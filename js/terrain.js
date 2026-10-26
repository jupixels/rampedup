// Heightmap terrain: generation, physics sampling, splat-mapped PBR rendering.
import * as THREE from 'three';
import { WORLD, ZONES, MOUNTAIN, LAKE, TRAIL, ROADS } from './layout.js';
import { makeNoise2D, fbm, smoothstep, clamp, lerp, distToSegment } from './util.js';
import { getTex, macroTexture } from './textures.js';

export class Terrain {
  constructor() {
    this.size = WORLD.size;
    this.seg = WORLD.segments;
    this.n = this.seg + 1;
    this.cell = this.size / this.seg;
    this.half = this.size / 2;
    this.heights = new Float32Array(this.n * this.n);
    this.splat = new Float32Array(this.n * this.n * 4); // dirt, rock, sand, noGrass
    this.paths = [];
    this.generate();
  }

  baseHeight(x, z) {
    const n = this.noise;
    let h = 3.5 + fbm(n, x / 320, z / 320, 5) * 9 + fbm(n, x / 90 + 40, z / 90, 3) * 1.6;
    // mountain with ridges
    const dm = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
    const ridge = 1 - Math.abs(n(x / 140 + 9, z / 140 - 3));
    h += MOUNTAIN.height * Math.exp(-(dm * dm) / (2 * MOUNTAIN.sigma ** 2)) * (0.82 + 0.25 * ridge);
    // lake basin
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z) + n(x / 60, z / 60) * 25;
    h -= (LAKE.depth + 3.5) * (1 - smoothstep(LAKE.radius * 0.4, LAKE.radius, dl));
    // border mountains enclose the world
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const e = smoothstep(560, 780, edge + n(x / 100, z / 100) * 30);
    h += e * e * (70 + 50 * ridge);
    return h;
  }

  generate() {
    const { n: N, cell, half } = this;
    this.noise = makeNoise2D(WORLD.seed);
    const H = this.heights;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      H[j * N + i] = this.baseHeight(-half + i * cell, -half + j * cell);
    }
    // Prepare path definitions with smoothed target heights
    const mkPath = (pts, width, falloff, kind) => {
      const samples = []; // {x,z,h,s}
      let s = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.ceil(L / 2));
        for (let q = 0; q < steps; q++) {
          const t = q / steps;
          const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          samples.push({ x, z, h: this.sampleRaw(x, z), s });
          s += L / steps;
        }
      }
      const last = pts[pts.length - 1];
      samples.push({ x: last[0], z: last[1], h: this.sampleRaw(last[0], last[1]), s });
      // smooth heights along the path
      const W = kind === 'trail' ? 6 : 10;
      const sm = samples.map((p, idx) => {
        let sum = 0, c = 0;
        for (let o = -W; o <= W; o++) {
          const q = samples[clamp(idx + o, 0, samples.length - 1)];
          sum += q.h; c++;
        }
        return sum / c;
      });
      samples.forEach((p, i) => (p.h = sm[i]));
      const path = { pts, samples, width, falloff, kind, length: s };
      this.paths.push(path);
      return path;
    };
    this.trail = mkPath(TRAIL, 4.5, 9, 'trail');
    for (const r of ROADS) mkPath(r.pts, r.width / 2, 8, 'road');

    // Zone targets
    for (const z of Object.values(ZONES)) {
      z.target = z.h ?? this.sampleRaw(z.x, z.z);
    }

    const out = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -half + i * cell, zc = -half + j * cell;
      const idx = j * N + i;
      let h = H[idx];
      let dirtW = 0, noGrass = 0, sand = 0;
      // paths
      for (const p of this.paths) {
        const best = this.nearestOnPath(p, x, zc);
        if (best.d > p.width + p.falloff) continue;
        const w = 1 - smoothstep(p.width, p.width + p.falloff, best.d);
        h = lerp(h, best.h - (p.kind === 'trail' ? 0.15 : 0.05), w);
        const dw = 1 - smoothstep(p.width - 0.5, p.width + 1.5 + this.noise(x / 3, zc / 3) * 1.2, best.d);
        dirtW = Math.max(dirtW, dw);
        if (p.kind === 'road') noGrass = Math.max(noGrass, dw);
      }
      // zones
      for (const z of Object.values(ZONES)) {
        const dx = Math.max(0, Math.abs(x - z.x) - z.hx), dz = Math.max(0, Math.abs(zc - z.z) - z.hz);
        const d = Math.hypot(dx, dz);
        if (d > z.falloff) continue;
        const w = 1 - smoothstep(0, z.falloff, d);
        h = lerp(h, z.target, w);
        if (z.surface === 'dirt') dirtW = Math.max(dirtW, 1 - smoothstep(0, 6, d + this.noise(x / 4, zc / 4) * 3));
        if (z.surface === 'concrete') noGrass = Math.max(noGrass, 1 - smoothstep(0, 4, d));
      }
      // shore sand
      const dl = Math.hypot(x - LAKE.x, zc - LAKE.z);
      if (dl < LAKE.radius * 1.2) sand = clamp(1 - Math.abs(h - WORLD.waterLevel - 0.6) / 1.8, 0, 1);
      out[idx] = h;
      this.splat[idx * 4] = dirtW;
      this.splat[idx * 4 + 2] = sand;
      this.splat[idx * 4 + 3] = noGrass;
    }
    this.heights = out;
    // rock weight from slope and altitude
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const nx = this.H(i - 1, j) - this.H(i + 1, j), nz = this.H(i, j - 1) - this.H(i, j + 1);
      const slope = Math.hypot(nx, nz) / (2 * cell);
      const alt = out[idx];
      let rock = smoothstep(0.62, 1.0, slope) + smoothstep(95, 135, alt) * 0.6;
      rock *= 1 - this.splat[idx * 4] * 0.9;
      this.splat[idx * 4 + 1] = clamp(rock, 0, 1);
    }
  }

  // Nearest point on a path. Uses a coarse grid of segments, so only nearby segments are tested.
  nearestOnPath(p, x, z, maxD = 40) {
    let best = { d: 1e9, h: 0, s: 0 };
    const S = p.samples;
    if (!p.grid) {
      p.grid = new Map();
      const C = 24;
      for (let k = 0; k < S.length - 1; k++) {
        const a = S[k], b = S[k + 1];
        const x0 = Math.floor((Math.min(a.x, b.x) - 40) / C), x1 = Math.floor((Math.max(a.x, b.x) + 40) / C);
        const z0 = Math.floor((Math.min(a.z, b.z) - 40) / C), z1 = Math.floor((Math.max(a.z, b.z) + 40) / C);
        for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
          const key = i * 4096 + j;
          let arr = p.grid.get(key);
          if (!arr) p.grid.set(key, (arr = []));
          arr.push(k);
        }
      }
      p.gridC = C;
    }
    if (maxD > 40) maxD = 40;
    const list = p.grid.get(Math.floor(x / p.gridC) * 4096 + Math.floor(z / p.gridC));
    if (!list) return best;
    for (let n = 0; n < list.length; n++) {
      const k = list[n];
      const a = S[k], b = S[k + 1];
      const r = distToSegment(x, z, a.x, a.z, b.x, b.z);
      if (r.d < best.d) best = { d: r.d, h: lerp(a.h, b.h, r.t), s: lerp(a.s, b.s, r.t), k, t: r.t };
    }
    return best;
  }


  pathPoint(p, s) {
    const S = p.samples;
    s = clamp(s, 0, p.length);
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; }
    const a = S[lo], b = S[hi];
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), h: lerp(a.h, b.h, t), dir: Math.atan2(b.x - a.x, b.z - a.z) };
  }

  H(i, j) {
    const N = this.n;
    i = clamp(i, 0, N - 1); j = clamp(j, 0, N - 1);
    return this.heights[j * N + i];
  }

  sampleRaw(x, z) { return this.sample(x, z); }

  // Height on the exact rendered triangulation
  sample(x, z) {
    const fx = (x + this.half) / this.cell, fz = (z + this.half) / this.cell;
    const i = clamp(Math.floor(fx), 0, this.seg - 1), j = clamp(Math.floor(fz), 0, this.seg - 1);
    const u = clamp(fx - i, 0, 1), v = clamp(fz - j, 0, 1);
    const h00 = this.H(i, j), h10 = this.H(i + 1, j), h01 = this.H(i, j + 1), h11 = this.H(i + 1, j + 1);
    if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
    return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  }

  normal(x, z, out = new THREE.Vector3()) {
    const fx = (x + this.half) / this.cell, fz = (z + this.half) / this.cell;
    const i = clamp(Math.floor(fx), 0, this.seg - 1), j = clamp(Math.floor(fz), 0, this.seg - 1);
    const u = fx - i, v = fz - j, c = this.cell;
    const h00 = this.H(i, j), h10 = this.H(i + 1, j), h01 = this.H(i, j + 1), h11 = this.H(i + 1, j + 1);
    let dx, dz;
    if (u + v <= 1) { dx = (h10 - h00) / c; dz = (h01 - h00) / c; }
    else { dx = (h11 - h01) / c; dz = (h11 - h10) / c; }
    return out.set(-dx, 1, -dz).normalize();
  }

  splatAt(x, z) {
    const N = this.n;
    const i = clamp(Math.round((x + this.half) / this.cell), 0, N - 1);
    const j = clamp(Math.round((z + this.half) / this.cell), 0, N - 1);
    const k = (j * N + i) * 4;
    return { dirt: this.splat[k], rock: this.splat[k + 1], sand: this.splat[k + 2], noGrass: this.splat[k + 3] };
  }

  surfaceAt(x, z) {
    const s = this.splatAt(x, z);
    if (s.noGrass > 0.5) return 'asphalt';
    if (s.dirt > 0.5) return 'dirt';
    if (s.rock > 0.5) return 'rock';
    if (s.sand > 0.5) return 'sand';
    return 'grass';
  }

  buildMesh() {
    const N = this.n, cell = this.cell, half = this.half;
    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const uv = new Float32Array(N * N * 2);
    const col = new Float32Array(N * N * 4);
    const v = new THREE.Vector3();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = -half + i * cell, z = -half + j * cell;
      pos[k * 3] = x; pos[k * 3 + 1] = this.heights[k]; pos[k * 3 + 2] = z;
      v.set(this.H(i - 1, j) - this.H(i + 1, j), 2 * cell, this.H(i, j - 1) - this.H(i, j + 1)).normalize();
      nor[k * 3] = v.x; nor[k * 3 + 1] = v.y; nor[k * 3 + 2] = v.z;
      uv[k * 2] = x / 4; uv[k * 2 + 1] = z / 4;
      col[k * 4] = this.splat[k * 4]; col[k * 4 + 1] = this.splat[k * 4 + 1];
      col[k * 4 + 2] = this.splat[k * 4 + 2]; col[k * 4 + 3] = this.splat[k * 4 + 3];
    }
    const idx = new Uint32Array(this.seg * this.seg * 6);
    let p = 0;
    for (let j = 0; j < this.seg; j++) for (let i = 0; i < this.seg; i++) {
      const a = j * N + i, b = j * N + i + 1, c = (j + 1) * N + i, d = (j + 1) * N + i + 1;
      // triangles (i,j),(i,j+1),(i+1,j) and (i,j+1),(i+1,j+1),(i+1,j) — matches sample()
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = c; idx[p++] = d; idx[p++] = b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('splat', new THREE.BufferAttribute(col, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();

    const grass = getTex('grass'), dirt = getTex('trackDirt'), rock = getTex('rock'), sand = getTex('dirt'), asph = getTex('asphalt');
    const mat = new THREE.MeshStandardMaterial({
      map: grass.map, normalMap: grass.normalMap, vertexColors: false, roughness: 1, metalness: 0,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tDirt = { value: dirt.map }; sh.uniforms.tDirtN = { value: dirt.normalMap };
      sh.uniforms.tRock = { value: rock.map }; sh.uniforms.tRockN = { value: rock.normalMap };
      sh.uniforms.tSand = { value: sand.map }; sh.uniforms.tAsph = { value: asph.map }; sh.uniforms.tAsphN = { value: asph.normalMap };
      sh.uniforms.tMacro = { value: macroTexture() };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(position,1.0)).xyz;\nvWNorm = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tDirt, tDirtN, tRock, tRockN, tSand, tAsph, tAsphN, tMacro;
varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNorm;
vec4 wts;`)
        .replace('#include <map_fragment>', `
vec2 tuv = vMapUv;
float macro = texture2D(tMacro, vWPos.xz / 220.0).r;
float macro2 = texture2D(tMacro, vWPos.xz / 41.0 + 0.3).r;
float wDirt = vSplat.r, wRock = vSplat.g, wSand = vSplat.b, wAsph = vSplat.a * (1.0 - vSplat.r);
// break up hard edges with noise
wRock = clamp(wRock + (macro2 - 0.5) * 0.6 * step(0.05, wRock), 0.0, 1.0);
wDirt = clamp(wDirt * (0.75 + macro2 * 0.5), 0.0, 1.0);
float wGrass = max(0.0, 1.0 - wDirt - wRock - wSand - wAsph);
float tot = wGrass + wDirt + wRock + wSand + wAsph + 1e-4;
wts = vec4(wDirt, wRock, wSand, wAsph) / tot; float wg = wGrass / tot;
vec3 cg = texture2D(map, tuv).rgb * mix(vec3(0.85,0.95,0.8), vec3(1.15,1.05,0.85), macro);
cg = mix(cg, cg * vec3(1.1, 0.95, 0.7), smoothstep(0.55, 0.8, macro2) * 0.5);
vec3 cd = texture2D(tDirt, tuv * 0.8).rgb;
vec3 cr = texture2D(tRock, tuv * 0.35).rgb * (0.85 + macro * 0.3);
vec3 cs = texture2D(tSand, tuv).rgb * vec3(1.25, 1.18, 1.02);
vec3 ca = texture2D(tAsph, tuv * 0.7).rgb;
vec3 albedo = cg * wg + cd * wts.x + cr * wts.y + cs * wts.z + ca * wts.w;
// distant tiling fade
float dist = length(vViewPosition);
albedo = mix(albedo, albedo * (0.8 + macro * 0.4), smoothstep(30.0, 200.0, dist));
diffuseColor.rgb *= albedo;
`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * (wg * 0.95 + wts.x * 0.92 + wts.y * 0.8 + wts.z * 0.9 + wts.w * 0.85);`)
        .replace('#include <normal_fragment_maps>', `
vec3 nG = texture2D(normalMap, tuv).xyz * 2.0 - 1.0;
vec3 nD = texture2D(tDirtN, tuv * 0.8).xyz * 2.0 - 1.0;
vec3 nR = texture2D(tRockN, tuv * 0.35).xyz * 2.0 - 1.0;
vec3 nA = texture2D(tAsphN, tuv * 0.7).xyz * 2.0 - 1.0;
vec3 mapN = normalize(nG * (wg + wts.z) + nD * wts.x + nR * wts.y * 1.6 + nA * wts.w);
mapN.xy *= normalScale * mix(1.0, 0.35, smoothstep(20.0, 120.0, length(vViewPosition)));
normal = normalize(tbn * mapN);
`);
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.mesh = mesh;
    return mesh;
  }

  // Data textures for the GPU grass shader
  makeDataTextures() {
    const N = this.n;
    const hd = new Float32Array(N * N);
    hd.set(this.heights);
    const ht = new THREE.DataTexture(hd, N, N, THREE.RedFormat, THREE.FloatType);
    ht.magFilter = ht.minFilter = THREE.NearestFilter;
    ht.needsUpdate = true;
    const sd = new Uint8Array(N * N * 4);
    for (let k = 0; k < N * N; k++) {
      const grassW = clamp(1 - this.splat[k * 4] * 1.4 - this.splat[k * 4 + 1] * 1.5 - this.splat[k * 4 + 2] * 2 - this.splat[k * 4 + 3] * 3, 0, 1);
      sd[k * 4] = grassW * 255;
      sd[k * 4 + 3] = 255;
    }
    const st = new THREE.DataTexture(sd, N, N, THREE.RGBAFormat);
    st.magFilter = st.minFilter = THREE.LinearFilter;
    st.needsUpdate = true;
    return { heightTex: ht, maskTex: st };
  }
}

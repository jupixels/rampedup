// Builds the open world: environment, terrain, vegetation, water and all the
// riding spots. Deterministic, so every player gets an identical world.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Terrain } from './terrain.js';
import { Collision } from './collision.js';
import { Builder, Profile, profiles } from './props.js';
import { WORLD, ZONES, LAKE } from './layout.js';
import { rng, clamp, smoothstep } from './util.js';
import { getTex, leafTexture, pineTexture, waterNormalTexture, preloadTextures } from './textures.js';

// ---------------- Environment ----------------
export const TIMES = {
  golden:   { label: 'Golden Hour', elev: 17, azim: 228, turb: 4.5, ray: 1.9, mie: 0.0025, mieG: 0.7, sun: 0xffd6a8, sunI: 2.1, hemiSky: 0x9fb8e8, hemiGround: 0x5a4a36, hemiI: 0.42, fog: 0xbfb3a4, fogD: 0.0008, exp: 0.72, env: 0.15, cloud: [1.0, 0.86, 0.72] },
  midday:   { label: 'Midday',      elev: 58, azim: 160, turb: 3.2, ray: 1.1, mie: 0.0025, mieG: 0.7,  sun: 0xfff4e6, sunI: 2.0, hemiSky: 0xa9c8ef, hemiGround: 0x5d5642, hemiI: 0.42, fog: 0xb4c9de, fogD: 0.0007, exp: 0.58, env: 0.2, cloud: [1, 1, 1] },
  sunset:   { label: 'Sunset',      elev: 3.2, azim: 248, turb: 8.5, ray: 2.8, mie: 0.005, mieG: 0.78, sun: 0xff9e62, sunI: 1.5, hemiSky: 0x8a8fc4, hemiGround: 0x4a3830, hemiI: 0.38, fog: 0xc89a84, fogD: 0.001, exp: 0.85, env: 0.13, cloud: [1.0, 0.62, 0.5] },
  overcast: { label: 'Overcast',    elev: 40, azim: 190, turb: 18, ray: 0.35, mie: 0.04, mieG: 0.7,   sun: 0xe8ecf0, sunI: 0.6, hemiSky: 0xc9d1da, hemiGround: 0x5a5a52, hemiI: 0.9, fog: 0xaeb4ba, fogD: 0.0016, exp: 0.78, env: 0.45, cloud: [0.78, 0.8, 0.83] },
};

export class Environment {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.sky.material.depthWrite = false;
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = quality.shadows > 0;
    const ss = quality.shadows || 1024;
    this.sun.shadow.mapSize.set(ss, ss);
    const S = quality.shadowRange || 70;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 600 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.shadowRange = S;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xc0c0c0, 0.001);
    this.sunDir = new THREE.Vector3();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.clouds = this.makeClouds();
    scene.add(this.clouds);
  }

  makeClouds() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3() }, uTint: { value: new THREE.Color(1, 1, 1) }, uCover: { value: 0.5 } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        varying vec3 vW; uniform float uTime; uniform vec3 uSun; uniform vec3 uTint; uniform float uCover;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec2 p = vW.xz / 1400.0 + vec2(uTime*0.004, uTime*0.0015);
          float d = fbm(p) ;
          float c = smoothstep(uCover, uCover + 0.28, d);
          float edge = length(vW.xz) / 9000.0;
          c *= 1.0 - smoothstep(0.55, 1.0, edge);
          float shade = fbm(p * 2.0 + 3.1);
          vec3 col = mix(vec3(0.62,0.66,0.72), vec3(1.0), smoothstep(0.3, 0.8, shade)) * uTint;
          float sunGlow = pow(max(0.0, dot(normalize(vW - cameraPosition), uSun)), 8.0);
          col += uTint * sunGlow * 0.6 * (1.0 - c);
          gl_FragColor = vec4(col, c * 0.85);
        }`,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(18000, 18000, 1, 1).rotateX(-Math.PI / 2), mat);
    m.position.y = 1100;
    m.renderOrder = -1;
    m.frustumCulled = false;
    return m;
  }

  setTime(key) {
    const t = TIMES[key] || TIMES.golden;
    this.time = t;
    const u = this.sky.material.uniforms;
    u.turbidity.value = t.turb; u.rayleigh.value = t.ray;
    u.mieCoefficient.value = t.mie; u.mieDirectionalG.value = t.mieG;
    const phi = THREE.MathUtils.degToRad(90 - t.elev), theta = THREE.MathUtils.degToRad(t.azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.sun.color.set(t.sun); this.sun.intensity = t.sunI;
    this.hemi.color.set(t.hemiSky); this.hemi.groundColor.set(t.hemiGround); this.hemi.intensity = t.hemiI;
    this.scene.fog.color.set(t.fog); this.scene.fog.density = t.fogD;
    this.renderer.toneMappingExposure = t.exp;
    this.clouds.material.uniforms.uSun.value.copy(this.sunDir);
    this.clouds.material.uniforms.uTint.value.setRGB(...t.cloud);
    this.clouds.material.uniforms.uCover.value = key === 'overcast' ? 0.3 : 0.52;
    // environment map from the sky
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    Object.keys(u).forEach((k) => { if (sky2.material.uniforms[k]) sky2.material.uniforms[k].value = u[k].value.clone ? u[k].value.clone() : u[k].value; });
    envScene.add(sky2);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(t.hemiGround).multiplyScalar(1.2) }));
    ground.position.y = -40;
    envScene.add(ground);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0, 1, 2000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = t.env;
  }

  update(dt, focus) {
    // shadow camera follows the player, snapped to texels to avoid shimmer
    const S = this.shadowRange;
    const texel = (2 * S) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 250, focus.y + this.sunDir.y * 250, fz + this.sunDir.z * 250);
    this.sun.target.updateMatrixWorld();
    this.clouds.material.uniforms.uTime.value += dt;
    this.clouds.position.x = focus.x; this.clouds.position.z = focus.z;
  }
}

// ---------------- Vegetation ----------------
function makeBroadleaf(seed) {
  const r = rng(seed);
  const trunkH = 3.2 + r() * 2;
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, trunkH + 2, 9, 4, true);
  trunk.translate(0, (trunkH + 2) / 2 - 0.3, 0);
  // slight bend
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    tp.setX(i, tp.getX(i) + Math.sin(y * 0.5) * 0.12);
  }
  // some branches
  const geos = [trunk];
  for (let b = 0; b < 4; b++) {
    const len = 1.8 + r() * 1.4;
    const br = new THREE.CylinderGeometry(0.05, 0.1, len, 6);
    br.translate(0, len / 2, 0);
    br.rotateZ(0.7 + r() * 0.4);
    br.rotateY(r() * Math.PI * 2);
    br.translate(0, trunkH * (0.65 + r() * 0.3), 0);
    geos.push(br);
  }
  const crownC = new THREE.Vector3(0, trunkH + 2.2, 0);
  const rx = 2.6 + r() * 1.2, ry = 2.4 + r() * 1, rz = 2.6 + r() * 1.2;
  const leaves = [];
  const pos = [], nor = [], uv = [], idx = [];
  const cards = 46;
  for (let c = 0; c < cards; c++) {
    // point in ellipsoid, biased to the surface
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.cbrt(0.35 + 0.65 * r());
    const s = Math.sqrt(1 - u * u);
    const p = new THREE.Vector3(Math.cos(th) * s * rx * rr, u * ry * rr, Math.sin(th) * s * rz * rr).add(crownC);
    const size = 1.7 + r() * 1.1;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * Math.PI, r() * Math.PI, r() * Math.PI));
    const ax = new THREE.Vector3(size / 2, 0, 0).applyQuaternion(q), ay = new THREE.Vector3(0, size / 2, 0).applyQuaternion(q);
    const n = p.clone().sub(crownC).normalize().multiply(new THREE.Vector3(1, 1.3, 1)).normalize();
    const b = pos.length / 3;
    for (const [sx, sy, uu, vv] of [[-1, -1, 0, 0], [1, -1, 1, 0], [-1, 1, 0, 1], [1, 1, 1, 1]]) {
      const v = p.clone().addScaledVector(ax, sx).addScaledVector(ay, sy);
      pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); uv.push(uu, vv);
    }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  lg.setIndex(idx);
  const trunkG = mergeSimple(geos);
  return { trunk: trunkG, leaves: lg, height: crownC.y + ry };
}

function makePine(seed) {
  const r = rng(seed);
  const H = 9 + r() * 6;
  const trunk = new THREE.CylinderGeometry(0.08, 0.32, H, 8, 1, true);
  trunk.translate(0, H / 2 - 0.3, 0);
  const pos = [], nor = [], uv = [], idx = [];
  const levels = 17;
  for (let l = 0; l < levels; l++) {
    const t = l / levels;
    const y = 1.8 + t * (H - 2);
    const rad = (1 - t) * (2.6 + r() * 0.4) + 0.3;
    const count = Math.max(4, Math.round(9 * (1 - t) + 4));
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + r() * 0.5 + l;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const len = rad * 1.3, wid = rad * 1.0;
      const droop = -0.35 - r() * 0.25;
      const p0 = new THREE.Vector3(0, y, 0);
      const p1 = dir.clone().multiplyScalar(len).add(new THREE.Vector3(0, y + droop * len, 0));
      const b = pos.length / 3;
      const n = dir.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.8, 0)).normalize();
      const verts = [
        p0.clone().addScaledVector(side, -wid * 0.15), p0.clone().addScaledVector(side, wid * 0.15),
        p1.clone().addScaledVector(side, -wid * 0.5), p1.clone().addScaledVector(side, wid * 0.5),
      ];
      const uvs = [[0, 0.3], [0, 0.3], [1, 0.6], [1, 0.6]];
      // map card: u along branch, v across
      const uvc = [[0.0, 0.15], [0.0, 0.55], [1.0, 0.25], [1.0, 0.95]];
      verts.forEach((v, i) => { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); uv.push(uvc[i][0], uvc[i][1]); });
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  lg.setIndex(idx);
  return { trunk, leaves: lg, height: H };
}

function mergeSimple(geos) {
  const out = { p: [], n: [], uv: [], idx: [] };
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0;
    const base = out.p.length / 3;
    out.p.push(...g.attributes.position.array);
    out.n.push(...g.attributes.normal.array);
    out.uv.push(...g.attributes.uv.array);
    for (let i = 0; i < g.index.count; i++) out.idx.push(g.index.getX(i) + base);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  g.setIndex(out.idx);
  return g;
}

const windUniforms = { uTime: { value: 0 } };
function addWind(mat, strength = 0.12) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float sway = sin(uTime * 1.3 + ip.x * 0.21 + ip.z * 0.17) + 0.5 * sin(uTime * 2.7 + ip.z * 0.4 + position.y);
      transformed.x += sway * ${strength.toFixed(3)} * max(0.0, position.y - 2.0) * 0.12;
      transformed.z += sway * ${(strength * 0.6).toFixed(3)} * max(0.0, position.y - 2.0) * 0.12;
      transformed += normal * sin(uTime * 4.0 + position.x * 3.0 + ip.z) * 0.03;`);
  };
}

function scatterTrees(scene, terrain, world, quality) {
  const r = rng(4242);
  const bark = getTex('bark');
  const trunkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 1 });
  bark.map.repeat.set(2, 3);
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, color: 0xd8e8c8 });
  const pineMat = new THREE.MeshStandardMaterial({ map: pineTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, color: 0xc8d8c0 });
  addWind(leafMat, 0.14); addWind(pineMat, 0.08);
  const kinds = [makeBroadleaf(1), makeBroadleaf(2), makeBroadleaf(3), makePine(4), makePine(5)];
  const lists = kinds.map(() => []);
  const total = quality.trees;
  const blocked = (x, z) => {
    for (const zn of Object.values(ZONES)) {
      if (Math.abs(x - zn.x) < zn.hx + 6 && Math.abs(z - zn.z) < zn.hz + 6) {
        // Loam Woods keeps trees between the lines
        if (zn === ZONES.woods && (Math.abs(x - zn.x) > 32 && Math.abs(x - zn.x) < zn.hx + 6)) return false;
        return true;
      }
    }
    for (const p of terrain.paths) {
      const d = terrain.nearestOnPath(p, x, z).d;
      if (d < p.width + 3) return true;
    }
    return false;
  };
  let tries = 0;
  const half = WORLD.size / 2 - 40;
  while ((lists.reduce((a, l) => a + l.length, 0)) < total && tries < total * 12) {
    tries++;
    const x = (r() * 2 - 1) * half, z = (r() * 2 - 1) * half;
    const dens = terrain.noise(x / 160, z / 160) * 0.5 + 0.5;
    const nearWoods = Math.abs(x - ZONES.woods.x) < 110 && Math.abs(z - ZONES.woods.z) < 170;
    if (r() > dens * dens * 1.6 + (nearWoods ? 0.6 : 0)) continue;
    const h = terrain.sample(x, z);
    if (h < WORLD.waterLevel + 0.6) continue;
    const n = terrain.normal(x, z);
    if (n.y < 0.78) continue;
    if (blocked(x, z)) continue;
    const s = terrain.splatAt(x, z);
    if (s.noGrass > 0.3) continue;
    const alpine = h > 40 || r() < 0.18;
    const kind = alpine ? 3 + (r() < 0.5 ? 0 : 1) : Math.floor(r() * 3);
    const sc = 0.8 + r() * 0.55;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.1, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2), new THREE.Vector3(sc, sc * (0.9 + r() * 0.25), sc));
    lists[kind].push(m);
    world.treePoints.push([x, z]);
  }
  // Split each tree kind into spatial chunks so the camera and the shadow pass only draw nearby trees
  const CH = 240;
  const tint = new THREE.Color();
  kinds.forEach((k, i) => {
    const chunks = new Map();
    for (const m of lists[i]) {
      const key = Math.floor(m.elements[12] / CH) + ':' + Math.floor(m.elements[14] / CH);
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(m);
    }
    for (const L of chunks.values()) {
      const tm = new THREE.InstancedMesh(k.trunk, trunkMat, L.length);
      const lm = new THREE.InstancedMesh(k.leaves, i >= 3 ? pineMat : leafMat, L.length);
      L.forEach((m, j) => {
        tm.setMatrixAt(j, m); lm.setMatrixAt(j, m);
        tint.setHSL(0.24 + (r() - 0.5) * 0.06, 0.35 + r() * 0.2, 0.42 + r() * 0.16);
        lm.setColorAt(j, tint);
      });
      for (const mm of [tm, lm]) { mm.castShadow = quality.shadows > 0; mm.receiveShadow = true; mm.computeBoundingSphere(); mm.matrixAutoUpdate = false; scene.add(mm); }
    }
  });
  // collision: tree trunks as thin solid columns
  for (let i = 0; i < kinds.length; i++) for (const m of lists[i]) {
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    world.trunks.push(p);
  }
}

function scatterRocks(scene, terrain, collision, quality) {
  const r = rng(999);
  const base = new THREE.IcosahedronGeometry(1, 2);
  const n2 = (x, y, z) => Math.sin(x * 2.1 + y * 1.3) * 0.5 + Math.sin(y * 3.7 + z * 2.9) * 0.25 + Math.sin(z * 5.1 + x * 4.3) * 0.12;
  const variants = [0, 1, 2].map((v) => {
    const g = base.clone();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = 1 + n2(x + v * 3, y + v, z - v * 2) * 0.22;
      p.setXYZ(i, x * d * 1.2, y * d * 0.65, z * d);
    }
    g.computeVertexNormals();
    return g;
  });
  const rt = getTex('rock');
  const mat = new THREE.MeshStandardMaterial({ map: rt.map, normalMap: rt.normalMap, roughness: 0.95, color: 0xbab4aa });
  const lists = [[], [], []];
  for (let i = 0; i < quality.rocks; i++) {
    const half = WORLD.size / 2 - 60;
    const x = (r() * 2 - 1) * half, z = (r() * 2 - 1) * half;
    const h = terrain.sample(x, z);
    const s = terrain.splatAt(x, z);
    if (s.noGrass > 0.2 || s.dirt > 0.3) continue;
    let ok = false;
    for (const zn of Object.values(ZONES)) if (Math.abs(x - zn.x) < zn.hx + 4 && Math.abs(z - zn.z) < zn.hz + 4) ok = true;
    if (ok) continue;
    if (r() > 0.25 + s.rock) continue;
    const sc = 0.4 + r() * r() * 2.6;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - sc * 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 0.3, r() * 6.28, r() * 0.3)), new THREE.Vector3(sc, sc, sc));
    lists[i % 3].push(m);
  }
  lists.forEach((L, v) => {
    const im = new THREE.InstancedMesh(variants[v], mat, L.length);
    L.forEach((m, j) => {
      im.setMatrixAt(j, m);
      const tmp = new THREE.Mesh(variants[v]);
      tmp.matrixWorld.copy(m);
      tmp.updateWorldMatrix = () => {};
      collision.addMesh(tmp, 'rock');
    });
    im.castShadow = quality.shadows > 0; im.receiveShadow = true;
    im.computeBoundingSphere();
    scene.add(im);
  });
}

// GPU grass: a fixed instanced grid that follows the camera, heights sampled from a texture.
function makeGrass(terrain, quality) {
  if (!quality.grass) return null;
  const { heightTex, maskTex } = terrain.makeDataTextures();
  const spacing = quality.grassSpacing, radius = quality.grassRadius;
  const n = Math.floor((radius * 2) / spacing);
  const count = n * n;
  const blade = new THREE.BufferGeometry();
  const segs = 3;
  const p = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, w = 0.024 * (1 - t * 0.9);
    p.push(-w, t, 0, w, t, 0);
    uv.push(0, t, 1, t);
  }
  for (let i = 0; i < segs; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  blade.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute(p.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  blade.setIndex(idx);
  const g = new THREE.InstancedBufferGeometry().copy(blade);
  g.instanceCount = count;
  const offs = new Float32Array(count * 2);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { offs[k++] = -radius + i * spacing; offs[k++] = -radius + j * spacing; }
  g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offs, 2));
  const uniforms = {
    uCenter: { value: new THREE.Vector2() }, uHeight: { value: heightTex }, uMask: { value: maskTex },
    uHalf: { value: terrain.half }, uCell: { value: terrain.cell }, uN: { value: terrain.n }, uSize: { value: terrain.size },
    uTime: windUniforms.uTime, uRadius: { value: radius }, uSpacing: { value: spacing }, uCam: { value: new THREE.Vector3() },
  };
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 iOffset;
        uniform vec2 uCenter; uniform sampler2D uHeight; uniform sampler2D uMask;
        uniform float uHalf, uCell, uN, uSize, uTime, uRadius, uSpacing; uniform vec3 uCam;
        varying float vT; varying float vVar;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float H(float i, float j){ i = clamp(i, 0.0, uN - 1.0); j = clamp(j, 0.0, uN - 1.0); return texelFetch(uHeight, ivec2(int(i), int(j)), 0).r; }
        float terrainH(vec2 p){
          vec2 f = (p + uHalf) / uCell; vec2 ij = floor(f); vec2 uv = f - ij;
          float h00 = H(ij.x, ij.y), h10 = H(ij.x+1.0, ij.y), h01 = H(ij.x, ij.y+1.0), h11 = H(ij.x+1.0, ij.y+1.0);
          if (uv.x + uv.y <= 1.0) return h00 + uv.x*(h10-h00) + uv.y*(h01-h00);
          return h11 + (1.0-uv.x)*(h01-h11) + (1.0-uv.y)*(h10-h11);
        }`)
      .replace('#include <begin_vertex>', `
        vec2 cell = uCenter + iOffset;
        float r1 = hash(cell), r2 = hash(cell + 17.31), r3 = hash(cell * 1.7 + 3.1);
        vec2 wxz = cell + (vec2(r1, r2) - 0.5) * uSpacing * 1.6;
        float mask = texture2D(uMask, (wxz + uHalf) / uSize).r;
        float dist = distance(wxz, uCam.xz);
        float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius * 0.95, dist);
        float clump = 0.6 + 0.8 * fract(sin(dot(floor(wxz / 1.7), vec2(4.1, 7.3))) * 921.7);
        float sc = mask * fade * step(0.25, mask);
        float hgt = (0.16 + r3 * 0.3) * clump * sc * (0.6 + 0.4 * fade);
        vT = uv.y; vVar = r1;
        float ang = r2 * 6.2831;
        vec3 pos = position;
        pos.x *= (0.7 + r1 * 0.7) * (sc > 0.0 ? 1.0 : 0.0);
        pos.y *= hgt;
        float wind = sin(uTime * 1.6 + wxz.x * 0.35 + wxz.y * 0.22) * 0.5 + sin(uTime * 3.1 + wxz.x * 1.1) * 0.25;
        float bend = (0.25 + wind * 0.35) * uv.y * uv.y * hgt;
        vec3 transformed = vec3(cos(ang) * pos.x, pos.y, sin(ang) * pos.x);
        transformed.x += cos(ang + 1.57) * bend + wind * 0.08 * uv.y * hgt;
        transformed.z += sin(ang + 1.57) * bend;
        transformed += vec3(wxz.x, terrainH(wxz) - 0.02, wxz.y);
      `)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(transformed, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vT; varying float vVar;')
      .replace('#include <map_fragment>', `
        vec3 base = mix(vec3(0.13, 0.19, 0.07), vec3(0.18, 0.23, 0.09), vVar);
        vec3 tip = mix(vec3(0.36, 0.44, 0.17), vec3(0.5, 0.5, 0.24), vVar);
        diffuseColor.rgb *= mix(base, tip, vT) * mix(0.6, 1.0, vT);`)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;');
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.update = (camPos) => {
    uniforms.uCenter.value.set(Math.round(camPos.x / spacing) * spacing, Math.round(camPos.z / spacing) * spacing);
    uniforms.uCam.value.copy(camPos);
  };
  return mesh;
}

function makeWater() {
  const nt = waterNormalTexture();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b3a40, roughness: 0.04, metalness: 0.15, normalMap: nt, transparent: true, opacity: 0.9, envMapIntensity: 1.3 });
  const u = { uTime: windUniforms.uTime };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <normal_fragment_maps>', `
        vec2 wuv = vNormalMapUv;
        vec3 n1 = texture2D(normalMap, wuv + vec2(uTime * 0.012, uTime * 0.007)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(normalMap, wuv * 1.9 - vec2(uTime * 0.009, -uTime * 0.013)).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
        mapN.xy *= 0.35;
        normal = normalize(tbn * mapN);`);
  };
  const g = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 1, 1).rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 70, uv.getY(i) * 70);
  const m = new THREE.Mesh(g, mat);
  m.position.set(0, WORLD.waterLevel, 0);
  m.receiveShadow = true;
  return m;
}

// ---------------- Zone layouts ----------------
function buildYard(B, A) {
  const Z = ZONES.yard;
  const yy = Z.target + 0.05;
  B.box({ x: 0, z: 0, y: Z.target - 0.6, w: Z.hx * 2, h: 0.65, d: Z.hz * 2, mat: 'concrete', tile: 4, surface: 'concrete', cast: false });
  const sk = { top: 'skatelite', side: 'plywood', surface: 'wood', y: yy };
  // vert ramp (north-west)
  B.quarterPipe({ ...sk, x: -35, z: -48, yaw: Math.PI, width: 18, h: 3.3, R: 3.1, deck: 3 });
  // mini halfpipe (north-east)
  B.quarterPipe({ ...sk, x: 35, z: -40, yaw: Math.PI, width: 12, h: 2.4, R: 2.6, deck: 2.2 });
  B.quarterPipe({ ...sk, x: 35, z: -34, yaw: 0, width: 12, h: 2.4, R: 2.6, deck: 2.2 });
  // funbox in the middle with a rail and a ledge
  B.ramp(profiles.funbox(1.2, 3.5, 6), { ...sk, x: 0, z: -1.5, yaw: Math.PI, width: 10 });
  B.rail(new THREE.Vector3(-2.5, yy + 1.2 + 0.42, -5.4), new THREE.Vector3(-2.5, yy + 1.2 + 0.42, -10.6), { mat: 'railRed', postEvery: 2.5 });
  B.box({ x: 2.8, z: -8, y: yy + 1.2, w: 0.9, h: 0.36, d: 5.6, mat: 'concreteSmooth', ledge: true });
  // side hubba rail down the funbox's north slope
  B.rail(new THREE.Vector3(5.6, yy + 1.2 + 0.5, -10.4), new THREE.Vector3(5.6, yy + 0.5, -14.2), { mat: 'railBlack', postEvery: 2 });
  // jump line (east), riders head north
  const jx = 56;
  B.ramp(profiles.jumpbox(1.0, 30, 2.8, 22), { ...sk, x: jx, z: 52, yaw: Math.PI, width: 5 });
  B.ramp(profiles.jumpbox(1.6, 33, 4.2, 25), { ...sk, x: jx, z: 30, yaw: Math.PI, width: 5.5 });
  B.ramp(profiles.jumpbox(2.3, 35, 5.6, 27), { ...sk, x: jx, z: 2, yaw: Math.PI, width: 6 });
  B.quarterPipe({ ...sk, x: jx, z: -50, yaw: Math.PI, width: 10, h: 2.8, R: 3.0, deck: 2 });
  // plinth with bank, stairs and handrail (west)
  B.box({ x: -62, z: 20, y: yy, w: 16, h: 1.4, d: 14, mat: 'concreteSmooth', tile: 3, ledge: false });
  B.ramp(new Profile().line(Math.atan2(1.4, 3.2), Math.hypot(1.4, 3.2)).by(0.3, 0), { x: -50.6, z: 20, y: yy, yaw: -Math.PI / 2, width: 8, top: 'concreteSmooth', side: 'concreteDark', surface: 'concrete', tile: 3 });
  B.ramp(profiles.stairs(5, 0.28, 0.42), { x: -62, z: 13, y: yy, yaw: Math.PI, width: 6, top: 'concreteSmooth', side: 'concreteDark', surface: 'concrete', tile: 3 });
  B.rail(new THREE.Vector3(-58.4, yy + 1.4 + 0.5, 17.5), new THREE.Vector3(-58.4, yy + 1.4 + 0.5, 13.2), { mat: 'railBlack', postEvery: 2 });
  B.rail(new THREE.Vector3(-58.4, yy + 1.4 + 0.5, 13.2), new THREE.Vector3(-58.4, yy + 0.5, 10.0), { mat: 'railBlack', postEvery: 2 });
  // ledges
  B.box({ x: -30, z: 30, y: yy, w: 1.0, h: 0.45, d: 14, mat: 'concreteSmooth', ledge: true, tile: 3 });
  B.box({ x: -16, z: 42, y: yy, w: 12, h: 0.5, d: 0.8, mat: 'concreteSmooth', ledge: true, tile: 3 });
  // manual pad
  B.box({ x: 22, z: 22, y: yy, w: 3, h: 0.3, d: 7, mat: 'concreteSmooth', ledge: true, tile: 3 });
  // flat + down rails
  B.rail(new THREE.Vector3(8, yy + 0.45, 48), new THREE.Vector3(20, yy + 0.45, 48), { mat: 'railRed' });
  B.rail(new THREE.Vector3(-14, yy + 0.95, 36), new THREE.Vector3(-4, yy + 0.45, 36), { mat: 'railYellow' });
  // spine
  B.ramp(profiles.spine(1.8, 2.4), { ...sk, x: 0, z: -34, yaw: Math.PI, width: 8 });
  // rollers (pump line) along the south
  B.ramp(profiles.rollers(40, 0.55, 5), { x: -62, z: 56, y: yy, yaw: Math.PI / 2, width: 3.6, top: 'concreteSmooth', side: 'concreteDark', surface: 'concrete', tile: 3 });
  // bank wall south-east
  B.ramp(profiles.bank(1.6, 2.6, 2), { ...sk, x: 30, z: 60, yaw: 0, width: 14 });
  // graffiti walls & decor
  B.graffitiWall(-20, 66, 0, 10, 2.4, 0);
  B.graffitiWall(52, 66, 0, 8, 2.4, 1);
  B.graffitiWall(-76, -30, Math.PI / 2, 10, 2.4, 2);
  B.graffitiWall(76, 30, Math.PI / 2, 10, 2.4, 3);
  for (let x = -70; x <= 70; x += 28) { B.lamp(x, -71, 7, -Math.PI / 2); B.lamp(x, 71, 7, Math.PI / 2); }
  for (let z = -42; z <= 42; z += 28) { B.lamp(-81, z, 7, 0); B.lamp(81, z, 7, Math.PI); }
  B.bench(-8, 62, 0); B.bench(8, 62, 0); B.bench(-74, 50, Math.PI / 2);
  const r = rng(321);
  for (let i = 0; i < 46; i++) B.decal(r.pick(['stain', 'tire', 'tire', 'crack']), (r() - 0.5) * 150, (r() - 0.5) * 130, yy + 0.003, 2 + r() * 5, r() * 6.28);
  A.yardSpawn = new THREE.Vector3(0, yy, 30);
  A.yy = yy;
}

function buildWoods(B, A) {
  const Z = ZONES.woods;
  const ty = Z.target;
  const dirt = { top: 'dirt', side: 'dirt', surface: 'dirt', tile: 3, sideTile: 3, sideSlope: 0.9 };
  // roll-in mound at the south end
  const mound = new Profile().line(0.95, 4.6 / Math.sin(0.95)).by(4, 0).arc(4, 0, -0.42, 8);
  mound.line(-0.42, (mound.end[1] - 7 * (1 - Math.cos(0.42))) / Math.sin(0.42)).arc(7, -0.42, 0, 10);
  B.ramp(mound, { ...dirt, x: 300.5, z: 88, y: ty, yaw: Math.PI, width: 34 });
  // line A
  let z = 58;
  const linesA = [[1.0, 2.6], [1.1, 2.9], [1.2, 3.2], [1.3, 3.4], [1.4, 3.6]];
  linesA.forEach(([h, gap], i) => { B.ramp(profiles.dirtDouble(h, gap), { ...dirt, x: 288, z, y: ty, yaw: Math.PI, width: 3.4 }); z -= 23; });
  // line B (bigger)
  z = 54;
  const linesB = [[1.7, 3.6], [1.9, 4.0], [2.1, 4.4], [2.3, 4.8]];
  linesB.forEach(([h, gap]) => { B.ramp(profiles.dirtDouble(h, gap, 40), { ...dirt, x: 313, z, y: ty, yaw: Math.PI, width: 3.6 }); z -= 30; });
  // turnaround wall
  B.ramp(profiles.quarter(3.2, 4.2, 1.5, 70), { ...dirt, x: 300, z: -140, y: ty, yaw: Math.PI, width: 44, sideSlope: 1.2 });
  // a few tree stumps / logs as decor
  for (let i = 0; i < 10; i++) {
    const lx = 270 + (i % 2) * 60, lz = 70 - i * 22;
    B.add(new THREE.CylinderGeometry(0.25, 0.25, 3.2, 10).rotateZ(Math.PI / 2), 'deck', B.matrix(lx, B.groundY(lx, lz) + 0.25, lz, i));
  }
  A.woodsTop = new THREE.Vector3(288, ty + 4.6, 82);
}

function buildDocks(B, A) {
  const Z = ZONES.docks;
  const ty = Z.target;
  const yy = ty + 0.05;
  A.docksY = yy;
  B.box({ x: Z.x, z: Z.z, y: ty - 0.6, w: Z.hx * 2, h: 0.65, d: Z.hz * 2, mat: 'concreteDark', top: 'asphalt', tile: 4, surface: 'concrete', cast: false });
  const colors = ['containerRed', 'containerBlue', 'containerGreen', 'containerYellow', 'containerGrey'];
  const r = rng(55);
  // container rows (scenery + gap line)
  for (let i = 0; i < 4; i++) {
    B.container({ x: -390 + i * 14, z: -28, y: yy, color: colors[i % 5] });
    B.container({ x: -390 + i * 14, z: -28, y: yy, color: colors[(i + 2) % 5], stackOn: 1 });
    B.container({ x: -390 + i * 14, z: -17, y: yy, color: colors[(i + 3) % 5] });
  }
  // gap-jump line on top of containers (riders go west)
  const gapX = [-349, -366, -383, -400];
  gapX.forEach((x, i) => B.container({ x, z: 8, y: yy, color: colors[(i + 1) % 5] }));
  B.ramp(profiles.bank(2.6, 9, 0).pts.slice(0, -1), { x: -333.9, z: 8, y: yy, yaw: -Math.PI / 2, width: 2.4, top: 'deck', side: 'wood', surface: 'wood' });
  A.containerLine = new THREE.Vector3(-330, yy, 8);
  // container drop: 2-high stack with ramp up and roll-in down
  for (const zz of [77.55, 80.45]) {
    B.container({ x: -300, z: zz, y: yy, color: r.pick(colors) });
    B.container({ x: -300, z: zz, y: yy, color: r.pick(colors), stackOn: 1 });
  }
  B.ramp(profiles.bank(5.2, 16, 0).pts.slice(0, -1), { x: -277.9, z: 79, y: yy, yaw: -Math.PI / 2, width: 4.8, top: 'deck', side: 'wood', surface: 'wood' });
  B.scaffold(-293.6, 77, -279, 81, (x) => yy + (5.2 * (-277.9 - x)) / 16);
  B.ramp(profiles.landing(5.2, 0.2, 30), { x: -306.1, z: 79, y: yy, yaw: -Math.PI / 2, width: 4.8, top: 'deck', side: 'wood', surface: 'wood' });
  // warehouse with a roof gap
  B.box({ x: -250, z: 20, y: yy, w: 34, h: 8, d: 22, mat: 'warehouse', top: 'roof', tile: 6.4, surface: 'metal' });
  B.ramp(profiles.bank(8, 26, 3).pts.slice(0, -1), { x: -250, z: -20, y: yy, yaw: 0, width: 5, top: 'deck', side: 'wood', surface: 'wood' });
  B.ramp(profiles.kicker(0.9, 30), { x: -250, z: 23.5, y: yy + 8, yaw: 0, width: 4, top: 'deck', side: 'wood', surface: 'wood' });
  B.ramp(profiles.landing(8, 0.6, 30), { x: -250, z: 35, y: yy, yaw: 0, width: 8, top: 'deck', side: 'wood', surface: 'wood' });
  A.roofTop = new THREE.Vector3(-250, yy + 8, 12);
  for (let i = 0; i < 40; i++) B.decal(r.pick(['stain', 'stain', 'tire', 'crack']), Z.x + (r() - 0.5) * 190, Z.z + (r() - 0.5) * 160, yy + 0.003, 2 + r() * 6, r() * 6.28);
  // quay rail and pipe
  B.rail(new THREE.Vector3(-412, yy + 0.5, -10), new THREE.Vector3(-412, yy + 0.5, 60), { mat: 'railBlack', postEvery: 4 });
  const pipeY = yy + 1.1;
  B.add(new THREE.CylinderGeometry(0.55, 0.55, 24, 20).rotateX(Math.PI / 2), 'steel', B.matrix(-340, yy + 0.55, 100));
  B.box({ x: -340, z: 100, y: yy, w: 0.4, h: 1.05, d: 24, invisible: true, surface: 'metal' });
  B.col.addRail(new THREE.Vector3(-340, pipeY, 88.3), new THREE.Vector3(-340, pipeY, 111.7), 'pipe');
  // kinked rail
  B.rail(new THREE.Vector3(-300, yy + 0.6, 40), new THREE.Vector3(-292, yy + 0.6, 40), { mat: 'railYellow' });
  B.rail(new THREE.Vector3(-292, yy + 0.6, 40), new THREE.Vector3(-284, yy + 0.2 + 0.4, 40), { mat: 'railYellow', posts: false });
  // pier + lake launch
  B.box({ x: -446, z: 60, y: yy - 0.3, w: 52, h: 0.35, d: 6, mat: 'deck', tile: 2, surface: 'wood' });
  for (let x = -470; x <= -422; x += 4) for (const s of [-2.6, 2.6]) {
    B.add(new THREE.CylinderGeometry(0.16, 0.16, 8, 8), 'deck', B.matrix(x, yy - 4, 60 + s));
  }
  B.ramp(profiles.kicker(1.5, 30), { x: -462, z: 60, y: yy + 0.05, yaw: -Math.PI / 2, width: 4, top: 'deck', side: 'wood', surface: 'wood' });
  A.pierStart = new THREE.Vector3(-424, yy, 60);
  // gantry crane (with solid legs)
  const cx = -398, cz = 100;
  for (const sx of [-6, 6]) for (const sz of [-8, 8]) {
    B.box({ x: cx + sx, z: cz + sz, y: yy, w: 1, h: 22, d: 1, mat: 'concrete', tile: 2, surface: 'metal', collide: true, cast: true });
  }
  for (const sz of [-8, 8]) B.add(new THREE.BoxGeometry(14, 1.6, 1.4), 'craneYellow', B.matrix(cx, yy + 22.8, cz + sz));
  B.add(new THREE.BoxGeometry(1.8, 1.8, 40), 'craneYellow', B.matrix(cx, yy + 24.4, cz - 8));
  B.add(new THREE.BoxGeometry(3, 2.4, 3), 'craneYellow', B.matrix(cx, yy + 22.5, cz - 14));
  for (let i = -3; i <= 3; i++) B.lamp(-330 + i * 28, -48, 8, -Math.PI / 2);
  for (let i = -2; i <= 3; i++) B.lamp(-416, 40 + i * 24, 8, 0);
}

function buildBigAir(B, A) {
  const Z = ZONES.bigair;
  const ty = Z.target, yy = ty + 0.05;
  B.box({ x: Z.x, z: Z.z, y: ty - 0.6, w: Z.hx * 2, h: 0.65, d: Z.hz * 2, mat: 'concrete', tile: 4, surface: 'concrete', cast: false });
  const z0 = 238, H = 24, x = 40;
  const p = new Profile().to(0, H).by(12, 0).arc(8, 0, -0.75, 14);
  const lineLen = (p.end[1] - 6.05) / Math.sin(0.75);
  p.line(-0.75, lineLen).arc(22, -0.75, 0, 18).by(14, 0).arc(10, 0, 0.5, 12).line(0.5, 2.4);
  const lipS = p.end[0], lipY = p.end[1];
  p.down();
  const wood = { top: 'deck', side: 'wood', surface: 'wood', tile: 2, sideTile: 3 };
  B.ramp(p, { ...wood, x, z: z0, y: yy, yaw: 0, width: 10 });
  // landing
  const gap = 15;
  const L = new Profile().to(0, 4.4).by(2, 0).arc(6, 0, -0.48, 10);
  L.line(-0.48, (L.end[1] - 14 * (1 - Math.cos(0.48))) / Math.sin(0.48)).arc(14, -0.48, 0, 14);
  B.ramp(L, { ...wood, x, z: z0 + lipS + gap, y: yy, yaw: 0, width: 14 });
  const landEnd = z0 + lipS + gap + L.end[0];
  // giant quarter pipe at the end
  const qpZ = landEnd + 46;
  B.quarterPipe({ ...wood, x, z: qpZ, y: yy, yaw: 0, width: 16, h: 9, R: 8, deck: 3, maxDeg: 84 });
  // side rails on the deck
  B.rail(new THREE.Vector3(x - 5, yy + H + 1.0, z0 + 0.2), new THREE.Vector3(x - 5, yy + H + 1.0, z0 + 11.8), { mat: 'railBlack', postEvery: 3, kind: 'rail' });
  B.rail(new THREE.Vector3(x + 5, yy + H + 1.0, z0 + 0.2), new THREE.Vector3(x + 5, yy + H + 1.0, z0 + 11.8), { mat: 'railBlack', postEvery: 3, kind: 'rail' });
  // scaffolding look under the roll-in sides (visual)
  for (let s = 2; s < 34; s += 3.2) {
    const pt = samplePts(p.pts, s);
    if (pt < 0.4) continue;
    for (const sx of [-5.6, 5.6]) B.add(new THREE.BoxGeometry(0.18, pt, 0.18), 'steel', B.matrix(x + sx, yy + pt / 2, z0 + s));
  }
  A.megaDeck = new THREE.Vector3(x, yy + H, z0 + 4);
  A.megaLip = new THREE.Vector3(x, yy + lipY, z0 + lipS);
  A.megaLand = new THREE.Vector3(x, yy, landEnd);
  A.megaQP = new THREE.Vector3(x, yy, qpZ);
  A.lift = new THREE.Vector3(56, yy, 256);
  A.bigAirY = yy;
  // a smaller hip jump on the side for warm-ups
  B.ramp(profiles.kicker(1.4, 32), { top: 'skatelite', side: 'plywood', surface: 'wood', x: 64, z: 330, y: yy, yaw: 0, width: 4 });
  B.ramp(profiles.landing(1.4, 1.2, 24), { top: 'skatelite', side: 'plywood', surface: 'wood', x: 64, z: 341, y: yy, yaw: 0, width: 5 });
  for (let i = 0; i < 6; i++) { B.lamp(2, 270 + i * 50, 8, 0); B.lamp(78, 270 + i * 50, 8, Math.PI); }
}

function samplePts(pts, s) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i + 1][0] >= s && pts[i][0] <= s) {
      const t = (s - pts[i][0]) / Math.max(1e-6, pts[i + 1][0] - pts[i][0]);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    }
  }
  return 0;
}

function buildSummit(B, A, terrain) {
  const Z = ZONES.summit;
  const ty = Z.target;
  B.box({ x: Z.x, z: Z.z, y: ty - 0.4, w: 14, h: 0.45, d: 14, mat: 'deck', tile: 2, surface: 'wood', cast: false });
  // start hut
  B.box({ x: Z.x - 9, z: Z.z - 4, y: ty, w: 4, h: 3, d: 5, mat: 'wood', top: 'roof', surface: 'wood' });
  A.summit = new THREE.Vector3(Z.x + 4, ty + 0.05, Z.z + 4);
  // trail features: dirt doubles, rollers and a wooden drop
  const trail = terrain.trail;
  const dirt = { top: 'dirt', side: 'dirt', surface: 'dirt', tile: 3, sideTile: 3, sideSlope: 0.9 };
  const feat = [
    [70, 'double', 1.1, 3.0], [150, 'drop'], [215, 'double', 1.3, 3.6], [300, 'rollers'],
    [380, 'double', 1.4, 3.8], [455, 'drop'], [530, 'double', 1.2, 3.2], [610, 'double', 1.5, 4.0],
  ];
  A.trailFeatures = [];
  for (const f of feat) {
    if (f[0] > trail.length - 30) continue;
    const a = terrain.pathPoint(trail, f[0]);
    const b = terrain.pathPoint(trail, f[0] + 6);
    const pitch = Math.atan2(a.h - b.h, 6);
    let prof;
    if (f[1] === 'double') prof = profiles.dirtDouble(f[2], f[3]);
    else if (f[1] === 'rollers') prof = profiles.rollers(18, 0.6, 3);
    else prof = new Profile().line(0.32, 3.2).by(2.4, 0).down();
    const isDrop = f[1] === 'drop';
    B.ramp(prof, { ...(isDrop ? { top: 'deck', side: 'wood', surface: 'wood', tile: 2 } : dirt), x: a.x, z: a.z, y: a.h - 0.12, yaw: a.dir, pitch, width: isDrop ? 3.2 : 3.6 });
    A.trailFeatures.push(f[0]);
  }
}

function buildPool(B, A) {
  const Z = ZONES.pool;
  const y0 = Z.target;
  B.box({ x: Z.x, z: Z.z, y: y0 - 0.6, w: Z.hx * 2, h: 0.65, d: Z.hz * 2, mat: 'concreteSmooth', tile: 3, surface: 'concrete', cast: false });
  const yy = y0 + 0.05;
  const bottom = 5.2, R = 3.2, h = 2.7, amax = 80 * Math.PI / 180;
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(bottom, 0)];
  for (let i = 1; i <= 16; i++) { const a = (amax * i) / 16; pts.push(new THREE.Vector2(bottom + R * Math.sin(a), R * (1 - Math.cos(a)))); }
  const last = pts[pts.length - 1];
  const ext = (h - last.y) / Math.sin(amax);
  const rc = last.x + Math.cos(amax) * ext;
  pts.push(new THREE.Vector2(rc, h), new THREE.Vector2(rc + 0.02, h), new THREE.Vector2(rc + 2.6, h), new THREE.Vector2(rc + 2.6, -0.5));
  const geo = new THREE.LatheGeometry(pts, 72);
  const mat = new THREE.MeshStandardMaterial().copy(B.mat('concreteSmooth'));
  for (const k of ['map', 'normalMap', 'roughnessMap']) if (mat[k]) { mat[k] = mat[k].clone(); mat[k].repeat.set(22, 5); mat[k].needsUpdate = true; }
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(Z.x, yy, Z.z);
  mesh.receiveShadow = true; mesh.castShadow = true;
  B.scene.add(mesh);
  B.col.addMesh(mesh, 'concrete');
  // coping + tile band
  const cop = new THREE.Mesh(new THREE.TorusGeometry(rc, 0.045, 8, 120).rotateX(Math.PI / 2), B.mat('metal'));
  cop.position.set(Z.x, yy + h + 0.02, Z.z);
  B.scene.add(cop);
  const tiles = new THREE.Mesh(new THREE.CylinderGeometry(rc - 0.01, rc - 0.01, 0.22, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x2d6f8f, roughness: 0.25, side: THREE.BackSide }));
  tiles.position.set(Z.x, yy + h - 0.13, Z.z);
  B.scene.add(tiles);
  // access bank up to the deck from the south
  B.ramp(profiles.bank(h, 6.5, 0).pts.slice(0, -1), { x: Z.x, z: Z.z + rc + 2.6 + 6.3, y: yy, yaw: Math.PI, width: 4.5, top: 'concreteSmooth', side: 'concreteDark', surface: 'concrete', tile: 3 });
  A.pool = new THREE.Vector3(Z.x, yy, Z.z);
  A.poolTop = yy + h;
  for (let i = 0; i < 4; i++) B.lamp(Z.x + (i % 2 ? 1 : -1) * 18, Z.z + (i < 2 ? -18 : 18), 6, i < 2 ? -Math.PI / 4 : Math.PI / 4);
  B.bench(Z.x - 14, Z.z + 17, 0);
}

function buildChannel(B, A) {
  const Z = ZONES.channel;
  const yy = Z.target + 0.05;
  B.box({ x: Z.x, z: Z.z, y: Z.target - 0.6, w: Z.hx * 2, h: 0.65, d: Z.hz * 2, mat: 'concreteDark', tile: 4, surface: 'concrete', cast: false });
  const p = new Profile().to(0, 3).by(2.5, 0).arc(1.5, 0, -0.8, 6);
  p.line(-0.8, (3 - 1.5 * (1 - Math.cos(0.8)) - 4 * (1 - Math.cos(0.8))) / Math.sin(0.8)).arc(4, -0.8, 0, 10).by(7, 0).arc(4, 0, 0.8, 10);
  p.line(0.8, (3 - 1.5 * (1 - Math.cos(0.8)) - p.end[1]) / Math.sin(0.8)).arc(1.5, 0.8, 0, 6).by(2.5, 0).down();
  const total = p.end[0];
  B.ramp(p, { x: Z.x, z: Z.z - total / 2, y: yy, yaw: 0, width: 120, top: 'concreteSmooth', side: 'concreteDark', surface: 'concrete', tile: 3, sideTile: 3 });
  // a hip and a rail in the channel floor
  B.ramp(profiles.kicker(1.1, 30), { x: Z.x - 20, z: Z.z, y: yy, yaw: Math.PI / 2, width: 3, top: 'concreteSmooth', side: 'concreteDark', surface: 'concrete', tile: 3 });
  B.rail(new THREE.Vector3(Z.x + 10, yy + 0.45, Z.z), new THREE.Vector3(Z.x + 30, yy + 0.45, Z.z), { mat: 'railRed' });
  A.channel = new THREE.Vector3(Z.x, yy, Z.z);
  for (const sx of [-50, -10, 30]) B.graffitiWall(Z.x + sx, Z.z - total / 2 - 1.2, 0, 8, 2.2, 4 + ((sx + 50) / 40));
}

// ---------------- World ----------------
export async function buildWorld(scene, renderer, quality, progress = () => {}) {
  const world = { treePoints: [], trunks: [], anchors: {}, dynamic: [] };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // textures are generated in worker threads while the terrain is sculpted on this one
  progress('Painting textures', 0.05); await tick();
  let texDone = 0;
  const texP = preloadTextures((f) => { texDone = f; });
  progress('Sculpting terrain', 0.1); await tick();
  const terrain = new Terrain();
  world.terrain = terrain;
  const collision = new Collision(terrain);
  collision.waterLevel = WORLD.waterLevel;
  world.collision = collision;
  progress('Painting textures', 0.15 + texDone * 0.2); await tick();
  await texP;
  progress('Laying concrete', 0.36); await tick();
  scene.add(terrain.buildMesh());
  progress('Building The Yard', 0.38); await tick();
  const B = new Builder(scene, collision, terrain);
  world.builder = B;
  const A = world.anchors;
  buildYard(B, A);
  progress('Building Port Rusty', 0.48); await tick();
  buildDocks(B, A);
  progress('Shaping Loam Woods', 0.55); await tick();
  buildWoods(B, A);
  progress('Raising Big Air', 0.6); await tick();
  buildBigAir(B, A);
  buildSummit(B, A, terrain);
  buildPool(B, A);
  buildChannel(B, A);
  B.finalize();
  progress('Growing trees', 0.7); await tick();
  scatterTrees(scene, terrain, world, quality);
  scatterRocks(scene, terrain, collision, quality);
  progress('Planting grass', 0.8); await tick();
  world.grass = makeGrass(terrain, quality);
  if (world.grass) scene.add(world.grass);
  world.water = makeWater();
  scene.add(world.water);
  // tree trunk collision: thin solid boxes
  for (const p of world.trunks) {
    const g = new THREE.BoxGeometry(0.5, 4, 0.5).translate(p.x, p.y + 2, p.z);
    const tmp = new THREE.Mesh(g); tmp.updateWorldMatrix = () => {}; tmp.matrixWorld.identity();
    collision.addMesh(tmp, 'wood');
  }
  world.update = (dt, camPos) => {
    windUniforms.uTime.value += dt;
    if (world.grass) world.grass.update(camPos);
  };
  return world;
}

// Procedural PBR textures, generated at load time on canvas so the game ships
// with no image assets. Each generator returns albedo + normal (+ optional roughness).
import * as THREE from 'three';
import { makeTileNoise, rng, clamp } from './util.js';

const cache = new Map();
let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = a; }

function canvas(n) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
}

function tex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function fbmTile(noises, x, y, oct, base) {
  let s = 0, a = 1, f = base, n = 0;
  for (let i = 0; i < oct; i++) {
    s += noises[i](x * f, y * f) * a;
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}

function makeFbm(seed, N, basePeriod, oct) {
  const ns = [];
  for (let i = 0; i < oct; i++) ns.push(makeTileNoise(seed + i * 101, basePeriod << i));
  return (x, y) => fbmTile(ns, (x / N) * basePeriod, (y / N) * basePeriod, oct, 1) ;
}
// fbmTile multiplies by f each octave; since each noise has period basePeriod<<i,
// sampling at x*basePeriod*2^i stays tileable.

function normalFromHeight(H, N, strength) {
  const c = canvas(N);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  const d = img.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const xl = (x - 1 + N) % N, xr = (x + 1) % N, yu = (y - 1 + N) % N, yd = (y + 1) % N;
      const dx = (H[y * N + xr] - H[y * N + xl]) * strength;
      const dy = (H[yd * N + x] - H[yu * N + x]) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      d[i] = (-dx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function heightFromCanvas(c, N, blur = 1) {
  const d = c.getContext('2d').getImageData(0, 0, N, N).data;
  let H = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) H[i] = d[i * 4] / 255;
  for (let b = 0; b < blur; b++) {
    const H2 = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++)
        s += H[((y + oy + N) % N) * N + ((x + ox + N) % N)];
      H2[y * N + x] = s / 9;
    }
    H = H2;
  }
  return H;
}

// Draw something with wrap-around so the texture tiles.
function wrapDraw(N, x, y, r, fn) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const px = x + ox * N, py = y + oy * N;
    if (px + r < 0 || px - r > N || py + r < 0 || py - r > N) continue;
    fn(px, py);
  }
}

function pixelTexture(N, seed, fn, normalStrength) {
  const c = canvas(N);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const H = new Float32Array(N * N);
  const R = new Uint8ClampedArray(N * N);
  const out = { r: 0, g: 0, b: 0, h: 0, rough: 0.8 };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    fn(x, y, out);
    const i = y * N + x;
    d[i * 4] = out.r; d[i * 4 + 1] = out.g; d[i * 4 + 2] = out.b; d[i * 4 + 3] = 255;
    H[i] = out.h; R[i] = out.rough * 255;
  }
  ctx.putImageData(img, 0, 0);
  return { c, ctx, H, R, normalStrength };
}

function roughCanvas(R, N) {
  const c = canvas(N);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = R[i];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function finish(key, p, N) {
  const set = {
    map: tex(p.c, true),
    normalMap: tex(normalFromHeight(p.H, N, p.normalStrength), false),
    roughnessMap: p.R ? tex(roughCanvas(p.R, N), false) : null,
  };
  cache.set(key, set);
  return set;
}

// ---------- Generators ----------

function grass(N = 512) {
  const n1 = makeFbm(11, N, 4, 5);
  const n2 = makeFbm(29, N, 16, 3);
  const p = pixelTexture(N, 1, (x, y, o) => {
    const a = n1(x, y), b = n2(x, y);
    const dry = clamp((a - 0.45) * 3, 0, 1);
    o.r = 58 + dry * 50 + b * 20; o.g = 78 + dry * 28 + b * 28; o.b = 40 + dry * 6 + b * 12;
    o.h = b * 0.3; o.rough = 0.9;
  }, 2);
  // blades
  const r = rng(77);
  const hc = canvas(N), hctx = hc.getContext('2d');
  hctx.fillStyle = '#000'; hctx.fillRect(0, 0, N, N);
  const ctx = p.ctx;
  ctx.lineCap = 'round';
  for (let i = 0; i < 14000; i++) {
    const x = r() * N, y = r() * N, len = 3 + r() * 9, ang = -Math.PI / 2 + (r() - 0.5) * 1.3;
    const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len;
    const shade = r();
    const g = Math.floor(66 + shade * 70), rr = Math.floor(44 + shade * 46 + (r() < 0.18 ? 46 : 0)), bb = Math.floor(28 + shade * 26);
    ctx.strokeStyle = `rgba(${rr},${g},${bb},${0.55 + r() * 0.45})`;
    ctx.lineWidth = 0.8 + r() * 1.4;
    hctx.strokeStyle = `rgba(255,255,255,${0.3 + shade * 0.7})`;
    hctx.lineWidth = ctx.lineWidth;
    wrapDraw(N, x, y, 14, (px, py) => {
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ex, py + ey); ctx.stroke();
      hctx.beginPath(); hctx.moveTo(px, py); hctx.lineTo(px + ex, py + ey); hctx.stroke();
    });
  }
  p.H = heightFromCanvas(hc, N, 1);
  return p;
}

function dirt(N = 512, seed = 5, dark = 0) {
  const n1 = makeFbm(seed, N, 4, 6);
  const n2 = makeFbm(seed + 7, N, 32, 2);
  const p = pixelTexture(N, seed, (x, y, o) => {
    const a = n1(x, y), b = n2(x, y);
    const m = a * 0.75 + b * 0.25;
    o.r = 84 + m * 56 - dark; o.g = 64 + m * 42 - dark * 0.8; o.b = 46 + m * 28 - dark * 0.6;
    o.h = a * 0.7 + b * 0.3; o.rough = 0.95 - b * 0.1;
  }, 6);
  // pebbles
  const r = rng(seed + 3);
  const ctx = p.ctx;
  for (let i = 0; i < 700; i++) {
    const x = r() * N, y = r() * N, rad = 0.6 + r() * r() * 2.8;
    const v = 78 + r() * 60;
    wrapDraw(N, x, y, rad + 2, (px, py) => {
      ctx.fillStyle = `rgba(0,0,0,0.22)`;
      ctx.beginPath(); ctx.ellipse(px + 0.8, py + 1, rad, rad * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${v},${v * 0.9},${v * 0.78})`;
      ctx.beginPath(); ctx.ellipse(px, py, rad, rad * 0.8, r() * 3, 0, Math.PI * 2); ctx.fill();
    });
    // bump the heightfield
    const R2 = Math.ceil(rad);
    for (let oy = -R2; oy <= R2; oy++) for (let ox = -R2; ox <= R2; ox++) {
      const dd = 1 - (ox * ox + oy * oy) / (rad * rad);
      if (dd <= 0) continue;
      const ix = ((Math.floor(x) + ox) % N + N) % N, iy = ((Math.floor(y) + oy) % N + N) % N;
      p.H[iy * N + ix] += Math.sqrt(dd) * 0.25;
      p.R[iy * N + ix] = 170;
    }
  }
  return p;
}

function rock(N = 512) {
  const n1 = makeFbm(41, N, 4, 6);
  const n2 = makeFbm(43, N, 8, 4);
  const p = pixelTexture(N, 41, (x, y, o) => {
    const a = n1(x, y), b = n2(x, y);
    const strata = Math.sin((y / N) * Math.PI * 2 * 6 + a * 6) * 0.5 + 0.5;
    const v = 60 + a * 58 + strata * 14;
    o.r = v * 1.06; o.g = v * 0.98; o.b = v * 0.88;
    const lichen = clamp((b - 0.62) * 4, 0, 1) * 0.35;
    o.r = o.r * (1 - lichen) + 96 * lichen; o.g = o.g * (1 - lichen) + 104 * lichen; o.b = o.b * (1 - lichen) + 70 * lichen;
    o.h = a * 0.8 + strata * 0.15 + b * 0.25; o.rough = 0.85;
  }, 5);
  return p;
}

function concrete(N = 512, seed = 61, tone = 0, seams = true) {
  const n1 = makeFbm(seed, N, 4, 5);
  const n2 = makeFbm(seed + 2, N, 64, 2);
  const n3 = makeFbm(seed + 5, N, 2, 3);
  const p = pixelTexture(N, seed, (x, y, o) => {
    const a = n1(x, y), b = n2(x, y), st = n3(x, y);
    let v = 150 + a * 40 + (b - 0.5) * 30 - tone;
    const stain = clamp((st - 0.6) * 4, 0, 1) * 25;
    v -= stain;
    o.r = v; o.g = v * 0.99; o.b = v * 0.96;
    o.h = a * 0.25 + b * 0.35; o.rough = 0.82 + (b - 0.5) * 0.2 - stain / 200;
    if (seams && (x < 2 || y < 2)) { o.r *= 0.55; o.g *= 0.55; o.b *= 0.55; o.h -= 0.6; o.rough = 0.95; }
  }, 3);
  const r = rng(seed + 9);
  const ctx = p.ctx;
  for (let i = 0; i < 3000; i++) {
    const x = r() * N, y = r() * N, v = r() < 0.5 ? 90 + r() * 40 : 190 + r() * 50;
    ctx.fillStyle = `rgba(${v},${v},${v * 0.95},0.6)`;
    ctx.fillRect(x, y, 1 + r(), 1 + r());
  }
  return p;
}

function asphalt(N = 512) {
  const n1 = makeFbm(81, N, 8, 4);
  const n2 = makeFbm(83, N, 64, 2);
  const n3 = makeFbm(85, N, 4, 4);
  const p = pixelTexture(N, 81, (x, y, o) => {
    const a = n1(x, y), b = n2(x, y), c = n3(x, y);
    const v = 50 + a * 14 + (b > 0.66 ? 14 : 0) + (c - 0.5) * 18;
    o.r = v; o.g = v; o.b = v * 1.03;
    o.h = b * 0.4 + a * 0.2; o.rough = 0.88 - (b > 0.66 ? 0.08 : 0);
  }, 4);
  return p;
}

function planks(N = 512, opts = {}) {
  const boards = opts.boards || 8;
  const n1 = makeFbm(91, N, 2, 4);
  const r = rng(92);
  const tints = Array.from({ length: boards }, () => 0.82 + r() * 0.3);
  const base = opts.base || [150, 108, 70];
  const p = pixelTexture(N, 91, (x, y, o) => {
    const bi = Math.floor((x / N) * boards);
    const fx = (x / N) * boards - bi;
    const grain = Math.sin((y / N) * 40 * Math.PI + n1(x * 4 % N, y) * 18 + bi * 7) * 0.5 + 0.5;
    const t = tints[bi];
    let k = (0.78 + grain * 0.22) * t;
    const edge = fx < 0.025 || fx > 0.975;
    if (edge) k *= 0.35;
    o.r = base[0] * k; o.g = base[1] * k; o.b = base[2] * k;
    o.h = edge ? 0 : 0.6 + grain * 0.08; o.rough = edge ? 0.95 : 0.7 + grain * 0.1;
  }, 3);
  // nails / screws
  const ctx = p.ctx;
  for (let bi = 0; bi < boards; bi++) for (const yy of [0.12, 0.62]) {
    const x = (bi + 0.5) / boards * N, y = yy * N;
    ctx.fillStyle = '#3a3a3a';
    ctx.beginPath(); ctx.arc(x - 6, y, 2, 0, 7); ctx.arc(x + 6, y, 2, 0, 7); ctx.fill();
  }
  return p;
}

function skatelite(N = 512) {
  const n1 = makeFbm(101, N, 8, 4);
  const p = pixelTexture(N, 101, (x, y, o) => {
    const a = n1(x, y);
    const v = 46 + a * 18;
    o.r = v * 1.15; o.g = v; o.b = v * 0.85;
    o.h = a * 0.2; o.rough = 0.45 + a * 0.2;
    if (x < 2) { o.r *= 0.5; o.g *= 0.5; o.b *= 0.5; o.h = -0.3; o.rough = 0.9; }
  }, 2);
  // scuffs: tire marks
  const r = rng(103);
  const ctx = p.ctx;
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = r() * N, y = r() * N, len = 40 + r() * 160;
    ctx.strokeStyle = `rgba(20,16,14,${0.08 + r() * 0.15})`;
    ctx.lineWidth = 3 + r() * 6;
    wrapDraw(N, x, y, len, (px, py) => {
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + (r() - 0.5) * 60, py + len / 2, px + (r() - 0.5) * 40, py + len); ctx.stroke();
    });
  }
  for (let i = 0; i < 160; i++) {
    const x = r() * N, y = r() * N;
    ctx.strokeStyle = `rgba(200,190,170,${0.06 + r() * 0.1})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); ctx.stroke();
  }
  return p;
}

function corrugated(N = 512, color = [160, 50, 30], seed = 111) {
  const n1 = makeFbm(seed, N, 4, 5);
  const n2 = makeFbm(seed + 1, N, 16, 3);
  const p = pixelTexture(N, seed, (x, y, o) => {
    const a = n1(x, y), b = n2(x, y);
    const rib = Math.sin((x / N) * Math.PI * 2 * 16);
    const rust = clamp((a - 0.58) * 5 + (b - 0.5), 0, 1);
    const shade = 0.85 + rib * 0.12 + (b - 0.5) * 0.15;
    o.r = (color[0] * (1 - rust) + 120 * rust) * shade;
    o.g = (color[1] * (1 - rust) + 62 * rust) * shade;
    o.b = (color[2] * (1 - rust) + 35 * rust) * shade;
    o.h = rib * 0.5 + rust * 0.1; o.rough = 0.55 + rust * 0.4;
  }, 8);
  return p;
}

function bark(N = 256) {
  const n1 = makeFbm(121, N, 4, 5);
  const p = pixelTexture(N, 121, (x, y, o) => {
    const a = n1(x * 4 % N, y * 0.5);
    const ridge = Math.abs(Math.sin((x / N) * Math.PI * 14 + a * 8));
    const v = 50 + ridge * 45 + a * 20;
    o.r = v * 0.95; o.g = v * 0.8; o.b = v * 0.62;
    o.h = ridge; o.rough = 0.95;
  }, 5);
  return p;
}

function metalBrushed(N = 256) {
  const n1 = makeFbm(131, N, 64, 2);
  return pixelTexture(N, 131, (x, y, o) => {
    const a = n1(x * 0.05 % N, y);
    const v = 170 + a * 50;
    o.r = v; o.g = v; o.b = v * 1.02; o.h = a * 0.2; o.rough = 0.35 + a * 0.15;
  }, 1);
}

// Leaf cluster card (RGBA, alpha cut-out)
function leafCard(N = 256, conifer = false, seed = 141) {
  const c = canvas(N);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.clearRect(0, 0, N, N);
  const cx = N / 2, cy = N / 2;
  if (!conifer) {
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * N * 0.42;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const s = 7 + r() * 9;
      const g = 70 + r() * 70, rr = 30 + r() * 50 + (r() < 0.1 ? 60 : 0);
      ctx.fillStyle = `rgb(${rr},${g},${25 + r() * 25})`;
      ctx.save(); ctx.translate(x, y); ctx.rotate(r() * Math.PI * 2);
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke();
      ctx.restore();
    }
  } else {
    // drooping needle branch
    ctx.strokeStyle = '#3b2a1c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(4, N * 0.3); ctx.quadraticCurveTo(N * 0.5, N * 0.25, N - 6, N * 0.6); ctx.stroke();
    for (let i = 0; i < 900; i++) {
      const t = r();
      const bx = 4 + t * (N - 10), by = N * 0.3 + t * t * N * 0.3 - Math.sin(t * Math.PI) * N * 0.05;
      const ang = (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.8) + 0.4;
      const len = (1 - t * 0.5) * (10 + r() * 22);
      const g = 60 + r() * 50;
      ctx.strokeStyle = `rgb(${20 + r() * 20},${g},${30 + r() * 20})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(ang) * len, by + Math.sin(ang) * len); ctx.stroke();
    }
  }
  const t = tex(c, true, false);
  return t;
}

function waterNormal(N = 512) {
  const n1 = makeFbm(151, N, 8, 5);
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = n1(x, y);
  const t = tex(normalFromHeight(H, N, 10), false);
  return t;
}

function graffiti(N = 512, seed = 161) {
  const c = canvas(N);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.clearRect(0, 0, N, N);
  const pal = ['#ff4d1f', '#ffd21f', '#1fc8ff', '#b14dff', '#29e07a', '#ff2e8a', '#ffffff'];
  for (let i = 0; i < 6; i++) {
    const x = r() * N, y = N * 0.3 + r() * N * 0.4, s = 40 + r() * 90;
    ctx.fillStyle = r.pick(pal);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const rr = s * (0.5 + r() * 0.6);
      ctx.lineTo(x + Math.cos(a) * rr * 1.6, y + Math.sin(a) * rr * 0.6);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 5; ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = `900 ${N * 0.2}px Impact, 'Arial Black', sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 10; ctx.strokeStyle = '#111';
  const words = ['RAMPED', 'SHRED', 'SEND IT', 'BMX', 'YARD', 'FLOW'];
  const w = r.pick(words);
  ctx.save(); ctx.translate(N / 2, N * 0.62); ctx.rotate(-0.08);
  ctx.strokeText(w, 0, 0);
  const grad = ctx.createLinearGradient(0, -N * 0.15, 0, 0);
  grad.addColorStop(0, r.pick(pal)); grad.addColorStop(1, r.pick(pal));
  ctx.fillStyle = grad; ctx.fillText(w, 0, 0);
  ctx.restore();
  // drips
  for (let i = 0; i < 25; i++) {
    ctx.fillStyle = r.pick(pal); ctx.globalAlpha = 0.7;
    ctx.fillRect(r() * N, N * 0.6 + r() * 30, 2 + r() * 2, 10 + r() * 40);
  }
  ctx.globalAlpha = 1;
  return tex(c, true, false);
}

// Decals: oil stains, tyre marks, cracks (RGBA)
const decalCache = {};
export function decalTexture(kind) {
  if (decalCache[kind]) return decalCache[kind];
  const N = 256, c = canvas(N), g = c.getContext('2d');
  const r = rng(kind.length * 31 + 7);
  if (kind === 'stain') {
    for (let i = 0; i < 9; i++) {
      const x = N / 2 + (r() - 0.5) * N * 0.4, y = N / 2 + (r() - 0.5) * N * 0.4, rad = N * (0.12 + r() * 0.22);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(18,16,14,${0.22 + r() * 0.2})`); gr.addColorStop(1, 'rgba(18,16,14,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    }
  } else if (kind === 'tire') {
    g.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      g.strokeStyle = `rgba(14,12,12,${0.18 + r() * 0.22})`; g.lineWidth = 5 + r() * 5;
      g.beginPath(); const x0 = N * (0.2 + r() * 0.6);
      g.moveTo(x0, 10); g.bezierCurveTo(x0 + (r() - 0.5) * 160, N * 0.4, x0 + (r() - 0.5) * 160, N * 0.6, x0 + (r() - 0.5) * 100, N - 10); g.stroke();
    }
  } else {
    g.strokeStyle = 'rgba(20,18,16,0.55)'; g.lineWidth = 1.6;
    for (let k = 0; k < 3; k++) {
      let x = r() * N, y = 0; g.beginPath(); g.moveTo(x, y);
      while (y < N) { x += (r() - 0.5) * 22; y += 6 + r() * 10; g.lineTo(x, y); }
      g.stroke();
    }
  }
  return (decalCache[kind] = tex(c, true, false));
}

// Macro variation (low-frequency, tileable over a big area)
function macro(N = 256) {
  const n1 = makeFbm(171, N, 4, 5);
  const c = canvas(N);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = n1(x, y) * 255, i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, false);
}

const GEN = {
  grass: () => grass(),
  dirt: () => dirt(512, 5, 0),
  trackDirt: () => dirt(512, 15, 18),
  rock: () => rock(),
  concrete: () => concrete(512, 61, 14, true),
  concreteSmooth: () => concrete(512, 64, -10, false),
  concreteDark: () => concrete(512, 66, 35, false),
  asphalt: () => asphalt(),
  planks: () => planks(512),
  deck: () => planks(512, { boards: 6, base: [120, 96, 72] }),
  skatelite: () => skatelite(),
  containerRed: () => corrugated(512, [150, 42, 28], 111),
  containerBlue: () => corrugated(512, [32, 74, 128], 113),
  containerGreen: () => corrugated(512, [40, 98, 64], 115),
  containerYellow: () => corrugated(512, [196, 150, 40], 117),
  containerGrey: () => corrugated(512, [130, 134, 136], 119),
  bark: () => bark(),
  metal: () => metalBrushed(),
};

export function getTex(name) {
  if (cache.has(name)) return cache.get(name);
  const gen = GEN[name];
  if (!gen) throw new Error('no texture ' + name);
  const p = gen();
  return finish(name, p, p.c.width);
}

let leafT, pineT, waterT, macroT;
export const leafTexture = () => (leafT ||= leafCard(256, false));
export const pineTexture = () => (pineT ||= leafCard(256, true, 147));
export const waterNormalTexture = () => (waterT ||= waterNormal());
export const macroTexture = () => (macroT ||= macro());
const graffitiCache = [];
export function graffitiTexture(i) { return (graffitiCache[i] ||= graffiti(512, 161 + i * 13)); }

// Convenience: build a standard PBR material from a texture set.
export function pbr(name, opts = {}) {
  const t = getTex(name);
  const rep = opts.repeat || [1, 1];
  const clone = (x) => {
    if (!x) return null;
    if (rep[0] === 1 && rep[1] === 1) return x;
    const c = x.clone(); c.repeat.set(rep[0], rep[1]); c.needsUpdate = true; return c;
  };
  const Mat = opts.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new Mat({
    map: clone(t.map),
    normalMap: clone(t.normalMap),
    roughnessMap: clone(t.roughnessMap),
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
    color: opts.color ?? 0xffffff,
    normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
    envMapIntensity: opts.env ?? 1,
  });
  if (opts.physical) {
    m.clearcoat = opts.clearcoat ?? 0;
    m.clearcoatRoughness = opts.clearcoatRoughness ?? 0.2;
  }
  return m;
}

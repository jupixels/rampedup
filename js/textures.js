// Procedural PBR textures, generated at load time so the game ships with no image
// assets. The heavy per-pixel work runs in a pool of Web Workers (texworker.js), in
// parallel; small canvas touches (grass blades, pebbles, scuffs) are added afterwards.
import * as THREE from 'three';
import { rng } from './util.js';
import { runProgram, normalArray } from './texpixels.js';

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

function bytesCanvas(bytes, N) {
  const c = canvas(N);
  const ctx = c.getContext('2d');
  ctx.putImageData(new ImageData(bytes, N, N), 0, 0);
  return c;
}

function greyCanvas(R, N) {
  const d = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = R[i]; d[i * 4 + 3] = 255; }
  return bytesCanvas(d, N);
}

function heightFromCanvas(c, N) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, N, N).data;
  const H0 = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) H0[i] = d[i * 4] / 255;
  const H = new Float32Array(N * N); // one box blur pass
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) s += H0[((y + oy + N) % N) * N + ((x + ox + N) % N)];
    H[y * N + x] = s / 9;
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

// ---------- Texture specs ----------
// program: pixel program in texpixels.js; normal: normal-map strength; post: canvas touches
// that run on the main thread (postH = the post step changes the heightfield, so the
// normal map is built after it).
const SPECS = {
  grass:          { program: 'grass', N: 512, normal: 2, post: grassBlades, postH: true },
  dirt:           { program: 'dirt', N: 256, params: { seed: 5, dark: 0 }, normal: 6, post: pebbles, postH: true },
  trackDirt:      { program: 'dirt', N: 512, params: { seed: 15, dark: 18 }, normal: 6, post: pebbles, postH: true },
  rock:           { program: 'rock', N: 512, normal: 5 },
  concrete:       { program: 'concrete', N: 512, params: { seed: 61, tone: 14, seams: true }, normal: 3, post: speckles },
  concreteSmooth: { program: 'concrete', N: 256, params: { seed: 64, tone: -10, seams: false }, normal: 3, post: speckles },
  asphalt:        { program: 'asphalt', N: 256, normal: 4 },
  planks:         { program: 'planks', N: 256, normal: 3, post: nails },
  skatelite:      { program: 'skatelite', N: 256, normal: 2, post: scuffs },
  corrugated:     { program: 'corrugated', N: 256, normal: 8 },
  bark:           { program: 'bark', N: 128, normal: 5 },
  metal:          { program: 'metal', N: 128, normal: 1 },
};
// Variants that reuse another texture with a colour tint (saves generating near-duplicates)
const ALIAS = {
  concreteDark: ['concreteSmooth', 0x8f8f8c],
  deck: ['planks', 0xb8a690],
  containerRed: ['corrugated', 0xa8402c], containerBlue: ['corrugated', 0x2f5c8f], containerGreen: ['corrugated', 0x3c7550],
  containerYellow: ['corrugated', 0xd3a336], containerGrey: ['corrugated', 0x9da2a6],
};

function grassBlades(p, N) {
  const r = rng(77);
  const hc = canvas(N), hctx = hc.getContext('2d', { willReadFrequently: true });
  hctx.fillStyle = '#000'; hctx.fillRect(0, 0, N, N);
  const ctx = p.ctx;
  ctx.lineCap = 'round';
  const k = N / 512, count = Math.round(14000 * k * k);
  for (let i = 0; i < count; i++) {
    const x = r() * N, y = r() * N, len = (3 + r() * 9) * k, ang = -Math.PI / 2 + (r() - 0.5) * 1.3;
    const ex = Math.cos(ang) * len, ey = Math.sin(ang) * len;
    const shade = r();
    const g = Math.floor(66 + shade * 70), rr = Math.floor(44 + shade * 46 + (r() < 0.18 ? 46 : 0)), bb = Math.floor(28 + shade * 26);
    ctx.strokeStyle = `rgba(${rr},${g},${bb},${0.55 + r() * 0.45})`;
    ctx.lineWidth = (0.8 + r() * 1.4) * Math.max(0.6, k);
    hctx.strokeStyle = `rgba(255,255,255,${0.3 + shade * 0.7})`;
    hctx.lineWidth = ctx.lineWidth;
    wrapDraw(N, x, y, 14, (px, py) => {
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ex, py + ey); ctx.stroke();
      hctx.beginPath(); hctx.moveTo(px, py); hctx.lineTo(px + ex, py + ey); hctx.stroke();
    });
  }
  p.H = heightFromCanvas(hc, N);
}

function pebbles(p, N, params) {
  const r = rng((params.seed || 5) + 3);
  const ctx = p.ctx;
  const k = N / 512, count = Math.round(700 * k * k);
  for (let i = 0; i < count; i++) {
    const x = r() * N, y = r() * N, rad = (0.6 + r() * r() * 2.8) * Math.max(0.7, k);
    const v = 78 + r() * 60;
    wrapDraw(N, x, y, rad + 2, (px, py) => {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(px + 0.8, py + 1, rad, rad * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${v},${v * 0.9},${v * 0.78})`;
      ctx.beginPath(); ctx.ellipse(px, py, rad, rad * 0.8, r() * 3, 0, Math.PI * 2); ctx.fill();
    });
    const R2 = Math.ceil(rad);
    for (let oy = -R2; oy <= R2; oy++) for (let ox = -R2; ox <= R2; ox++) {
      const dd = 1 - (ox * ox + oy * oy) / (rad * rad);
      if (dd <= 0) continue;
      const ix = ((Math.floor(x) + ox) % N + N) % N, iy = ((Math.floor(y) + oy) % N + N) % N;
      p.H[iy * N + ix] += Math.sqrt(dd) * 0.25;
      p.R[iy * N + ix] = 170;
    }
  }
}

function speckles(p, N, params) {
  const r = rng((params.seed || 61) + 9);
  const ctx = p.ctx;
  const count = Math.round(3000 * (N / 512) ** 2);
  for (let i = 0; i < count; i++) {
    const x = r() * N, y = r() * N, v = r() < 0.5 ? 90 + r() * 40 : 190 + r() * 50;
    ctx.fillStyle = `rgba(${v},${v},${v * 0.95},0.6)`;
    ctx.fillRect(x, y, 1 + r(), 1 + r());
  }
}

function nails(p, N) {
  const boards = 8, ctx = p.ctx, rr = Math.max(1, N / 256);
  ctx.fillStyle = '#3a3a3a';
  for (let bi = 0; bi < boards; bi++) for (const yy of [0.12, 0.62]) {
    const x = ((bi + 0.5) / boards) * N, y = yy * N;
    ctx.beginPath(); ctx.arc(x - 3 * rr, y, rr, 0, 7); ctx.arc(x + 3 * rr, y, rr, 0, 7); ctx.fill();
  }
}

function scuffs(p, N) {
  const r = rng(103), ctx = p.ctx, k = N / 512;
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = r() * N, y = r() * N, len = (40 + r() * 160) * k;
    ctx.strokeStyle = `rgba(20,16,14,${0.08 + r() * 0.15})`;
    ctx.lineWidth = (3 + r() * 6) * k;
    wrapDraw(N, x, y, len, (px, py) => {
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + (r() - 0.5) * 60 * k, py + len / 2, px + (r() - 0.5) * 40 * k, py + len); ctx.stroke();
    });
  }
  for (let i = 0; i < 160; i++) {
    const x = r() * N, y = r() * N;
    ctx.strokeStyle = `rgba(200,190,170,${0.06 + r() * 0.1})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 40 * k, y + (r() - 0.5) * 40 * k); ctx.stroke();
  }
}

// Turn raw pixel buffers into a cached set of three.js textures
function assemble(name, spec, res) {
  const N = spec.N;
  const p = { c: bytesCanvas(res.rgba, N), H: res.H, R: res.R };
  p.ctx = p.c.getContext('2d');
  if (spec.post) spec.post(p, N, spec.params || {});
  const nrm = res.nrm && !spec.postH ? res.nrm : normalArray(p.H, N, spec.normal);
  const set = { map: tex(p.c, true), normalMap: tex(bytesCanvas(nrm, N), false), roughnessMap: tex(greyCanvas(p.R, N), false) };
  cache.set(name, set);
  return set;
}

// ---------- Worker pool ----------
let pool = null;
function getPool() {
  if (pool !== null) return pool;
  try {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    pool = { workers: [], queue: [], pending: new Map(), id: 0 };
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./texworker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => {
        const job = pool.pending.get(e.data.id);
        pool.pending.delete(e.data.id);
        w.busy = false;
        if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data);
        pump();
      };
      w.onerror = (e) => { e.preventDefault(); pool.broken = true; w.busy = false; for (const j of [...pool.pending.values(), ...pool.queue]) j.reject(new Error('worker failed')); pool.pending.clear(); pool.queue.length = 0; };
      pool.workers.push(w);
    }
  } catch (e) { pool = false; }
  return pool;
}
function pump() {
  for (const w of pool.workers) {
    if (w.busy || !pool.queue.length) continue;
    const job = pool.queue.shift();
    w.busy = true;
    pool.pending.set(job.msg.id, job);
    w.postMessage(job.msg);
  }
}
function runInWorker(msg) {
  const P = getPool();
  if (!P || P.broken) return Promise.reject(new Error('no workers'));
  return new Promise((resolve, reject) => { P.queue.push({ msg: { ...msg, id: ++P.id }, resolve, reject }); pump(); });
}

function runLocal(spec) {
  const res = runProgram(spec.program, spec.N, spec.params);
  if (!spec.postH) res.nrm = normalArray(res.H, spec.N, spec.normal);
  return res;
}

// Generate every texture up front, in parallel. Falls back to the main thread if workers fail.
export async function preloadTextures(onProgress = () => {}) {
  const names = Object.keys(SPECS);
  let done = 0;
  const extra = [
    runInWorker({ name: 'macro', N: 256 }).catch(() => runProgram('macro', 256)).then((r) => { macroT = tex(bytesCanvas(r.rgba, 256), false); }),
    runInWorker({ name: 'water', N: 512, normal: 10 }).catch(() => ({ nrm: normalArray(runProgram('water', 512).H, 512, 10) })).then((r) => { waterT = tex(bytesCanvas(r.nrm, 512), false); }),
  ];
  await Promise.all([...extra, ...names.map(async (name) => {
    const spec = SPECS[name];
    let res;
    try { res = await runInWorker({ name: spec.program, N: spec.N, params: spec.params, normal: spec.postH ? 0 : spec.normal }); }
    catch (e) { res = runLocal(spec); }
    assemble(name, spec, res);
    onProgress(++done / names.length);
  })]);
  if (pool) { for (const w of pool.workers) w.terminate(); pool = null; }
}

export function getTex(name) {
  if (cache.has(name)) return cache.get(name);
  const spec = SPECS[name];
  if (!spec) throw new Error('no texture ' + name);
  return assemble(name, spec, runLocal(spec));
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


let leafT, pineT, waterT, macroT;
export const leafTexture = () => (leafT ||= leafCard(256, false));
export const pineTexture = () => (pineT ||= leafCard(256, true, 147));
export const waterNormalTexture = () => (waterT ||= tex(bytesCanvas(normalArray(runProgram('water', 512).H, 512, 10), 512), false));
export const macroTexture = () => (macroT ||= tex(bytesCanvas(runProgram('macro', 256).rgba, 256), false));
const graffitiCache = [];
export function graffitiTexture(i) { return (graffitiCache[i] ||= graffiti(512, 161 + i * 13)); }

// Convenience: build a standard PBR material from a texture set.
export function pbr(name, opts = {}) {
  if (ALIAS[name]) {
    const [base, tint] = ALIAS[name];
    const c = new THREE.Color(tint);
    if (opts.color !== undefined) c.multiply(new THREE.Color(opts.color));
    return pbr(base, { ...opts, color: c });
  }
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

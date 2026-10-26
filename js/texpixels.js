// Pure per-pixel texture programs (no DOM, no three.js), so they can run in Web Workers.
import { makeTileNoise, rng, clamp } from './util.js';

function makeFbm(seed, N, basePeriod, oct) {
  const ns = [];
  for (let i = 0; i < oct; i++) ns.push(makeTileNoise(seed + i * 101, basePeriod << i));
  // each octave's noise has period basePeriod * 2^i, so sampling at u * basePeriod * 2^i tiles
  return (x, y) => {
    const u = (x / N) * basePeriod, v = (y / N) * basePeriod;
    let s = 0, a = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += ns[i](u * f, v * f) * a; n += a; a *= 0.5; f *= 2; }
    return s / n;
  };
}

// Each program returns (x, y, out) -> sets out.r/g/b (0-255), out.h (height), out.rough (0-1)
export const PROGRAMS = {
  grass(N) {
    const n1 = makeFbm(11, N, 4, 5), n2 = makeFbm(29, N, 16, 3);
    return (x, y, o) => {
      const a = n1(x, y), b = n2(x, y);
      const dry = clamp((a - 0.45) * 3, 0, 1);
      o.r = 58 + dry * 50 + b * 20; o.g = 78 + dry * 28 + b * 28; o.b = 40 + dry * 6 + b * 12;
      o.h = b * 0.3; o.rough = 0.9;
    };
  },
  dirt(N, { seed = 5, dark = 0 } = {}) {
    const n1 = makeFbm(seed, N, 4, 6), n2 = makeFbm(seed + 7, N, 32, 2);
    return (x, y, o) => {
      const a = n1(x, y), b = n2(x, y);
      const m = a * 0.75 + b * 0.25;
      o.r = 84 + m * 56 - dark; o.g = 64 + m * 42 - dark * 0.8; o.b = 46 + m * 28 - dark * 0.6;
      o.h = a * 0.7 + b * 0.3; o.rough = 0.95 - b * 0.1;
    };
  },
  rock(N) {
    const n1 = makeFbm(41, N, 4, 6), n2 = makeFbm(43, N, 8, 4);
    return (x, y, o) => {
      const a = n1(x, y), b = n2(x, y);
      const strata = Math.sin((y / N) * Math.PI * 2 * 6 + a * 6) * 0.5 + 0.5;
      const v = 60 + a * 58 + strata * 14;
      o.r = v * 1.06; o.g = v * 0.98; o.b = v * 0.88;
      const lichen = clamp((b - 0.62) * 4, 0, 1) * 0.35;
      o.r = o.r * (1 - lichen) + 96 * lichen; o.g = o.g * (1 - lichen) + 104 * lichen; o.b = o.b * (1 - lichen) + 70 * lichen;
      o.h = a * 0.8 + strata * 0.15 + b * 0.25; o.rough = 0.85;
    };
  },
  concrete(N, { seed = 61, tone = 0, seams = true } = {}) {
    const n1 = makeFbm(seed, N, 4, 5), n2 = makeFbm(seed + 2, N, 64, 2), n3 = makeFbm(seed + 5, N, 2, 3);
    const seamW = Math.max(1, Math.round(N / 256));
    return (x, y, o) => {
      const a = n1(x, y), b = n2(x, y), st = n3(x, y);
      let v = 150 + a * 40 + (b - 0.5) * 30 - tone;
      const stain = clamp((st - 0.6) * 4, 0, 1) * 25;
      v -= stain;
      o.r = v; o.g = v * 0.99; o.b = v * 0.96;
      o.h = a * 0.25 + b * 0.35; o.rough = 0.82 + (b - 0.5) * 0.2 - stain / 200;
      if (seams && (x < seamW || y < seamW)) { o.r *= 0.55; o.g *= 0.55; o.b *= 0.55; o.h -= 0.6; o.rough = 0.95; }
    };
  },
  asphalt(N) {
    const n1 = makeFbm(81, N, 8, 4), n2 = makeFbm(83, N, 64, 2), n3 = makeFbm(85, N, 4, 4);
    return (x, y, o) => {
      const a = n1(x, y), b = n2(x, y), c = n3(x, y);
      const v = 50 + a * 14 + (b > 0.66 ? 14 : 0) + (c - 0.5) * 18;
      o.r = v; o.g = v; o.b = v * 1.03;
      o.h = b * 0.4 + a * 0.2; o.rough = 0.88 - (b > 0.66 ? 0.08 : 0);
    };
  },
  planks(N, { boards = 8, base = [150, 108, 70] } = {}) {
    const n1 = makeFbm(91, N, 2, 4);
    const r = rng(92);
    const tints = Array.from({ length: boards }, () => 0.82 + r() * 0.3);
    return (x, y, o) => {
      const bi = Math.floor((x / N) * boards);
      const fx = (x / N) * boards - bi;
      const grain = Math.sin((y / N) * 40 * Math.PI + n1((x * 4) % N, y) * 18 + bi * 7) * 0.5 + 0.5;
      let k = (0.78 + grain * 0.22) * tints[bi];
      const edge = fx < 0.025 || fx > 0.975;
      if (edge) k *= 0.35;
      o.r = base[0] * k; o.g = base[1] * k; o.b = base[2] * k;
      o.h = edge ? 0 : 0.6 + grain * 0.08; o.rough = edge ? 0.95 : 0.7 + grain * 0.1;
    };
  },
  skatelite(N) {
    const n1 = makeFbm(101, N, 8, 4);
    const seamW = Math.max(1, Math.round(N / 256));
    return (x, y, o) => {
      const a = n1(x, y);
      const v = 46 + a * 18;
      o.r = v * 1.15; o.g = v; o.b = v * 0.85;
      o.h = a * 0.2; o.rough = 0.45 + a * 0.2;
      if (x < seamW) { o.r *= 0.5; o.g *= 0.5; o.b *= 0.5; o.h = -0.3; o.rough = 0.9; }
    };
  },
  corrugated(N, { color = [205, 205, 205], seed = 111 } = {}) {
    const n1 = makeFbm(seed, N, 4, 5), n2 = makeFbm(seed + 1, N, 16, 3);
    return (x, y, o) => {
      const a = n1(x, y), b = n2(x, y);
      const rib = Math.sin((x / N) * Math.PI * 2 * 16);
      const rust = clamp((a - 0.58) * 5 + (b - 0.5), 0, 1);
      const shade = 0.85 + rib * 0.12 + (b - 0.5) * 0.15;
      o.r = (color[0] * (1 - rust) + 120 * rust) * shade;
      o.g = (color[1] * (1 - rust) + 62 * rust) * shade;
      o.b = (color[2] * (1 - rust) + 35 * rust) * shade;
      o.h = rib * 0.5 + rust * 0.1; o.rough = 0.55 + rust * 0.4;
    };
  },
  bark(N) {
    const n1 = makeFbm(121, N, 4, 5);
    return (x, y, o) => {
      const a = n1((x * 4) % N, y * 0.5);
      const ridge = Math.abs(Math.sin((x / N) * Math.PI * 14 + a * 8));
      const v = 50 + ridge * 45 + a * 20;
      o.r = v * 0.95; o.g = v * 0.8; o.b = v * 0.62;
      o.h = ridge; o.rough = 0.95;
    };
  },
  metal(N) {
    const n1 = makeFbm(131, N, 64, 2);
    return (x, y, o) => {
      const a = n1((x * 0.05) % N, y);
      const v = 170 + a * 50;
      o.r = v; o.g = v; o.b = v * 1.02; o.h = a * 0.2; o.rough = 0.35 + a * 0.15;
    };
  },
  macro(N) {
    const n1 = makeFbm(171, N, 4, 5);
    return (x, y, o) => { const v = n1(x, y) * 255; o.r = o.g = o.b = v; o.h = 0; o.rough = 1; };
  },
  water(N) {
    const n1 = makeFbm(151, N, 8, 5);
    return (x, y, o) => { o.r = o.g = o.b = 128; o.h = n1(x, y); o.rough = 0; };
  },
};

export function runProgram(name, N, params) {
  const fn = PROGRAMS[name](N, params || {});
  const rgba = new Uint8ClampedArray(N * N * 4);
  const H = new Float32Array(N * N);
  const R = new Uint8ClampedArray(N * N);
  const out = { r: 0, g: 0, b: 0, h: 0, rough: 0.8 };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    fn(x, y, out);
    const i = y * N + x;
    rgba[i * 4] = out.r; rgba[i * 4 + 1] = out.g; rgba[i * 4 + 2] = out.b; rgba[i * 4 + 3] = 255;
    H[i] = out.h; R[i] = out.rough * 255;
  }
  return { rgba, H, R };
}

// Tangent-space normal map (RGBA bytes) from a wrapping heightfield
export function normalArray(H, N, strength) {
  const d = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) {
    const yu = ((y - 1 + N) % N) * N, yd = ((y + 1) % N) * N, row = y * N;
    for (let x = 0; x < N; x++) {
      const xl = (x - 1 + N) % N, xr = (x + 1) % N;
      const dx = (H[row + xr] - H[row + xl]) * strength;
      const dy = (H[yd + x] - H[yu + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (row + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return d;
}

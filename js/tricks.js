// Trick naming, scoring and combo chaining.
import { TRICK_ANIMS } from './player.js';
import { store } from './util.js';

const SPIN_PTS = { 180: 100, 360: 300, 540: 650, 720: 1100, 900: 1800, 1080: 2700, 1260: 3800, 1440: 5000 };
const FLIP_NAMES = { 1: 'Backflip', 2: 'Double Backflip', 3: 'Triple Backflip' };
const FFLIP_NAMES = { 1: 'Frontflip', 2: 'Double Frontflip', 3: 'Triple Frontflip' };
const ANIM_PTS = { barspin: 350, tailwhip: 700, superman: 450, nohander: 400, cancan: 350, tabletop: 380, nofooter: 400,
  xup: 300, turndown: 560, tucknh: 520, seatgrab: 620, onefooter: 300 };

// Real BMX names for classic combinations. `c` = counts of each animated trick in the air.
// First match wins; a named combo replaces the generic "360 Barspin"-style name and scores 10% more.
const only = (c, want) => Object.keys(c).length === Object.keys(want).length && Object.entries(want).every(([k, n]) => c[k] === n);
const NAMED = [
  { name: 'Flair', test: (a, deg, flips, c) => a.vert && flips === -1 && deg === 180 && only(c, {}) },
  { name: 'Flair Whip', test: (a, deg, flips, c) => a.vert && flips === -1 && deg === 180 && only(c, { tailwhip: 1 }) },
  { name: 'Truckdriver', test: (a, deg, flips, c) => !a.vert && flips === 0 && deg === 360 && only(c, { barspin: 1 }) },
  { name: 'Double Truckdriver', test: (a, deg, flips, c) => !a.vert && flips === 0 && deg === 360 && only(c, { barspin: 2 }) },
  { name: '360 Whip', test: (a, deg, flips, c) => !a.vert && flips === 0 && deg === 360 && only(c, { tailwhip: 1 }) },
  { name: 'Flipwhip', test: (a, deg, flips, c) => flips === -1 && deg < 180 && only(c, { tailwhip: 1 }) },
  { name: 'Double Flipwhip', test: (a, deg, flips, c) => flips === -1 && deg < 180 && only(c, { tailwhip: 2 }) },
  { name: 'Bar Flip', test: (a, deg, flips, c) => flips === -1 && deg < 180 && only(c, { barspin: 1 }) },
  { name: 'Superflip', test: (a, deg, flips, c) => flips === -1 && deg < 180 && only(c, { superman: 1 }) },
  { name: 'Cash Roll', test: (a, deg, flips, c) => !a.vert && flips === -1 && deg === 360 && only(c, {}) },
  { name: 'Whip to Bar', test: (a, deg, flips, c) => flips === 0 && deg < 180 && only(c, { tailwhip: 1, barspin: 1 }) },
  { name: 'Decade', test: (a, deg, flips, c) => flips === 0 && deg < 180 && only(c, { tailwhip: 2, barspin: 1 }) },
  { name: 'Suicide No Hander', test: (a, deg, flips, c) => flips === 0 && deg < 180 && only(c, { tucknh: 1, nohander: 1 }) },
];

export class Tricks {
  constructor(game) {
    this.game = game;
    this.total = 0;
    this.best = 0;
    this.combo = null;
    this.idle = 0;
    this.feed = []; // recent notable landings
    // lifetime stats: saved between sessions
    this.stats = { maxAir: 0, maxHeight: 0, grindDist: 0, manualTime: 0, maxManual: 0, bails: 0, flips: 0, longestCombo: 0, maxSpin: 0, best: 0, lifetime: 0, combos: 0, spinL: 0, spinR: 0, stallTime: 0, wallDist: 0 };
    const saved = store('stats');
    if (saved && typeof saved === 'object') for (const k of Object.keys(this.stats)) if (typeof saved[k] === 'number' && isFinite(saved[k])) this.stats[k] = saved[k];
    this.best = this.stats.best;
    this.onBank = null;
    this.listeners = [];
  }

  on(fn) { this.listeners.push(fn); }
  fire(ev) { for (const fn of this.listeners) fn(ev); }

  ensure() {
    if (!this.combo) this.combo = { parts: [], base: 0, mult: 0, seen: {}, grind: null, manual: null };
    return this.combo;
  }

  addTrick(name, pts, countMult = true) {
    const c = this.ensure();
    const seen = c.seen[name] || 0;
    c.seen[name] = seen + 1;
    const p = Math.round(pts * Math.pow(0.5, seen));
    c.parts.push({ name, pts: p });
    c.base += p;
    if (countMult) c.mult += 1;
    this.idle = 0;
    this.fire({ type: 'trick', name, pts: p });
  }

  airStart(air) {
    this.idle = 0;
  }

  land(air, info) {
    const names = [];
    let pts = 0;
    const deg = Math.round(Math.abs(air.spin) / Math.PI) * 180;
    const flips = info.flips;
    // spin naming
    let spinName = '';
    if (air.vert && deg === 180) spinName = 'Air';
    else if (deg >= 180) { spinName = String(deg); pts += SPIN_PTS[Math.min(1440, deg)] || 5000; }
    if (air.vert && deg === 180) pts += 120;
    this.stats.maxSpin = Math.max(this.stats.maxSpin, deg);
    // flips: positive flip = front flip
    let flipName = '';
    if (flips !== 0) {
      const n = Math.abs(flips);
      flipName = flips < 0 ? (FLIP_NAMES[n] || `${n}x Backflip`) : (FFLIP_NAMES[n] || `${n}x Frontflip`);
      pts += (flips < 0 ? 1000 : 1300) * n * (n > 1 ? 1.6 : 1);
      this.stats.flips += n;
    }
    // animated tricks
    const counts = {};
    for (const t of air.tricks) counts[t.type] = (counts[t.type] || 0) + 1;
    const animNames = [];
    for (const [type, n] of Object.entries(counts)) {
      const base = TRICK_ANIMS[type].label;
      const nm = n === 1 ? base : n === 2 ? `Double ${base}` : `${n}x ${base}`;
      animNames.push(nm);
      const hold = air.tricks.filter((t) => t.type === type).reduce((a, t) => a + t.hold, 0);
      pts += ANIM_PTS[type] * n * (n > 1 ? 1.3 : 1) + hold * 600;
    }
    // compose a name like "360 Backflip Tailwhip", unless the combination has a name of its own
    const named = NAMED.find((n) => n.test(air, deg, flips, counts));
    if (named) { names.push(named.name); pts *= 1.1; }
    else {
      if (spinName && spinName !== 'Air') names.push(spinName);
      if (flipName) names.push(flipName);
      names.push(...animNames);
    }
    // spinning against your usual direction is harder: "Opposite" pays 25% more
    if (deg >= 180 && !air.vert) {
      const dir = air.spin > 0 ? 'spinL' : 'spinR', other = air.spin > 0 ? 'spinR' : 'spinL';
      const st = this.stats;
      if (st[dir] + st[other] >= 10 && st[other] > st[dir] * 2) { names.unshift('Opposite'); pts *= 1.25; }
      st[dir]++;
    }
    // out of fakie: a 180 is a Half Cab, a 360 a Full Cab; anything else gets a Fakie prefix
    const cab = info.fakieStart && !flips && !animNames.length && (deg === 180 || deg === 360) && !air.vert;
    if (cab) { names.length = 0; names.push(deg === 180 ? 'Half Cab' : 'Full Cab'); pts += 80; }
    let name = names.join(' ');
    if (info.fakieStart && name && !cab) { name = 'Fakie ' + name; pts *= 1.15; }
    // a plain hop is not a trick: "Big Air" needs real height or hang time
    if (!name && (spinName === 'Air' || (air.t > 0.75 && (info.height > 1.6 || air.t > 1.1)))) name = air.vert ? 'Air' : 'Big Air';
    // landing fakie only counts when you didn't start that way
    if (info.fakie && !info.fakieStart && name) { name += ' to Fakie'; pts += 50; }
    // air bonus
    if (air.t > 0.6) pts += Math.round((air.t - 0.6) * 220);
    if (info.height > 2) pts += Math.round((info.height - 2) * 60);
    this.stats.maxAir = Math.max(this.stats.maxAir, air.t);
    this.stats.maxHeight = Math.max(this.stats.maxHeight, info.height);
    this.fire({ type: 'land', air, info, name, pts, deg, flips });
    if (name && pts > 0) this.addTrick(name, Math.round(pts));
    else if (air.t > 0.45 && this.combo) this.idle = 0;
  }

  grindStart(style) {
    const c = this.ensure();
    c.grind = { style, pts: 0, dist: 0, time: 0 };
    this.addTrick(style, 150);
  }
  grindTick(dt, d) {
    const c = this.combo; if (!c || !c.grind) return;
    c.grind.time += dt; c.grind.dist += d;
    const p = d * 40;
    c.grind.pts += p; c.base += p;
    if (c.grind.style !== 'Wallride') this.stats.grindDist += d;
    this.idle = 0;
  }
  // lip tricks pay by the second
  stallTick(dt) {
    const c = this.combo; if (!c || !c.grind) return;
    c.grind.time += dt;
    const p = dt * 260;
    c.grind.pts += p; c.base += p;
    c.grind.stall = true;
    this.stats.stallTime += dt;
    this.idle = 0;
  }
  grindEnd() {
    const c = this.combo; if (!c || !c.grind) return;
    const last = c.parts[c.parts.length - 1];
    if (last) { last.pts += Math.round(c.grind.pts); last.name = c.grind.stall ? `${c.grind.style} (${c.grind.time.toFixed(1)}s)` : `${c.grind.style} (${c.grind.dist.toFixed(1)}m)`; }
    if (c.grind.style === 'Wallride') this.stats.wallDist += c.grind.dist;
    c.base = Math.round(c.base);
    c.grind = null;
    this.idle = 0;
  }

  manualStart(name) {
    const c = this.ensure();
    c.manual = { name, time: 0, pts: 0 };
    this.addTrick(name, 100);
  }
  manualTick(dt) {
    const c = this.combo; if (!c || !c.manual) return;
    c.manual.time += dt;
    const p = dt * 160;
    c.manual.pts += p; c.base += p;
    this.stats.manualTime += dt;
    this.stats.maxManual = Math.max(this.stats.maxManual, c.manual.time);
    this.idle = 0;
  }
  manualEnd(clean) {
    const c = this.combo; if (!c || !c.manual) return;
    const last = c.parts[c.parts.length - 1];
    if (last && last.name.startsWith(c.manual.name)) { last.pts += Math.round(c.manual.pts); last.name = `${c.manual.name} (${c.manual.time.toFixed(1)}s)`; }
    c.manual = null;
    c.base = Math.round(c.base);
    this.idle = 0;
    if (!clean) this.idle = 0.5;
  }

  bail(reason) {
    this.stats.bails++;
    this.saveStats();
    if (this.combo && this.combo.parts.length) this.fire({ type: 'comboLost', combo: this.combo, reason });
    else this.fire({ type: 'bail', reason });
    this.combo = null;
  }

  // Called every frame; banks the combo after a short grace period on the ground
  update(dt, player) {
    const c = this.combo;
    if (!c) return;
    const busy = player.mode !== 'ground' || player.manual;
    if (busy) { this.idle = 0; return; }
    this.idle += dt;
    if (this.idle > 0.75) this.bank();
  }

  bank() {
    const c = this.combo;
    this.combo = null;
    if (!c || !c.parts.length) return;
    const mult = Math.max(1, c.mult);
    // variety bonus: 10% for every different trick beyond the third, up to 50%
    const kinds = Object.keys(c.seen).filter((k) => !['Sprocket', 'Perfect Landing', 'Revert'].includes(k)).length;
    const variety = Math.min(0.5, Math.max(0, kinds - 3) * 0.1);
    const score = Math.round(c.base * mult * (1 + variety));
    this.total += score;
    this.best = Math.max(this.best, score);
    this.stats.longestCombo = Math.max(this.stats.longestCombo, c.parts.length);
    this.stats.best = this.best; this.stats.lifetime += score; this.stats.combos++;
    this.saveStats();
    const label = c.parts.map((p) => p.name).join(' + ');
    this.fire({ type: 'bank', score, mult, base: Math.round(c.base), label, parts: c.parts, variety });
  }

  saveStats() { store('stats', this.stats); }

  comboText() {
    const c = this.combo;
    if (!c) return null;
    let names = c.parts.map((p) => p.name);
    if (c.grind) names[names.length - 1] = c.grind.stall ? `${c.grind.style} ${c.grind.time.toFixed(1)}s` : `${c.grind.style} ${c.grind.dist.toFixed(1)}m`;
    if (c.manual) names[names.length - 1] = `${c.manual.name} ${c.manual.time.toFixed(1)}s`;
    if (names.length > 5) names = ['…', ...names.slice(-5)];
    return { text: names.join(' + '), base: Math.round(c.base), mult: Math.max(1, c.mult) };
  }
}

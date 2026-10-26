// Trick naming, scoring and combo chaining.
import { TRICK_ANIMS } from './player.js';

const SPIN_PTS = { 180: 100, 360: 300, 540: 650, 720: 1100, 900: 1800, 1080: 2700, 1260: 3800, 1440: 5000 };
const FLIP_NAMES = { 1: 'Backflip', 2: 'Double Backflip', 3: 'Triple Backflip' };
const FFLIP_NAMES = { 1: 'Frontflip', 2: 'Double Frontflip', 3: 'Triple Frontflip' };
const ANIM_PTS = { barspin: 350, tailwhip: 700, superman: 450, nohander: 400, cancan: 350, tabletop: 380, nofooter: 400 };

export class Tricks {
  constructor(game) {
    this.game = game;
    this.total = 0;
    this.best = 0;
    this.combo = null;
    this.idle = 0;
    this.feed = []; // recent notable landings
    this.stats = { maxAir: 0, maxHeight: 0, grindDist: 0, manualTime: 0, bails: 0, flips: 0, longestCombo: 0, maxSpin: 0 };
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
    // compose a name like "360 Backflip Tailwhip"
    if (spinName && spinName !== 'Air') names.push(spinName);
    if (flipName) names.push(flipName);
    names.push(...animNames);
    let name = names.join(' ');
    if (!name && (spinName === 'Air' || air.t > 0.75)) name = air.vert ? 'Air' : 'Big Air';
    if (info.fakie) { name = (name ? name + ' to Fakie' : 'Fakie'); pts += 50; }
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
    this.stats.grindDist += d;
    this.idle = 0;
  }
  grindEnd() {
    const c = this.combo; if (!c || !c.grind) return;
    const last = c.parts[c.parts.length - 1];
    if (last) { last.pts += Math.round(c.grind.pts); last.name = `${c.grind.style} (${c.grind.dist.toFixed(1)}m)`; }
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
    const score = Math.round(c.base * mult);
    this.total += score;
    this.best = Math.max(this.best, score);
    this.stats.longestCombo = Math.max(this.stats.longestCombo, c.parts.length);
    const label = c.parts.map((p) => p.name).join(' + ');
    this.fire({ type: 'bank', score, mult, base: Math.round(c.base), label, parts: c.parts });
  }

  comboText() {
    const c = this.combo;
    if (!c) return null;
    let names = c.parts.map((p) => p.name);
    if (c.grind) names[names.length - 1] = `${c.grind.style} ${c.grind.dist.toFixed(1)}m`;
    if (c.manual) names[names.length - 1] = `${c.manual.name} ${c.manual.time.toFixed(1)}s`;
    if (names.length > 5) names = ['…', ...names.slice(-5)];
    return { text: names.join(' + '), base: Math.round(c.base), mult: Math.max(1, c.mult) };
  }
}

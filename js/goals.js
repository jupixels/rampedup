// Things to do at each spot: a ladder of five goals per spot, named gaps to find,
// and a daily challenge that is the same for every player (seeded by the date).
import { ZONES } from './layout.js';
import { store, rng } from './util.js';

const rad = (d) => (d * Math.PI) / 180;
// horizontal distance from a ramp's origin to the middle of its gap / table (see props.js profiles)
const arcRun = (h, deg) => (h / (1 - Math.cos(rad(deg)))) * Math.sin(rad(deg));
const boxMid = (h, deg, table) => arcRun(h, deg) + 0.05 + table / 2;
const doubleMid = (h, gap, deg = 38) => arcRun(h, deg) + h / Math.tan(1.1) + gap / 2;

// Gaps are spots you have to be airborne over. r = horizontal radius, minY = lowest wheel height that counts.
export function defineGaps(world) {
  const A = world.anchors, T = world.terrain;
  const yy = A.yy, dy = A.docksY;
  const g = [];
  const add = (id, zone, name, x, z, r, extra = {}) => g.push({ id, zone, name, x, z, r, ...extra });
  // The Yard
  add('box1', 'yard', 'Box One', 56, 52 - boxMid(1.0, 30, 2.8), 1.5);
  add('box2', 'yard', 'Box Two', 56, 30 - boxMid(1.6, 33, 4.2), 2.0);
  add('box3', 'yard', 'Box Three', 56, 2 - boxMid(2.3, 35, 5.6), 2.6);
  add('funbox', 'yard', 'Funbox Flyover', 0, -8, 1.8, { minY: yy + 1.5 });
  add('spine', 'yard', 'Spine Transfer', 0, -36.5, 1.5, { minY: yy + 1.9 });
  add('stairs', 'yard', 'Five Stair', -62, 11.95, 1.4);
  // Loam Woods
  const namesA = ['Sprout', 'Sapling', 'Branch', 'Trunk', 'Canopy'];
  [[1.0, 2.6], [1.1, 2.9], [1.2, 3.2], [1.3, 3.4], [1.4, 3.6]].forEach(([h, gap], i) => add('woodsA' + (i + 1), 'woods', namesA[i], 288, 58 - 23 * i - doubleMid(h, gap), gap / 2));
  const namesB = ['Timber', 'Lumberjack', 'Widowmaker', 'Old Growth'];
  [[1.7, 3.6], [1.9, 4.0], [2.1, 4.4], [2.3, 4.8]].forEach(([h, gap], i) => add('woodsB' + (i + 1), 'woods', namesB[i], 313, 54 - 30 * i - doubleMid(h, gap, 40), gap / 2));
  // Port Rusty
  [-357.5, -374.5, -391.5].forEach((x, i) => add('boxcar' + (i + 1), 'docks', 'Box Car ' + (i + 1), x, 8, 1.7, { minY: dy + 2.2 }));
  add('roof', 'docks', 'Warehouse Roof', -250, 33, 2.2, { minY: dy + 6.5 });
  add('lake', 'docks', 'Lake Launch', -470, 60, 3.5, { instant: true });
  // Big Air
  add('mega', 'bigair', 'Mega', A.megaLip.x, A.megaLip.z + 7.5, 5, { minY: A.megaLip.y - 4 });
  add('hip', 'bigair', 'Warm-up Hip', 64, 336.6, 2.2);
  // The Pool and The Channel
  add('poolover', 'pool', 'Carve Over', A.pool.x, A.pool.z, 2.2, { minY: A.poolTop + 0.2 });
  add('channel', 'channel', 'Ditch Jump', A.channel.x, A.channel.z, 1.6, { x1: A.channel.x - 55, x2: A.channel.x + 55, minY: A.channel.y + 1.6 });
  // Summit trail doubles
  const trailNames = { 70: 'Ridge Double', 215: 'Switchback Double', 380: 'Treeline Double', 530: 'Creek Double', 610: 'Last Chance' };
  const sizes = { 70: [1.1, 3.0], 215: [1.3, 3.6], 380: [1.4, 3.8], 530: [1.2, 3.2], 610: [1.5, 4.0] };
  for (const f of A.trailFeatures || []) {
    if (!sizes[f]) continue;
    const a = T.pathPoint(T.trail, f);
    const s = doubleMid(sizes[f][0], sizes[f][1]);
    add('trail' + f, 'summit', trailNames[f], a.x + Math.sin(a.dir) * s, a.z + Math.cos(a.dir) * s, sizes[f][1] / 2 + 0.3);
  }
  return g;
}

const inZone = (z) => (e, c) => c.zone === z;
const land = (fn) => (e, c) => e.type === 'land' && fn(e, c);
const bank = (n) => (e) => e.type === 'bank' && e.score >= n;
const gapHit = (...ids) => (e) => e.type === 'gap' && ids.includes(e.id);
const overGap = (e) => e.air && e.air.gapsHit && e.air.gapsHit.length > 0;
const realGrind = (e) => e.type === 'grindEnd' && !e.stall && e.style !== 'Wallride';

// Five goals per spot, easiest first. test(event, ctx) — ctx.zone is the spot the rider is in.
export const GOALS = [
  { zone: 'yard', name: 'Warm Up', desc: 'Bank a 2,000 point combo', test: bank(2000) },
  { zone: 'yard', name: 'Rail Check', desc: 'Grind 8 m in one grind', test: (e) => realGrind(e) && e.dist >= 8 },
  { zone: 'yard', name: 'Coping Killer', desc: 'Hold a lip trick for 2 seconds', test: (e) => e.type === 'grindEnd' && e.stall && e.time >= 2 },
  { zone: 'yard', name: 'Third Box', desc: 'Clear the Box Three gap', test: gapHit('box3') },
  { zone: 'yard', name: 'Yard Boss', desc: 'Bank a 30,000 point combo', test: bank(30000) },

  { zone: 'woods', name: 'First Flight', desc: 'Clear any dirt double', test: (e) => e.type === 'gap' },
  { zone: 'woods', name: 'Spin Cycle', desc: 'Land a 360 over a dirt double', test: land((e) => e.deg >= 360 && overGap(e)) },
  { zone: 'woods', name: 'Flip the Woods', desc: 'Backflip over a dirt double', test: land((e) => e.flips <= -1 && overGap(e)) },
  { zone: 'woods', name: 'Widowmaker', desc: 'Clear the Widowmaker, the third double on the big line', test: gapHit('woodsB3', 'woodsB4') },
  { zone: 'woods', name: 'Lumber Lord', desc: 'Bank a 15,000 point combo', test: bank(15000) },

  { zone: 'docks', name: 'Dock Worker', desc: 'Grind 6 m in one grind', test: (e) => realGrind(e) && e.dist >= 6 },
  { zone: 'docks', name: 'Wall Crawler', desc: 'Wallride a container for 4 m', test: (e) => e.type === 'grindEnd' && e.style === 'Wallride' && e.dist >= 4 },
  { zone: 'docks', name: 'Box Car Hopper', desc: 'Jump a gap between containers', test: gapHit('boxcar1', 'boxcar2', 'boxcar3') },
  { zone: 'docks', name: 'Man Overboard', desc: 'Launch off the pier into the lake', test: gapHit('lake') },
  { zone: 'docks', name: 'Roof Raiser', desc: 'Clear the Warehouse Roof gap', test: gapHit('roof') },

  { zone: 'bigair', name: 'Commit', desc: 'Clear the Mega gap', test: gapHit('mega') },
  { zone: 'bigair', name: 'Hang Time', desc: 'Land an air of 3 seconds', test: land((e) => e.air.t >= 3) },
  { zone: 'bigair', name: 'Mega Flip', desc: 'Backflip over the Mega gap', test: land((e) => e.flips <= -1 && e.air.gapsHit && e.air.gapsHit.includes('mega')) },
  { zone: 'bigair', name: 'Seven-Twenty', desc: 'Land a 720', test: land((e) => e.deg >= 720) },
  { zone: 'bigair', name: 'Mega Session', desc: 'Bank a 40,000 point combo', test: bank(40000) },

  { zone: 'pool', name: 'Dip In', desc: 'Air out of the bowl and land it', test: land((e) => e.air.vert && e.air.t > 0.5) },
  { zone: 'pool', name: 'Tile Tapper', desc: 'Hold a lip trick on the pool coping for 2 seconds', test: (e) => e.type === 'grindEnd' && e.stall && e.time >= 2 },
  { zone: 'pool', name: 'Carve Over', desc: 'Air across the middle of the bowl', test: gapHit('poolover') },
  { zone: 'pool', name: 'Pool Flair', desc: 'Land a Flair', test: land((e) => /Flair/.test(e.name)) },
  { zone: 'pool', name: 'Bowl Boss', desc: 'Bank a 12,000 point combo', test: bank(12000) },

  { zone: 'channel', name: 'Balance Beam', desc: 'Hold a manual for 3 seconds', test: (e) => e.type === 'manualEnd' && e.time >= 3 },
  { zone: 'channel', name: 'Tagger', desc: 'Wallride a graffiti wall for 3 m', test: (e) => e.type === 'grindEnd' && e.style === 'Wallride' && e.dist >= 3 },
  { zone: 'channel', name: 'Ditch Spin', desc: 'Land a 360', test: land((e) => e.deg >= 360) },
  { zone: 'channel', name: 'Long Haul', desc: 'Hold a manual for 8 seconds', test: (e) => e.type === 'manualEnd' && e.time >= 8 },
  { zone: 'channel', name: 'Channel Surfer', desc: 'Bank a 12,000 point combo', test: bank(12000) },

  { zone: 'summit', name: 'Send It Down', desc: 'Reach 50 km/h on the trail', test: (e, c) => e.type === 'tick' && c.speed >= 13.9 },
  { zone: 'summit', name: 'Trail Double', desc: 'Clear any double on the trail', test: (e) => e.type === 'gap' },
  { zone: 'summit', name: 'Style Points', desc: 'Land a Table Top or Turndown on the trail', test: land((e) => e.air.tricks.some((t) => t.type === 'tabletop' || t.type === 'turndown')) },
  { zone: 'summit', name: 'Top to Bottom', desc: 'Finish the Summit Downhill course', test: (e) => e.type === 'courseDone' && e.course.id === 'summit', anywhere: true },
  { zone: 'summit', name: 'Downhill Silver', desc: 'Earn silver or better on Summit Downhill', test: (e) => e.type === 'courseDone' && e.course.id === 'summit' && e.medal >= 2, anywhere: true },
];
{ const n = {}; for (const goal of GOALS) { n[goal.zone] = (n[goal.zone] || 0) + 1; goal.tier = n[goal.zone]; goal.id = goal.zone + goal.tier; } }

// Daily challenge: three picks from this pool, chosen by the date so everyone gets the same set.
const DAILY_POOL = [
  { name: 'Score {n} points today', pick: [20000, 40000, 60000], stat: 'score' },
  { name: 'Land {n} flips', pick: [3, 5, 8], stat: 'flips' },
  { name: 'Grind {n} m', pick: [40, 80, 120], stat: 'grind' },
  { name: 'Hold manuals for {n} seconds in total', pick: [15, 30, 45], stat: 'manual' },
  { name: 'Clear {n} gaps', pick: [5, 10, 15], stat: 'gaps' },
  { name: 'Spin {n} degrees in total', pick: [1800, 3600, 5400], stat: 'spin' },
  { name: 'Land {n} tricks out of fakie', pick: [2, 4, 6], stat: 'fakie' },
  { name: 'Hold lip tricks for {n} seconds in total', pick: [6, 12, 20], stat: 'stall' },
  { name: 'Wallride {n} m', pick: [10, 20, 30], stat: 'wall' },
  { name: 'Bank a {n} point combo', pick: [8000, 15000, 25000], stat: 'best', max: true },
  { name: 'Get {n} seconds of airtime in total', pick: [30, 60, 90], stat: 'air' },
  { name: 'Finish {n} courses', pick: [1, 2, 3], stat: 'courses' },
];
export function dayKey(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function dailyFor(key) {
  const r = rng([...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  const pool = DAILY_POOL.slice(), out = [];
  for (let i = 0; i < 3; i++) {
    const d = pool.splice(Math.floor(r() * pool.length), 1)[0];
    const n = d.pick[Math.floor(r() * d.pick.length)];
    out.push({ stat: d.stat, n, max: !!d.max, name: d.name.replace('{n}', n.toLocaleString()) });
  }
  return out;
}

export class Goals {
  constructor(game) {
    this.game = game;
    this.gaps = defineGaps(game.world);
    this.byZone = {};
    for (const gap of this.gaps) (this.byZone[gap.zone] = this.byZone[gap.zone] || []).push(gap);
    this.foundGaps = new Set(store('gaps') || []);
    this.done = new Set(store('goals') || []);
    this.tickT = 0;
    this.loadDaily();
  }

  // ---------- zone ----------
  zoneKey() {
    const g = this.game, p = g.player.pos;
    for (const [k, z] of Object.entries(ZONES)) if (Math.abs(p.x - z.x) < z.hx + 10 && Math.abs(p.z - z.z) < z.hz + 10) return k;
    const t = g.world.terrain;
    if (t.nearestOnPath(t.trail, p.x, p.z).d < 14) return 'summit';
    return null;
  }

  // next unfinished goal for a spot (or null when the ladder is complete)
  next(zone) { return GOALS.find((x) => x.zone === zone && !this.done.has(x.id)) || null; }
  count(zone) { return GOALS.filter((x) => x.zone === zone && this.done.has(x.id)).length; }

  // ---------- per frame: gap detection ----------
  update(dt) {
    const g = this.game, p = g.player;
    this.tickT += dt;
    if (this.tickT > 0.25) { this.tickT = 0; this.zone = this.zoneKey(); this.onEvent({ type: 'tick' }); }
    if (p.mode !== 'air' || !p.air) return;
    const list = this.gaps; // a few dozen circles: cheap enough to test them all
    const A = p.air;
    if (!A.gapsHit) A.gapsHit = [];
    for (const gap of list) {
      if (A.gapsHit.includes(gap.id)) continue;
      let dx = p.pos.x - gap.x; const dz = p.pos.z - gap.z;
      if (gap.x1 !== undefined) dx = p.pos.x < gap.x1 ? p.pos.x - gap.x1 : p.pos.x > gap.x2 ? p.pos.x - gap.x2 : 0;
      if (dx * dx + dz * dz > gap.r * gap.r) continue;
      if (gap.minY !== undefined ? p.pos.y < gap.minY : p.pos.y - g.world.collision.ground(p.pos.x, p.pos.z, p.pos.y + 0.3, p.g2).h < 0.35) continue;
      A.gapsHit.push(gap.id);
      if (gap.instant) this.award(gap);
    }
  }

  award(gap) {
    const g = this.game;
    if (g.modded) return;
    const first = !this.foundGaps.has(gap.id);
    g.tricks.addTrick(`${gap.name} Gap`, first ? 500 : 200, false);
    this.bump('gaps', 1);
    if (first) {
      this.foundGaps.add(gap.id);
      store('gaps', [...this.foundGaps]);
      g.ui.toast(`Gap found: ${gap.name}  ${this.foundGaps.size}/${this.gaps.length}`, 'gold');
      g.audio.play('pickup');
      g.progress.add(120, 'new gap');
    }
    this.onEvent({ type: 'gap', id: gap.id, zone: gap.zone });
  }

  // ---------- events ----------
  onEvent(e) {
    const g = this.game;
    if (g.modded) return;
    if (e.type === 'land' && e.air && e.air.gapsHit) for (const id of e.air.gapsHit) { const gap = this.gaps.find((x) => x.id === id); if (gap && !gap.instant) this.award(gap); }
    this.trackDaily(e);
    // a gap knows which spot it belongs to, even where it sticks out past the spot's edge (the pier)
    const ctx = { zone: e.type === 'gap' ? e.zone : this.zone, speed: g.player.speed };
    for (const goal of GOALS) {
      if (this.done.has(goal.id)) continue;
      if (!goal.anywhere && goal.zone !== ctx.zone) continue;
      let ok = false;
      try { ok = !!goal.test(e, ctx); } catch (err) { ok = false; }
      if (!ok) continue;
      this.done.add(goal.id);
      store('goals', [...this.done]);
      g.ui.toast(`${ZONES[goal.zone].name} goal: ${goal.name}  ${this.count(goal.zone)}/5`, 'challenge');
      g.audio.play('record');
      g.progress.add(150 * goal.tier, 'spot goal');
      if (this.count(goal.zone) === 5) { g.fx.confetti(g.player.pos, 120); g.ui.toast(`${ZONES[goal.zone].name} complete!`, 'gold'); g.progress.add(500, 'spot complete'); }
    }
  }

  // ---------- daily challenge ----------
  loadDaily() {
    const key = dayKey();
    const saved = store('daily');
    this.daily = saved && saved.key === key ? saved : { key, prog: {}, done: [] };
    this.dailyList = dailyFor(key);
  }
  bump(stat, v, max = false) {
    const d = this.daily;
    d.prog[stat] = max ? Math.max(d.prog[stat] || 0, v) : (d.prog[stat] || 0) + v;
    this.dirty = true;
  }
  trackDaily(e) {
    if (dayKey() !== this.daily.key) this.loadDaily();
    if (e.type === 'bank') { this.bump('score', e.score); this.bump('best', e.score, true); }
    else if (e.type === 'land') {
      if (e.flips) this.bump('flips', Math.abs(e.flips));
      if (e.deg) this.bump('spin', e.deg);
      if (e.info && e.info.fakieStart && e.name) this.bump('fakie', 1);
      this.bump('air', e.air.t);
    } else if (e.type === 'grindEnd') this.bump(e.stall ? 'stall' : e.style === 'Wallride' ? 'wall' : 'grind', e.stall ? e.time : e.dist);
    else if (e.type === 'manualEnd') this.bump('manual', e.time);
    else if (e.type === 'courseDone') this.bump('courses', 1);
    if (!this.dirty) return;
    if (e.type === 'tick' || e.type === 'bank' || e.type === 'courseDone') {
      this.dirty = false;
      const g = this.game;
      this.dailyList.forEach((d, i) => {
        if (this.daily.done.includes(i) || (this.daily.prog[d.stat] || 0) < d.n) return;
        this.daily.done.push(i);
        g.ui.toast(`Daily challenge complete: ${d.name}`, 'challenge');
        g.audio.play('record');
        g.progress.add(600, 'daily challenge');
        if (this.daily.done.length === 3) { g.fx.confetti(g.player.pos, 140); g.progress.add(900, 'all dailies'); }
      });
      store('daily', this.daily);
    }
  }
}

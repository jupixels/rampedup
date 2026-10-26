// Obstacle courses (timed gate runs + trick attack), ghost replays,
// collectible golden sprockets and challenges.
import * as THREE from 'three';
import { ZONES } from './layout.js';
import { RiderBike } from './bikeModel.js';
import { store, formatTime, rng } from './util.js';

function label(text, sub = '', color = '#ff5a1f') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(12,12,14,0.78)';
  g.beginPath(); g.roundRect(8, 8, 496, 144, 22); g.fill();
  g.fillStyle = color; g.fillRect(8, 8, 14, 144);
  g.fillStyle = '#fff';
  g.font = '700 58px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(text.toUpperCase(), 44, 76);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = '500 34px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(sub, 44, 124);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(4.2, 1.31, 1);
  return s;
}

export function defineCourses(world) {
  const A = world.anchors, T = world.terrain;
  const yard = ZONES.yard, woods = ZONES.woods;
  const trail = T.trail;
  const tp = (s) => { const p = T.pathPoint(trail, s); return { x: p.x, z: p.z }; };
  const sumGates = [];
  for (let s = 45; s < trail.length - 20; s += 68) sumGates.push(tp(s));
  const lip = A.megaLip, land = A.megaLand;
  return [
    {
      id: 'yard', name: 'Yard Flow', zone: 'yard', diff: 'Easy', type: 'gates', par: [55, 42, 34],
      start: { x: -6, z: 46, yaw: Math.PI },
      gates: [{ x: 0, z: 12 }, { x: 0, z: -26 }, { x: -35, z: -30 }, { x: -62, z: -2 }, { x: -30, z: 46 }, { x: 22, z: 40 }, { x: 56, z: 56 }, { x: 56, z: -32 }, { x: 22, z: -12, finish: true }],
    },
    {
      id: 'woods', name: 'Loam Line', zone: 'woods', diff: 'Medium', type: 'gates', par: [62, 48, 40],
      start: { x: 288, z: 81, yaw: Math.PI, top: true },
      gates: [{ x: 288, z: 44 }, { x: 288, z: 21 }, { x: 288, z: -2 }, { x: 288, z: -25 }, { x: 288, z: -48 }, { x: 300, z: -118 }, { x: 329, z: -60 }, { x: 329, z: 10 }, { x: 329, z: 62, finish: true }],
    },
    {
      id: 'summit', name: 'Summit Downhill', zone: 'summit', diff: 'Hard', type: 'gates', par: [150, 115, 95],
      start: { x: A.summit.x, z: A.summit.z, yaw: Math.atan2(sumGates[0].x - A.summit.x, sumGates[0].z - A.summit.z) },
      gates: [...sumGates, { ...tp(trail.length - 3), finish: true }],
    },
    {
      id: 'docks', name: 'Dockyard Gauntlet', zone: 'docks', diff: 'Medium', type: 'gates', par: [80, 62, 50],
      start: { x: -226, z: 79, yaw: -Math.PI / 2 },
      gates: [{ x: -270, z: 79 }, { x: -322, z: 79 }, { x: -326, z: 30 }, { x: -338, z: 8, top: true }, { x: -374.5, z: 8, top: true }, { x: -414, z: 8 }, { x: -412, z: 70 }, { x: -360, z: 112 }, { x: -268, z: 112, finish: true }],
    },
    {
      id: 'bigair', name: 'Big Air Send', zone: 'bigair', diff: 'Expert', type: 'gates', par: [18, 14, 12],
      start: { x: A.megaDeck.x, z: A.megaDeck.z - 1, yaw: 0, top: true },
      gates: [{ x: lip.x, z: lip.z + 9, y: lip.y + 3.4, r: 6 }, { x: land.x, z: land.z + 4 }, { x: land.x, z: A.megaQP.z - 4 }, { x: land.x + 16, z: land.z + 20, finish: true }],
    },
    {
      id: 'trickattack', name: 'Trick Attack', zone: 'yard', diff: 'Score', type: 'score', duration: 90, par: [15000, 45000, 100000],
      start: { x: 10, z: 30, yaw: Math.PI },
    },
    {
      id: 'megascore', name: 'Mega Session', zone: 'bigair', diff: 'Score', type: 'score', duration: 60, par: [8000, 25000, 60000],
      start: { x: A.megaDeck.x, z: A.megaDeck.z - 1, yaw: 0, top: true },
    },
  ];
}

export function defineSprockets(world) {
  const A = world.anchors, T = world.terrain;
  const yy = A.yy;
  const s = [
    [-35, -55.6, null, 'Vert deck'], [-2.5, -8, yy + 3.4], [56, -8, yy + 4.7], [0, -36.6, null], [-62, 22, null], [22, 22, null],
    [-300, 79, null], [-240, 25, null], [-482, 60, A.docksY + 2.4], [-357.5, 8, A.docksY + 4.3], [-250, 33, A.roofTop.y + 2.2],
    [A.megaDeck.x, A.megaDeck.z, null], [A.megaLip.x, A.megaLip.z + 9, A.megaLip.y + 4.2], [A.megaQP.x + 5, A.megaQP.z + 8.5, A.bigAirY + 11.5], [64, 336, A.bigAirY + 3.2],
    [306, 82, null], [313, 44, null, 'B1'], [313, 14, null], [300, -138, null],
    [A.summit.x - 9, A.summit.z - 4, null], [-150, -150, null], [180, 240, null], [-560, 330, null], [-480, -60, null],
    [A.pool.x, A.pool.z, A.poolTop + 3.2], [A.pool.x + 9, A.pool.z, null], [A.channel.x - 20, A.channel.z, A.channel.y + 3.4], [A.channel.x + 55, A.channel.z - 9, null],
    [420, -420, null], [520, 260, null], [-650, -620, null], [150, -620, null], [640, -100, null], [-120, 520, null],
  ];
  // trail gaps
  for (const f of (A.trailFeatures || []).slice(0, 4)) {
    const p = T.pathPoint(T.trail, f + 6);
    s.push([p.x, p.z, null]);
  }
  return s.map((d, i) => ({ id: i, x: d[0], z: d[1], y: d[2] }));
}

export const CHALLENGES = [
  { id: 'air1', name: 'First Flight', desc: 'Get 1 second of airtime', test: (e, st) => st.maxAir >= 1 },
  { id: 'spin360', name: 'Spin Doctor', desc: 'Land a 360', test: (e) => e.type === 'land' && e.deg >= 360 },
  { id: 'backflip', name: 'Flip Out', desc: 'Land a backflip', test: (e) => e.type === 'land' && e.flips <= -1 },
  { id: 'frontflip', name: 'Send It Forward', desc: 'Land a frontflip', test: (e) => e.type === 'land' && e.flips >= 1 },
  { id: 'whip', name: 'Whip It', desc: 'Land a tailwhip', test: (e) => e.type === 'land' && e.air.tricks.some((t) => t.type === 'tailwhip') },
  { id: 'dbar', name: 'Double Trouble', desc: 'Land a double barspin', test: (e) => e.type === 'land' && e.air.tricks.filter((t) => t.type === 'barspin').length >= 2 },
  { id: 'grind30', name: 'Rail Rat', desc: 'Grind 30 m in total', test: (e, st) => st.grindDist >= 30 },
  { id: 'manual5', name: 'Wheelie King', desc: 'Hold a 5 second manual', test: (e, st, g) => g.player.manual && g.player.manual.time >= 5 },
  { id: 'combo5k', name: 'Combo Starter', desc: 'Bank a 5,000 point combo', test: (e) => e.type === 'bank' && e.score >= 5000 },
  { id: 'combo25k', name: 'Combo Master', desc: 'Bank a 25,000 point combo', test: (e) => e.type === 'bank' && e.score >= 25000 },
  { id: 'air3', name: 'Mega Send', desc: 'Get 3 seconds of airtime', test: (e, st) => st.maxAir >= 3 },
  { id: 'spin900', name: 'The 900', desc: 'Land a 900', test: (e) => e.type === 'land' && e.deg >= 900 },
  { id: 'sprockets10', name: 'Collector', desc: 'Find 10 golden sprockets', test: (e, st, g) => g.courses.found.size >= 10 },
  { id: 'sprocketsAll', name: 'Completionist', desc: 'Find every golden sprocket', test: (e, st, g) => g.courses.found.size >= g.courses.sprockets.length },
  { id: 'course', name: 'Gate Keeper', desc: 'Finish any course', test: (e) => e.type === 'courseDone' },
  { id: 'gold', name: 'Gold Standard', desc: 'Get a gold medal on any course', test: (e) => e.type === 'courseDone' && e.medal === 3 },
  { id: 'splash', name: 'Splashdown', desc: 'Launch into the lake', test: (e) => e.type === 'bail' && e.reason === 'splash' },
];

const GATE_R = 4.8;

export class Courses {
  constructor(game) {
    this.game = game;
    const w = game.world;
    this.list = defineCourses(w);
    this.sprockets = defineSprockets(w);
    this.found = new Set(store('sprockets') || []);
    this.best = store('best') || {};
    this.medals = store('medals') || {};
    this.done = new Set(store('challenges') || []);
    this.run = null;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.resolveHeights();
    this.buildMarkers();
    this.buildSprockets();
    this.gateMeshes = [];
    this.ghost = null;
  }

  groundTop(x, z, top) {
    const col = this.game.world.collision;
    const t = col.terrain.sample(x, z);
    return col.ground(x, z, top ? t + 60 : t + 1.2, { n: new THREE.Vector3() }).h;
  }

  resolveHeights() {
    for (const c of this.list) {
      c.start.y = this.groundTop(c.start.x, c.start.z, c.start.top);
      for (const g of c.gates || []) {
        g.base = g.y ?? this.groundTop(g.x, g.z, g.top);
        g.r = g.r || GATE_R;
      }
    }
  }

  buildMarkers() {
    this.markers = [];
    const ringGeo = new THREE.RingGeometry(1.6, 2.1, 48).rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(1.6, 1.6, 30, 32, 1, true);
    for (const c of this.list) {
      const color = new THREE.Color(ZONES[c.zone].color);
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      ring.position.y = 0.06;
      const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: color }, uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'varying vec2 vUv; uniform vec3 uColor; uniform float uTime; void main(){ float a = pow(1.0 - vUv.y, 2.2) * 0.55 * (0.8 + 0.2*sin(uTime*3.0 + vUv.y*20.0)); gl_FragColor = vec4(uColor * a, a); }',
      }));
      beam.position.y = 15;
      const best = this.best[c.id];
      const sub = c.type === 'score' ? `${c.diff} · ${c.duration}s${best ? ' · best ' + best.toLocaleString() : ''}` : `${c.diff}${best ? ' · best ' + formatTime(best) : ''}`;
      const lab = label(c.name, sub, ZONES[c.zone].color);
      lab.position.y = 3.4;
      grp.add(ring, beam, lab);
      grp.position.set(c.start.x, c.start.y, c.start.z);
      this.group.add(grp);
      this.markers.push({ course: c, grp, beam, lab });
    }
  }

  refreshLabel(c) {
    const m = this.markers.find((x) => x.course === c);
    if (!m) return;
    m.grp.remove(m.lab);
    const best = this.best[c.id];
    const sub = c.type === 'score' ? `${c.diff} · ${c.duration}s${best ? ' · best ' + best.toLocaleString() : ''}` : `${c.diff}${best ? ' · best ' + formatTime(best) : ''}`;
    m.lab = label(c.name, sub, ZONES[c.zone].color);
    m.lab.position.y = 3.4;
    m.grp.add(m.lab);
  }

  buildSprockets() {
    // golden sprocket: toothed ring
    const shape = new THREE.Shape();
    const teeth = 18, ro = 0.42, ri = 0.36;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 ? ri : ro;
      const a2 = a + Math.PI / (teeth * 2);
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      shape.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
    }
    const hole = new THREE.Path(); hole.absarc(0, 0, 0.2, 0, Math.PI * 2, true); shape.holes.push(hole);
    for (let k = 0; k < 5; k++) {
      const h = new THREE.Path(); const a = (k / 5) * Math.PI * 2;
      h.absarc(Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0.045, 0, Math.PI * 2, true); shape.holes.push(h);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
    geo.center();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffc533, metalness: 1, roughness: 0.18, emissive: 0x6a4300, emissiveIntensity: 0.6 });
    const glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,220,120,0.9)'); gr.addColorStop(1, 'rgba(255,180,40,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    this.sprocketMeshes = [];
    for (const s of this.sprockets) {
      if (s.y == null) s.y = this.groundTop(s.x, s.z, true) + 1.25;
      if (this.found.has(s.id)) continue;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x, s.y, s.z);
      m.castShadow = true;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.scale.setScalar(2.2);
      m.add(glow);
      this.group.add(m);
      this.sprocketMeshes.push({ s, m });
    }
  }

  // ---- gates ----
  makeGate(g, idx, color) {
    const grp = new THREE.Group();
    const w = g.r * 2, h = g.r * 1.25;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.5, metalness: 0.4 });
    const bannerMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, h, 10), postMat);
      post.position.set(s * w / 2, h / 2, 0);
      post.castShadow = true;
      grp.add(post);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.55, 0.12), bannerMat);
    banner.position.y = h;
    grp.add(banner);
    if (g.y != null) {
      // air gate: glowing ring instead of posts
      grp.clear();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(g.r, 0.16, 12, 64), bannerMat);
      ring.position.y = 0;
      grp.add(ring);
    }
    const flagTex = label(g.finish ? 'Finish' : `Gate ${idx + 1}`, '', '#' + color.getHexString());
    flagTex.scale.set(2.6, 0.81, 1);
    flagTex.position.y = (g.y != null ? g.r : h) + 0.9;
    grp.add(flagTex);
    grp.position.set(g.x, g.base, g.z);
    grp.userData.bannerMat = bannerMat;
    return grp;
  }

  nearbyStart(player) {
    if (this.run) return null;
    for (const m of this.markers) {
      const s = m.course.start;
      if (Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < 3.2 && Math.abs(player.pos.y - s.y) < 3) return m.course;
    }
    return null;
  }

  start(course, opts = {}) {
    this.cancel(true);
    const g = this.game;
    const p = g.player;
    p.spawn(course.start.x, course.start.z, course.start.yaw, !!course.start.top);
    g.cam.snap(p);
    p.frozen = true;
    const color = new THREE.Color(ZONES[course.zone].color);
    const run = this.run = {
      course, opts, idx: 0, time: 0, state: 'countdown', countdown: opts.countdownFrom ?? 3,
      gates: [], startScore: g.tricks.total, rec: [], recT: 0, splits: [],
    };
    if (course.type === 'gates') {
      course.gates.forEach((gt, i) => {
        // orient towards the next gate
        const nx = course.gates[i + 1] || null;
        const prev = i === 0 ? course.start : course.gates[i - 1];
        const mesh = this.makeGate(gt, i, color);
        mesh.lookAt(new THREE.Vector3(prev.x, mesh.position.y, prev.z));
        this.group.add(mesh);
        run.gates.push(mesh);
      });
    }
    // ghost of personal best
    const gd = store('ghost.' + course.id);
    if (gd && course.type === 'gates' && !opts.race) this.spawnGhost(gd);
    if (opts.startAt) run.startAt = opts.startAt;
    g.ui.courseStart(course);
    this.updateGateVisibility();
  }

  spawnGhost(data) {
    this.removeGhost();
    const gh = new RiderBike({ frame: '#7fd7ff', helmet: '#bfe9ff', shirt: '#7fd7ff', pants: '#5aa0c0' });
    gh.root.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false;
      }
      o.castShadow = false;
    });
    gh.setNameTag('Ghost · PB', '#bfe9ff');
    this.game.scene.add(gh.root);
    this.ghost = { model: gh, data, i: 0 };
  }

  removeGhost() {
    if (this.ghost) { this.game.scene.remove(this.ghost.model.root); this.ghost = null; }
  }

  updateGateVisibility() {
    const r = this.run;
    if (!r) return;
    r.gates.forEach((m, i) => {
      m.visible = i >= r.idx && i <= r.idx + 2;
      m.userData.bannerMat.emissiveIntensity = i === r.idx ? 2.2 : 0.4;
      m.scale.setScalar(i === r.idx ? 1 : 0.85);
    });
  }

  cancel(silent = false) {
    if (!this.run) return;
    for (const m of this.run.gates) this.group.remove(m);
    const was = this.run;
    this.run = null;
    this.game.player.frozen = false;
    this.removeGhost();
    if (!silent) { this.game.ui.courseEnd(null); this.game.audio.play('fail'); }
    return was;
  }

  nextGate() {
    const r = this.run;
    if (!r || r.course.type !== 'gates') return null;
    return r.course.gates[r.idx];
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const t = performance.now() / 1000;
    for (const m of this.markers) { m.beam.material.uniforms.uTime.value = t; m.grp.visible = !this.run; }
    for (const { m } of this.sprocketMeshes) { m.rotation.y += dt * 1.6; m.position.y += Math.sin(t * 2 + m.position.x) * 0.002; }
    // sprocket pickups
    for (let i = this.sprocketMeshes.length - 1; i >= 0; i--) {
      const { s, m } = this.sprocketMeshes[i];
      const dx = p.pos.x - s.x, dy = p.pos.y + 0.9 - s.y, dz = p.pos.z - s.z;
      if (dx * dx + dy * dy + dz * dz < 2.2 * 2.2 && p.mode !== 'bail') {
        this.group.remove(m);
        this.sprocketMeshes.splice(i, 1);
        this.found.add(s.id);
        store('sprockets', [...this.found]);
        g.audio.play('pickup');
        g.ui.toast(`Golden Sprocket ${this.found.size}/${this.sprockets.length}`, 'gold');
        g.tricks.addTrick('Sprocket', 250, false);
        this.checkChallenges({ type: 'sprocket' });
      }
    }
    const r = this.run;
    if (!r) return;
    if (r.state === 'countdown') {
      p.frozen = true;
      if (r.startAt) {
        const left = (r.startAt - g.net.now()) / 1000;
        const n = Math.ceil(left);
        if (n !== r.lastN && n <= 3 && n > 0) { g.audio.play('countdown'); g.ui.bigText(String(n)); }
        r.lastN = n;
        if (left <= 0) this.go();
      } else {
        const before = Math.ceil(r.countdown);
        r.countdown -= dt;
        const after = Math.ceil(r.countdown);
        if (before !== after || r.first === undefined) {
          r.first = true;
          if (after > 0) { g.audio.play('countdown'); g.ui.bigText(String(after)); }
        }
        if (r.countdown <= 0) this.go();
      }
      return;
    }
    if (r.state !== 'running') return;
    r.time += dt;
    // record ghost frames @ 15Hz
    r.recT += dt;
    if (r.recT >= 1 / 15) { r.recT = 0; r.rec.push([+r.time.toFixed(3), ...p.snapshot().slice(0, 20)]); }
    this.playGhost(r.time);
    if (r.course.type === 'score') {
      if (r.time >= r.course.duration) this.finish();
      return;
    }
    const gt = r.course.gates[r.idx];
    const cy = gt.base + (gt.y != null ? 0 : gt.r * 0.6);
    const dx = p.pos.x - gt.x, dz = p.pos.z - gt.z, dy = p.pos.y + 0.8 - cy;
    const inside = gt.y != null ? Math.hypot(dx, dy, dz) < gt.r + 0.6 : (Math.hypot(dx, dz) < gt.r + 0.4 && dy > -2.5 && dy < gt.r * 1.6);
    if (inside) {
      r.splits.push(r.time);
      r.idx++;
      g.audio.play('gate');
      // respawn at the last gate after a bail
      p.lastSafe.pos.set(gt.x, gt.base, gt.z);
      const nx = r.course.gates[r.idx];
      if (nx) p.lastSafe.heading = Math.atan2(nx.x - gt.x, nx.z - gt.z);
      if (gt.y != null) p.lastSafe.pos.set(p.pos.x, p.pos.y, p.pos.z);
      if (r.idx >= r.course.gates.length) this.finish();
      else this.updateGateVisibility();
    }
  }

  go() {
    const r = this.run;
    r.state = 'running';
    this.game.player.frozen = false;
    this.game.audio.play('go');
    this.game.ui.bigText('GO!');
    r.startScore = this.game.tricks.total;
  }

  playGhost(time) {
    const gh = this.ghost;
    if (!gh) return;
    const d = gh.data;
    while (gh.i < d.length - 2 && d[gh.i + 1][0] < time) gh.i++;
    const a = d[gh.i], b = d[Math.min(d.length - 1, gh.i + 1)];
    const t = b[0] > a[0] ? Math.min(1, (time - a[0]) / (b[0] - a[0])) : 0;
    applySnapshot(gh.model, a.slice(1), b.slice(1), t);
    gh.model.root.visible = time < d[d.length - 1][0] + 1;
  }

  finish() {
    const g = this.game;
    const r = this.run;
    const c = r.course;
    let result, medal = 0, isBest = false;
    if (c.type === 'score') {
      g.tricks.bank();
      result = g.tricks.total - r.startScore;
      medal = c.par.filter((p) => result >= p).length;
      isBest = !this.best[c.id] || result > this.best[c.id];
    } else {
      result = r.time;
      medal = c.par.filter((p) => result <= p).length;
      isBest = !this.best[c.id] || result < this.best[c.id];
      if (isBest) store('ghost.' + c.id, r.rec);
    }
    if (isBest) { this.best[c.id] = result; store('best', this.best); }
    this.medals[c.id] = Math.max(this.medals[c.id] || 0, medal);
    store('medals', this.medals);
    for (const m of r.gates) this.group.remove(m);
    this.run = null;
    this.removeGhost();
    g.player.frozen = false;
    g.audio.play(isBest ? 'record' : 'finish');
    if (medal > 0) setTimeout(() => g.audio.play('finish'), 400);
    this.refreshLabel(c);
    g.ui.courseEnd({ course: c, result, medal, isBest, race: r.opts.race });
    if (r.opts.race) g.net.sendFinish(c.id, result);
    this.checkChallenges({ type: 'courseDone', medal, course: c });
  }

  checkChallenges(ev) {
    const g = this.game;
    for (const ch of CHALLENGES) {
      if (this.done.has(ch.id)) continue;
      let ok = false;
      try { ok = ch.test(ev, g.tricks.stats, g); } catch (e) { ok = false; }
      if (ok) {
        this.done.add(ch.id);
        store('challenges', [...this.done]);
        g.ui.toast(`Challenge complete: ${ch.name}`, 'challenge');
        g.audio.play('record');
      }
    }
  }
}

// Apply a (possibly interpolated) network/ghost snapshot to a RiderBike
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
export function applySnapshot(model, a, b, t) {
  const L = (i) => a[i] + (b[i] - a[i]) * t;
  model.root.position.set(L(0), L(1), L(2));
  qa.set(a[3], a[4], a[5], a[6]); qb.set(b[3], b[4], b[5], b[6]);
  model.root.quaternion.slerpQuaternions(qa, qb, t);
  const w = L(7);
  const wq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -w);
  const rearC = new THREE.Vector3(0, 0, -0.49);
  const wo = rearC.clone().sub(rearC.clone().applyQuaternion(wq));
  model.bike.position.copy(wo); model.bike.quaternion.copy(wq);
  model.rider.position.copy(wo); model.rider.quaternion.copy(wq);
  const P = model.pose;
  P.steer = L(8); P.barspin = Math.abs(b[9] - a[9]) > 3 ? b[9] : L(9); P.whip = Math.abs(b[10] - a[10]) > 3 ? b[10] : L(10);
  P.crouch = L(11); P.shift = L(12); P.superman = L(13); P.nohander = L(14); P.cancan = L(15); P.nofooter = L(16); P.tuck = L(17);
  P.crank = a[18]; P.wheel = a[19];
  model.updatePose();
}

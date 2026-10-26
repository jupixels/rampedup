// Verlet ragdoll for bails: a floppy rider (15 particles) and a rigid-ish bike
// (12 particles), each colliding with the terrain and every prop surface.
import * as THREE from 'three';
import { BIKE } from './bikeModel.js';

const G = 11;
const SUB = 1 / 120;
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
const ground = { h: 0, n: new THREE.Vector3(), surface: '', prop: false, water: false };

class Body {
  constructor() { this.p = []; this.c = []; }
  add(pos, vel, r, dt, mass = 1) {
    const prev = pos.clone().addScaledVector(vel, -dt);
    this.p.push({ x: pos.clone(), o: prev, r, m: mass, f: new THREE.Vector3(), hit: 0 });
    return this.p.length - 1;
  }
  link(a, b, stiff = 1) {
    this.c.push({ a, b, d: this.p[a].x.distanceTo(this.p[b].x), k: stiff });
  }
}

export class Ragdoll {
  constructor(collision) {
    this.col = collision;
    this.active = false;
  }

  // model: RiderBike (pose already applied), vel: rider velocity at the moment of the bail
  start(model, vel, opts = {}) {
    this.model = model;
    this.t = 0;
    this.impacts = [];
    this.splash = !!opts.splash;
    model.root.updateMatrixWorld(true);
    const rm = model.rider.matrixWorld, J = model.joints;
    const w = (v) => v.clone().applyMatrix4(rm);
    // random tumble: angular velocity around a mostly horizontal axis, scaled by speed
    const sp = vel.length();
    const spin = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 2).normalize().multiplyScalar(2 + Math.min(sp, 14) * 0.45);
    const centre = w(J.pelvis);
    const launch = vel.clone().multiplyScalar(0.92).add(new THREE.Vector3(0, 1.6 + Math.random() * 1.6, 0));
    const pv = (pos) => launch.clone().add(tmp.copy(spin).cross(tmp2.copy(pos).sub(centre)));

    // ---- rider ----
    const R = this.rider = new Body();
    const add = (name, pos, r, m) => { const x = w(pos); R[name] = R.add(x, pv(x), r, SUB, m); };
    add('head', J.head, 0.14, 1.2); add('chest', J.chest, 0.15, 2); add('pelvis', J.pelvis, 0.14, 2);
    add('ls', J.shoulder[0], 0.07, 1); add('rs', J.shoulder[1], 0.07, 1);
    add('le', J.elbow[0], 0.05, 0.6); add('re', J.elbow[1], 0.05, 0.6);
    add('lh', J.hand[0], 0.05, 0.5); add('rh', J.hand[1], 0.05, 0.5);
    add('lp', J.hip[0], 0.09, 1.2); add('rp', J.hip[1], 0.09, 1.2);
    add('lk', J.knee[0], 0.07, 1); add('rk', J.knee[1], 0.07, 1);
    add('lf', J.foot[0], 0.06, 0.8); add('rf', J.foot[1], 0.06, 0.8);
    const core = ['chest', 'pelvis', 'ls', 'rs', 'lp', 'rp'];
    for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) R.link(R[core[i]], R[core[j]]);
    // wobbly head
    R.link(R.head, R.chest, 0.6); R.link(R.head, R.ls, 0.35); R.link(R.head, R.rs, 0.35);
    // limbs
    R.link(R.ls, R.le); R.link(R.le, R.lh); R.link(R.rs, R.re); R.link(R.re, R.rh);
    R.link(R.lp, R.lk); R.link(R.lk, R.lf); R.link(R.rp, R.rk); R.link(R.rk, R.rf);
    // loose limits so limbs don't fold completely inside out
    R.link(R.ls, R.lh, 0.05); R.link(R.rs, R.rh, 0.05); R.link(R.lp, R.lf, 0.05); R.link(R.rp, R.rf, 0.05);
    this.flail = Array.from({ length: 4 }, () => ({ ph: Math.random() * 6.28, ax: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize() }));

    // ---- bike: rigid cloud of points ----
    model.bike.updateMatrixWorld(true);
    const bm = model.bike.matrixWorld;
    const B = this.bike = new Body();
    const bspin = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
    const bc = new THREE.Vector3(0, 0.4, 0).applyMatrix4(bm);
    const bv = vel.clone().multiplyScalar(0.75).add(new THREE.Vector3(0, 1.2, 0));
    const badd = (lx, ly, lz, r) => {
      const x = new THREE.Vector3(lx, ly, lz).applyMatrix4(bm);
      return B.add(x, bv.clone().add(tmp.copy(bspin).cross(tmp2.copy(x).sub(bc))), r, SUB, 1);
    };
    const WR = BIKE.WR, rz = BIKE.REAR.z, fz = BIKE.FRONT.z;
    B.rear = badd(0, WR, rz, 0.04); B.front = badd(0, WR, fz, 0.04); B.seat = badd(0, 0.7, -0.19, 0.06);
    for (const z of [rz, fz]) { badd(0, 0.02, z, 0.03); badd(0, 2 * WR - 0.02, z, 0.03); badd(0, WR, z - WR + 0.02, 0.03); badd(0, WR, z + WR - 0.02, 0.03); }
    badd(0.37, 0.95, 0.26, 0.03); badd(-0.37, 0.95, 0.26, 0.03); // bar ends
    badd(0.16, 0.12, -0.07, 0.03); badd(-0.16, 0.46, -0.07, 0.03); // pedals
    for (let i = 0; i < B.p.length; i++) for (let j = i + 1; j < B.p.length; j++) B.link(i, j);

    // detach the visual parts into world space (root becomes identity)
    model.root.position.set(0, 0, 0); model.root.quaternion.identity();
    model.rider.position.set(0, 0, 0); model.rider.quaternion.identity();
    this.active = true;
    this.acc = 0;
  }

  // Simulate; returns the strongest impact speed this frame (for sound/shake)
  update(dt) {
    let impact = 0;
    this.acc += dt;
    while (this.acc >= SUB) {
      this.acc -= SUB;
      this.t += SUB;
      impact = Math.max(impact, this.step(this.rider, true), this.step(this.bike, false));
    }
    this.apply();
    return impact;
  }

  step(body, isRider) {
    const P = body.p;
    let impact = 0;
    // flailing arms and legs for the first moments of the crash
    if (isRider && this.t < 1.1) {
      const k = (1.1 - this.t) * 55;
      [body.lh, body.rh, body.lf, body.rf].forEach((idx, i) => {
        const fl = this.flail[i];
        P[idx].f.copy(fl.ax).multiplyScalar(Math.sin(this.t * 22 + fl.ph) * k);
        if (i < 2) P[idx].f.y += Math.cos(this.t * 17 + fl.ph) * k * 0.6;
      });
    }
    for (const q of P) {
      const vx = (q.x.x - q.o.x) * 0.999, vy = (q.x.y - q.o.y) * 0.999, vz = (q.x.z - q.o.z) * 0.999;
      q.o.copy(q.x);
      let ay = -G;
      if (this.splash && q.x.y < this.col.waterLevel) ay += 24; // buoyancy
      q.x.x += vx + q.f.x * SUB * SUB; q.x.y += vy + (ay + q.f.y) * SUB * SUB; q.x.z += vz + q.f.z * SUB * SUB;
      if (this.splash && q.x.y < this.col.waterLevel) { q.o.lerp(q.x, 0.06); }
      q.f.set(0, 0, 0);
    }
    for (let it = 0; it < 6; it++) {
      for (const c of body.c) {
        const a = P[c.a], b = P[c.b];
        tmp.subVectors(b.x, a.x);
        const len = tmp.length() || 1e-6;
        const diff = ((len - c.d) / len) * c.k;
        const wa = 1 / a.m, wb = 1 / b.m, ws = wa + wb;
        a.x.addScaledVector(tmp, (diff * wa) / ws);
        b.x.addScaledVector(tmp, (-diff * wb) / ws);
      }
      if (it % 2 === 1 || it === 5) for (const q of P) impact = Math.max(impact, this.collide(q));
    }
    return impact;
  }

  collide(q) {
    const col = this.col;
    // walls: if this point moved inside a solid, put it back where it came from horizontally
    const wall = col.obstacle(q.x.x, q.x.z, q.x.y + q.r + 0.3, q.x.y + 60);
    if (wall !== null) {
      const vx = q.x.x - q.o.x, vz = q.x.z - q.o.z;
      q.x.x = q.o.x; q.x.z = q.o.z;
      q.o.x = q.x.x + vx * 0.4; q.o.z = q.x.z + vz * 0.4; // bounce back
    }
    col.ground(q.x.x, q.x.z, q.x.y + q.r + 0.4, ground);
    const pen = ground.h + q.r - q.x.y;
    if (pen <= 0) return 0;
    const n = ground.n;
    // velocity before correction
    const v = tmp2.subVectors(q.x, q.o);
    const vn = v.dot(n);
    q.x.addScaledVector(n, pen * Math.max(n.y, 0.3) / Math.max(n.y, 0.3));
    if (q.x.y < ground.h + q.r - 0.001) q.x.y = ground.h + q.r;
    // bounce + friction
    const vt = tmp3.copy(v).addScaledVector(n, -vn);
    vt.multiplyScalar(0.82);
    const newV = vt.addScaledVector(n, vn < 0 ? -vn * 0.32 : vn);
    q.o.copy(q.x).sub(newV);
    return vn < 0 ? -vn / SUB : 0;
  }

  // Place rider limbs and the bike from the particles
  apply() {
    const m = this.model, R = this.rider, P = R.p, parts = m.parts;
    const X = (i) => P[i].x;
    const place = (mesh, a, b) => {
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      const d = tmp.subVectors(b, a);
      if (d.lengthSq() > 1e-10) mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    };
    // torso basis: up = pelvis->chest, right = across the shoulders
    const pel = X(R.pelvis), ch = X(R.chest);
    const yv = tmp.subVectors(ch, pel).normalize();
    const xv = tmp2.subVectors(X(R.rs), X(R.ls));
    xv.addScaledVector(yv, -xv.dot(yv)).normalize();
    const zv = tmp3.crossVectors(xv, yv).normalize();
    const basis = new THREE.Matrix4().makeBasis(xv, yv, zv);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    if (!isFinite(q.x)) return;
    const tLen = pel.distanceTo(ch);
    parts.torso.position.copy(pel).addScaledVector(yv, -0.04);
    parts.torso.quaternion.copy(q);
    parts.torso.scale.y = (tLen + 0.06) / 0.48;
    place(parts.hips, X(R.rp), X(R.lp));
    parts.hips.position.copy(pel).addScaledVector(yv, -0.03);
    place(parts.neck, ch, X(R.head));
    parts.head.position.copy(X(R.head));
    // head looks along the torso's forward with a bit of wobble
    const hq = new THREE.Quaternion().setFromUnitVectors(yv, tmp.subVectors(X(R.head), ch).normalize());
    parts.head.quaternion.copy(hq.multiply(q));
    const L = [[R.ls, R.le, R.lh, R.lp, R.lk, R.lf], [R.rs, R.re, R.rh, R.rp, R.rk, R.rf]];
    // parts arrays: index 0 is the rider's right side in the pose code (side -1)
    for (let i = 0; i < 2; i++) {
      const [s, e, h, hp, k, f] = L[i];
      place(parts.uArm[i], X(s), X(e));
      place(parts.fArm[i], X(e), X(h));
      parts.hand[i].position.copy(X(h));
      place(parts.thigh[i], X(hp), X(k));
      place(parts.shin[i], X(k), X(f));
      parts.kneePad[i].position.copy(X(k));
      parts.foot[i].position.copy(X(f));
      parts.foot[i].quaternion.copy(q);
    }
    // bike orientation from rear axle, front axle and seat
    const B = this.bike, bp = B.p;
    const A = bp[B.rear].x, F = bp[B.front].x, S = bp[B.seat].x;
    const bz = tmp.subVectors(F, A).normalize();
    const u = tmp2.subVectors(S, A);
    const bx = new THREE.Vector3().crossVectors(u, bz).normalize();
    const by = new THREE.Vector3().crossVectors(bz, bx);
    const bq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, by, bz));
    if (!isFinite(bq.x)) return;
    m.bike.quaternion.copy(bq);
    m.bike.position.copy(A).sub(BIKE.REAR.clone().applyQuaternion(bq));
  }

  centre() { return this.rider.p[this.rider.pelvis].x; }
}

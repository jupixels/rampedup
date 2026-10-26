// Rider controller: arcade BMX physics on arbitrary ramps, airs, flips, spins,
// grinds, manuals, bunny hops and bails.
import * as THREE from 'three';
import { RiderBike, BIKE } from './bikeModel.js';
import { makeGroundResult } from './collision.js';
import { Ragdoll } from './ragdoll.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, angleDiff, TAU } from './util.js';

export const G = 11;
const SUB = 1 / 240;
const PEDAL_MAX = 12.5;
const STEP_UP = 0.14;

export const TRICK_ANIMS = {
  barspin:  { dur: 0.4,  label: 'Barspin' },
  tailwhip: { dur: 0.58, label: 'Tailwhip' },
  superman: { dur: 0.66, label: 'Superman', hold: true },
  nohander: { dur: 0.58, label: 'No Hander', hold: true },
  cancan:   { dur: 0.54, label: 'Can Can', hold: true },
  tabletop: { dur: 0.6,  label: 'Table Top', hold: true },
  nofooter: { dur: 0.54, label: 'No Footer', hold: true },
};

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function envelope(t, dur, hold) {
  // 0 -> 1 -> 0 with a plateau; hold freezes the plateau
  const a = 0.28, b = 0.72;
  const u = t / dur;
  if (u < a) return u / a;
  if (u < b || hold) return 1;
  return Math.max(0, 1 - (u - b) / (1 - b));
}

export class Player {
  constructor(game, colors) {
    this.game = game;
    this.col = game.world.collision;
    this.model = new RiderBike(colors);
    game.scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.mode = 'ground';
    this.normal = new THREE.Vector3(0, 1, 0);
    this.visNormal = new THREE.Vector3(0, 1, 0);
    this.visQuat = new THREE.Quaternion();
    this.ground = makeGroundResult();
    this.g2 = makeGroundResult();
    this.preload = 0;
    this.sinceAir = 0;
    this.air = null;     // air state
    this.grind = null;
    this.manual = null;
    this.bail = null;
    this.anim = null;
    this.animQueue = [];
    this.crouch = 0;
    this.landSquash = 0;
    this.crank = 0;
    this.wheel = 0;
    this.steerVis = 0;
    this.lean = 0;
    this.visHeading = 0;
    this.speed = 0;
    this.lastSafe = { pos: new THREE.Vector3(), heading: 0 };
    this.safeTimer = 0;
    this.leftRail = { rail: null, t: 0 };
    this.frozen = false;
    this.events = []; // for audio/fx
    this.netAnim = { type: 0, t: 0 };
  }

  spawn(x, z, heading, onTop = false) {
    const g = this.col.ground(x, z, onTop ? 500 : this.col.terrain.sample(x, z) + 3, this.ground);
    this.pos.set(x, g.h, z);
    this.vel.set(0, 0, 0);
    this.heading = this.visHeading = heading;
    this.mode = 'ground';
    this.normal.copy(g.n); this.visNormal.copy(g.n);
    this.air = this.grind = this.manual = this.bail = this.anim = null;
    this.animQueue.length = 0;
    this.model.rider.position.set(0, 0, 0); this.model.rider.rotation.set(0, 0, 0);
    this.model.bike.position.set(0, 0, 0); this.model.bike.rotation.set(0, 0, 0);
    this.lastSafe.pos.copy(this.pos); this.lastSafe.heading = heading;
    Object.assign(this.model.pose, { barspin: 0, whip: 0, superman: 0, nohander: 0, cancan: 0, nofooter: 0, tuck: 0 });
    this.tableRoll = 0;
    this.updateVisual(1);
  }

  forward(out = tmpV) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  update(dt, input) {
    if (this.frozen) { this.updateVisual(dt); return; }
    if (this.mode === 'bail') { this.updateBail(dt, input); return; }
    // hop preload
    if (input.hop && this.mode !== 'air') this.preload = Math.min(1, this.preload + dt / 0.28);
    const released = input.hopReleased;
    // trick input (air only)
    if (this.mode === 'air') this.handleTrickInput(input);
    const steps = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (this.mode === 'ground') this.stepGround(h, input, i === 0 && released);
      else if (this.mode === 'air') this.stepAir(h, input, i === 0 && released);
      else if (this.mode === 'grind') this.stepGrind(h, input, i === 0 && input.hopPressed);
      if (this.mode === 'bail') break;
    }
    if (released) this.preload = 0;
    if (this.mode !== 'bail') this.updateAnim(dt, input);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // safety: out of bounds / water
    if (this.pos.y < this.col.waterLevel - 0.6 && this.mode !== 'bail') this.doBail('splash');
    if (Math.abs(this.pos.x) > 790 || Math.abs(this.pos.z) > 790) {
      this.pos.x = clamp(this.pos.x, -790, 790); this.pos.z = clamp(this.pos.z, -790, 790);
      this.vel.x *= -0.3; this.vel.z *= -0.3;
    }
    // safe point
    this.safeTimer += dt;
    if (this.mode === 'ground' && !this.manual && this.safeTimer > 0.6 && this.normal.y > 0.9 && this.speed > 0.3) {
      this.safeTimer = 0;
      this.lastSafe.pos.copy(this.pos); this.lastSafe.heading = this.heading;
    }
    this.updateVisual(dt, input);
  }

  // ---------------- ground ----------------
  stepGround(dt, input, hopRelease) {
    const n = this.normal;
    const f = this.forward(tmpV);
    f.addScaledVector(n, -f.dot(n));
    if (f.lengthSq() < 1e-6) f.set(0, 1, 0).addScaledVector(n, -n.y);
    f.normalize();
    const lat = tmpV2.crossVectors(n, f).normalize();
    let vf = this.vel.dot(f), vl = this.vel.dot(lat);
    const surf = this.ground.surface;
    const roll = { concrete: 0.12, wood: 0.12, metal: 0.12, asphalt: 0.16, dirt: 0.32, rock: 0.3, sand: 1.4, grass: 0.55 }[surf] ?? 0.3;
    // propulsion / braking
    const pedal = input.pedal * (this.manual ? 0.4 : 1);
    if (pedal > 0 && vf < PEDAL_MAX) {
      const a = (vf < 3 ? 6.5 : 5.4) * (1 - Math.max(0, vf) / PEDAL_MAX);
      vf += pedal * a * dt;
      this.pedaling = true;
    } else this.pedaling = false;
    if (input.brake > 0) {
      const b = 8 * input.brake * dt;
      vf = Math.abs(vf) < b ? 0 : vf - Math.sign(vf) * b;
    }
    this.skidding = (input.brake > 0.5 && Math.abs(vf) > 2.5) || Math.abs(vl) > 1.6;
    // gravity along the surface
    const gf = -G * f.y, gl = -G * lat.y;
    vf += gf * dt; vl += gl * dt;
    // resistance
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), (roll + 0.0034 * vf * vf) * dt);
    // grip
    vl *= Math.exp(-(surf === 'dirt' || surf === 'sand' ? 7 : 11) * dt);
    // steering
    const sp = Math.abs(vf);
    const maxYaw = Math.min(2.6, 8.5 / (sp + 0.6)) * (sp < 0.3 ? 0.5 : 1);
    const yawRate = input.steer * maxYaw * (this.manual ? 0.6 : 1) * (vf < -0.2 ? -1 : 1);
    this.heading += yawRate * dt;
    this.yawRate = yawRate;
    // revert when rolling backwards
    if (vf < -1.2 && !this.manual) {
      this.heading = wrapAngle(this.heading + Math.PI);
      vf = -vf;
      this.emit('revert');
      this.game.tricks.addTrick('Revert', 120);
      const f2 = this.forward(tmpV);
      f.copy(f2.addScaledVector(n, -f2.dot(n)).normalize());
      lat.crossVectors(n, f).normalize();
    }
    this.vel.copy(f).multiplyScalar(vf).addScaledVector(lat, vl);
    // bunny hop
    if (hopRelease && this.preload > 0.05) {
      const imp = 3.2 + this.preload * 1.7;
      this.vel.addScaledVector(n, imp);
      if (n.y > 0.6) this.vel.y += 0.3;
      this.goAir(true);
      this.emit('hop');
      this.preload = 0;
      if (this.manual) this.endManual(true);
      return;
    }
    this.integrateGround(dt);
    // manual
    this.updateManual(dt, input);
  }

  integrateGround(dt) {
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const ny = this.pos.y + this.vel.y * dt - 0.5 * G * dt * dt;
    const hstep = Math.hypot(this.vel.x, this.vel.z) * dt;
    const tol = STEP_UP + hstep * 3.7;
    // wall?
    const wall = this.col.obstacle(nx, nz, ny + tol, ny + 60);
    if (wall !== null) { this.hitWall(); return; }
    const g = this.col.ground(nx, nz, ny + tol, this.g2);
    const d = (ny - g.h) * g.n.y;
    const sharp = g.n.dot(this.normal) < 0.7;
    if (d > 0.05 || (sharp && this.vel.dot(g.n) > 0.3 * this.vel.length() && this.vel.length() > 1)) {
      // left the surface
      this.pos.set(nx, ny, nz);
      this.goAir(false);
      return;
    }
    if (sharp && this.vel.dot(g.n) < -0.75 * this.vel.length() && this.vel.length() > 4) {
      // slammed into a much steeper face
      this.hitWall();
      return;
    }
    this.pos.set(nx, ny, nz);
    this.pos.addScaledVector(g.n, -d);
    if (this.pos.y < g.h - 0.02 && g.n.y > 0.3) this.pos.y = g.h;
    // re-project velocity onto the new surface, preserving speed
    const sp = this.vel.length();
    this.vel.addScaledVector(g.n, -this.vel.dot(g.n));
    const l = this.vel.length();
    if (l > 1e-5) this.vel.multiplyScalar(sp / l);
    this.normal.copy(g.n);
    const tmpg = this.ground; this.ground = g; this.g2 = tmpg;
    if (g.water) this.doBail('splash');
  }

  hitWall() {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 7.5 && !this.manual) { this.doBail('wall'); return; }
    this.vel.x *= -0.25; this.vel.z *= -0.25;
    this.emit('bump', { strength: sp });
  }

  goAir(hopped) {
    const vert = this.normal.y < 0.55 && this.vel.y > 1.5;
    const sp = this.vel.length();
    this.mode = 'air';
    this.sinceAir = 0;
    this.air = {
      t: 0, startY: this.pos.y, maxY: this.pos.y, spin: 0, flip: 0, flipVel: 0, spinVel: 0,
      vert, hopped, tricks: [], launchNormal: this.normal.clone(), trajPitch: 0,
      targetHeading: null, popWindow: hopped ? 0 : 0.2, fromGrind: false,
    };
    if (vert) {
      // keep the rider over the ramp: push horizontal velocity back toward the transition
      const nh = tmpV.set(this.normal.x, 0, this.normal.z);
      if (nh.lengthSq() > 1e-6) {
        nh.normalize();
        const along = this.vel.x * nh.x + this.vel.z * nh.z;
        const want = 0.55 + Math.min(1.2, sp * 0.03);
        this.vel.x += nh.x * (want - along); this.vel.z += nh.z * (want - along);
        this.air.targetHeading = Math.atan2(nh.x, nh.z);
      }
    }
    if (this.manual) this.endManual(false, true);
    this.game.tricks.airStart(this.air);
    this.emit('takeoff', { speed: sp });
  }

  // ---------------- air ----------------
  handleTrickInput(input) {
    const order = ['barspin', 'tailwhip', 'superman', 'nohander', 'cancan', 'tabletop', 'nofooter'];
    for (const k of order) {
      if (input.tricks[k]) {
        if (!this.anim) this.startAnim(k);
        else if (this.animQueue.length < 2) this.animQueue.push(k);
      }
    }
  }

  startAnim(type) {
    this.anim = { type, t: 0, dur: TRICK_ANIMS[type].dur, holdTime: 0 };
    this.emit('trickStart', { type });
  }

  updateAnim(dt, input) {
    const P = this.model.pose;
    const a = this.anim;
    P.barspin = 0; P.whip = 0;
    let sup = 0, nh = 0, cc = 0, nf = 0;
    this.tableRoll = damp(this.tableRoll || 0, 0, 10, dt);
    if (a) {
      const def = TRICK_ANIMS[a.type];
      const holding = def.hold && input.trickHeld[a.type] && a.t / a.dur > 0.4 && this.mode === 'air';
      if (holding) a.holdTime += dt; else a.t += dt;
      const u = clamp(a.t / a.dur, 0, 1);
      const e = envelope(a.t, a.dur, holding);
      const ease = u * u * (3 - 2 * u);
      switch (a.type) {
        case 'barspin': P.barspin = ease * TAU; break;
        case 'tailwhip': P.whip = ease * TAU; nf = Math.sin(u * Math.PI) * 0.7; break;
        case 'superman': sup = e; break;
        case 'nohander': nh = e; break;
        case 'cancan': cc = e; break;
        case 'nofooter': nf = e; break;
        case 'tabletop': this.tableRoll = e * 1.15; break;
      }
      if (a.t >= a.dur) {
        if (this.air) this.air.tricks.push({ type: a.type, hold: a.holdTime });
        this.emit('trickDone', { type: a.type });
        this.anim = null;
        if (this.animQueue.length && this.mode === 'air') this.startAnim(this.animQueue.shift());
        else this.animQueue.length = 0;
      }
    }
    P.superman = damp(P.superman, sup, 18, dt);
    P.nohander = damp(P.nohander, nh, 18, dt);
    P.cancan = damp(P.cancan, cc, 18, dt);
    P.nofooter = damp(P.nofooter, nf, 18, dt);
    this.netAnim.type = a ? Object.keys(TRICK_ANIMS).indexOf(a.type) + 1 : 0;
    this.netAnim.t = a ? a.t / a.dur : 0;
  }

  animSafe() {
    const a = this.anim;
    if (!a) return true;
    const u = a.t / a.dur;
    if (a.type === 'barspin') return u > 0.82 || u < 0.08;
    if (a.type === 'tailwhip') return u > 0.86 || u < 0.06;
    // poses: fine to land once you're mostly back on the bike
    return a.t / a.dur > 0.55 && envelope(a.t, a.dur, false) < 0.75;
  }

  stepAir(dt, input, hopRelease) {
    const A = this.air;
    A.t += dt;
    // late pop off a lip
    if (hopRelease && A.t < A.popWindow && this.preload > 0.05) {
      this.vel.y += 1.5 + this.preload * 2.0;
      A.hopped = true;
      this.emit('hop');
    }
    this.vel.y -= G * dt;
    const sp2 = this.vel.lengthSq();
    this.vel.multiplyScalar(1 - Math.min(0.02, 0.0034 * Math.sqrt(sp2) * dt));
    // spin
    const spinIn = input.steer;
    const targetSpinVel = spinIn * 7.2;
    A.spinVel = damp(A.spinVel, targetSpinVel, spinIn ? 7 : 4, dt);
    if (!spinIn && A.targetHeading !== null) {
      // vert auto-turn back into the ramp
      const diff = angleDiff(A.targetHeading, this.heading);
      A.spinVel = damp(A.spinVel, clamp(diff * 4.2, -5.5, 5.5), 8, dt);
    } else if (!spinIn && A.t > 0.15) {
      // gentle assist: line up with the direction of travel
      const vh = Math.atan2(this.vel.x, this.vel.z);
      const dd = angleDiff(vh, this.heading);
      if (Math.hypot(this.vel.x, this.vel.z) > 2) {
        const sn = Math.round(dd / Math.PI) * Math.PI; // nearest forward/fakie
        const r = angleDiff(vh - sn, this.heading);
        if (Math.abs(r) < 0.9) A.spinVel = damp(A.spinVel, r * 3, 3, dt);
      }
    }
    this.heading += A.spinVel * dt;
    A.spin += A.spinVel * dt;
    // flips: W = front flip (+), S = back flip (-)
    const flipIn = input.flip;
    if (flipIn) A.flipVel = damp(A.flipVel, flipIn * 6.6, 5, dt);
    else {
      // settle towards the nearest upright orientation
      const res = wrapAngle(A.flip);
      A.flipVel = damp(A.flipVel, Math.abs(res) < 1.4 ? -res * 3.2 : A.flipVel, 3, dt);
    }
    A.flip += A.flipVel * dt;
    // integrate
    const nx = this.pos.x + this.vel.x * dt, ny = this.pos.y + this.vel.y * dt, nz = this.pos.z + this.vel.z * dt;
    // walls
    const wall = this.col.obstacle(nx, nz, ny + 0.45, ny + 60);
    if (wall !== null && wall > this.pos.y + 0.45) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 6.5) { this.doBail('wall'); return; }
      this.vel.x *= -0.25; this.vel.z *= -0.25;
      this.pos.y = ny;
      this.emit('bump', { strength: sp });
      return;
    }
    this.pos.set(nx, ny, nz);
    A.maxY = Math.max(A.maxY, ny);
    const g = this.col.ground(nx, nz, ny + 0.45, this.g2);
    if (ny <= g.h) { this.land(g); return; }
    // grind check
    if (A.t > 0.08) this.tryGrind();
  }

  land(g) {
    const A = this.air;
    const n = g.n;
    const vn = -this.vel.dot(n);
    const fails = [];
    const flipRes = wrapAngle(A.flip);
    if (Math.abs(flipRes) > 0.8) fails.push('flip');
    if (!this.animSafe()) fails.push('trick');
    const vt = tmpV.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
    const tsp = vt.length();
    let fakie = false;
    if (tsp > 1.6) {
      const vh = Math.atan2(vt.x, vt.z);
      const d = Math.abs(angleDiff(this.heading, vh));
      if (d > Math.PI - 0.95) fakie = true;
      else if (d > 0.95) fails.push('sideways');
    }
    if (vn > 16.5) fails.push('hard');
    if (g.water) fails.push('water');
    if (fails.length) {
      this.pos.y = g.h;
      this.doBail(fails[0], vn);
      return;
    }
    // clean landing. A "perfect" one (smooth onto a downslope, rolling straight) keeps a bit of extra speed
    this.pos.y = g.h;
    const perfect = A.t > 0.45 && vn < 3.2 && tsp > 4 && n.y < 0.985 && !fakie;
    const loss = perfect ? 1.06 : clamp(1 - Math.max(0, vn - 5) * 0.035, 0.6, 1);
    this.vel.copy(vt).multiplyScalar(loss);
    if (perfect) { this.game.tricks.addTrick('Perfect Landing', 150, false); this.emit('perfect'); }
    if (fakie) {
      this.heading = wrapAngle(this.heading + Math.PI);
    }
    if (tsp > 1.6) this.heading = Math.atan2(vt.x, vt.z);
    this.normal.copy(n);
    const tmpg = this.ground; this.ground = g; this.g2 = tmpg;
    this.mode = 'ground';
    this.landSquash = clamp(vn / 9, 0.15, 1);
    const flips = Math.round(A.flip / TAU);
    if (this.anim) A.tricks.push({ type: this.anim.type, hold: this.anim.holdTime }); // finished on touchdown
    this.game.tricks.land(A, { flips, fakie, airtime: A.t, height: A.maxY - Math.min(A.startY, this.pos.y), vn });
    this.emit('land', { vn, big: A.t > 0.9, airtime: A.t, pos: this.pos.clone(), surface: g.surface });
    this.anim = null; this.animQueue.length = 0;
    this.air = null;
    // land straight into a manual if held
    this.wantManualOnLand = true;
  }

  // ---------------- grinds ----------------
  tryGrind() {
    if (this.vel.y > 2) return;
    const rails = this.col.railsNear(this.pos.x, this.pos.z);
    const pegY = this.pos.y + 0.22;
    for (const r of rails) {
      if (r === this.leftRail.rail && this.air.t < 0.35) continue;
      const rel = tmpV2.copy(this.pos).sub(r.a);
      rel.y += 0.22;
      const t = clamp(rel.dot(r.dir), 0.05, r.len - 0.05);
      const cx = r.a.x + r.dir.x * t, cy = r.a.y + r.dir.y * t, cz = r.a.z + r.dir.z * t;
      const dxz = Math.hypot(this.pos.x - cx, this.pos.z - cz);
      const dy = pegY - cy;
      if (dxz > 0.5 || dy < -0.28 || dy > 0.4) continue;
      const vh = Math.hypot(this.vel.x, this.vel.z);
      const dirH = Math.hypot(r.dir.x, r.dir.z);
      const along = (this.vel.x * r.dir.x + this.vel.z * r.dir.z) / (dirH || 1);
      if (vh < 1 || Math.abs(along) / vh < 0.55) continue;
      const sign = along >= 0 ? 1 : -1;
      if (Math.abs(wrapAngle(A_heading(r, sign) - this.heading)) > 1.2 && Math.abs(wrapAngle(A_heading(r, sign) - this.heading - Math.PI)) > 1.2) continue;
      this.startGrind(r, t, sign, Math.max(2.2, Math.abs(this.vel.dot(r.dir))));
      return;
    }
  }

  startGrind(rail, t, sign, speed) {
    const A = this.air;
    // land the air tricks first (grinding counts as a landing for combo purposes)
    if (A) {
      if (Math.abs(wrapAngle(A.flip)) > 0.8 || !this.animSafe()) { this.doBail('grind'); return; }
      if (this.anim) A.tricks.push({ type: this.anim.type, hold: this.anim.holdTime });
      this.game.tricks.land(A, { flips: Math.round(A.flip / TAU), fakie: false, airtime: A.t, height: A.maxY - A.startY, vn: 0, intoGrind: true });
    }
    this.anim = null; this.animQueue.length = 0;
    const input = this.game.input.state;
    let style = 'Double Peg';
    if (rail.kind === 'ledge') style = input.flip > 0 ? 'Smith' : input.flip < 0 ? 'Feeble' : 'Double Peg';
    else if (input.flip > 0) style = 'Icepick';
    else if (input.flip < 0) style = 'Feeble';
    else if (input.steer) style = 'Smith';
    if (rail.kind === 'pipe') style = 'Pipe ' + style;
    this.grind = { rail, t, sign, speed, bal: 0, balVel: (Math.random() - 0.5) * 0.4, style, dist: 0, time: 0 };
    this.mode = 'grind';
    this.air = null;
    this.vel.set(0, 0, 0);
    this.heading = A_heading(rail, sign);
    this.game.tricks.grindStart(style);
    this.emit('grindStart');
  }

  stepGrind(dt, input, jump) {
    const g = this.grind;
    const r = g.rail;
    g.speed += -G * r.dir.y * g.sign * dt - 0.7 * dt;
    g.t += g.speed * g.sign * dt;
    g.dist += g.speed * dt;
    g.time += dt;
    // balance
    g.balVel += ((Math.random() - 0.5) * 3.2 + g.bal * (1.4 + g.time * 0.25)) * dt;
    g.balVel -= input.steer * 3.6 * dt;
    g.balVel *= Math.exp(-0.6 * dt);
    g.bal += g.balVel * dt;
    const dirv = tmpV.copy(r.dir).multiplyScalar(g.sign);
    this.pos.copy(r.a).addScaledVector(r.dir, g.t);
    this.pos.y -= 0.22;
    this.normal.set(0, 1, 0);
    this.game.tricks.grindTick(dt, g.speed * dt);
    const leave = (up) => {
      this.vel.copy(dirv).multiplyScalar(g.speed);
      this.vel.y += up;
      this.leftRail = { rail: r };
      this.grind = null;
      this.game.tricks.grindEnd();
      this.emit('grindEnd');
      this.goAir(up > 2);
      this.air.fromGrind = true;
    };
    if (jump) { leave(4.4 + this.preload * 1.2); this.emit('hop'); return; }
    if (g.t < 0 || g.t > r.len) { leave(0.6); return; }
    if (g.speed < 0.4) { leave(0.2); return; }
    if (Math.abs(g.bal) > 1) { this.doBail('balance'); }
  }

  // ---------------- manual ----------------
  updateManual(dt, input) {
    const want = input.manual && this.speed > 1.2;
    if (!this.manual && want && (this.wantManualOnLand || input.manualPressed)) {
      this.manual = { bal: 0.05 * (Math.random() - 0.5), balVel: 0, time: 0, nose: input.flip > 0.5 };
      this.game.tricks.manualStart(this.manual.nose ? 'Nose Manual' : 'Manual');
      this.emit('manualStart');
    }
    this.wantManualOnLand = false;
    const m = this.manual;
    if (!m) return;
    if (!input.manual) { this.endManual(true); return; }
    m.time += dt;
    m.balVel += ((Math.random() - 0.5) * 2.0 + m.bal * (1.15 + m.time * 0.15)) * dt;
    m.balVel += (m.nose ? 1 : -1) * input.flip * 3.8 * dt;
    m.balVel *= Math.exp(-0.5 * dt);
    m.bal += m.balVel * dt;
    this.game.tricks.manualTick(dt);
    if (Math.abs(m.bal) > 1) this.endManual(false);
  }

  endManual(clean, keepCombo = false) {
    if (!this.manual) return;
    this.manual = null;
    this.game.tricks.manualEnd(clean || keepCombo);
    if (!clean && !keepCombo) { this.vel.multiplyScalar(0.7); this.emit('manualFail'); }
  }

  // ---------------- bails ----------------
  doBail(reason, impact = 6) {
    if (this.mode === 'bail') return;
    this.mode = 'bail';
    this.grind = null; this.manual = null; this.air = null; this.anim = null; this.animQueue.length = 0;
    const sp = this.vel.length();
    const splash = reason === 'splash' || reason === 'water';
    this.ragdoll = this.ragdoll || new Ragdoll(this.col);
    this.ragdoll.start(this.model, this.vel, { splash });
    this.bail = { t: 0, reason, splash, riderPos: this.ragdoll.centre().clone(), lastThud: 0, peak: this.pos.y, dist: 0, start: this.pos.clone() };
    this.game.tricks.bail(reason);
    this.emit('bail', { reason, speed: sp, splash, impact, pos: this.pos.clone(), surface: this.ground.surface });
  }

  updateBail(dt, input) {
    const B = this.bail;
    B.t += dt;
    const hit = this.ragdoll.update(dt);
    B.riderPos.copy(this.ragdoll.centre());
    B.peak = Math.max(B.peak, B.riderPos.y);
    B.dist = Math.max(B.dist, Math.hypot(B.riderPos.x - B.start.x, B.riderPos.z - B.start.z));
    this.pos.copy(B.riderPos);
    if (hit > 3.5 && B.t - B.lastThud > 0.12) { B.lastThud = B.t; this.emit('thud', { strength: hit, pos: B.riderPos.clone() }); }
    const settled = B.t > 3.2;
    if (settled || (B.t > 0.7 && (input.resetPressed || input.hopPressed))) {
      this.ragdoll.active = false;
      this.respawnSafe();
    }
  }

  respawnSafe() {
    const s = this.lastSafe;
    const tumble = this.bail ? this.bail.dist : 0;
    this.spawn(s.pos.x, s.pos.z, s.heading);
    this.emit('respawn', { tumble });
  }

  // ---------------- visuals ----------------
  updateVisual(dt, input = { steer: 0, pedal: 0 }) {
    if (this.mode === 'bail') return;
    const m = this.model;
    const P = m.pose;
    // surface normal (smoothed) & orientation
    const targetN = this.mode === 'air' ? UP : this.normal;
    this.visNormal.lerp(targetN, 1 - Math.exp(-(this.mode === 'air' ? 4 : 22) * dt)).normalize();
    this.visHeading = dampAngle(this.visHeading, this.heading, this.mode === 'air' ? 40 : 18, dt);
    const n = this.visNormal;
    const f = tmpV.set(Math.sin(this.visHeading), 0, Math.cos(this.visHeading));
    f.addScaledVector(n, -f.dot(n));
    if (f.lengthSq() < 1e-6) f.set(0, 1, 0).addScaledVector(n, -n.y); // facing straight into a vertical wall
    f.normalize();
    const x = tmpV2.crossVectors(n, f).normalize();
    const basis = new THREE.Matrix4().makeBasis(x, n, f);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    // air pitch: follow trajectory + flips
    let pitch = 0;
    if (this.mode === 'air' && this.air) {
      const vh = Math.hypot(this.vel.x, this.vel.z);
      let traj = Math.atan2(this.vel.y, Math.max(vh, 0.1));
      if (this.air.vert) traj *= 0.25;
      const facing = Math.cos(angleDiff(Math.atan2(this.vel.x, this.vel.z), this.heading));
      this.air.trajPitch = damp(this.air.trajPitch, clamp(traj * 0.65 * facing, -0.75, 0.75), 3, dt);
      pitch = -(this.air.trajPitch) + this.air.flip;
      this.pitchVis = pitch;
    } else {
      this.pitchVis = damp(wrapAngle(this.pitchVis || 0), 0, 14, dt);
      pitch = this.pitchVis;
    }
    // manual wheelie
    let wheelie = 0;
    if (this.manual) wheelie = this.manual.nose ? -(0.32 + this.manual.bal * 0.18) : 0.36 + this.manual.bal * 0.2;
    this.wheelieVis = damp(this.wheelieVis || 0, wheelie, 12, dt);
    // lean into turns
    const targetLean = this.mode === 'ground' ? clamp(-(this.yawRate || 0) * this.speed / G, -0.6, 0.6) : 0;
    this.lean = damp(this.lean, targetLean, 8, dt);
    const grindLean = this.grind ? this.grind.bal * 0.35 : 0;
    q.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.lean + grindLean + (this.tableRoll || 0)));
    q.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
    m.root.quaternion.copy(q);
    // pivot flips around the bike's centre (~0.55m up) and wheelies around the rear contact
    const centre = new THREE.Vector3(0, 0.55, 0);
    const off = centre.clone().sub(centre.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
    m.root.position.copy(this.pos).add(off.applyQuaternion(tmpQ.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch))));
    if (this.grind) m.root.position.y += 0.0;
    // wheelie: rotate bike+rider about rear axle contact
    const wq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.wheelieVis);
    const rearC = new THREE.Vector3(0, 0, -BIKE.WB / 2);
    const wo = rearC.clone().sub(rearC.clone().applyQuaternion(wq));
    m.bike.position.copy(wo); m.bike.quaternion.copy(wq);
    m.rider.position.copy(wo); m.rider.quaternion.copy(wq);
    // wheel & cranks
    const ws = this.mode === 'grind' ? 0 : this.vel.length();
    this.wheel += (ws / BIKE.WR) * dt;
    if (this.pedaling && this.mode === 'ground') this.crank += (ws / BIKE.WR) * dt * 0.42;
    else this.crank = damp(this.crank, Math.round(this.crank / Math.PI) * Math.PI, 3, dt); // level pedals when coasting
    P.wheel = -this.wheel;
    P.crank = -this.crank;
    // steering visual
    const steerT = this.mode === 'ground' ? clamp(input.steer * 0.35 / (1 + this.speed * 0.12), -0.5, 0.5) : this.mode === 'air' ? input.steer * 0.12 : 0;
    this.steerVis = damp(this.steerVis, steerT, 10, dt);
    P.steer = this.steerVis;
    // crouch from preload & landing squash
    this.landSquash = damp(this.landSquash, 0, 5, dt);
    const crouchT = this.preload * 0.9 + this.landSquash * 0.8 + (this.grind ? 0.35 : 0) + (this.mode === 'air' && this.air && this.air.t < 0.2 ? 0.3 : 0);
    P.crouch = damp(P.crouch, clamp(crouchT, 0, 1), 14, dt);
    P.shift = damp(P.shift, this.manual ? (this.manual.nose ? -0.6 : 0.8) : 0, 10, dt);
    P.tuck = damp(P.tuck, this.mode === 'air' && this.air && Math.abs(this.air.flipVel) > 2 ? 1 : 0, 8, dt);
    m.updatePose();
  }

  // Compact network snapshot: root transform + pose numbers
  snapshot() {
    const r = this.model.root, P = this.model.pose;
    const f = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
    return [
      f(r.position.x), f(r.position.y), f(r.position.z),
      f(r.quaternion.x, 4), f(r.quaternion.y, 4), f(r.quaternion.z, 4), f(r.quaternion.w, 4),
      f(this.wheelieVis || 0), f(P.steer), f(P.barspin), f(P.whip), f(P.crouch, 2), f(P.shift, 2),
      f(P.superman, 2), f(P.nohander, 2), f(P.cancan, 2), f(P.nofooter, 2), f(P.tuck, 2), f(P.crank), f(P.wheel % 100),
      this.mode === 'bail' ? 1 : 0, f(this.vel.length(), 1),
    ];
  }
}

function A_heading(rail, sign) {
  return Math.atan2(rail.dir.x * sign, rail.dir.z * sign);
}

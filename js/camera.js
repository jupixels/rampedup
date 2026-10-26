// Chase / far / helmet cameras with smoothing, terrain avoidance and shake.
import * as THREE from 'three';
import { damp, dampAngle, clamp, angleDiff } from './util.js';
import { makeGroundResult } from './collision.js';

export const CAM_MODES = ['chase', 'far', 'helmet'];

export class ChaseCamera {
  constructor(camera, collision) {
    this.cam = camera;
    this.col = collision;
    this.mode = 'chase';
    this.yaw = 0;
    this.orbitYaw = 0; this.orbitPitch = 0;
    this.lastOrbit = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.g = makeGroundResult();
    this.fov = 62;
    this.time = 0;
    this.distScale = 1;
    this.baseFov = 60;
    this.reduceMotion = false;
    this.dip = 0; this.dipV = 0;
    this.airPull = 0;
  }

  cycle() {
    this.mode = CAM_MODES[(CAM_MODES.indexOf(this.mode) + 1) % CAM_MODES.length];
    return this.mode;
  }

  snap(player) {
    this.yaw = player.heading;
    this.update(1, player, { orbitX: 0, orbitY: 0 }, true);
  }

  addShake(a) { if (!this.reduceMotion) this.shake = Math.min(1, this.shake + a); }
  // landing compression: the camera dips and recovers like a spring
  addDip(a) { if (!this.reduceMotion) this.dipV -= a; }

  update(dt, player, input, snap = false) {
    this.time += dt;
    const p = player.pos;
    const sp = player.speed;
    // which way to look: in the air follow the direction of travel, so spins don't spin the camera
    let targetYaw = player.heading;
    if (player.mode === 'air' && sp > 1.5) {
      targetYaw = Math.atan2(player.vel.x, player.vel.z);
      if (player.air && player.air.vert) targetYaw = this.yaw; // hold on vert airs
    }
    if (player.mode === 'bail') targetYaw = this.yaw;
    this.yaw = snap ? targetYaw : dampAngle(this.yaw, targetYaw, player.mode === 'air' ? 2.2 : 4.5, dt);
    if (input.orbitX || input.orbitY) { this.orbitYaw -= input.orbitX; this.orbitPitch = clamp(this.orbitPitch + input.orbitY, -0.5, 1.0); this.lastOrbit = this.time; }
    if (this.time - this.lastOrbit > 1.6) { this.orbitYaw = damp(this.orbitYaw, 0, 2.5, dt); this.orbitPitch = damp(this.orbitPitch, 0, 2.5, dt); }

    const yaw = this.yaw + this.orbitYaw;
    let dist, height, lookH;
    switch (this.mode) {
      case 'far': dist = 7.5 + sp * 0.12; height = 3.0; lookH = 1.0; break;
      default: dist = 3.9 + sp * 0.09; height = 1.55; lookH = 1.05;
    }
    // pull back on big airs so you can see the landing coming
    const airT = player.mode === 'air' && player.air ? player.air.t : 0;
    this.airPull = damp(this.airPull, clamp((airT - 0.35) * 1.6, 0, 2.6), airT > 0 ? 2 : 4, dt);
    dist = (dist + this.airPull) * this.distScale;
    height += this.airPull * 0.35;
    if (player.mode === 'bail') dist *= 1.15;
    // spring for the landing dip
    this.dipV += (-this.dip * 90 - this.dipV * 12) * dt;
    this.dip += this.dipV * dt;
    const pitch = 0.22 + this.orbitPitch;
    const target = new THREE.Vector3(p.x, p.y + lookH, p.z);
    if (player.mode === 'bail' && player.bail) target.copy(player.bail.riderPos);
    let desired;
    if (this.mode === 'helmet' && player.mode !== 'bail') {
      const head = player.model.parts.head.getWorldPosition(new THREE.Vector3());
      const fwd = new THREE.Vector3(Math.sin(player.visHeading), 0, Math.cos(player.visHeading));
      desired = head.clone().addScaledVector(fwd, 0.12).add(new THREE.Vector3(0, 0.06, 0));
      this.pos.copy(desired);
      this.look.copy(desired).addScaledVector(fwd, 5).add(new THREE.Vector3(0, -0.6 + (player.mode === 'air' ? player.vel.y * 0.08 : 0), 0));
      this.cam.position.copy(this.pos);
      this.cam.lookAt(this.look);
      this.applyFov(dt, sp, this.baseFov + 16);
      return;
    }
    {
      desired = new THREE.Vector3(
        target.x - Math.sin(yaw) * dist * Math.cos(pitch),
        target.y + height - 1 + Math.sin(pitch) * dist,
        target.z - Math.cos(yaw) * dist * Math.cos(pitch),
      );
    }
    // keep above ground / props
    const g = this.col.ground(desired.x, desired.z, desired.y + 1.5, this.g);
    if (desired.y < g.h + 0.45) desired.y = g.h + 0.45;
    if (snap) { this.pos.copy(desired); this.look.copy(target); }
    else {
      const k = player.mode === 'air' ? 7 : 9;
      this.pos.x = damp(this.pos.x, desired.x, k, dt);
      this.pos.z = damp(this.pos.z, desired.z, k, dt);
      this.pos.y = damp(this.pos.y, desired.y, player.mode === 'air' ? 4.5 : 8, dt);
      if (this.pos.y < g.h + 0.4) this.pos.y = g.h + 0.4;
      this.look.x = damp(this.look.x, target.x, 16, dt);
      this.look.y = damp(this.look.y, target.y, player.mode === 'air' ? 7 : 14, dt);
      this.look.z = damp(this.look.z, target.z, 16, dt);
    }
    this.cam.position.copy(this.pos);
    this.cam.position.y += this.dip * 0.6;
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.08;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this.cam.lookAt(this.look);
    this.applyFov(dt, sp, this.baseFov);
  }

  applyFov(dt, sp, base) {
    const f = clamp(base + Math.max(0, sp - 6) * 0.9, base, base + 18);
    this.fov = damp(this.fov, f, 3, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.05) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
}

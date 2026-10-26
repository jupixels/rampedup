// Photo mode: freeze the moment, fly the camera around, change the light and save a picture.
import * as THREE from 'three';
import { TIMES } from './world.js';
import { clamp } from './util.js';

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.el = document.getElementById('photo');
    this.target = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0.2; this.dist = 4;
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      game.audio.play('click');
      if (b.dataset.time) { game.env.setTime(b.dataset.time); this.markTime(); }
      if (b.dataset.ph === 'save') this.save();
      if (b.dataset.ph === 'exit') this.exit();
      if (b.dataset.ph === 'rider') { game.player.model.root.visible = !game.player.model.root.visible; b.classList.toggle('on', !game.player.model.root.visible); }
    });
    this.el.querySelector('[data-ph=fov]').addEventListener('input', (e) => { this.fov = +e.target.value; });
    window.addEventListener('wheel', (e) => { if (this.active) this.dist = clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.1), 0.8, 60); }, { passive: true });
  }

  enter() {
    const g = this.game;
    if (!g.playing || this.active) return;
    this.active = true;
    this.prevTime = g.env.time;
    const cam = g.camera;
    this.target.copy(g.player.mode === 'bail' && g.player.bail ? g.player.bail.riderPos : g.player.pos).add(new THREE.Vector3(0, 1, 0));
    const off = cam.position.clone().sub(this.target);
    this.dist = clamp(off.length(), 1.5, 30);
    this.yaw = Math.atan2(off.x, off.z);
    this.pitch = Math.asin(clamp(off.y / this.dist, -0.95, 0.95));
    this.fov = cam.fov;
    this.el.querySelector('[data-ph=fov]').value = this.fov;
    document.getElementById('hud').classList.add('hidden');
    g.ui.showTouch(false);
    this.el.classList.remove('hidden');
    this.markTime();
  }

  exit() {
    const g = this.game;
    if (!this.active) return;
    this.active = false;
    g.player.model.root.visible = true;
    this.el.querySelector('[data-ph=rider]')?.classList.remove('on');
    document.getElementById('hud').classList.remove('hidden');
    g.ui.showTouch(true);
    this.el.classList.add('hidden');
    g.env.setTime(g.settings.time);
    g.cam.applyFov(1, g.player.speed, 60);
  }

  markTime() {
    const cur = Object.entries(TIMES).find(([, t]) => t === this.game.env.time)?.[0];
    this.el.querySelectorAll('[data-time]').forEach((b) => b.classList.toggle('on', b.dataset.time === cur));
  }

  update(dt, input) {
    const g = this.game, k = (c) => g.input.key(c);
    this.yaw -= input.orbitX * 1.4;
    this.pitch = clamp(this.pitch + input.orbitY * 1.4, -1.2, 1.4);
    // fly the focus point
    const sp = (k('ShiftLeft') ? 12 : 4) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const mv = new THREE.Vector3();
    if (k('KeyW') || k('ArrowUp')) mv.add(fwd);
    if (k('KeyS') || k('ArrowDown')) mv.sub(fwd);
    if (k('KeyD') || k('ArrowRight')) mv.add(right);
    if (k('KeyA') || k('ArrowLeft')) mv.sub(right);
    if (k('KeyE')) mv.y += 1;
    if (k('KeyQ')) mv.y -= 1;
    mv.x += -input.steer * 0; // keyboard handled above; stick below
    this.target.addScaledVector(mv, sp);
    const cam = g.camera;
    const pos = new THREE.Vector3(
      this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    const gr = g.world.collision.ground(pos.x, pos.z, pos.y + 1, { n: new THREE.Vector3() });
    if (pos.y < gr.h + 0.2) pos.y = gr.h + 0.2;
    cam.position.copy(pos);
    cam.lookAt(this.target);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  save() {
    const g = this.game;
    this.el.classList.add('hidden');
    g.composer.render(0);
    g.renderer.domElement.toBlob((blob) => {
      this.el.classList.remove('hidden');
      if (!blob) { g.ui.toast('Could not save the photo'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ramped-up-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      g.audio.play('record');
      g.ui.toast('Photo saved');
    }, 'image/png');
  }
}

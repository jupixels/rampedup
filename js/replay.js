// Instant replay: the last 20 seconds of riding are always being recorded. Replay plays them
// back on your own rider with an orbit camera and slow motion, and can save the clip as a video.
import * as THREE from 'three';
import { applySnapshot } from './courses.js';
import { clamp } from './util.js';

const KEEP = 20;      // seconds of history
const HZ = 30;
const SPEEDS = [1, 0.5, 0.25];

export class Replay {
  constructor(game) {
    this.game = game;
    this.buf = [];       // { t, d }
    this.clock = 0;
    this.acc = 0;
    this.active = false;
    this.el = document.getElementById('replay');
    this.scrub = this.el.querySelector('[data-rp=scrub]');
    this.yaw = 0; this.pitch = 0.25; this.dist = 5;
    this.focus = new THREE.Vector3();
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      game.audio.play('click');
      const a = b.dataset.rp;
      if (a === 'play') this.setPlaying(!this.playing);
      if (a === 'speed') { this.speedI = (this.speedI + 1) % SPEEDS.length; this.syncUi(); }
      if (a === 'clip') this.saveClip();
      if (a === 'exit') this.exit();
    });
    this.scrub.addEventListener('input', () => { if (this.rec) return; this.t = this.t0 + (this.scrub.value / 1000) * (this.t1 - this.t0); this.setPlaying(false); });
    window.addEventListener('wheel', (e) => { if (this.active) this.dist = clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.1), 1.5, 40); }, { passive: true });
  }

  get seconds() { return this.buf.length ? this.buf[this.buf.length - 1].t - this.buf[0].t : 0; }
  canSaveClip() { return typeof MediaRecorder !== 'undefined' && !!this.game.renderer.domElement.captureStream; }

  // called every frame while riding
  record(dt) {
    this.clock += dt; this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc = 0;
    this.buf.push({ t: this.clock, d: this.game.player.snapshot() });
    while (this.buf.length > 2 && this.clock - this.buf[0].t > KEEP) this.buf.shift();
  }

  enter() {
    const g = this.game;
    if (this.active || !g.playing) return false;
    if (this.seconds < 1) { g.ui.toast('Ride a little first, then replay it'); return false; }
    this.active = true;
    this.t0 = this.buf[0].t; this.t1 = this.buf[this.buf.length - 1].t;
    this.t = Math.max(this.t0, this.t1 - 10);   // start 10 s back; scrub for more
    this.speedI = 0;
    this.i = 0;
    const off = g.camera.position.clone().sub(g.player.pos);
    this.dist = clamp(off.length(), 3, 12);
    this.yaw = Math.atan2(off.x, off.z);
    this.pitch = 0.25;
    document.getElementById('hud').classList.add('hidden');
    g.ui.showTouch(false);
    this.el.classList.remove('hidden');
    this.el.querySelector('[data-rp=clip]').classList.toggle('hidden', !this.canSaveClip());
    this.setPlaying(true);
    return true;
  }

  exit() {
    const g = this.game;
    if (!this.active) return;
    this.stopClip(false);
    this.active = false;
    this.el.classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    g.ui.showTouch(true);
    g.player.model.rider.visible = true;
    g.player.updateVisual(1);       // put the rider back where they really are
    g.cam.snap(g.player);
    g.clock.getDelta();
  }

  setPlaying(on) { this.playing = on; this.syncUi(); }
  syncUi() {
    this.el.querySelector('[data-rp=play]').firstElementChild.textContent = this.playing ? 'Pause' : 'Play';
    this.el.querySelector('[data-rp=speed]').firstElementChild.textContent = SPEEDS[this.speedI] === 1 ? 'Speed 1×' : SPEEDS[this.speedI] === 0.5 ? 'Speed ½×' : 'Speed ¼×';
    this.el.querySelector('[data-rp=clip]').firstElementChild.textContent = this.rec ? 'Recording…' : 'Save clip';
    this.el.classList.toggle('recording', !!this.rec);
  }

  // pose the rider at playhead time t
  apply() {
    const b = this.buf, m = this.game.player.model;
    if (this.i >= b.length - 1 || b[this.i].t > this.t) this.i = 0;
    while (this.i < b.length - 2 && b[this.i + 1].t < this.t) this.i++;
    const a = b[this.i], c = b[Math.min(b.length - 1, this.i + 1)];
    const f = c.t > a.t ? clamp((this.t - a.t) / (c.t - a.t), 0, 1) : 0;
    const bailed = c.d[20] === 1;
    m.rider.visible = !bailed;
    if (!bailed) applySnapshot(m, a.d, c.d, f);
  }

  update(dt, input) {
    const g = this.game;
    if (input.pausePressed) { this.exit(); return; }
    if (input.hopPressed && !this.rec) this.setPlaying(!this.playing);
    if (this.playing) {
      this.t += dt * SPEEDS[this.speedI];
      if (this.t >= this.t1) {
        this.t = this.t1;
        if (this.rec) this.stopClip(true);
        this.setPlaying(false);
      }
    }
    this.apply();
    if (!this.rec) this.scrub.value = Math.round(((this.t - this.t0) / Math.max(1e-3, this.t1 - this.t0)) * 1000);
    // orbit camera around the rider
    this.yaw -= input.orbitX * 1.4;
    this.pitch = clamp(this.pitch + input.orbitY * 1.4, -0.3, 1.3);
    const p = g.player.model.root.position;
    this.focus.lerp(new THREE.Vector3(p.x, p.y + 0.9, p.z), this.focus.lengthSq() === 0 ? 1 : 1 - Math.exp(-12 * dt));
    if (this.focus.distanceTo(p) > 6) this.focus.set(p.x, p.y + 0.9, p.z);
    const cam = g.camera;
    cam.position.set(
      this.focus.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
      this.focus.y + Math.sin(this.pitch) * this.dist,
      this.focus.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist,
    );
    const gh = g.world.collision.ground(cam.position.x, cam.position.z, cam.position.y + 2, g.cam.g).h;
    if (cam.position.y < gh + 0.4) cam.position.y = gh + 0.4;
    cam.lookAt(this.focus);
  }

  // ---------- clip export ----------
  saveClip() {
    if (this.rec || !this.canSaveClip()) return;
    const g = this.game;
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const type = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) { g.ui.toast('This browser cannot record video'); return; }
    let stream;
    try { stream = g.renderer.domElement.captureStream(30); } catch (e) { g.ui.toast('This browser cannot record video'); return; }
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!this.keepClip || !chunks.length) return;
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      this.lastClip = { size: blob.size, type: blob.type };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `rampedup-clip-${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      g.ui.toast('Clip saved to your downloads');
    };
    // record from the start of the visible range to the end, at the chosen speed
    this.t = Math.max(this.t0, this.t1 - 10);
    this.rec = rec;
    rec.start(500);
    this.setPlaying(true);
  }

  stopClip(keep) {
    if (!this.rec) return;
    this.keepClip = keep;
    const r = this.rec; this.rec = null;
    try { r.stop(); } catch (e) {}
    this.syncUi();
  }
}

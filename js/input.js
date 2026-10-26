// Keyboard, gamepad and touch input merged into one per-frame state.
import { clamp } from './util.js';

const TRICK_KEYS = { KeyJ: 'barspin', KeyK: 'tailwhip', KeyL: 'superman', KeyU: 'nohander', KeyI: 'cancan', KeyO: 'tabletop', KeyH: 'nofooter' };
export const TRICK_LIST = ['barspin', 'tailwhip', 'superman', 'nohander', 'cancan', 'tabletop', 'nofooter'];

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.releasedKeys = new Set();
    this.enabled = true;
    this.touch = { steer: 0, fwd: 0, hop: false, manual: false, tricks: {}, buttons: {} };
    this.mouse = { dx: 0, dy: 0, down: false };
    this.prevPad = [];
    this.padActive = false;
    this.state = this.blank();
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.padActive = false;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedKeys.add(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    const canvas = document.getElementById('game');
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { this.mouse.down = true; this.mouse.lastMove = performance.now(); } });
    window.addEventListener('pointerup', () => { this.mouse.down = false; });
    window.addEventListener('pointermove', (e) => {
      if (this.mouse.down && e.pointerType === 'mouse') { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; this.mouse.lastMove = performance.now(); }
    });
  }

  blank() {
    return {
      steer: 0, pedal: 0, brake: 0, flip: 0, hop: false, hopPressed: false, hopReleased: false,
      manual: false, manualPressed: false, tricks: {}, trickHeld: {}, resetPressed: false, interactPressed: false,
      camPressed: false, mapPressed: false, pausePressed: false, chatPressed: false, scoreHeld: false, orbitX: 0, orbitY: 0,
    };
  }

  key(c) { return this.keys.has(c); }
  pressed(c) { return this.pressedKeys.has(c); }

  poll() {
    const s = this.blank();
    if (this.enabled) {
      const k = (c) => this.keys.has(c);
      const left = k('KeyA') || k('ArrowLeft'), right = k('KeyD') || k('ArrowRight');
      const up = k('KeyW') || k('ArrowUp'), down = k('KeyS') || k('ArrowDown');
      s.steer = (left ? 1 : 0) - (right ? 1 : 0);
      s.pedal = up ? 1 : 0;
      s.brake = down ? 1 : 0;
      s.flip = (up ? 1 : 0) - (down ? 1 : 0);
      s.hop = k('Space');
      s.hopPressed = this.pressed('Space');
      s.hopReleased = this.releasedKeys.has('Space');
      s.manual = k('ShiftLeft') || k('ShiftRight');
      s.manualPressed = this.pressed('ShiftLeft') || this.pressed('ShiftRight');
      for (const [code, t] of Object.entries(TRICK_KEYS)) {
        if (this.pressed(code)) s.tricks[t] = true;
        if (k(code)) s.trickHeld[t] = true;
      }
      s.resetPressed = this.pressed('KeyR');
      s.interactPressed = this.pressed('KeyE') || this.pressed('KeyF');
      s.camPressed = this.pressed('KeyC');
      s.mapPressed = this.pressed('KeyM');
      s.chatPressed = this.pressed('KeyT') || this.pressed('Enter');
      s.scoreHeld = k('Tab');
      s.orbitX = this.mouse.dx * 0.005; s.orbitY = this.mouse.dy * 0.004;
      this.pollPad(s);
      this.pollTouch(s);
    }
    s.pausePressed = this.pressed('Escape') || this.pressed('KeyP') || s.pausePressed;
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.state = s;
    return s;
  }

  pollPad(s) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = [...pads].find((x) => x && x.connected);
    if (!p) return;
    const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    const bv = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
    const prev = this.prevPad;
    const pr = (i) => b(i) && !prev[i];
    const rl = (i) => !b(i) && prev[i];
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
    // right stick (camera): wider dead zone so a worn/drifting stick can't spin the camera
    const dzR = (v) => (Math.abs(v) < 0.3 ? 0 : (v - Math.sign(v) * 0.3) / 0.7);
    const rx = dzR(p.axes[2] || 0), ry = dzR(p.axes[3] || 0);
    const any = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0 || p.buttons.some((x) => x.pressed);
    if (any) this.padActive = true;
    if (!this.padActive) { this.prevPad = p.buttons.map((x) => x.pressed); return; }
    s.steer = clamp(s.steer - lx, -1, 1);
    s.pedal = Math.max(s.pedal, bv(7), ly < -0.4 ? -ly : 0);
    s.brake = Math.max(s.brake, bv(6), ly > 0.4 ? ly : 0);
    s.flip = clamp(s.flip - ly, -1, 1);
    s.hop = s.hop || b(0);
    s.hopPressed = s.hopPressed || pr(0);
    s.hopReleased = s.hopReleased || rl(0);
    s.manual = s.manual || b(4);
    s.manualPressed = s.manualPressed || pr(4);
    const map = { 2: 'barspin', 3: 'tailwhip', 1: 'superman', 4: 'nohander', 5: 'cancan', 13: 'tabletop', 12: 'nofooter' };
    for (const [i, t] of Object.entries(map)) { if (pr(+i)) s.tricks[t] = true; if (b(+i)) s.trickHeld[t] = true; }
    s.resetPressed = s.resetPressed || pr(8);
    s.pausePressed = pr(9);
    s.camPressed = s.camPressed || pr(11) || pr(10);
    s.interactPressed = s.interactPressed || pr(14) || pr(15);
    s.mapPressed = s.mapPressed;
    s.orbitX += rx * 0.05; s.orbitY += ry * 0.03;
    this.prevPad = p.buttons.map((x) => x.pressed);
  }

  pollTouch(s) {
    const t = this.touch;
    if (!t.active) return;
    s.steer = clamp(s.steer - t.steer, -1, 1);
    s.flip = clamp(s.flip + t.fwd, -1, 1);
    s.pedal = Math.max(s.pedal, t.autoPedal ? 1 : 0, t.fwd > 0.35 ? t.fwd : 0);
    s.brake = Math.max(s.brake, t.fwd < -0.45 ? -t.fwd : 0);
    if (t.autoPedal && t.fwd < -0.45) s.pedal = 0;
    s.hop = s.hop || t.hop;
    if (t.hop && !t.prevHop) s.hopPressed = true;
    if (!t.hop && t.prevHop) s.hopReleased = true;
    t.prevHop = t.hop;
    s.manual = s.manual || t.manual;
    if (t.manual && !t.prevManual) s.manualPressed = true;
    t.prevManual = t.manual;
    for (const k of TRICK_LIST) {
      if (t.tricks[k] && !t['prev_' + k]) s.tricks[k] = true;
      if (t.tricks[k]) s.trickHeld[k] = true;
      t['prev_' + k] = t.tricks[k];
    }
    for (const [k, v] of Object.entries(t.buttons)) { if (v) { s[k] = true; t.buttons[k] = false; } }
  }
}

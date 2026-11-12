// Keyboard, gamepad and touch input merged into one per-frame state.
// Every action can be rebound (Settings → Controls); overrides live in settings.binds.
import { clamp } from './util.js';

export const TRICK_LIST = ['barspin', 'tailwhip', 'superman', 'nohander', 'cancan', 'tabletop', 'nofooter'];

// action -> keyboard codes
export const DEFAULT_KEYS = {
  pedal: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  hop: ['Space'], manual: ['ShiftLeft', 'ShiftRight'],
  barspin: ['KeyJ'], tailwhip: ['KeyK'], superman: ['KeyL'], nohander: ['KeyU'], cancan: ['KeyI'], tabletop: ['KeyO'], nofooter: ['KeyH'],
  reset: ['KeyR'], restart: ['Backspace'], interact: ['KeyE', 'KeyF'], camera: ['KeyC'], map: ['KeyM'], chat: ['KeyT', 'Enter'], photo: ['KeyP'], replay: ['KeyV'], riders: ['Tab'],
};
// action -> standard-layout gamepad button. LB is manual only; Start always pauses.
export const DEFAULT_PAD = {
  pedal: 7, brake: 6, hop: 0, manual: 4,
  barspin: 2, tailwhip: 3, superman: 1, nohander: 5, cancan: 14, tabletop: 13, nofooter: 12,
  reset: 8, interact: 15, camera: 11, map: 10,
};
export const ACTION_LABELS = {
  pedal: 'Pedal · front flip', brake: 'Brake · back flip', left: 'Steer left', right: 'Steer right', hop: 'Bunny hop', manual: 'Manual',
  barspin: 'Barspin', tailwhip: 'Tailwhip', superman: 'Superman', nohander: 'No Hander', cancan: 'Can Can', tabletop: 'Table Top', nofooter: 'No Footer',
  reset: 'Restart course / back to safe spot', restart: 'Back to last gate', interact: 'Start course / lift', camera: 'Camera', map: 'Map', chat: 'Chat', photo: 'Photo mode', replay: 'Instant replay', riders: 'Riders list',
};
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'];
const TOUCH_NAMES = { pedal: 'stick up', brake: 'stick down', left: 'stick', right: 'stick', hop: 'HOP', manual: 'MANUAL', barspin: 'BAR', tailwhip: 'WHIP', superman: 'SUPER', nohander: 'NO HAND', cancan: 'CAN', tabletop: 'TABLE', nofooter: 'NO FOOT', reset: '↺', interact: 'GO', camera: 'CAM', map: 'MAP' };

export function keyName(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc' }[code] || code;
}
export const padName = (i) => (i == null ? '—' : PAD_NAMES[i] || 'Button ' + i);

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
    this.isTouch = false;
    this.capture = null; // set while the rebinding screen waits for a key or button
    this.setBinds(null);
    this.state = this.blank();
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (this.capture && this.capture.kind === 'key') {
        e.preventDefault();
        const cb = this.capture.done; this.capture = null;
        cb(e.code === 'Escape' ? null : e.code);
        return;
      }
      if (e.ctrlKey || e.metaKey) return; // leave browser shortcuts alone
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
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

  // ---------- bindings ----------
  setBinds(saved) {
    this.keymap = {}; this.padmap = {};
    for (const [a, codes] of Object.entries(DEFAULT_KEYS)) this.keymap[a] = codes.slice();
    Object.assign(this.padmap, DEFAULT_PAD);
    if (saved && typeof saved === 'object') {
      for (const [a, codes] of Object.entries(saved.keys || {})) if (a in DEFAULT_KEYS && Array.isArray(codes)) this.keymap[a] = codes.filter((c) => typeof c === 'string').slice(0, 2);
      for (const [a, i] of Object.entries(saved.pad || {})) if (a in ACTION_LABELS && (i === null || (Number.isInteger(i) && i >= 0 && i < 17 && i !== 9))) this.padmap[a] = i;
    }
  }
  // what to save: only the entries that differ from the defaults
  bindsToSave() {
    const keys = {}, pad = {};
    for (const a of Object.keys(DEFAULT_KEYS)) if (this.keymap[a].join() !== DEFAULT_KEYS[a].join()) keys[a] = this.keymap[a];
    for (const a of Object.keys(ACTION_LABELS)) if ((this.padmap[a] ?? null) !== (DEFAULT_PAD[a] ?? null)) pad[a] = this.padmap[a] ?? null;
    return { keys, pad };
  }
  bindKey(action, code) {
    for (const a of Object.keys(this.keymap)) if (a !== action) this.keymap[a] = this.keymap[a].filter((c) => c !== code);
    this.keymap[action] = [code];
  }
  bindPad(action, index) {
    for (const a of Object.keys(this.padmap)) if (a !== action && this.padmap[a] === index) this.padmap[a] = null;
    this.padmap[action] = index;
  }
  // wait for the next key (kind 'key') or gamepad button (kind 'pad'); done(null) = cancelled
  startCapture(kind, done) { this.capture = { kind, done }; }
  cancelCapture() { const c = this.capture; this.capture = null; if (c) c.done(undefined); }

  // ---------- labels for prompts ----------
  device() { return this.isTouch ? 'touch' : this.padActive ? 'pad' : 'kb'; }
  label(action) {
    const d = this.device();
    if (d === 'touch') return TOUCH_NAMES[action] || '';
    if (d === 'pad') {
      if (action === 'pause') return 'Start';
      if (action === 'left' || action === 'right') return 'left stick';
      return this.padmap[action] != null ? padName(this.padmap[action]) : '';
    }
    if (action === 'pause') return 'Esc';
    return keyName((this.keymap[action] || [])[0]);
  }

  blank() {
    return {
      steer: 0, pedal: 0, brake: 0, flip: 0, hop: false, hopPressed: false, hopReleased: false,
      manual: false, manualPressed: false, tricks: {}, trickHeld: {}, resetPressed: false, restartPressed: false, interactPressed: false,
      camPressed: false, mapPressed: false, pausePressed: false, chatPressed: false, scoreHeld: false, orbitX: 0, orbitY: 0,
    };
  }

  key(c) { return this.keys.has(c); }
  pressed(c) { return this.pressedKeys.has(c); }
  held(action) { const l = this.keymap[action]; for (let i = 0; i < l.length; i++) if (this.keys.has(l[i])) return true; return false; }
  hit(action) { const l = this.keymap[action]; for (let i = 0; i < l.length; i++) if (this.pressedKeys.has(l[i])) return true; return false; }
  let(action) { const l = this.keymap[action]; for (let i = 0; i < l.length; i++) if (this.releasedKeys.has(l[i])) return true; return false; }

  poll() {
    const s = this.blank();
    if (this.enabled && !this.capture) {
      const left = this.held('left'), right = this.held('right');
      const up = this.held('pedal'), down = this.held('brake');
      s.steer = (left ? 1 : 0) - (right ? 1 : 0);
      s.pedal = up ? 1 : 0;
      s.brake = down ? 1 : 0;
      s.flip = (up ? 1 : 0) - (down ? 1 : 0);
      s.hop = this.held('hop');
      s.hopPressed = this.hit('hop');
      s.hopReleased = this.let('hop');
      s.manual = this.held('manual');
      s.manualPressed = this.hit('manual');
      for (const t of TRICK_LIST) {
        if (this.hit(t)) s.tricks[t] = true;
        if (this.held(t)) s.trickHeld[t] = true;
      }
      s.resetPressed = this.hit('reset');
      s.restartPressed = this.hit('restart');
      s.interactPressed = this.hit('interact');
      s.camPressed = this.hit('camera');
      s.mapPressed = this.hit('map');
      s.chatPressed = this.hit('chat');
      s.scoreHeld = this.held('riders');
      const sens = this.sens || 1;
      s.orbitX = this.mouse.dx * 0.005 * sens; s.orbitY = this.mouse.dy * 0.004 * sens * (this.invert ? -1 : 1);
      this.pollTouch(s);
    }
    this.pollPad(s);
    s.pausePressed = (!this.capture && this.pressed('Escape')) || s.pausePressed;
    s.photoPressed = (this.enabled && !this.capture && this.hit('photo')) || !!s.photoPressedPad;
    s.replayPressed = (this.enabled && !this.capture && this.hit('replay')) || !!s.replayPressedPad;
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
    const b = (i) => i != null && !!(p.buttons[i] && p.buttons[i].pressed);
    const bv = (i) => (i != null && p.buttons[i] ? p.buttons[i].value : 0);
    const prev = this.prevPad;
    const pr = (i) => b(i) && !prev[i];
    const rl = (i) => i != null && !b(i) && prev[i];
    const save = () => { this.prevPad = p.buttons.map((x) => x.pressed); };
    // rebinding: the next fresh button press is the answer
    if (this.capture) {
      if (this.capture.kind === 'pad') {
        const i = p.buttons.findIndex((x, k) => x.pressed && !prev[k]);
        if (i >= 0) { const cb = this.capture.done; this.capture = null; cb(i === 9 ? null : i); }
      }
      save();
      return;
    }
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
    // right stick (camera): wider dead zone so a worn/drifting stick can't spin the camera
    const dzR = (v) => (Math.abs(v) < 0.3 ? 0 : (v - Math.sign(v) * 0.3) / 0.7);
    const rx = dzR(p.axes[2] || 0), ry = dzR(p.axes[3] || 0);
    const any = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0 || p.buttons.some((x) => x.pressed);
    if (any) this.padActive = true;
    if (!this.padActive) { save(); return; }
    const M = this.padmap;
    // menu navigation edges (D-pad or stick with auto-repeat) work even while gameplay input is off
    const now = performance.now();
    const dirs = { up: b(12) || ly < -0.6, down: b(13) || ly > 0.6, left: b(14) || lx < -0.6, right: b(15) || lx > 0.6 };
    this.navHeld = this.navHeld || {}; this.navRep = this.navRep || {};
    const nav = {};
    for (const [k, on] of Object.entries(dirs)) {
      if (!on) { this.navHeld[k] = 0; continue; }
      if (!this.navHeld[k]) { nav[k] = true; this.navHeld[k] = now; this.navRep[k] = false; }
      else if (now - this.navHeld[k] > (this.navRep[k] ? 120 : 380)) { nav[k] = true; this.navHeld[k] = now; this.navRep[k] = true; }
    }
    nav.ok = pr(0); nav.back = pr(1);
    s.nav = nav;
    s.pausePressed = pr(9);
    if (this.enabled) {
      s.steer = clamp(s.steer - lx, -1, 1);
      s.pedal = Math.max(s.pedal, bv(M.pedal), ly < -0.4 ? -ly : 0);
      s.brake = Math.max(s.brake, bv(M.brake), ly > 0.4 ? ly : 0);
      s.flip = clamp(s.flip - ly, -1, 1);
      s.hop = s.hop || b(M.hop);
      s.hopPressed = s.hopPressed || pr(M.hop);
      s.hopReleased = s.hopReleased || rl(M.hop);
      s.manual = s.manual || b(M.manual);
      s.manualPressed = s.manualPressed || pr(M.manual);
      for (const t of TRICK_LIST) { if (pr(M[t])) s.tricks[t] = true; if (b(M[t])) s.trickHeld[t] = true; }
      s.resetPressed = s.resetPressed || pr(M.reset);
      s.restartPressed = s.restartPressed || pr(M.restart);
      s.camPressed = s.camPressed || pr(M.camera);
      s.mapPressed = s.mapPressed || pr(M.map);
      s.interactPressed = s.interactPressed || pr(M.interact);
      s.chatPressed = s.chatPressed || pr(M.chat);
      s.photoPressedPad = pr(M.photo);
      s.replayPressedPad = pr(M.replay);
      s.scoreHeld = s.scoreHeld || b(M.riders);
      s.orbitX += rx * 0.05; s.orbitY += ry * 0.03 * (this.invert ? -1 : 1);
    }
    save();
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

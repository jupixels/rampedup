// DOM UI: menus, panels, HUD, minimap, big map, chat, touch controls.
import { ZONES, FAST_TRAVEL, WORLD, LAKE } from './layout.js';
import { CHALLENGES } from './courses.js';
import { formatTime, clamp, store } from './util.js';
import { TRICK_LIST } from './input.js';

const $ = (s, el = document) => el.querySelector(s);
const PALETTES = {
  frame: ['#ff5a1f', '#ffd21f', '#3fd4ff', '#57e08a', '#e8e8e8', '#151515', '#c42b6b', '#7b5cff', '#2b6cff', '#9aa1a8'],
  helmet: ['#f2f2f2', '#151515', '#ff5a1f', '#ffd21f', '#3fd4ff', '#c42b6b', '#57e08a', '#7b5cff'],
  shirt: ['#1d2b3a', '#f2f2f2', '#151515', '#8a1e1e', '#ff5a1f', '#2f6b3a', '#ffd21f', '#3fd4ff', '#6b4a2f'],
  pants: ['#2a2a2a', '#3b4a5e', '#5b4a3a', '#151515', '#7a7a7a', '#2f3d2a', '#c8b89a'],
};
const MEDAL = ['', 'Bronze', 'Silver', 'Gold'];
const MEDAL_C = ['', '#c98a54', '#c9d1d9', '#ffd21f'];

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      loading: $('#loading'), loadFill: $('#load-fill'), loadText: $('#load-text'), loadError: $('#load-error'),
      menu: $('#menu'), pause: $('#pause'), hud: $('#hud'), map: $('#map'),
      zone: $('#hud-zone'), speed: $('#hud-speed'), score: $('#hud-score'),
      course: $('#hud-course'), cname: $('#hud-cname'), ctime: $('#hud-ctime'), csub: $('#hud-csub'),
      compass: $('#hud-compass'), combo: $('#hud-combo'), comboText: $('#hud-combo-text'), comboScore: $('#hud-combo-score'),
      bank: $('#hud-bank'), balance: $('#hud-balance'), big: $('#hud-big'), prompt: $('#hud-prompt'), feed: $('#hud-feed'),
      toasts: $('#toasts'), minimap: $('#minimap'), hints: $('#hud-hints'), fps: $('#hud-fps'), netBadge: $('#net-badge'),
      chatLog: $('#chat-log'), chatInput: $('#chat-input'), scoreboard: $('#scoreboard'), result: $('#result'),
      bigmap: $('#bigmap'), mapTravel: $('#map-travel'),
    };
    this.panelOpen = null;
    this.frame = 0;
    this.fpsAcc = { t: 0, n: 0 };
    this.bindMenus();
    this.bindChat();
    this.applyPrefs();
  }

  // ---------- loading ----------
  loading(text, p) { this.el.loadText.textContent = text; this.el.loadFill.style.width = `${Math.round(p * 100)}%`; }
  error(msg) { this.el.loadError.innerHTML = msg; this.el.loadError.classList.remove('hidden'); this.el.loadText.textContent = 'Something went wrong'; }
  hideLoading() { this.el.loading.classList.add('hidden'); }

  // ---------- menus ----------
  bindMenus() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.panel) { this.click(); const host = b.closest('#pause') ? $('#pause-panel-host') : $('#panel-host'); this.openPanel(b.dataset.panel, host, b); }
      if (b.dataset.action) this.action(b.dataset.action, b);
    });
    this.el.bigmap.addEventListener('click', (e) => {
      const r = this.el.bigmap.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * WORLD.size - WORLD.size / 2;
      const z = ((e.clientY - r.top) / r.height) * WORLD.size - WORLD.size / 2;
      this.game.teleport(x, z, null, true);
      this.closeMap();
    });
  }

  click() { this.game.audio.play('click'); }

  action(a, b) {
    const g = this.game;
    this.click();
    switch (a) {
      case 'ride': g.startRiding(); break;
      case 'resume': g.setPaused(false); break;
      case 'openmap': this.openMap(); break;
      case 'closemap': this.closeMap(); break;
      case 'quitcourse': g.courses.cancel(); g.setPaused(false); break;
      case 'quick': this.mpDo(() => g.net.quickJoin(), 'Finding a session…'); break;
      case 'host': this.mpDo(() => g.net.host(), 'Opening a room…'); break;
      case 'join': {
        const code = (this.panelEl.querySelector('[data-bind=code]').value || '').toUpperCase().trim();
        if (code.length < 4) { this.mpMsg('Enter a room code'); break; }
        this.mpDo(() => g.net.join(code), `Joining ${code}…`);
        break;
      }
      case 'leave': g.net.leave(); this.renderMp(); break;
      case 'copylink': {
        const url = `${location.origin}${location.pathname}?room=${g.net.code}`;
        navigator.clipboard?.writeText(url).then(() => this.toast('Invite link copied'), () => this.toast(url));
        break;
      }
      case 'race': g.net.startRace(b.dataset.course); g.setPaused(false); break;
      case 'course': {
        const c = g.courses.list.find((x) => x.id === b.dataset.course);
        if (!g.playing) g.startRiding();
        g.setPaused(false);
        g.courses.start(c);
        break;
      }
    }
  }

  async mpDo(fn, msg) {
    this.mpMsg(msg);
    this.panelEl.querySelectorAll('.btn').forEach((x) => (x.disabled = true));
    try {
      await fn();
      if (!this.game.playing) this.game.startRiding();
    } catch (e) {
      console.warn(e);
      const t = e && e.type;
      this.mpMsg(t === 'peer-unavailable' ? 'Room not found' : t === 'unavailable-id' ? 'That room code is taken' : t === 'browser-incompatible' ? 'Your browser does not support WebRTC' : 'Could not connect. Check your network and try again.');
    }
    this.panelEl && this.panelEl.querySelectorAll('.btn').forEach((x) => (x.disabled = false));
    this.renderMp();
  }

  mpMsg(t) { const el = this.panelEl && this.panelEl.querySelector('[data-bind=mpstatus]'); if (el) el.textContent = t; }

  openPanel(name, host, btn) {
    const tpl = document.getElementById('tpl-' + name);
    host.innerHTML = '';
    host.closest('.screen').querySelectorAll('.menu-list button').forEach((x) => x.classList.toggle('active', x === btn));
    if (this.panelOpen === name + host.id) { this.panelOpen = null; this.panelEl = null; host.closest('.screen').querySelectorAll('.menu-list button').forEach((x) => x.classList.remove('active')); return; }
    host.appendChild(tpl.content.cloneNode(true));
    this.panelEl = host.firstElementChild;
    this.panelOpen = name + host.id;
    const fn = { mp: 'renderMp', courses: 'renderCourses', customize: 'renderCustomize', settings: 'renderSettings' }[name];
    if (fn) this[fn]();
  }

  closePanels() {
    for (const h of [$('#panel-host'), $('#pause-panel-host')]) h.innerHTML = '';
    document.querySelectorAll('.menu-list button.active').forEach((x) => x.classList.remove('active'));
    this.panelOpen = null; this.panelEl = null;
  }

  renderMp() {
    const p = this.panelEl; if (!p || !p.querySelector('[data-bind=roomrow]')) return;
    const net = this.game.net;
    const on = net.online;
    p.querySelector('[data-bind=roomrow]').classList.toggle('hidden', !on);
    if (on) {
      p.querySelector('[data-bind=roomcode]').textContent = net.code;
      this.mpMsg(`${net.isHost ? 'Hosting' : 'Connected'} · ${net.players.size + 1} rider${net.players.size ? 's' : ''}`);
    }
    const rh = p.querySelector('[data-bind=racehost]');
    rh.classList.toggle('hidden', !(on && net.isHost));
    if (on && net.isHost) {
      const list = p.querySelector('[data-bind=racelist]');
      list.innerHTML = '';
      for (const c of this.game.courses.list.filter((x) => x.type === 'gates')) {
        const b = document.createElement('button');
        b.className = 'btn small'; b.dataset.action = 'race'; b.dataset.course = c.id;
        b.innerHTML = `<span>Race: ${c.name}</span>`;
        list.appendChild(b);
      }
    }
    const params = new URLSearchParams(location.search);
    const inp = p.querySelector('[data-bind=code]');
    if (params.get('room') && !inp.value) inp.value = params.get('room').toUpperCase();
  }

  renderCourses() {
    const p = this.panelEl, C = this.game.courses;
    const list = p.querySelector('[data-bind=courselist]');
    for (const c of C.list) {
      const best = C.best[c.id];
      const medal = C.medals[c.id] || 0;
      const row = document.createElement('div');
      row.className = 'course-item';
      row.innerHTML = `<span class="bar" style="background:${ZONES[c.zone].color}"></span>
        <div><b>${c.name}</b><small>${ZONES[c.zone].name} · ${c.diff} · ${best ? 'Best ' + (c.type === 'score' ? best.toLocaleString() : formatTime(best)) : 'Not ridden'}</small></div>
        <div class="medals">${[1, 2, 3].map((i) => `<i class="${medal >= i ? 'on' + i : ''}"></i>`).join('')}</div>
        <button class="btn small primary" data-action="course" data-course="${c.id}"><span>Go</span></button>`;
      list.appendChild(row);
    }
    const ch = p.querySelector('[data-bind=challist]');
    let done = 0;
    for (const c of CHALLENGES) {
      const d = C.done.has(c.id); if (d) done++;
      const el = document.createElement('div');
      el.className = 'challenge' + (d ? ' done' : '');
      el.innerHTML = `<i></i><span>${c.name}</span><small>${c.desc}</small>`;
      ch.appendChild(el);
    }
    p.querySelector('[data-bind=chcount]').textContent = `${done}/${CHALLENGES.length} · Sprockets ${C.found.size}/${C.sprockets.length}`;
  }

  renderCustomize() {
    const p = this.panelEl, s = this.game.settings;
    const name = p.querySelector('[data-bind=name]');
    name.value = s.name;
    name.addEventListener('input', () => { s.name = name.value.trim() || 'Rider'; this.game.saveSettings(); });
    p.querySelectorAll('.swatch-group').forEach((grp) => {
      const part = grp.dataset.part;
      const box = grp.querySelector('.swatches');
      for (const col of PALETTES[part]) {
        const b = document.createElement('button');
        b.style.background = col;
        b.title = col;
        if (s.colors[part] === col) b.classList.add('sel');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          s.colors[part] = col;
          box.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
          this.game.player.model.setColors(s.colors);
          this.game.saveSettings();
          this.click();
        });
        box.appendChild(b);
      }
    });
    this.game.focusRider = true;
  }

  renderSettings() {
    const p = this.panelEl, s = this.game.settings, g = this.game;
    const q = p.querySelector('[data-bind=quality]');
    q.value = s.quality;
    q.addEventListener('change', () => { s.quality = q.value; g.saveSettings(); if (confirm('Reload now to apply the new quality?')) location.reload(); });
    const t = p.querySelector('[data-bind=time]');
    t.value = s.time;
    t.addEventListener('change', () => { s.time = t.value; g.saveSettings(); g.env.setTime(s.time); });
    const v = p.querySelector('[data-bind=volume]');
    v.value = g.audio.volume;
    v.addEventListener('input', () => g.audio.setVolume(+v.value));
    const m = p.querySelector('[data-bind=mute]');
    m.checked = g.audio.muted;
    m.addEventListener('change', () => { if (m.checked !== g.audio.muted) g.audio.toggleMute(); });
    const f = p.querySelector('[data-bind=fps]');
    f.checked = !!s.fps;
    f.addEventListener('change', () => { s.fps = f.checked; g.saveSettings(); this.applyPrefs(); });
    const h = p.querySelector('[data-bind=hints]');
    h.checked = s.hints !== false;
    h.addEventListener('change', () => { s.hints = h.checked; g.saveSettings(); this.applyPrefs(); });
  }

  applyPrefs() {
    const s = this.game.settings || {};
    this.el.fps.classList.toggle('hidden', !s.fps);
    this.el.hints.classList.toggle('hidden', s.hints === false || this.game.touch);
  }

  showMenu() {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    const C = this.game.courses;
    $('#menu-stats').textContent = `Sprockets ${C.found.size}/${C.sprockets.length} · Challenges ${C.done.size}/${CHALLENGES.length}`;
  }
  hideMenu() { this.el.menu.classList.add('hidden'); this.closePanels(); this.el.hud.classList.remove('hidden'); }
  showPause(on) {
    this.el.pause.classList.toggle('hidden', !on);
    $('#btn-quitcourse').classList.toggle('hidden', !this.game.courses.run);
    if (!on) { this.closePanels(); this.game.focusRider = false; }
  }

  // ---------- map ----------
  buildMapImage() {
    const T = this.game.world.terrain;
    const N = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const S = WORLD.size / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -WORLD.size / 2 + i * S, z = -WORLD.size / 2 + j * S;
      const h = T.sample(x, z);
      const h2 = T.sample(x + 3, z + 3);
      const shade = clamp(1 + (h - h2) * 0.18, 0.55, 1.4);
      const sp = T.splatAt(x, z);
      let r, gg, b;
      if (h < WORLD.waterLevel) { const d = clamp((WORLD.waterLevel - h) / 10, 0, 1); r = 40 - d * 20; gg = 88 - d * 30; b = 110 - d * 25; }
      else {
        r = 78 + h * 0.6; gg = 104 + h * 0.3; b = 60;
        if (h > 70) { const k = clamp((h - 70) / 60, 0, 1); r += k * 60; gg += k * 30; b += k * 60; }
        r = r * (1 - sp.rock) + 120 * sp.rock; gg = gg * (1 - sp.rock) + 116 * sp.rock; b = b * (1 - sp.rock) + 108 * sp.rock;
        r = r * (1 - sp.dirt) + 150 * sp.dirt; gg = gg * (1 - sp.dirt) + 116 * sp.dirt; b = b * (1 - sp.dirt) + 80 * sp.dirt;
        r = r * (1 - sp.noGrass) + 120 * sp.noGrass; gg = gg * (1 - sp.noGrass) + 120 * sp.noGrass; b = b * (1 - sp.noGrass) + 118 * sp.noGrass;
        r = r * (1 - sp.sand) + 190 * sp.sand; gg = gg * (1 - sp.sand) + 170 * sp.sand; b = b * (1 - sp.sand) + 120 * sp.sand;
        r *= shade; gg *= shade; b *= shade;
      }
      const k = (j * N + i) * 4;
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // trees
    g.fillStyle = 'rgba(28,52,26,0.55)';
    for (const [x, z] of this.game.world.treePoints) { g.beginPath(); g.arc((x / WORLD.size + 0.5) * N, (z / WORLD.size + 0.5) * N, 1.8, 0, 7); g.fill(); }
    // zones
    for (const zn of Object.values(ZONES)) {
      g.strokeStyle = zn.color; g.lineWidth = 2;
      g.strokeRect(((zn.x - zn.hx) / WORLD.size + 0.5) * N, ((zn.z - zn.hz) / WORLD.size + 0.5) * N, (zn.hx * 2 / WORLD.size) * N, (zn.hz * 2 / WORLD.size) * N);
    }
    this.mapImg = c;
  }

  worldToMap(x, z, size) { return [(x / WORLD.size + 0.5) * size, (z / WORLD.size + 0.5) * size]; }

  drawMinimap() {
    const cv = this.el.minimap, g = cv.getContext('2d');
    const W = cv.width, p = this.game.player;
    if (!this.mapImg) return;
    const N = this.mapImg.width;
    const scale = 1.6; // canvas px per map px
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, 7); g.clip();
    g.fillStyle = '#2a3a2a'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2);
    g.rotate(p.visHeading - Math.PI);
    g.scale(scale, scale);
    const [px, pz] = this.worldToMap(p.pos.x, p.pos.z, N);
    g.drawImage(this.mapImg, -px, -pz);
    const dot = (x, z, col, r = 3) => { const [mx, mz] = this.worldToMap(x, z, N); g.fillStyle = col; g.beginPath(); g.arc(mx - px, mz - pz, r / scale, 0, 7); g.fill(); };
    for (const m of this.game.courses.markers) if (m.grp.visible) dot(m.course.start.x, m.course.start.z, ZONES[m.course.zone].color, 4);
    for (const { s } of this.game.courses.sprocketMeshes) dot(s.x, s.z, '#ffd21f', 2.5);
    const ng = this.game.courses.nextGate();
    if (ng) dot(ng.x, ng.z, '#ffffff', 5);
    for (const rp of this.game.net.players.values()) dot(rp.model.root.position.x, rp.model.root.position.z, rp.colors.frame, 4.5);
    g.restore();
    // player arrow
    g.fillStyle = '#ff5a1f'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W / 2, W / 2 - 10); g.lineTo(W / 2 + 7, W / 2 + 8); g.lineTo(W / 2, W / 2 + 4); g.lineTo(W / 2 - 7, W / 2 + 8); g.closePath(); g.fill(); g.stroke();
  }

  openMap() {
    const g = this.game;
    this.el.map.classList.remove('hidden');
    this.el.pause.classList.add('hidden');
    this.closePanels();
    this.mapOpen = true;
    g.setPaused(true, true);
    const cv = this.el.bigmap, c = cv.getContext('2d'), W = cv.width;
    c.drawImage(this.mapImg, 0, 0, W, W);
    c.font = '700 22px "Barlow Condensed", sans-serif';
    c.textAlign = 'center';
    for (const zn of Object.values(ZONES)) {
      const [x, z] = this.worldToMap(zn.x, zn.z - zn.hz, W);
      c.fillStyle = 'rgba(14,15,17,0.75)';
      const tw = c.measureText(zn.name.toUpperCase()).width + 14;
      c.fillRect(x - tw / 2, z - 30, tw, 26);
      c.fillStyle = zn.color; c.fillText(zn.name.toUpperCase(), x, z - 10);
    }
    for (const { s } of g.courses.sprocketMeshes) { const [x, z] = this.worldToMap(s.x, s.z, W); c.fillStyle = '#ffd21f'; c.beginPath(); c.arc(x, z, 4, 0, 7); c.fill(); }
    for (const m of g.courses.markers) { const [x, z] = this.worldToMap(m.course.start.x, m.course.start.z, W); c.strokeStyle = ZONES[m.course.zone].color; c.lineWidth = 3; c.beginPath(); c.arc(x, z, 7, 0, 7); c.stroke(); }
    for (const rp of g.net.players.values()) { const [x, z] = this.worldToMap(rp.model.root.position.x, rp.model.root.position.z, W); c.fillStyle = rp.colors.frame; c.beginPath(); c.arc(x, z, 7, 0, 7); c.fill(); c.fillStyle = '#fff'; c.fillText(rp.name, x, z - 12); }
    const [px, pz] = this.worldToMap(g.player.pos.x, g.player.pos.z, W);
    c.save(); c.translate(px, pz); c.rotate(-g.player.heading + Math.PI);
    c.fillStyle = '#ff5a1f'; c.strokeStyle = '#fff'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -14); c.lineTo(10, 11); c.lineTo(0, 5); c.lineTo(-10, 11); c.closePath(); c.fill(); c.stroke();
    c.restore();
    const t = this.el.mapTravel;
    t.innerHTML = '';
    for (const f of FAST_TRAVEL) {
      const b = document.createElement('button');
      b.className = 'btn small'; b.innerHTML = `<span>${f.label}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.click(); g.teleport(f.x, f.z, f.yaw, !!f.deck); this.closeMap(); });
      t.appendChild(b);
    }
  }

  closeMap() {
    this.el.map.classList.add('hidden');
    this.mapOpen = false;
    this.game.setPaused(false, true);
  }

  // ---------- HUD ----------
  update(dt) {
    const g = this.game, p = g.player, el = this.el;
    this.frame++;
    el.speed.textContent = Math.round(p.speed * 3.6);
    el.score.textContent = g.tricks.total.toLocaleString();
    if (this.frame % 15 === 0) el.zone.textContent = g.zoneName();
    // combo
    const c = g.tricks.comboText();
    if (c) {
      el.combo.classList.add('on');
      if (c.text !== this._ct) { el.comboText.textContent = c.text; this._ct = c.text; }
      el.comboScore.innerHTML = `${c.base.toLocaleString()} <em>×${c.mult}</em>`;
    } else el.combo.classList.remove('on');
    // balance meter
    const bal = p.grind ? p.grind.bal : p.manual ? p.manual.bal : null;
    el.balance.classList.toggle('hidden', bal === null);
    if (bal !== null) {
      const i = el.balance.firstElementChild;
      i.style.left = `${50 + clamp(bal, -1, 1) * 50}%`;
      i.style.background = Math.abs(bal) > 0.7 ? '#ff3b3b' : Math.abs(bal) > 0.4 ? '#ffd21f' : '#57e08a';
      el.balance.lastElementChild.textContent = p.grind ? 'Balance  A / D' : 'Balance  W / S';
    }
    // course
    const r = g.courses.run;
    el.course.classList.toggle('on', !!r);
    el.compass.classList.toggle('on', !!(r && r.course.type === 'gates' && r.state === 'running'));
    if (r) {
      el.cname.textContent = r.course.name + (r.opts.race ? ' · RACE' : '');
      if (r.course.type === 'score') {
        el.ctime.textContent = r.state === 'running' ? Math.max(0, r.course.duration - r.time).toFixed(1) : r.course.duration.toFixed(1);
        el.csub.textContent = `${(g.tricks.total - r.startScore).toLocaleString()} pts · gold ${r.course.par[2].toLocaleString()}`;
      } else {
        el.ctime.textContent = formatTime(r.time);
        el.csub.textContent = `Gate ${Math.min(r.idx + 1, r.course.gates.length)} / ${r.course.gates.length}${g.courses.best[r.course.id] ? ' · PB ' + formatTime(g.courses.best[r.course.id]) : ''}`;
        const ng = g.courses.nextGate();
        if (ng) {
          const cam = g.camera;
          const ang = Math.atan2(ng.x - cam.position.x, ng.z - cam.position.z);
          const cf = g.cam.yaw + g.cam.orbitYaw;
          const rel = -(ang - cf);
          el.compass.firstElementChild.style.transform = `rotate(${rel}rad)`;
        }
      }
    }
    // prompt
    const pr = g.promptText();
    el.prompt.classList.toggle('hidden', !pr);
    if (pr && pr !== this._pr) { el.prompt.innerHTML = pr; this._pr = pr; }
    if (this.frame % 2 === 0 && !this.game.touchSmall) this.drawMinimap();
    // scoreboard
    const showSB = g.input.state.scoreHeld;
    el.scoreboard.classList.toggle('hidden', !showSB);
    if (showSB && this.frame % 10 === 0) this.renderScoreboard();
    // fps
    this.fpsAcc.t += dt; this.fpsAcc.n++;
    if (this.fpsAcc.t > 0.5) { el.fps.textContent = `${Math.round(this.fpsAcc.n / this.fpsAcc.t)} fps`; this.fpsAcc.t = 0; this.fpsAcc.n = 0; }
  }

  renderScoreboard() {
    const g = this.game;
    const rows = [{ name: g.settings.name + ' (you)', score: g.tricks.total, color: g.settings.colors.frame }];
    for (const p of g.net.players.values()) rows.push({ name: p.name, score: p.score || 0, color: p.colors.frame });
    rows.sort((a, b) => b.score - a.score);
    this.el.scoreboard.innerHTML = `<h3>${g.net.online ? 'Room ' + g.net.code : 'Session'}</h3><table>${rows.map((r) => `<tr><td><b style="color:${r.color}">■</b> ${esc(r.name)}</td><td>${r.score.toLocaleString()}</td></tr>`).join('')}</table>`;
  }

  toast(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 4100);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  feed(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.el.feed.prepend(d);
    setTimeout(() => d.remove(), 5100);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
  }

  bigText(t) {
    const b = this.el.big;
    b.textContent = t;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  bankPop(text, lost = false) {
    const b = this.el.bank;
    b.textContent = text;
    b.classList.toggle('lost', lost);
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  courseStart(c) { this.el.result.classList.add('hidden'); this.toast(`${c.name} — ${c.type === 'score' ? 'score as much as you can!' : 'hit every gate'}`); }

  courseEnd(res) {
    const el = this.el.result;
    if (!res) { el.classList.add('hidden'); return; }
    const { course, result, medal, isBest, race } = res;
    const val = course.type === 'score' ? result.toLocaleString() : formatTime(result);
    el.innerHTML = `<h3>${esc(course.name)}</h3><div class="big">${val}</div>
      ${medal ? `<div class="medal" style="background:${MEDAL_C[medal]}">${MEDAL[medal]}</div>` : `<div class="muted">Next medal: ${course.type === 'score' ? course.par[0].toLocaleString() : formatTime(course.par[0])}</div>`}
      ${isBest ? '<div style="color:#57e08a;font-weight:800;text-transform:uppercase;letter-spacing:.08em">New personal best</div>' : ''}
      ${race ? '<div class="muted">Waiting for other riders…</div><div data-bind="race"></div>' : ''}
      <div class="row"><button class="btn primary" id="res-again"><span>Again</span></button><button class="btn ghost" id="res-close"><span>Ride on</span></button></div>`;
    el.classList.remove('hidden');
    el.querySelector('#res-again').onclick = () => { this.click(); el.classList.add('hidden'); this.game.courses.start(course); };
    el.querySelector('#res-close').onclick = () => { this.click(); el.classList.add('hidden'); };
    clearTimeout(this._resT);
    this._resT = setTimeout(() => el.classList.add('hidden'), race ? 30000 : 12000);
  }

  raceResults(m) {
    const el = this.el.result;
    const c = this.game.courses.list.find((x) => x.id === m.course);
    const html = `<h3>Race · ${esc(c ? c.name : m.course)}</h3><table>${m.list.map((r, i) => `<tr><td>${i + 1}.</td><td>${esc(r.name)}</td><td>${formatTime(r.time)}</td></tr>`).join('')}</table>
      <div class="row"><button class="btn ghost" id="res-close"><span>Close</span></button></div>`;
    el.innerHTML = html;
    el.classList.remove('hidden');
    el.querySelector('#res-close').onclick = () => el.classList.add('hidden');
    clearTimeout(this._resT);
    this._resT = setTimeout(() => el.classList.add('hidden'), 20000);
  }

  netStatus() {
    const n = this.game.net;
    this.el.netBadge.classList.toggle('hidden', !n.online);
    if (n.online) this.el.netBadge.textContent = `Room ${n.code} · ${n.players.size + 1} online${n.rtt ? ' · ' + n.rtt + 'ms' : ''}`;
    if (this.panelOpen && this.panelOpen.startsWith('mp')) this.renderMp();
  }

  // ---------- chat ----------
  bindChat() {
    const inp = this.el.chatInput;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = inp.value.trim();
        if (t) {
          this.chatLine(this.game.settings.name, t, this.game.settings.colors.frame);
          this.game.net.send({ t: 'chat', text: t.slice(0, 120) });
        }
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
  }
  openChat() {
    if (!this.game.net.online) { this.toast('Join a multiplayer room to chat'); return; }
    this.el.chatInput.classList.remove('hidden');
    this.el.chatInput.value = '';
    this.el.chatInput.focus();
    this.game.input.enabled = false;
  }
  closeChat() { this.el.chatInput.classList.add('hidden'); this.el.chatInput.blur(); this.game.input.enabled = true; this.game.input.keys.clear(); }
  chatLine(name, text, color = '#fff') {
    const d = document.createElement('div');
    d.innerHTML = `<b style="color:${color}">${esc(name)}</b>${esc(text)}`;
    this.el.chatLog.appendChild(d);
    setTimeout(() => d.remove(), 12100);
    while (this.el.chatLog.children.length > 6) this.el.chatLog.firstChild.remove();
  }

  // ---------- touch ----------
  setupTouch(input) {
    const root = $('#touch');
    root.classList.remove('hidden');
    const t = input.touch;
    t.active = true;
    const stick = $('#stick'), knob = stick.firstElementChild;
    let sid = null, cx = 0, cy = 0;
    stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; stick.setPointerCapture(sid); move(e); });
    const move = (e) => {
      if (e.pointerId !== sid) return;
      let dx = (e.clientX - cx) / 60, dy = (e.clientY - cy) / 60;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      t.steer = dx; t.fwd = -dy;
      knob.style.transform = `translate(${dx * 45}px, ${dy * 45}px)`;
    };
    stick.addEventListener('pointermove', move);
    const end = (e) => { if (e.pointerId !== sid) return; sid = null; t.steer = 0; t.fwd = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    root.querySelectorAll('[data-t]').forEach((b) => {
      const k = b.dataset.t;
      const set = (v) => { b.classList.toggle('on', v); if (k === 'hop') t.hop = v; else if (k === 'manual') t.manual = v; else t.tricks[k] = v; };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); set(true); });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
    });
    root.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); t.buttons[b.dataset.b] = true; }));
    const auto = root.querySelector('[data-auto]');
    auto.addEventListener('pointerdown', (e) => { e.preventDefault(); t.autoPedal = !t.autoPedal; auto.classList.toggle('on', t.autoPedal); });
    // camera drag on the right half
    let did = null, lx = 0, ly = 0;
    document.getElementById('game').addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { did = e.pointerId; lx = e.clientX; ly = e.clientY; } });
    window.addEventListener('pointermove', (e) => { if (e.pointerId === did) { input.mouse.dx += (e.clientX - lx) * 1.5; input.mouse.dy += (e.clientY - ly) * 1.5; lx = e.clientX; ly = e.clientY; } });
    window.addEventListener('pointerup', (e) => { if (e.pointerId === did) did = null; });
  }
  showTouch(on) { const r = $('#touch'); if (this.game.touch) r.classList.toggle('hidden', !on); }
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

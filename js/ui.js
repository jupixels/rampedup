// DOM UI: menus, panels, HUD, minimap, big map, chat, touch controls.
import { ZONES, FAST_TRAVEL, WORLD, LAKE } from './layout.js';
import { CHALLENGES } from './courses.js';
import { formatTime, clamp, store } from './util.js';
import { TRICK_LIST } from './input.js';
import { UNLOCKS, BASE, xpForLevel } from './progress.js';

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
  startTips() {
    const tips = [
      ['Pop', 'Let go of Space right as you leave a lip to jump higher.'],
      ['Vert', 'On quarter pipes you turn around in the air on your own. Spin input adds to it.'],
      ['Combos', 'Land an air straight into a manual to keep the combo going.'],
      ['Perfect', 'Land smoothly on a downslope for a Perfect Landing bonus and a little extra speed.'],
      ['Grinds', 'Hold W, S or A/D as you lock onto a rail to pick Icepick, Feeble or Smith.'],
      ['Ghosts', 'Your best run on every course comes back as a ghost to race.'],
      ['Sprockets', 'Some golden sprockets float over gaps. You have to jump for them.'],
      ['Photo mode', 'Press P to freeze the moment and line up the perfect shot.'],
      ['Lift', 'Ride up to the glowing pad at Big Air and press E to reach the top of the mega ramp.'],
      ['Bails', 'Press Space or R to get back on straight after a crash.'],
      ['Friends', 'Host a room and send the invite link. The host can start races.'],
    ];
    const el = document.getElementById('load-tip');
    let i = Math.floor(Math.random() * tips.length);
    const show = () => { const [h, t] = tips[i++ % tips.length]; el.innerHTML = `<b>${h}</b>${t}`; };
    show();
    this._tipT = setInterval(show, 3200);
  }

  loading(text, p) { if (location.search.includes('debug')) console.log('[load]', text, Math.round(performance.now())); this.el.loadText.textContent = text; this.el.loadFill.style.width = `${Math.round(p * 100)}%`; }
  error(msg) { this.el.loadError.innerHTML = msg; this.el.loadError.classList.remove('hidden'); this.el.loadText.textContent = 'Something went wrong'; }
  hideLoading() { this.el.loading.classList.add('hidden'); clearInterval(this._tipT); }

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
      case 'tutorial': this.closePanels(); this.showPause(false); this.el.menu.classList.add('hidden'); this.el.hud.classList.remove('hidden'); g.tutorial.start(); break;
      case 'resume': g.setPaused(false); break;
      case 'openmap': this.openMap(); break;
      case 'closemap': this.closeMap(); break;
      case 'quitcourse': g.courses.cancel(); g.setPaused(false); break;
      case 'photo': g.setPaused(false); g.photo.enter(); break;
      case 'quitmenu': g.quitToMenu(); break;
      case 'resetprogress': {
        if (b.dataset.armed) {
          ['xp', 'best', 'medals', 'challenges', 'sprockets', 'tutorialDone'].forEach((k) => { try { localStorage.removeItem('rampedup.' + k); } catch (e) {} });
          Object.keys(localStorage).filter((k) => k.startsWith('rampedup.ghost.')).forEach((k) => localStorage.removeItem(k));
          location.reload();
        } else { b.dataset.armed = '1'; b.innerHTML = '<span>Click again to erase everything</span>'; }
        break;
      }
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
    const fn = { mp: 'renderMp', courses: 'renderCourses', customize: 'renderCustomize', settings: 'renderSettings', controls: 'renderGuide' }[name];
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
    const p = this.panelEl, s = this.game.settings, prog = this.game.progress;
    const name = p.querySelector('[data-bind=name]');
    name.value = s.name;
    name.addEventListener('input', () => { s.name = name.value.trim() || 'Rider'; this.game.saveSettings(); });
    p.querySelectorAll('.swatch-group').forEach((grp) => {
      const part = grp.dataset.part;
      const box = grp.querySelector('.swatches');
      const items = [...(PALETTES[part] || BASE[part] || []).map((v) => ({ value: v })), ...UNLOCKS.filter((u) => u.part === part)];
      for (const it of items) {
        const b = document.createElement('button');
        b.style.background = it.finish === 'chrome' ? 'linear-gradient(135deg,#fff,#8d939b 45%,#f4f4f4 55%,#6b7178)' : it.finish === 'gold' || it.finish === 'metal' && it.value === '#d4af37' ? 'linear-gradient(135deg,#fff3b0,#b8862b 50%,#ffe28a)' : it.finish === 'oilslick' ? 'conic-gradient(#7b5cff,#3fd4ff,#57e08a,#ffd21f,#ff5fa2,#7b5cff)' : it.value;
        const locked = it.level && it.level > prog.level;
        b.title = it.label ? `${it.label}${locked ? ` · unlocks at level ${it.level}` : ''}` : it.value;
        b.setAttribute('aria-label', b.title);
        if (locked) { b.classList.add('locked'); b.dataset.lv = `LV ${it.level}`; }
        const cur = s.colors[part] === it.value && (s.colors[part + 'Finish'] || null) === (it.finish || null);
        if (cur) b.classList.add('sel');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (locked) { this.toast(`${it.label} unlocks at level ${it.level}`); this.game.audio.play('fail'); return; }
          s.colors[part] = it.value;
          s.colors[part + 'Finish'] = it.finish || null;
          box.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
          this.game.player.model.setColors(s.colors);
          this.game.saveSettings();
          this.click();
        });
        box.appendChild(b);
      }
    });
    const next = UNLOCKS.find((u) => u.level > prog.level);
    p.querySelector('[data-bind=unlockhint]').textContent = next ? `Level ${prog.level}. Next unlock at level ${next.level}: ${next.label}. Earn XP by banking combos, finishing courses and finding sprockets.` : `Level ${prog.level}. Everything is unlocked.`;
    this.game.focusRider = true;
  }

  renderGuide() {
    const box = this.panelEl.querySelector('[data-bind=spots]');
    for (const z of Object.values(ZONES)) {
      const d = document.createElement('div');
      d.innerHTML = `<i style="background:${z.color}"></i><b>${z.name}</b><span>${z.blurb}</span>`;
      box.appendChild(d);
    }
    // in-panel jump links scroll the panel instead of changing the page URL
    this.panelEl.querySelectorAll('.guide-nav a').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.panelEl.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  markTutorialDone() {
    document.querySelector('#btn-tutorial .badge')?.remove();
  }

  renderSettings() {
    const p = this.panelEl, s = this.game.settings, g = this.game;
    const bind = (key, get, set, ev = 'input') => {
      const el = p.querySelector(`[data-bind=${key}]`);
      if (el.type === 'checkbox') el.checked = !!get(); else el.value = get();
      el.addEventListener(ev, () => { set(el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value); g.saveSettings(); g.applySettings(); this.applyPrefs(); });
    };
    bind('quality', () => s.quality, (v) => { s.quality = v; g.saveSettings(); this.toast('Reload the page to apply the new quality'); }, 'change');
    bind('time', () => s.time, (v) => { s.time = v; g.env.setTime(v); }, 'change');
    bind('volume', () => g.audio.volume, (v) => g.audio.setVolume(v));
    bind('music', () => g.audio.musicVol, (v) => g.audio.setMusicVolume(v));
    bind('sfx', () => g.audio.sfxVol, (v) => g.audio.setSfxVolume(v));
    bind('mute', () => g.audio.muted, (v) => { if (v !== g.audio.muted) g.audio.toggleMute(); }, 'change');
    bind('camdist', () => s.camDist, (v) => { s.camDist = v; });
    bind('fov', () => s.fov, (v) => { s.fov = v; });
    bind('sens', () => s.sens, (v) => { s.sens = v; });
    bind('invert', () => s.invert, (v) => { s.invert = v; }, 'change');
    bind('reduce', () => s.reduceMotion, (v) => { s.reduceMotion = v; }, 'change');
    bind('mph', () => s.mph, (v) => { s.mph = v; }, 'change');
    bind('minimap', () => s.minimap !== false, (v) => { s.minimap = v; }, 'change');
    bind('hints', () => s.hints !== false, (v) => { s.hints = v; }, 'change');
    bind('fps', () => s.fps, (v) => { s.fps = v; }, 'change');
  }

  applyPrefs() {
    const s = this.game.settings || {};
    this.el.fps.classList.toggle('hidden', !s.fps);
    this.el.hints.classList.toggle('hidden', s.hints === false || this.game.touch);
    this.el.minimap.classList.toggle('hidden', s.minimap === false);
    document.querySelector('.speed small').textContent = s.mph ? 'mph' : 'km/h';
  }

  showMenu() {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    const C = this.game.courses;
    $('#menu-stats').innerHTML = `<span class="lvl">Level ${this.game.progress.level}</span>` + `Sprockets ${C.found.size}/${C.sprockets.length} · Challenges ${C.done.size}/${CHALLENGES.length}`;
  }
  hideMenu() { this.el.menu.classList.add('hidden'); this.closePanels(); this.el.hud.classList.remove('hidden'); }
  showPause(on) {
    this.el.pause.classList.toggle('hidden', !on);
    $('#btn-quitcourse').classList.toggle('hidden', !this.game.courses.run);
    if (!on) { this.closePanels(); this.game.focusRider = false; }
  }

  // ---------- gamepad menu navigation ----------
  menuNav(nav) {
    if (!nav) return;
    const g = this.game;
    const screens = [this.el.map, document.getElementById('photo'), this.el.pause, this.el.menu, this.el.result];
    const scr = screens.find((x) => x && !x.classList.contains('hidden') && x.offsetParent !== null);
    if (!scr) return;
    const items = [...scr.querySelectorAll('button, input, select')].filter((x) => x.offsetParent !== null && !x.disabled);
    if (!items.length) return;
    let i = items.indexOf(document.activeElement);
    const focus = (j) => { const el = items[(j + items.length) % items.length]; el.focus({ preventScroll: false }); el.scrollIntoView?.({ block: 'nearest' }); this.audio?.(); };
    const cur = items[i];
    if (nav.down) focus(i < 0 ? 0 : i + 1);
    if (nav.up) focus(i < 0 ? 0 : i - 1);
    if ((nav.left || nav.right) && cur && cur.type === 'range') {
      const st = +cur.step || 0.05;
      cur.value = +cur.value + (nav.right ? st : -st);
      cur.dispatchEvent(new Event('input', { bubbles: true }));
    } else if ((nav.left || nav.right) && cur && cur.tagName === 'SELECT') {
      cur.selectedIndex = Math.max(0, Math.min(cur.options.length - 1, cur.selectedIndex + (nav.right ? 1 : -1)));
      cur.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (nav.right) focus(i + 1);
    else if (nav.left) focus(i - 1);
    if (nav.ok && cur) { if (cur.type === 'checkbox') { cur.checked = !cur.checked; cur.dispatchEvent(new Event('change', { bubbles: true })); } else cur.click(); }
    if (nav.back) {
      if (this.mapOpen) this.closeMap();
      else if (g.photo?.active) g.photo.exit();
      else if (this.panelOpen) this.closePanels();
      else if (g.playing && g.paused) g.setPaused(false);
    }
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
    if (!this.mapImg) this.buildMapImage();
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
    // only touch the DOM when something changed: layout work every frame adds up
    const cache = this._dom || (this._dom = new Map());
    const set = (node, v, html = false) => { if (cache.get(node) === v) return; cache.set(node, v); if (html) node.innerHTML = v; else node.textContent = v; };
    const cls = (node, c, on) => { const k = c + '|'; const key = node; const prev = cache.get(k + (node.id || '')); if (prev === on) return; cache.set(k + (node.id || ''), on); node.classList.toggle(c, on); };
    set(el.speed, String(Math.round(p.speed * (g.settings.mph ? 2.237 : 3.6))));
    if (this.frame % 10 === 0) {
      set(this.lvlEl || (this.lvlEl = document.getElementById('hud-level')), `Lv ${g.progress.level}`);
      const w = `${Math.round(g.progress.frac() * 100)}%`;
      const xb = this.xpBar || (this.xpBar = document.getElementById('hud-xp'));
      if (xb.style.width !== w) xb.style.width = w;
    }
    // combo timer: how long until the combo banks
    const ct = this.comboTimer || (this.comboTimer = document.getElementById('hud-combo-timer'));
    const cfrac = g.tricks.combo && p.mode === 'ground' && !p.manual ? Math.max(0, 1 - g.tricks.idle / 0.75) : 1;
    const ctv = cfrac.toFixed(2);
    if (cache.get('ct') !== ctv) { cache.set('ct', ctv); ct.style.transform = `scaleX(${ctv})`; }
    set(el.score, g.tricks.total.toLocaleString());
    if (this.frame % 15 === 0) set(el.zone, g.zoneName());
    // combo
    const c = g.tricks.comboText();
    if (c) {
      cls(el.combo, 'on', true);
      set(el.comboText, c.text);
      set(el.comboScore, `${c.base.toLocaleString()} <em>×${c.mult}</em>`, true);
    } else cls(el.combo, 'on', false);
    // balance meter
    const bal = p.grind ? p.grind.bal : p.manual ? p.manual.bal : null;
    cls(el.balance, 'hidden', bal === null);
    if (bal !== null) {
      const i = el.balance.firstElementChild;
      i.style.transform = `translateX(${(clamp(bal, -1, 1) * 130).toFixed(1)}px)`;
      const col = Math.abs(bal) > 0.7 ? '#ff3b3b' : Math.abs(bal) > 0.4 ? '#ffd21f' : '#57e08a';
      if (cache.get('balcol') !== col) { cache.set('balcol', col); i.style.background = col; }
      set(el.balance.lastElementChild, p.grind ? 'Balance  A / D' : 'Balance  W / S');
    }
    // course
    const r = g.courses.run;
    cls(el.course, 'on', !!r);
    cls(el.compass, 'on', !!(r && r.course.type === 'gates' && r.state === 'running'));
    if (r) {
      set(el.cname, r.course.name + (r.opts.race ? ' · RACE' : ''));
      if (r.course.type === 'score') {
        set(el.ctime, r.state === 'running' ? Math.max(0, r.course.duration - r.time).toFixed(1) : r.course.duration.toFixed(1));
        set(el.csub, `${(g.tricks.total - r.startScore).toLocaleString()} pts · gold ${r.course.par[2].toLocaleString()}`);
      } else {
        set(el.ctime, formatTime(r.time));
        set(el.csub, `Gate ${Math.min(r.idx + 1, r.course.gates.length)} / ${r.course.gates.length}${g.courses.best[r.course.id] ? ' · PB ' + formatTime(g.courses.best[r.course.id]) : ''}`);
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
    cls(el.prompt, 'hidden', !pr);
    if (pr) set(el.prompt, pr, true);
    if (this.frame % 3 === 0 && g.settings.minimap !== false) this.drawMinimap();
    // scoreboard
    const showSB = g.input.state.scoreHeld;
    cls(el.scoreboard, 'hidden', !showSB);
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

  xpGain(amount, reason) {
    const el = document.getElementById('hud-xpgain');
    this._xpAcc = (this._xpShow ? this._xpAcc : 0) + amount;
    this._xpShow = true;
    el.textContent = `+${this._xpAcc.toLocaleString()} XP${reason ? ' · ' + reason : ''}`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this._xpT);
    this._xpT = setTimeout(() => { this._xpShow = false; }, 1500);
  }

  levelUp(level, unlocked) {
    const el = document.getElementById('levelup');
    el.innerHTML = `<p>Level up</p><h3>Level ${level}</h3>${unlocked.length ? `<ul>${unlocked.map((u) => `<li>${esc(u.label)}</li>`).join('')}</ul><p class="muted small">Equip in Customize</p>` : ''}`;
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this._lvT);
    this._lvT = setTimeout(() => el.classList.add('hidden'), 4300);
  }

  bailCaption(title, sub = '') {
    const el = document.getElementById('hud-bail');
    if (title) {
      el.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span><small>Space or R to get back on</small>`;
      el.classList.remove('show', 'sub'); void el.offsetWidth; el.classList.add('show');
    } else if (sub) {
      el.innerHTML = `<span>${esc(sub)}</span>`;
      el.classList.remove('show'); void el.offsetWidth; el.classList.add('show', 'sub');
    }
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

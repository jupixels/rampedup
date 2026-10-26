// Peer-to-peer multiplayer over WebRTC (PeerJS). No game server needed, so it
// works on GitHub Pages. One player hosts a room (star topology, host relays);
// everyone else joins with the room code. "Quick Join" uses a shared public room.
import * as THREE from 'three';
import { RiderBike } from './bikeModel.js';
import { applySnapshot } from './courses.js';

const PREFIX = 'rampedup-v1-';
const PUBLIC = 'PUBLIC';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SEND_HZ = 15;
const INTERP_DELAY = 120;

export function randomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}

export class Net {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.isHost = false;
    this.code = null;
    this.conns = new Map();     // host: peerId -> conn
    this.hostConn = null;       // client: connection to host
    this.players = new Map();   // id -> remote player
    this.myId = null;
    this.offset = 0;            // host clock - local clock
    this.sendT = 0;
    this.status = 'offline';
    this.raceResults = null;
  }

  get online() { return this.status === 'host' || this.status === 'client'; }
  now() { return Date.now() + this.offset; }

  profile() {
    const s = this.game.settings;
    return { name: s.name, colors: s.colors };
  }

  makePeer(id) {
    if (!window.Peer) throw new Error('PeerJS failed to load');
    const opts = { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] } };
    // Optional self-hosted signalling server: ?peerhost=example.com&peerport=443&peerpath=/myapp
    const q = new URLSearchParams(location.search);
    if (q.get('peerhost')) {
      opts.host = q.get('peerhost');
      opts.port = +(q.get('peerport') || 443);
      opts.path = q.get('peerpath') || '/';
      opts.secure = q.get('peersecure') ? q.get('peersecure') !== '0' : opts.port === 443;
    }
    return new window.Peer(id, opts);
  }

  async host(code = randomCode()) {
    await this.leave(true);
    return new Promise((resolve, reject) => {
      const peer = this.makePeer(PREFIX + code);
      this.peer = peer;
      const fail = (e) => { reject(e); };
      peer.on('open', (id) => {
        this.isHost = true; this.code = code; this.myId = id; this.status = 'host';
        this.offset = 0;
        peer.off('error', fail);
        peer.on('error', (e) => this.onPeerError(e));
        this.game.ui.netStatus();
        resolve(code);
      });
      peer.on('error', fail);
      peer.on('connection', (conn) => this.acceptConn(conn));
    });
  }

  async join(code) {
    await this.leave(true);
    return new Promise((resolve, reject) => {
      const peer = this.makePeer();
      this.peer = peer;
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')); } }, 12000);
      peer.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } else this.onPeerError(e); });
      peer.on('open', (id) => {
        this.myId = id;
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          this.hostConn = conn; this.code = code; this.isHost = false; this.status = 'client';
          conn.send({ t: 'hello', ...this.profile() });
          this.ping();
          if (!done) { done = true; clearTimeout(timer); resolve(code); }
          this.game.ui.netStatus();
        });
        conn.on('data', (m) => this.onMessage(m, conn));
        conn.on('close', () => this.onHostLost());
        conn.on('error', () => {});
      });
    });
  }

  async quickJoin() {
    try { return await this.join(PUBLIC); }
    catch (e) {
      if (e && (e.type === 'peer-unavailable' || e.message === 'timeout')) {
        try { return await this.host(PUBLIC); }
        catch (e2) { if (e2 && e2.type === 'unavailable-id') return await this.join(PUBLIC); throw e2; }
      }
      throw e;
    }
  }

  async leave(silent = false) {
    for (const c of this.conns.values()) try { c.close(); } catch (e) {}
    this.conns.clear();
    if (this.hostConn) { const h = this.hostConn; this.hostConn = null; try { h.close(); } catch (e) {} }
    if (this.peer) { const p = this.peer; this.peer = null; try { p.destroy(); } catch (e) {} }
    for (const id of [...this.players.keys()]) this.removePlayer(id, true);
    this.isHost = false;
    this.status = 'offline';
    this.code = null;
    if (!silent) this.game.ui.netStatus();
  }

  onPeerError(e) {
    console.warn('peer error', e && e.type, e);
    if (e && e.type === 'network') this.game.ui.toast('Network hiccup – reconnecting…');
  }

  // ---------- host side ----------
  acceptConn(conn) {
    conn.on('open', () => { this.conns.set(conn.peer, conn); });
    conn.on('data', (m) => this.onMessage(m, conn));
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      if (this.players.has(conn.peer)) {
        const p = this.players.get(conn.peer);
        this.broadcast({ t: 'leave', id: conn.peer });
        this.removePlayer(conn.peer);
        this.game.ui.toast(`${p.name} left`);
      }
    });
    conn.on('error', () => {});
  }

  broadcast(m, except = null) {
    for (const [id, c] of this.conns) if (id !== except && c.open) try { c.send(m); } catch (e) {}
  }

  send(m) {
    if (this.isHost) this.broadcast({ ...m, id: this.myId });
    else if (this.hostConn && this.hostConn.open) try { this.hostConn.send(m); } catch (e) {}
  }

  // ---------- messages ----------
  onMessage(m, conn) {
    if (!m || !m.t) return;
    const from = this.isHost ? conn.peer : (m.id || null);
    switch (m.t) {
      case 'hello': {
        if (!this.isHost) return;
        const list = [{ id: this.myId, ...this.profile(), score: this.game.tricks.total }];
        for (const [id, p] of this.players) list.push({ id, name: p.name, colors: p.colors, score: p.score });
        conn.send({ t: 'welcome', you: conn.peer, players: list, hostTime: Date.now() });
        this.addPlayer(conn.peer, m.name, m.colors);
        this.broadcast({ t: 'join', id: conn.peer, name: m.name, colors: m.colors }, conn.peer);
        break;
      }
      case 'welcome':
        for (const p of m.players) if (p.id !== this.myId) this.addPlayer(p.id, p.name, p.colors, p.score, true);
        this.game.ui.toast(`Joined room ${this.code} · ${m.players.length + 0} riders`);
        break;
      case 'join': if (m.id !== this.myId) this.addPlayer(m.id, m.name, m.colors); break;
      case 'leave': this.removePlayer(m.id); break;
      case 'ping': if (this.isHost) conn.send({ t: 'pong', c: m.c, h: Date.now() }); break;
      case 'pong': {
        const now = Date.now();
        const rtt = now - m.c;
        this.rtt = rtt;
        this.offset = m.h - (m.c + rtt / 2);
        break;
      }
      case 's': {
        const id = this.isHost ? conn.peer : m.id;
        const p = this.players.get(id);
        if (p) { p.buf.push({ t: performance.now(), d: m.d }); if (p.buf.length > 30) p.buf.shift(); p.lastSeen = performance.now(); }
        if (this.isHost) this.broadcast({ t: 's', id, d: m.d }, id);
        break;
      }
      case 'chat': case 'feed': case 'score': {
        const id = this.isHost ? conn.peer : m.id;
        const p = this.players.get(id);
        if (m.t === 'chat') this.game.ui.chatLine(p ? p.name : '?', m.text, p ? p.colors.frame : '#fff');
        if (m.t === 'feed' && p) this.game.ui.feed(`${p.name} ${m.text}`);
        if (m.t === 'score' && p) p.score = m.total;
        if (this.isHost) this.broadcast({ ...m, id }, id);
        break;
      }
      case 'race':
        this.raceResults = { course: m.course, list: [] };
        this.game.startRace(m.course, m.startAt);
        break;
      case 'fin': {
        if (!this.isHost) return;
        this.recordFinish(conn.peer, m.course, m.time);
        break;
      }
      case 'results':
        this.raceResults = m;
        this.game.ui.raceResults(m);
        break;
    }
  }

  ping() {
    if (this.hostConn && this.hostConn.open) this.hostConn.send({ t: 'ping', c: Date.now() });
  }

  addPlayer(id, name, colors, score = 0, quiet = false) {
    if (this.players.has(id) || id === this.myId) return;
    const model = new RiderBike(colors);
    model.setNameTag(name, colors.frame);
    this.game.scene.add(model.root);
    this.players.set(id, { id, name, colors, model, buf: [], score, lastSeen: performance.now() });
    if (!quiet) { this.game.ui.toast(`${name} joined`); this.game.audio.play('join'); }
    this.game.ui.netStatus();
  }

  removePlayer(id, quiet = false) {
    const p = this.players.get(id);
    if (!p) return;
    this.game.scene.remove(p.model.root);
    this.players.delete(id);
    if (!quiet) this.game.ui.netStatus();
  }

  async onHostLost() {
    if (this.status !== 'client') return;
    const code = this.code;
    this.game.ui.toast('Host left – taking over the room…');
    for (const id of [...this.players.keys()]) this.removePlayer(id, true);
    this.hostConn = null;
    // the earliest-sorted remaining peer is likely to win; random back-off to avoid clashes
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 1500));
    try { await this.host(code); this.game.ui.toast(`You are now hosting ${code}`); }
    catch (e) {
      try { await this.join(code); } catch (e2) { this.game.ui.toast('Lost connection to the room'); this.leave(); }
    }
  }

  // ---------- races ----------
  startRace(courseId) {
    if (!this.isHost) return;
    const startAt = Date.now() + 6000;
    this.raceResults = { course: courseId, list: [] };
    this.broadcast({ t: 'race', course: courseId, startAt, id: this.myId });
    this.game.startRace(courseId, startAt);
  }

  sendFinish(course, time) {
    if (!this.online) return;
    if (this.isHost) this.recordFinish(this.myId, course, time);
    else this.send({ t: 'fin', course, time });
  }

  recordFinish(id, course, time) {
    const r = this.raceResults;
    if (!r || r.course !== course) return;
    const name = id === this.myId ? this.game.settings.name : (this.players.get(id) || {}).name || '?';
    if (r.list.some((x) => x.id === id)) return;
    r.list.push({ id, name, time });
    r.list.sort((a, b) => a.time - b.time);
    const msg = { t: 'results', course, list: r.list };
    this.broadcast(msg);
    this.game.ui.raceResults(msg);
  }

  // ---------- per frame ----------
  update(dt) {
    if (!this.online) return;
    this.sendT += dt;
    if (this.sendT >= 1 / SEND_HZ) {
      this.sendT = 0;
      this.send({ t: 's', d: this.game.player.snapshot() });
    }
    this.pingT = (this.pingT || 0) + dt;
    if (this.pingT > 5) { this.pingT = 0; this.ping(); }
    const renderT = performance.now() - INTERP_DELAY;
    for (const p of this.players.values()) {
      const b = p.buf;
      if (!b.length) continue;
      while (b.length > 2 && b[1].t <= renderT) b.shift();
      const a = b[0], c = b[1] || b[0];
      const t = c.t > a.t ? Math.min(1, Math.max(0, (renderT - a.t) / (c.t - a.t))) : 1;
      const bailed = c.d[20] === 1;
      p.model.rider.visible = !bailed;
      if (!bailed) applySnapshot(p.model, a.d, c.d, t);
      p.model.root.visible = performance.now() - p.lastSeen < 8000;
    }
  }
}

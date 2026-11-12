// Game of BIKE: one rider sets a trick, everyone else has to land the same trick or take a
// letter. Four letters (B-I-K-E) and you are out; the last rider standing wins.
// The host runs the game and broadcasts its state; everyone else just reports their landings.
import { safeName, safeText, safeNumber } from './util.js';

export const WORD = 'BIKE';
const SET_TIME = 35000, MATCH_TIME = 40000, MIN_PTS = 200;

export class BikeGame {
  constructor(game) {
    this.game = game;
    this.state = null;   // the shared state (host: source of truth; client: last broadcast)
    this.shownKey = '';
  }

  get net() { return this.game.net; }
  get active() { return !!this.state && this.state.phase !== 'over'; }

  // ---------- host ----------
  start() {
    const net = this.net;
    if (!net.isHost) return false;
    const order = [net.myId, ...net.players.keys()];
    if (order.length < 2) { this.game.ui.toast('Game of BIKE needs at least two riders'); return false; }
    const names = { [net.myId]: safeName(this.game.settings.name) };
    for (const [id, p] of net.players) names[id] = p.name;
    const letters = {}; for (const id of order) letters[id] = 0;
    this.state = { phase: 'set', order, names, letters, setter: order[0], trick: null, pending: [], deadline: net.now() + SET_TIME, winner: null, round: 1 };
    this.push('Game of BIKE! ' + names[order[0]] + ' sets the first trick');
    return true;
  }

  stop() {
    if (!this.state) return;
    if (this.net.isHost) { this.state.phase = 'over'; this.state.winner = null; this.push('Game of BIKE stopped'); }
    this.state = null;
  }

  alive() { const s = this.state; return s.order.filter((id) => s.letters[id] < WORD.length); }

  nextSetter() {
    const s = this.state, alive = this.alive();
    if (alive.length <= 1) { s.phase = 'over'; s.winner = alive[0] || null; s.trick = null; s.pending = []; return; }
    const i = s.order.indexOf(s.setter);
    for (let k = 1; k <= s.order.length; k++) {
      const id = s.order[(i + k) % s.order.length];
      if (s.letters[id] < WORD.length) { s.setter = id; break; }
    }
    s.phase = 'set'; s.trick = null; s.pending = []; s.deadline = this.net.now() + SET_TIME; s.round++;
  }

  // a rider landed a named trick (host receives this for every rider, itself included)
  onLanding(id, name, pts) {
    const s = this.state;
    if (!s || !this.net.isHost || s.phase === 'over') return;
    name = safeText(name, 60); pts = safeNumber(pts, 0, 1e7);
    if (!name) return;
    if (s.phase === 'set') {
      if (id !== s.setter || pts < MIN_PTS) return;
      s.trick = { name, pts: Math.round(pts) };
      s.pending = this.alive().filter((x) => x !== id);
      s.phase = 'match'; s.deadline = this.net.now() + MATCH_TIME;
      this.push(`${s.names[id]} set: ${name}`);
    } else if (s.phase === 'match') {
      if (!s.pending.includes(id) || name !== s.trick.name) return;
      s.pending = s.pending.filter((x) => x !== id);
      this.push(`${s.names[id]} matched it`);
      if (!s.pending.length) { this.nextSetter(); this.push(this.roundMsg()); }
    }
  }

  roundMsg() {
    const s = this.state;
    if (s.phase === 'over') return s.winner ? `${s.names[s.winner]} wins Game of BIKE!` : 'Game of BIKE over';
    return `${s.names[s.setter]} sets the next trick`;
  }

  onLeave(id) {
    const s = this.state;
    if (!s || !this.net.isHost || s.phase === 'over' || !s.order.includes(id)) return;
    s.letters[id] = WORD.length; // out
    s.pending = s.pending.filter((x) => x !== id);
    if (this.alive().length <= 1 || s.setter === id || (s.phase === 'match' && !s.pending.length)) this.nextSetter();
    this.push(this.roundMsg());
  }

  // host, every frame: time limits
  update() {
    const s = this.state;
    if (!s || !this.net.isHost || s.phase === 'over' || this.net.now() < s.deadline) return;
    if (s.phase === 'set') { this.nextSetter(); this.push(`Time's up. ${this.roundMsg()}`); return; }
    const got = [];
    for (const id of s.pending) { s.letters[id]++; got.push(`${s.names[id]}: ${WORD.slice(0, s.letters[id])}${s.letters[id] >= WORD.length ? ' (out)' : ''}`); }
    this.nextSetter();
    this.push(`${got.join(' · ')}. ${this.roundMsg()}`);
  }

  // host: send the state to everyone and show it locally
  push(msg) {
    const s = this.state;
    const out = { t: 'bike', s: s ? { ...s, msg } : null };
    this.net.broadcast({ ...out, id: this.net.myId });
    this.show(msg);
    if (s && s.phase === 'over') { const done = this.state; setTimeout(() => { if (this.state === done) this.state = null; }, 8000); }
  }

  // ---------- client ----------
  // state broadcast from the host
  onState(m) {
    const s = m && m.s;
    if (!s || typeof s !== 'object') { this.state = null; return; }
    const order = Array.isArray(s.order) ? s.order.filter((x) => typeof x === 'string').slice(0, 8) : [];
    const names = {}, letters = {};
    for (const id of order) { names[id] = safeName(s.names && s.names[id], '?'); letters[id] = safeNumber(s.letters && s.letters[id], 0, WORD.length, 0); }
    this.state = {
      phase: ['set', 'match', 'over'].includes(s.phase) ? s.phase : 'over', order, names, letters,
      setter: typeof s.setter === 'string' ? s.setter : null,
      trick: s.trick && typeof s.trick === 'object' ? { name: safeText(s.trick.name, 60), pts: safeNumber(s.trick.pts, 0, 1e7) } : null,
      pending: Array.isArray(s.pending) ? s.pending.filter((x) => typeof x === 'string').slice(0, 8) : [],
      deadline: safeNumber(s.deadline, 0, 1e15), winner: typeof s.winner === 'string' ? s.winner : null, round: safeNumber(s.round, 0, 999),
    };
    this.show(safeText(s.msg, 160));
    if (this.state.phase === 'over') { const done = this.state; setTimeout(() => { if (this.state === done) this.state = null; }, 8000); }
  }

  show(msg) {
    if (msg) { this.game.ui.toast(msg, 'challenge'); this.game.audio.play('gate'); }
  }

  // every rider: report a landing while a game is on
  reportLanding(name, pts) {
    if (!this.active || !name) return;
    const net = this.net;
    if (net.isHost) this.onLanding(net.myId, name, pts);
    else net.send({ t: 'bikeLand', name, pts });
  }

  // one line for the HUD, or null when no game is running
  hud() {
    const s = this.state;
    if (!s) return null;
    const me = this.net.myId;
    const left = Math.max(0, Math.ceil((s.deadline - this.net.now()) / 1000));
    const mine = s.order.includes(me) ? WORD.split('').map((c, i) => (i < s.letters[me] ? c : '·')).join(' ') : '';
    let line;
    if (s.phase === 'over') line = s.winner ? `${s.winner === me ? 'You win' : s.names[s.winner] + ' wins'} Game of BIKE!` : 'Game of BIKE over';
    else if (s.phase === 'set') line = s.setter === me ? `Your turn: land any trick to set it · ${left}s` : `${s.names[s.setter]} is setting a trick · ${left}s`;
    else if (s.pending.includes(me)) line = `Match it: ${s.trick.name} · ${left}s`;
    else line = `${s.trick.name} · waiting for ${s.pending.map((id) => s.names[id]).join(', ')} · ${left}s`;
    const board = s.order.map((id) => `${id === me ? 'You' : s.names[id]} ${WORD.slice(0, s.letters[id]) || '–'}`).join('   ');
    return { line, mine, board, out: s.order.includes(me) && s.letters[me] >= WORD.length };
  }
}

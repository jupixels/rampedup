// Interactive tutorial: a guided run of short goals that teaches the controls in-game.
import { store, wrapAngle } from './util.js';

// Pick the label for the player's current input device
function key(game, kb, pad, touch) {
  if (game.touch) return touch;
  if (game.input.padActive) return pad;
  return kb;
}
const kbd = (s) => s.split(' ').map((k) => `<kbd>${k}</kbd>`).join(' ');

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.el = document.getElementById('tutorial');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      game.audio.play('click');
      if (b.dataset.tut === 'skip') this.next(true);
      if (b.dataset.tut === 'exit') this.stop();
      if (b.dataset.tut === 'done') this.stop(true);
    });
    const g = game;
    const K = (kb, pad, touch) => key(g, kb, pad, touch);
    const yard = (x, z, yaw) => () => g.teleport(x, z, yaw);
    this.steps = [
      {
        title: 'Pedal',
        text: () => `Hold ${K(kbd('W'), kbd('RT'), 'the stick up')} to pedal. Get up to 20 km/h.`,
        setup: yard(0, 44, Math.PI),
        progress: () => Math.min(1, (g.player.speed * 3.6) / 20),
      },
      {
        title: 'Steer',
        text: () => `Steer with ${K(kbd('A') + ' ' + kbd('D'), 'the left stick', 'the stick')}. Turn all the way around.`,
        start: (s) => { s.last = g.player.heading; s.turned = 0; },
        tick: (s) => { if (g.player.mode === 'ground') s.turned += Math.abs(wrapAngle(g.player.heading - s.last)); s.last = g.player.heading; },
        progress: (s) => Math.min(1, s.turned / Math.PI),
      },
      {
        title: 'Brake',
        text: () => `Get rolling, then hold ${K(kbd('S'), kbd('LT'), 'the stick down')} to brake to a stop.`,
        start: (s) => { s.moving = false; },
        tick: (s) => { if (g.player.speed > 4) s.moving = true; },
        progress: (s) => (s.moving ? (g.player.speed < 0.4 ? 1 : 0.5) : Math.min(0.45, g.player.speed / 9)),
      },
      {
        title: 'Bunny hop',
        text: () => `Hold ${K(kbd('Space'), kbd('A'), 'HOP')} to crouch, let go to jump. The longer you hold, the higher you go. Hop 3 times.`,
        start: (s) => { s.n = 0; },
        on: { hop: (s) => { s.n++; } },
        progress: (s) => s.n / 3,
      },
      {
        title: 'Catch some air',
        text: () => `Pedal into the jump boxes. Tap ${K(kbd('Space'), kbd('A'), 'HOP')} right as you leave the lip to pop higher. Get half a second of air.`,
        setup: yard(56, 66, Math.PI),
        onTrick: { land: (s, e) => { if (e.air.t >= 0.5) s.done = true; } },
      },
      {
        title: 'Spin',
        text: () => `In the air, hold ${K(kbd('A') + ' or ' + kbd('D'), 'the left stick sideways', 'the stick sideways')} to spin. Land a 180 or more. Line up with where you're going before you touch down.`,
        setup: yard(56, 66, Math.PI),
        onTrick: { land: (s, e) => { if (e.deg >= 180 && !e.air.vert) s.done = true; } },
      },
      {
        title: 'Barspin',
        text: () => `Tap ${K(kbd('J'), kbd('X'), 'BAR')} in the air to throw a barspin. It has to finish before you land.`,
        setup: yard(56, 66, Math.PI),
        onTrick: { land: (s, e) => { if (e.air.tricks.some((t) => t.type === 'barspin')) s.done = true; } },
      },
      {
        title: 'Strike a pose',
        text: () => `Press ${K(kbd('L'), kbd('B'), 'SUPER')} in the air for a superman. Holding it stretches the pose for more points, so let go before you land. The bigger jump boxes give you more time.`,
        setup: yard(56, 66, Math.PI),
        onTrick: { land: (s, e) => { if (e.air.tricks.some((t) => t.type === 'superman')) s.done = true; } },
      },
      {
        title: 'Grind',
        text: () => `Hop onto the red rail, roughly lined up with it, and you'll lock into a grind. Balance with ${K(kbd('A') + ' ' + kbd('D'), 'the left stick', 'the stick')}.`,
        setup: yard(-9, 48, Math.PI / 2),
        on: { grindStart: (s) => { s.done = true; } },
      },
      {
        title: 'Manual',
        text: () => `While rolling, hold ${K(kbd('Shift'), kbd('LB'), 'MANUAL')} to pull a wheelie. Keep it balanced with ${K(kbd('W') + ' ' + kbd('S'), 'the stick up and down', 'the stick up and down')} for 2 seconds.`,
        setup: yard(-20, 52, Math.PI / 2),
        progress: (s) => { s.best = Math.max(s.best || 0, g.player.manual ? g.player.manual.time : 0); return s.best / 2; },
      },
      {
        title: 'Combos',
        text: () => 'Tricks you link before your wheels settle add up, and each one raises the multiplier. Land an air straight into a manual, or hop from a grind into another trick. Bank a ×2 combo.',
        setup: yard(56, 66, Math.PI),
        onTrick: { bank: (s, e) => { if (e.mult >= 2) s.done = true; } },
      },
      {
        title: 'Flip it',
        text: () => `Drop in on the mega ramp. In the air, hold ${K(kbd('S'), 'the left stick down', 'the stick down')} to backflip and let go once you're coming upright.`,
        setup: () => { const d = g.world.anchors.megaDeck; g.teleport(d.x, d.z, 0, true); },
        onTrick: { land: (s, e) => { if (e.flips <= -1) s.done = true; } },
        optional: true,
      },
      {
        title: 'Find your way',
        text: () => `Press ${K(kbd('M'), 'Start, then Map', 'II, then Map')} to open the map. Click any spot to fast travel there.`,
        tick: (s) => { if (g.ui.mapOpen) s.done = true; },
      },
      {
        title: 'You’re ready',
        text: () => `Ride into a glowing ring and press ${K(kbd('E'), 'D-pad ←', 'E')} to start a course. Hunt for golden sprockets, and press ${K(kbd('Esc'), 'Start', 'II')} for challenges, the guide and multiplayer.`,
        final: true,
      },
    ];
  }

  start() {
    const g = this.game;
    this.active = true;
    if (!g.playing) g.startRiding();
    g.setPaused(false);
    if (g.courses.run) g.courses.cancel(true);
    this.i = -1;
    this.el.classList.remove('hidden');
    this.next();
  }

  stop(finished = false) {
    this.active = false;
    this.el.classList.add('hidden');
    if (finished || (this.i >= this.steps.length - 1)) {
      if (!store('tutorialDone')) this.game.progress?.add(500, 'tutorial');
      store('tutorialDone', true);
      this.game.ui.markTutorialDone?.();
      this.game.ui.toast('Tutorial complete. Go ride!');
    }
  }

  next(skipped = false) {
    clearTimeout(this.timer);
    this.i++;
    if (this.i >= this.steps.length) { this.stop(true); return; }
    const st = this.steps[this.i];
    this.state = { done: false };
    if (st.setup) st.setup(this.state);
    if (st.start) st.start(this.state);
    this.render();
  }

  render() {
    const st = this.steps[this.i];
    const n = this.steps.length;
    this.el.innerHTML = `
      <div class="tut-top"><span>Tutorial · ${this.i + 1}/${n}</span>${st.optional ? '<span class="tut-opt">Optional</span>' : ''}</div>
      <h3>${st.title}</h3>
      <p>${st.text()}</p>
      ${st.final ? '' : '<div class="tut-bar"><i></i></div>'}
      <div class="tut-actions">
        ${st.final ? '<button class="btn primary small" data-tut="done"><span>Finish</span></button>' : '<button class="btn small" data-tut="skip"><span>Skip step</span></button>'}
        <button class="btn ghost small" data-tut="exit"><span>Exit tutorial</span></button>
      </div>`;
    this.bar = this.el.querySelector('.tut-bar i');
    this.mode = this.game.input.padActive ? 'pad' : 'kb';
  }

  complete() {
    this.state.done = true;
    this.state.completed = true;
    this.el.classList.add('tut-win');
    if (this.bar) this.bar.style.width = '100%';
    this.game.audio.play('record');
    const h = this.el.querySelector('h3');
    if (h) h.textContent = 'Nice!';
    this.timer = setTimeout(() => { this.el.classList.remove('tut-win'); this.next(); }, 1300);
  }

  update(dt) {
    if (!this.active) return;
    const st = this.steps[this.i];
    const S = this.state;
    if (!st || S.completed) return;
    // re-render text if the player switched between keyboard and gamepad
    const mode = this.game.input.padActive ? 'pad' : 'kb';
    if (mode !== this.mode) this.render();
    if (st.tick) st.tick(S);
    let p = st.progress ? st.progress(S) : S.done ? 1 : 0;
    if (S.done) p = 1;
    if (this.bar) this.bar.style.width = `${Math.round(Math.min(1, p) * 100)}%`;
    if (!st.final && p >= 1) this.complete();
  }

  onPlayerEvent(ev) {
    if (!this.active || this.state.completed) return;
    const h = this.steps[this.i].on && this.steps[this.i].on[ev.type];
    if (h) h(this.state, ev);
  }

  onTrick(ev) {
    if (!this.active || this.state.completed) return;
    const h = this.steps[this.i].onTrick && this.steps[this.i].onTrick[ev.type];
    if (h) h(this.state, ev);
  }
}

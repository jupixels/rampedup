// Generative lo-fi soundtrack built with Web Audio: dusty drums, a round bass, warm
// electric-piano chords and vinyl crackle. Never repeats exactly; muffles when paused.
const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);

// chord progressions as MIDI root + chord tones (7ths / 9ths for that lo-fi colour)
const PROGRESSIONS = [
  [[50, [0, 3, 7, 10, 14]], [55, [0, 4, 7, 10, 14]], [48, [0, 4, 7, 11, 14]], [57, [0, 3, 7, 10]]],   // Dm9 G9 Cmaj9 Am7
  [[45, [0, 3, 7, 10, 14]], [50, [0, 3, 7, 10]], [43, [0, 4, 7, 10, 14]], [48, [0, 4, 7, 11]]],      // Am9 Dm7 G9 Cmaj7
  [[52, [0, 3, 7, 10]], [57, [0, 3, 7, 10, 14]], [50, [0, 4, 7, 11, 14]], [55, [0, 4, 7, 10]]],      // Em7 Am9 Dmaj9 G7
  [[53, [0, 4, 7, 11, 14]], [52, [0, 3, 7, 10]], [50, [0, 3, 7, 10, 14]], [55, [0, 4, 7, 10, 13]]],  // Fmaj9 Em7 Dm9 G7b9
];

// 16-step drum patterns
const KICKS = ['x.....x...x.....', 'x......xx.......', 'x.....x.x.....x.'];
const SNARE = '....x.......x...';
const HATS = ['x.x.x.x.x.x.x.x.', 'x.xxx.x.x.xxx.x.', '..x...x...x...x.'];

export class Music {
  constructor(sfx) {
    this.ctx = sfx.ctx;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.filter.Q.value = 0.5;
    this.out.connect(this.filter).connect(sfx.buses.music);
    this.bpm = 84;
    this.step = 0;
    this.bar = 0;
    this.playing = false;
    this.volume = 1;
    this.noise = this.makeNoise();
  }

  makeNoise() {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
    this.kick = KICKS[0]; this.hat = HATS[0];
    this.nextTime = this.ctx.currentTime + 0.1;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(0.9, this.ctx.currentTime, 1.5);
    this.crackle();
    this.timer = setInterval(() => this.schedule(), 40);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    if (this.crackleSrc) { try { this.crackleSrc.stop(this.ctx.currentTime + 1); } catch (e) {} this.crackleSrc = null; }
  }

  // menus and pause: muffle the music as if it's playing in the next room
  setMuffled(on) {
    this.filter.frequency.setTargetAtTime(on ? 700 : 18000, this.ctx.currentTime, 0.25);
  }

  crackle() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const g = this.ctx.createGain(); g.gain.value = 0.012;
    src.connect(hp).connect(g).connect(this.out);
    src.start();
    this.crackleSrc = src;
  }

  schedule() {
    const spb = 60 / this.bpm / 4; // seconds per 16th
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, spb);
      // lazy swing on off-beats
      this.nextTime += spb * (this.step % 2 === 0 ? 1.12 : 0.88);
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.nextBar();
    }
  }

  nextBar() {
    this.bar++;
    if (this.bar % 8 === 0) {
      this.kick = KICKS[Math.floor(Math.random() * KICKS.length)];
      this.hat = HATS[Math.floor(Math.random() * HATS.length)];
      if (Math.random() < 0.4) this.prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
    }
  }

  playStep(s, t, spb) {
    const section = Math.floor(this.bar / 8) % 4; // 0 intro-ish, 1-3 full
    const chord = this.prog[Math.floor(this.bar / 2) % 4];
    if (this.kick[s] === 'x' && section > 0) this.kickDrum(t);
    if (SNARE[s] === 'x' && section > 0) this.snare(t);
    if (this.hat[s] === 'x') this.hihat(t, s % 4 === 2 ? 0.05 : 0.03);
    if (s === 0 && this.bar % 2 === 0) this.chord(chord, t, spb * 32);
    if (section > 0 && (s === 0 || s === 10 || (s === 7 && Math.random() < 0.5))) this.bass(t, chord[0] - 12 + (s === 10 && Math.random() < 0.3 ? 7 : 0), spb * 3);
    if (section >= 2 && Math.random() < 0.09) this.melody(chord, t, spb * 2);
  }

  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  kickDrum(t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.004, 0.55, 0.32);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.4);
  }

  snare(t) {
    const n = this.ctx.createBufferSource(); n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    this.env(g, t, 0.003, 0.22, 0.18);
    n.connect(bp).connect(g).connect(this.out); n.start(t, Math.random() * 0.5); n.stop(t + 0.25);
    const o = this.ctx.createOscillator(), og = this.ctx.createGain();
    o.frequency.value = 190; this.env(og, t, 0.002, 0.1, 0.08);
    o.connect(og).connect(this.out); o.start(t); o.stop(t + 0.12);
  }

  hihat(t, vol) {
    const n = this.ctx.createBufferSource(); n.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    this.env(g, t, 0.001, vol, 0.045);
    n.connect(hp).connect(g).connect(this.out); n.start(t, Math.random() * 0.5); n.stop(t + 0.08);
  }

  bass(t, midi, dur) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = NOTE(midi);
    lp.type = 'lowpass'; lp.frequency.value = 420;
    this.env(g, t, 0.01, 0.32, dur);
    o.connect(lp).connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.1);
  }

  // soft electric piano: detuned sine + triangle partials through a low-pass, slow release
  chord([root, tones], t, dur) {
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(this.out);
    tones.forEach((iv, k) => {
      for (const [type, det, amp] of [['sine', -4, 1], ['triangle', 5, 0.35]]) {
        const o = this.ctx.createOscillator(), og = this.ctx.createGain();
        o.type = type; o.frequency.value = NOTE(root + 12 + iv); o.detune.value = det + (Math.random() - 0.5) * 6;
        og.gain.value = amp / tones.length;
        o.connect(og).connect(lp);
        o.start(t + k * 0.012); o.stop(t + dur + 0.1);
      }
    });
  }

  melody([root, tones], t, dur) {
    const iv = tones[Math.floor(Math.random() * tones.length)];
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.value = NOTE(root + 24 + iv);
    this.env(g, t, 0.01, 0.05, dur * 2);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur * 2 + 0.1);
  }
}

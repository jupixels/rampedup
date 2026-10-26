// Sound: one-shots from the bundled Kenney CC0 library (via sfx.js), plus a few
// continuous procedural layers the library doesn't cover (tyre roll, wind,
// freewheel ticking, grind scrape).
import { clamp, store } from './util.js';

const SOUNDS = {
  land:      { src: ['impacts/soft_medium_01.mp3', 'impacts/soft_medium_02.mp3', 'impacts/soft_medium_03.mp3'], volume: 0.36 },
  landHard:  { src: ['impacts/soft_heavy_02.mp3', 'impacts/soft_heavy_03.mp3', 'impacts/soft_heavy_04.mp3'], volume: 0.45 },
  bail:      { src: ['impacts/punch_heavy_01.mp3', 'impacts/punch_heavy_02.mp3', 'impacts/punch_heavy_03.mp3'], volume: 0.42 },
  bikeClang: { src: ['impacts/metal_medium_01.mp3', 'impacts/metal_medium_04.mp3'], volume: 0.6 },
  grind:     { src: ['impacts/metal_light_01.mp3', 'impacts/metal_light_02.mp3', 'impacts/metal_light_03.mp3'], volume: 0.5 },
  hop:       { src: ['impacts/generic_light_01.mp3', 'impacts/generic_light_02.mp3'], volume: 0.35 },
  trick:     { src: ['ui/confirm_02.mp3', 'ui/confirm_03.mp3'], volume: 0.4 },
  bigCombo:  { src: ['jingles/jingle_hit_02.mp3', 'jingles/jingle_hit_07.mp3', 'jingles/jingle_hit_11.mp3'], volume: 0.42 },
  gate:      { src: ['ui/glass_01.mp3', 'ui/glass_02.mp3', 'ui/glass_03.mp3'], volume: 0.5 },
  finish:    { src: ['jingles/jingle_steel_drum_03.mp3', 'jingles/jingle_steel_drum_05.mp3'], volume: 0.5 },
  record:    { src: 'arcade/three_tone_02.mp3', volume: 0.45 },
  countdown: { src: 'arcade/tone_01.mp3', volume: 0.32 },
  go:        { src: 'impacts/bell_heavy_03.mp3', volume: 0.7 },
  click:     { src: 'ui/click_01.mp3', volume: 0.5 },
  join:      { src: 'ui/bong_01.mp3', volume: 0.6 },
  pickup:    { src: 'arcade/two_tone_01.mp3', volume: 0.4 },
  fail:      { src: 'arcade/zap_three_down_01.mp3', volume: 0.32 },
  lose:      { src: 'jingles/jingle_steel_drum_01.mp3', volume: 0.5 },
};

export class Audio {
  constructor() {
    this.sfx = new window.SFX({ base: 'sounds/' });
    this.ctx = this.sfx.ctx;
    this.ready = false;
    this.volume = store('volume') ?? 0.8;
    this.muted = store('muted') ?? false;
    this.apply();
  }

  async load() {
    await this.sfx.load(SOUNDS);
    this.buildLoops();
    this.ready = true;
  }

  apply() {
    this.sfx.setVolume('master', this.muted ? 0 : this.volume);
  }
  setVolume(v) { this.volume = v; store('volume', v); this.apply(); }
  toggleMute() { this.muted = !this.muted; store('muted', this.muted); this.apply(); return this.muted; }

  play(name, opts) { if (this.ready) this.sfx.play(name, opts); }

  noiseBuffer(seconds = 2, color = 'white') {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    return b;
  }

  buildLoops() {
    const ctx = this.ctx;
    const out = this.sfx.buses.sfx;
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    // tyre roll: brown noise through a band-pass whose centre follows speed
    this.roll = { src: loop(this.noiseBuffer(3, 'brown')), filt: ctx.createBiquadFilter(), gain: ctx.createGain() };
    this.roll.filt.type = 'bandpass'; this.roll.filt.Q.value = 0.8;
    this.roll.src.connect(this.roll.filt).connect(this.roll.gain).connect(out);
    this.roll.gain.gain.value = 0;
    // wind
    this.wind = { src: loop(this.noiseBuffer(3)), filt: ctx.createBiquadFilter(), gain: ctx.createGain() };
    this.wind.filt.type = 'lowpass'; this.wind.filt.frequency.value = 600;
    this.wind.src.connect(this.wind.filt).connect(this.wind.gain).connect(out);
    this.wind.gain.gain.value = 0;
    // freewheel ticks: a buffer of clicks played back faster with speed
    const sr = ctx.sampleRate, tb = ctx.createBuffer(1, sr, sr), td = tb.getChannelData(0);
    for (let k = 0; k < 40; k++) {
      const o = Math.floor((k / 40) * sr);
      for (let i = 0; i < 260; i++) td[o + i] = (Math.random() * 2 - 1) * Math.exp(-i / 40) * 0.9;
    }
    this.tick = { src: loop(tb), filt: ctx.createBiquadFilter(), gain: ctx.createGain() };
    this.tick.filt.type = 'highpass'; this.tick.filt.frequency.value = 2500;
    this.tick.src.connect(this.tick.filt).connect(this.tick.gain).connect(out);
    this.tick.gain.gain.value = 0;
    // grind scrape
    this.scrape = { src: loop(this.noiseBuffer(2)), filt: ctx.createBiquadFilter(), gain: ctx.createGain() };
    this.scrape.filt.type = 'bandpass'; this.scrape.filt.frequency.value = 2600; this.scrape.filt.Q.value = 3;
    this.scrape.src.connect(this.scrape.filt).connect(this.scrape.gain).connect(out);
    this.scrape.gain.gain.value = 0;
  }

  // per-frame continuous layers
  update(player, paused) {
    if (!this.ready || !this.roll) return;
    const t = this.ctx.currentTime;
    const set = (node, v, tc = 0.06) => node.gain.setTargetAtTime(paused ? 0 : v, t, tc);
    const sp = player.speed;
    const ground = player.mode === 'ground';
    const surf = player.ground ? player.ground.surface : 'concrete';
    const rough = { dirt: 1.6, grass: 1.3, sand: 1.2, rock: 1.5, wood: 1.1, metal: 0.9, concrete: 1, asphalt: 1.15 }[surf] || 1;
    set(this.roll.gain, ground ? clamp(sp / 14, 0, 1) * 0.22 * rough : 0);
    this.roll.filt.frequency.setTargetAtTime(160 + sp * 45 * (surf === 'wood' ? 1.4 : 1), t, 0.1);
    const air = player.mode === 'air';
    set(this.wind.gain, clamp((sp - 4) / 18, 0, 1) * (air ? 0.22 : 0.09));
    this.wind.filt.frequency.setTargetAtTime(300 + sp * 50, t, 0.2);
    const coasting = (ground || air) && !player.pedaling && sp > 0.5 && player.mode !== 'bail';
    set(this.tick.gain, coasting ? 0.05 : 0, 0.03);
    this.tick.src.playbackRate.setTargetAtTime(clamp((sp / 0.255 / (2 * Math.PI)) * 24 / 40, 0.2, 8), t, 0.05);
    set(this.scrape.gain, player.mode === 'grind' ? 0.16 : 0, 0.03);
    if (player.grind) this.scrape.filt.frequency.setTargetAtTime(1800 + player.grind.speed * 120, t, 0.05);
  }
}

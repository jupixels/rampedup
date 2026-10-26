/*
 * sfx.js — tiny game audio manager for the game-sounds library.
 * No dependencies. Works from a folder, a CDN URL, or embedded data URIs.
 *
 *   const sfx = new SFX({ base: "sounds/" });          // or base: "https://cdn.jsdelivr.net/gh/USER/game-sounds@main/sounds/"
 *   await sfx.load({ jump: "arcade/jump_02.mp3", coin: "rpg/coins_01.mp3",
 *                    step: ["footsteps/footstep_grass_01.mp3", "footsteps/footstep_grass_02.mp3"] });
 *   sfx.play("jump");                                   // plays (a random variant if an array was given)
 *   sfx.play("step", { volume: 0.5, vary: 0.08 });      // vary = random pitch ±8% so repeats don't sound robotic
 *   const engine = sfx.loop("engine", { volume: 0.3 }); engine.stop(0.5);  // fade out over 0.5s
 *   sfx.music("theme", { volume: 0.4 });                // looping music on its own bus
 *   sfx.setVolume("sfx", 0.8); sfx.setVolume("master", 0); // mute
 *
 * Embedded (single HTML file): pass data URIs instead of paths, e.g. { jump: "data:audio/mpeg;base64,..." }.
 * Browsers block audio until the first user gesture; SFX unlocks itself on the first click/key/touch.
 */
(function (root) {
  class SFX {
    constructor(opts = {}) {
      this.base = opts.base || "";
      const AC = root.AudioContext || root.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.buses = {};
      for (const name of ["sfx", "music", "ui"]) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.buses[name] = g;
      }
      this.buffers = {};   // name -> AudioBuffer[]
      this.gains = {};     // name -> default volume
      this.lastPlayed = {};
      this._musicHandle = null;
      const unlock = () => {
        if (this.ctx.state !== "running") this.ctx.resume();
        ["pointerdown", "keydown", "touchstart"].forEach((e) => root.removeEventListener(e, unlock, true));
      };
      ["pointerdown", "keydown", "touchstart"].forEach((e) => root.addEventListener(e, unlock, true));
    }

    _url(p) {
      return /^(data:|https?:|blob:|\/)/.test(p) ? p : this.base + p;
    }

    async _decode(p) {
      const res = await fetch(this._url(p));
      if (!res.ok) throw new Error(`sfx: could not load ${p} (${res.status})`);
      const data = await res.arrayBuffer();
      return await new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail));
    }

    /** map: { name: path | [paths] | {src, volume} } */
    async load(map) {
      await Promise.all(Object.entries(map).map(async ([name, v]) => {
        let src = v, vol = 1;
        if (v && typeof v === "object" && !Array.isArray(v)) { src = v.src; vol = v.volume ?? 1; }
        const list = Array.isArray(src) ? src : [src];
        try {
          this.buffers[name] = await Promise.all(list.map((p) => this._decode(p)));
          this.gains[name] = vol;
        } catch (e) { console.warn(e.message); }
      }));
      return this;
    }

    _pick(name) {
      const list = this.buffers[name];
      if (!list || !list.length) return null;
      return list[Math.floor(Math.random() * list.length)];
    }

    _voice(name, o, loop) {
      const buf = this._pick(name);
      if (!buf) { console.warn(`sfx: "${name}" not loaded`); return null; }
      const now = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const vary = o.vary ?? (loop ? 0 : 0.04);
      src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
      if (loop) {
        src.loop = true;
        // skip the MP3 encoder padding so loops don't click
        src.loopStart = Math.min(0.05, buf.duration * 0.05);
        src.loopEnd = Math.max(src.loopStart + 0.01, buf.duration - 0.05);
      }
      const gain = this.ctx.createGain();
      const target = (o.volume ?? 1) * (this.gains[name] ?? 1);
      const fadeIn = o.fadeIn ?? (loop ? 0.15 : 0);
      if (fadeIn > 0) {
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(target, now + fadeIn);
      } else gain.gain.value = target;
      let node = src;
      if (o.pan && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, o.pan));
        src.connect(p); node = p;
      }
      node.connect(gain);
      gain.connect(this.buses[o.bus || (loop === "music" ? "music" : "sfx")] || this.buses.sfx);
      src.start(now + (o.delay || 0), loop ? src.loopStart : 0);
      return {
        source: src,
        gain,
        stop: (fade = 0.1) => {
          const t = this.ctx.currentTime;
          gain.gain.cancelScheduledValues(t);
          gain.gain.setValueAtTime(gain.gain.value, t);
          gain.gain.linearRampToValueAtTime(0, t + fade);
          try { src.stop(t + fade + 0.02); } catch (_) {}
        },
        setVolume: (v, fade = 0.1) => gain.gain.linearRampToValueAtTime(v * (this.gains[name] ?? 1), this.ctx.currentTime + fade),
        setRate: (r) => { src.playbackRate.value = r; },
      };
    }

    /** One-shot. opts: volume, rate, vary (pitch randomness 0–1), pan (-1..1), delay, bus, cooldown (seconds) */
    play(name, opts = {}) {
      if (this.ctx.state !== "running") this.ctx.resume();
      const cd = opts.cooldown ?? 0.03;   // stops 20 copies stacking in one frame
      const t = this.ctx.currentTime;
      if (this.lastPlayed[name] !== undefined && t - this.lastPlayed[name] < cd) return null;
      this.lastPlayed[name] = t;
      return this._voice(name, opts, false);
    }

    /** Looping sound (engines, ambience). Returns handle with stop(fade), setVolume, setRate. */
    loop(name, opts = {}) {
      return this._voice(name, opts, true);
    }

    /** Looping music on the music bus; crossfades from the current track. */
    music(name, opts = {}) {
      if (this._musicHandle) this._musicHandle.stop(opts.crossfade ?? 1);
      this._musicHandle = name ? this._voice(name, { fadeIn: opts.crossfade ?? 1, ...opts, bus: "music" }, "music") : null;
      return this._musicHandle;
    }

    /** bus: "master" | "sfx" | "music" | "ui" */
    setVolume(bus, v) {
      const g = bus === "master" ? this.master : this.buses[bus];
      if (g) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }
  root.SFX = SFX;
  if (typeof module !== "undefined") module.exports = SFX;
})(typeof window !== "undefined" ? window : globalThis);

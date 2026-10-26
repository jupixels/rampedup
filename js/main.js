// Ramped Up — bootstrap and main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { buildWorld, Environment } from './world.js';
import { setAnisotropy } from './textures.js';
import { Player } from './player.js';
import { Tricks } from './tricks.js';
import { Input } from './input.js';
import { ChaseCamera } from './camera.js';
import { Courses } from './courses.js';
import { Audio } from './audio.js';
import { Net } from './network.js';
import { UI } from './ui.js';
import { Tutorial } from './tutorial.js';
import { ZONES, SPAWN } from './layout.js';
import { store, clamp } from './util.js';

const QUALITY = {
  low:    { pr: 1,    shadows: 1024, shadowRange: 45, trees: 900,  rocks: 160, grass: false, msaa: 0, bloom: false, gtao: false },
  medium: { pr: 1,    shadows: 2048, shadowRange: 55, trees: 1600, rocks: 260, grass: true, grassSpacing: 0.32, grassRadius: 24, msaa: 2, bloom: true, gtao: false },
  high:   { pr: 1.5,  shadows: 2048, shadowRange: 65, trees: 2400, rocks: 380, grass: true, grassSpacing: 0.25, grassRadius: 30, msaa: 4, bloom: true, gtao: false },
  ultra:  { pr: 2,    shadows: 4096, shadowRange: 85, trees: 3600, rocks: 600, grass: true, grassSpacing: 0.17, grassRadius: 42, msaa: 4, bloom: true, gtao: true },
};

const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (isnan(c.r) || isnan(c.g) || isnan(c.b) || isinf(c.r) || isinf(c.g) || isinf(c.b)) c = vec4(0.5, 0.5, 0.5, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 60.0), 1.0); }`,
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVig; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // gentle S-curve + saturation
      vec3 col = c.rgb;
      col = mix(col, col*col*(3.0-2.0*col), 0.22);
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, 1.08);
      // vignette
      vec2 d = vUv - 0.5; d.x *= 1.2;
      col *= 1.0 - uVig * smoothstep(0.25, 0.85, length(d));
      // fine grain
      col += (h(vUv * 1000.0) - 0.5) * 0.018;
      gl_FragColor = vec4(col, c.a);
    }`,
};

// Captions for crashes, by cause
const BAIL_LINES = {
  wall: ['Face, meet wall', 'That wall came out of nowhere', 'Structural integrity: tested', 'Brakes are optional, apparently'],
  hard: ['Cased it', 'Knees said no', 'Gravity wins again', 'That one echoed'],
  flip: ['Under-rotated', 'Half a flip still counts, right?', 'So close. Not really.', 'Commit to the flip!'],
  sideways: ['Sideways surprise', 'Landed like a shopping cart', 'Wrong way, champ'],
  trick: ['Too much style, not enough air', 'Finish the trick first', 'Bars went one way, you went the other'],
  balance: ['Rail: 1, You: 0', 'Lost the balance', 'Slipped a peg'],
  grind: ['Rail: 1, You: 0', 'Caught a peg'],
  splash: ['Splashdown!', 'Hope that bike floats', 'Swim team tryouts', 'Refreshing!'],
  water: ['Splashdown!', 'Hope that bike floats'],
  default: ['Yard sale!', 'Oof', 'Send it... to the ER', 'That will buff out'],
};

class Game {
  constructor() {
    this.settings = Object.assign({
      name: 'Rider' + Math.floor(Math.random() * 900 + 100),
      colors: { frame: '#ff5a1f', helmet: '#f2f2f2', shirt: '#1d2b3a', pants: '#2a2a2a' },
      quality: null, time: 'golden', fps: false, hints: true, cam: 'chase',
    }, store('settings') || {});
    this.touch = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
    if (!this.settings.quality) this.settings.quality = this.touch ? 'low' : 'medium';
    this.q = QUALITY[this.settings.quality] || QUALITY.high;
    this.playing = false;
    this.paused = false;
    this.clock = { last: performance.now(), getDelta() { const n = performance.now(); const d = (n - this.last) / 1000; this.last = n; return d; } };
    this.menuT = 0;
  }

  saveSettings() { store('settings', this.settings); }

  async init() {
    const canvas = document.getElementById('game');
    this.ui = new UI(this);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    } catch (e) {
      this.ui.error('Your browser could not start WebGL 2.<br>Try an up-to-date Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled.');
      throw e;
    }
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pr));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = this.q.shadows > 0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.08, 9000);
    this.env = new Environment(this.scene, renderer, this.q);
    this.env.setTime(this.settings.time);

    this.audio = new Audio();
    const audioP = this.audio.load().catch((e) => console.warn('audio', e));

    this.world = await buildWorld(this.scene, renderer, this.q, (t, p) => this.ui.loading(t, p));
    this.ui.loading('Tuning the bike', 0.88);
    await new Promise((r) => setTimeout(r, 0));
    const T0 = performance.now(), dbg = (l) => location.search.includes('debug') && console.log('[load]', l, Math.round(performance.now() - T0));
    this.tricks = new Tricks(this);
    this.input = new Input();
    this.player = new Player(this, this.settings.colors);
    dbg('player');
    this.player.spawn(SPAWN.x, SPAWN.z, SPAWN.yaw);
    this.cam = new ChaseCamera(this.camera, this.world.collision);
    this.cam.mode = ['chase', 'far', 'helmet'].includes(this.settings.cam) ? this.settings.cam : 'chase';
    dbg('cam');
    this.courses = new Courses(this);
    dbg('courses');
    this.net = new Net(this);
    this.tutorial = new Tutorial(this);
    if (store('tutorialDone')) this.ui.markTutorialDone();
    this.setupComposer();
    dbg('composer');
    this.bindEvents();
    // compile shaders in parallel where the browser supports it, instead of stalling on the first frames
    this.ui.loading('Warming up', 0.95);
    try { await renderer.compileAsync(this.scene, this.camera); } catch (e) { renderer.compile(this.scene, this.camera); }
    await Promise.race([audioP, new Promise((r) => setTimeout(r, 1500))]);
    // the map image isn't needed until the first frames are on screen
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
    idle(() => this.ui.buildMapImage(), { timeout: 2000 });
    this.ui.hideLoading();
    this.ui.showMenu();
    if (this.touch) this.ui.setupTouch(this.input);
    this.ui.showTouch(false);
    this.ui.applyPrefs();
    // invite link
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      const btn = document.querySelector('#menu [data-panel=mp]');
      this.ui.openPanel('mp', document.getElementById('panel-host'), btn);
    }
    renderer.setAnimationLoop(() => this.frame());
  }

  setupComposer() {
    const r = this.renderer, q = this.q;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (q.gtao) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1 });
      this.composer.addPass(ao);
    }
    // Guard against NaN/huge HDR pixels: bloom would smear a single bad pixel into a dark flash
    if (q.bloom) this.composer.addPass(new ShaderPass(SanitizeShader));
    if (q.bloom) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.1, 0.35, 1.8));
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.playing && !this.net.online) this.setPaused(true); });
    this.tricks.on((e) => this.onTrickEvent(e));
  }

  startRiding() {
    this.playing = true;
    this.ui.hideMenu();
    this.ui.showTouch(true);
    this.cam.snap(this.player);
    this.clock.getDelta();
    if (!store('seenHelp')) {
      store('seenHelp', true);
      if (!this.tutorial.active && !store('tutorialDone')) setTimeout(() => this.ui.toast('New here? Press Esc and pick Tutorial'), 800);
      setTimeout(() => this.ui.toast('W pedal · Space hop · J/K/L tricks'), 4500);
    }
  }

  setPaused(on, fromMap = false) {
    if (!this.playing) return;
    this.paused = on;
    if (!fromMap) this.ui.showPause(on);
    this.ui.showTouch(!on);
    this.input.keys.clear();
  }

  teleport(x, z, yaw = null, top = false) {
    if (this.courses.run) this.courses.cancel(true);
    if (yaw === null) yaw = this.player.heading;
    this.player.spawn(x, z, yaw, top);
    this.cam.snap(this.player);
  }

  startRace(courseId, startAt) {
    const c = this.courses.list.find((x) => x.id === courseId);
    if (!c) return;
    if (!this.playing) this.startRiding();
    this.setPaused(false);
    this.ui.closeMap?.();
    this.courses.start(c, { race: true, startAt: startAt });
    this.ui.toast(`Race: ${c.name} — get ready!`);
  }

  zoneName() {
    const p = this.player.pos;
    for (const z of Object.values(ZONES)) if (Math.abs(p.x - z.x) < z.hx + 10 && Math.abs(p.z - z.z) < z.hz + 10) return z.name;
    const t = this.world.terrain;
    if (t.nearestOnPath(t.trail, p.x, p.z).d < 12) return 'Summit Trail';
    if (Math.hypot(p.x + 610, p.z - 110) < 240) return 'Lakeside';
    return p.y > 50 ? 'High Country' : 'Backcountry';
  }

  nearLift() {
    const L = this.world.anchors.lift;
    const p = this.player.pos;
    return L && Math.hypot(p.x - L.x, p.z - L.z) < 4 && p.y < L.y + 2;
  }

  promptText() {
    if (this.paused || this.courses.run) return null;
    const c = this.courses.nearbyStart(this.player);
    if (c) {
      const best = this.courses.best[c.id];
      return `<kbd>E</kbd> Start ${c.name}${best ? ` <span class="muted">· best ${c.type === 'score' ? best.toLocaleString() : (Math.floor(best / 60) + ':' + (best % 60).toFixed(2).padStart(5, '0'))}</span>` : ''}`;
    }
    if (this.nearLift()) return '<kbd>E</kbd> Take the lift to the top of the mega ramp';
    return null;
  }

  onTrickEvent(e) {
    this.tutorial?.onTrick(e);
    if (e.type === 'land' && e.name) {
      if (e.pts >= 600) this.audio.play('trick', { volume: 0.8 });
      this.ui.feed(`${e.name}  +${e.pts.toLocaleString()}`);
    }
    if (e.type === 'bank') {
      this.ui.bankPop(`+${e.score.toLocaleString()}`);
      if (e.score >= 8000) this.audio.play('bigCombo');
      if (e.score >= 10000 && this.net.online) this.net.send({ t: 'feed', text: `landed a ${e.score.toLocaleString()} pt combo` });
      if (this.net.online) this.net.send({ t: 'score', total: this.tricks.total });
    }
    if (e.type === 'comboLost') this.ui.bankPop('Combo lost', true);
    this.courses.checkChallenges(e);
  }

  handlePlayerEvents() {
    const p = this.player;
    for (const ev of p.events) {
      this.tutorial.onPlayerEvent(ev);
      switch (ev.type) {
        case 'land':
          this.audio.play(ev.vn > 7 ? 'landHard' : 'land', { volume: clamp(0.4 + ev.vn / 10, 0.4, 1.2) });
          this.cam.addShake(clamp((ev.vn - 4) / 10, 0, 0.7));
          break;
        case 'hop': this.audio.play('hop'); break;
        case 'grindStart': this.audio.play('grind'); break;
        case 'bail': {
          this.audio.play('bail');
          setTimeout(() => this.audio.play('bikeClang', { vary: 0.15 }), 140 + Math.random() * 120);
          this.cam.addShake(0.9);
          this.bails = (this.bails || 0) + 1;
          const lines = BAIL_LINES[ev.reason] || BAIL_LINES.default;
          this.ui.bailCaption(lines[Math.floor(Math.random() * lines.length)], `Bail #${this.bails}`);
          this.courses.checkChallenges({ type: 'bail', reason: ev.reason });
          break;
        }
        case 'thud':
          this.audio.play(ev.strength > 7 ? 'landHard' : 'land', { volume: Math.min(1.2, 0.35 + ev.strength / 12), vary: 0.12, cooldown: 0.08 });
          this.cam.addShake(Math.min(0.5, ev.strength / 25));
          break;
        case 'respawn':
          if (ev.tumble > 0.5) {
            this.ui.bailCaption(null, `Tumbled ${ev.tumble.toFixed(1)} m`);
            this.courses.checkChallenges({ type: 'tumble', dist: ev.tumble });
          }
          break;
        case 'bump': if (ev.strength > 2) this.audio.play('hop', { volume: 0.6 }); break;
      }
    }
    p.events.length = 0;
  }

  // Keep the frame rate up by lowering render resolution. Only ever steps down, and rarely,
  // because every resize reallocates render targets.
  adaptResolution(rawDt) {
    if (!this.playing || this.paused) return;
    const P = this.perf || (this.perf = { t: -3, n: 0, acc: 0, scale: 1, slow: 0 });
    P.t += rawDt;
    if (P.t < 0) return; // let the first seconds settle
    P.n++; P.acc += Math.min(rawDt, 0.1);
    if (P.t < 3) return;
    const avg = P.acc / P.n;
    P.t = 0; P.n = 0; P.acc = 0;
    P.slow = avg > 1 / 40 ? P.slow + 1 : 0;
    if (P.slow >= 2 && P.scale > 0.62) {
      P.slow = 0;
      P.scale = Math.max(0.6, P.scale * 0.8);
      const pr = Math.min(window.devicePixelRatio || 1, this.q.pr) * P.scale;
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  frame() {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, rawDt);
    if (!this.noAdapt) this.adaptResolution(rawDt);
    const input = this.input.poll();
    const p = this.player;
    if (this.playing) {
      if (input.pausePressed) {
        if (this.ui.mapOpen) this.ui.closeMap();
        else this.setPaused(!this.paused);
      }
      if (input.mapPressed) { if (this.ui.mapOpen) this.ui.closeMap(); else if (!this.paused) this.ui.openMap(); }
      if (!this.paused) {
        if (input.camPressed) { this.settings.cam = this.cam.cycle(); this.saveSettings(); this.ui.toast(`Camera: ${this.cam.mode}`); }
        if (input.chatPressed) this.ui.openChat();
        if (input.resetPressed && p.mode !== 'bail') {
          if (this.courses.run && this.courses.run.state === 'running') this.courses.start(this.courses.run.course, {});
          else p.respawnSafe();
        }
        if (input.interactPressed) {
          const c = this.courses.nearbyStart(p);
          if (c) this.courses.start(c);
          else if (this.nearLift()) { const d = this.world.anchors.megaDeck; this.teleport(d.x, d.z, 0, true); this.ui.toast('Drop in when ready. Commit!'); }
        }
        // slow motion for the first moments of a crash
        const slow = p.mode === 'bail' && p.bail && p.bail.t < 0.55 ? 0.35 : 1;
        p.update(dt * slow, input);
        this.tricks.update(dt, p);
        this.handlePlayerEvents();
        this.courses.update(dt);
      }
      this.tutorial.update(dt);
      this.cam.update(dt, p, this.paused ? { orbitX: 0, orbitY: 0 } : input);
      this.ui.update(dt);
    } else {
      // menu: slow cinematic orbit over The Yard
      this.menuT += dt;
      p.updateVisual(dt);
      const a = this.menuT * 0.05 + 0.6;
      const focus = this.focusRider ? p.pos.clone().add(new THREE.Vector3(0, 1, 0)) : new THREE.Vector3(0, 4, -10);
      const r = this.focusRider ? 3.6 : 70, h = this.focusRider ? 1.4 : 26;
      const target = new THREE.Vector3(focus.x + Math.sin(a) * r, focus.y + h, focus.z + Math.cos(a) * r);
      this.camera.position.lerp(target, this.focusRider ? 0.08 : 1);
      this.camera.lookAt(focus);
      this.courses.update(dt);
    }
    this.net.update(dt);
    this.audio.update(p, this.paused || !this.playing);
    const focus = this.playing ? p.pos : this.camera.position;
    this.env.update(dt, this.playing ? p.pos : new THREE.Vector3(0, 0, 0));
    this.world.update(dt, this.camera.position);
    this.grade.uniforms.uTime.value = (this.grade.uniforms.uTime.value + dt) % 100;
    this.composer.render(dt);
  }
}

const game = new Game();
window.__game = game;
game.init().catch((e) => {
  console.error(e);
  game.ui?.error?.(`Failed to start: ${String(e && e.message || e)}<br><span class="muted">Try a different browser or lower the quality.</span>`);
});

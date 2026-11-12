// Test cases. Each `run` executes inside the page with `window.__game` (the game)
// and `window.__sim` (the driver from run.mjs) available, and returns { ok, detail }.

// Reads the lower half of the frame (ground and rider) back from the GPU.
// A broken render shows up as a GL error, a blank or blown-out picture, or one with no detail.
const PICTURE = `(g) => {
  const gl = g.renderer.getContext();
  while (gl.getError() !== gl.NO_ERROR) { /* clear */ }
  g.paused = false; g.playing = true; g.clock.getDelta();
  for (let i = 0; i < 6; i++) g.frame();           // the real frame loop, exactly as the game runs it
  const err = gl.getError();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  g.composer.render(0.016);
  const px = new Uint8Array(w * 4);
  const rows = [0.15, 0.3, 0.45].map((f) => { gl.readPixels(0, Math.floor(h * f), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); let sum = 0, sq = 0, n = 0; for (let k = 0; k < px.length; k += 16) { const v = (px[k] + px[k + 1] + px[k + 2]) / 3; sum += v; sq += v * v; n++; } const mean = sum / n; return { mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) }; });
  const mean = rows.reduce((a, r) => a + r.mean, 0) / rows.length, sd = Math.max(...rows.map((r) => r.sd));
  const bad = [];
  if (err !== gl.NO_ERROR) bad.push('GL error ' + err);
  if (mean > 215 || mean < 12) bad.push('ground brightness ' + mean.toFixed(0) + ' (blank or blown out)');
  if (sd < 2) bad.push('no detail in the picture');
  return { bad, text: 'err=' + err + ' brightness=' + mean.toFixed(0) + ' detail=' + sd.toFixed(1) };
}`;

export const CASES = [
  {
    // must stay first: it checks the game exactly as it comes up, before any test touches a setting
    name: 'rendering: the game as it boots draws a real picture with no GL errors',
    run: new Function(`
      const g = window.__game;
      g.cam.snap(g.player);
      const r = (${PICTURE})(g);
      return { ok: !r.bad.length, detail: r.bad.length ? r.bad.join('; ') : r.text + ' (' + g.settings.quality + ')' };
    `),
  },
  {
    name: 'world: straight rides through every spot stay stable',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      const spots = [['yard', 0, 30, Math.PI, false], ['woods', 288, 80, Math.PI, true], ['docks', -228, 62, -Math.PI / 2, false],
        ['bigair', 40, 243, 0, true], ['summit', -36, -556, 1.2, false], ['pool', -120, 163, Math.PI, true], ['channel', 100, -160, Math.PI / 2, false]];
      const bad = [];
      for (const [id, x, z, yaw, top] of spots) {
        sim.reset(x, z, yaw, top);
        for (let i = 0; i < 480; i++) {
          sim.step(1, { pedal: p.mode === 'ground' ? 1 : 0 });
          if (!isFinite(p.pos.x + p.pos.y + p.pos.z)) { bad.push(id + ': NaN position'); break; }
        }
        if (sim.has('ev:bail')) bad.push(id + ': ' + sim.log.find((l) => l.startsWith('ev:bail')));
      }
      return { ok: !bad.length, detail: bad.join('; ') };
    },
  },
  {
    name: 'challenge: a 5 second manual completes Wheelie King',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      g.courses.done.delete('manual5');
      sim.reset(-60, 30, Math.PI / 2);
      p.vel.set(8, 0, 0);
      sim.step(1, { manual: true, manualPressed: true });
      let held = 0;
      for (let i = 0; i < 60 * 6 && p.manual; i++) {
        p.manual.bal = 0; p.manual.balVel = 0;
        if (p.speed < 4) p.vel.set(8, 0, 0);
        sim.step(1, { manual: true });
        if (p.manual) held = p.manual.time;
      }
      sim.step(90, {});
      return { ok: held > 5 && g.courses.done.has('manual5'), detail: `held ${held.toFixed(2)}s, done=${g.courses.done.has('manual5')}` };
    },
  },
  {
    name: 'tricks: a flat-ground bunny hop is not called Big Air',
    run: () => {
      const sim = window.__sim;
      sim.reset();
      sim.step(120, { pedal: 1 });
      sim.step(20, { hop: true });
      sim.step(1, { hopReleased: true });
      sim.step(150, {});
      return { ok: sim.has('ev:hop') && sim.has('ev:land') && !sim.has('land:Big Air'), detail: sim.log.filter((l) => !l.startsWith('ev:takeoff')).join(',') };
    },
  },
  {
    name: 'input: letting go of hop without a release event clears the crouch',
    run: () => {
      const g = window.__game, sim = window.__sim;
      sim.reset();
      sim.step(15, { hop: true });
      const during = g.player.preload;
      sim.step(3, {}); // e.g. the window lost focus: key is up, no keyup was seen
      return { ok: during > 0.5 && g.player.preload === 0 && g.player.mode === 'ground', detail: `preload ${during.toFixed(2)} -> ${g.player.preload}` };
    },
  },
  {
    name: 'tricks: rolling backwards does not hand out free points',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(-60, 30, Math.PI / 2);
      p.vel.set(-4, 0, 0); // rolling backwards, facing +x
      sim.step(120, {});
      return { ok: sim.has('ev:revert') && !sim.log.some((l) => l.startsWith('bank:')) && !g.tricks.combo, detail: sim.log.join(',') };
    },
  },
  {
    name: 'courses: restarting a course does not leak GPU objects',
    run: () => {
      const g = window.__game, sim = window.__sim;
      sim.reset();
      const c = g.courses.list.find((x) => x.id === 'yard');
      const cycle = () => { g.courses.start(c); g.composer.render(0.016); g.courses.cancel(true); g.composer.render(0.016); };
      // warm up: the chase camera settles over the first few snaps, bringing scenery into view
      for (let i = 0; i < 4; i++) cycle();
      const before = { ...g.renderer.info.memory };
      for (let i = 0; i < 5; i++) cycle();
      const after = g.renderer.info.memory;
      const dg = after.geometries - before.geometries, dt = after.textures - before.textures;
      return { ok: dg <= 0 && dt <= 0, detail: `geometries +${dg}, textures +${dt}` };
    },
  },
  {
    name: 'courses: reset during a multiplayer race keeps you in the race',
    run: () => {
      const g = window.__game, sim = window.__sim;
      sim.reset();
      const c = g.courses.list.find((x) => x.id === 'yard');
      g.courses.start(c, { race: true, startAt: Date.now() - 10 });
      sim.step(5, {});
      const running = g.courses.run && g.courses.run.state === 'running';
      sim.step(60, { pedal: 1 });
      g.resetRider();
      const r = g.courses.run;
      const ok = running && !!r && r.opts.race === true && r.state === 'running' && r.time > 0.5;
      g.courses.cancel(true);
      return { ok, detail: r ? `race=${r.opts.race} state=${r.state} t=${r.time.toFixed(2)}` : 'run was dropped' };
    },
  },
  {
    name: 'multiplayer: remote names and colours cannot inject HTML',
    run: () => {
      const g = window.__game, net = g.net;
      const evil = '"><img src=x onerror="window.__xss=1">';
      const sent = [];
      const conn = { peer: 'evil-peer', open: true, send: (m) => sent.push(m) };
      const wasHost = net.isHost, wasStatus = net.status;
      net.isHost = true; net.status = 'host'; net.myId = 'me';
      net.onMessage({ t: 'hello', name: evil + 'x'.repeat(200), colors: { frame: evil, helmet: 'red; background:url(x)', shirt: 123, pants: null } }, conn);
      net.onMessage({ t: 'chat', text: '<b onmouseover="window.__xss=1">hi</b>' }, conn);
      g.ui.renderScoreboard();
      const pl = net.players.get('evil-peer');
      const imgs = document.querySelectorAll('#chat-log img, #scoreboard img, #chat-log [onmouseover], #toasts img').length;
      const hex = /^#[0-9a-f]{6}$/i;
      const ok = !!pl && imgs === 0 && !window.__xss && pl.name.length <= 16 && ['frame', 'helmet', 'shirt', 'pants'].every((k) => hex.test(pl.colors[k]));
      const detail = pl ? `name=${pl.name.length} chars, frame=${pl.colors.frame}, injected nodes=${imgs}` : 'player not added';
      net.removePlayer('evil-peer', true); net.conns.clear();
      net.isHost = wasHost; net.status = wasStatus;
      document.getElementById('chat-log').textContent = '';
      return { ok, detail };
    },
  },
  {
    name: 'gamepad: LB is manual only, and map has a button',
    run: () => {
      const g = window.__game, inp = g.input;
      const real = navigator.getGamepads;
      const pad = (down) => ({ connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })) });
      let cur = pad([]);
      navigator.getGamepads = () => [cur];
      inp.prevPad = []; inp.padActive = false;
      const press = (i) => { cur = pad([]); inp.poll(); cur = pad([i]); return inp.poll(); };
      const lb = press(4), rb = press(5), map = press(10);
      cur = pad([]); inp.poll();
      navigator.getGamepads = real; inp.padActive = false; inp.prevPad = [];
      const ok = lb.manual && !Object.keys(lb.tricks).length && rb.tricks.nohander === true && map.mapPressed === true;
      return { ok, detail: `LB manual=${lb.manual} tricks=${Object.keys(lb.tricks)}, RB=${Object.keys(rb.tricks)}, L3 map=${map.mapPressed}` };
    },
  },
  {
    name: 'performance: resolution scales back up when frames are fast again',
    run: () => {
      const g = window.__game;
      g.noAdapt = false; g.playing = true; g.paused = false; g.perf = null;
      for (let i = 0; i < 600; i++) g.adaptResolution(1 / 20);   // 30 s of slow frames
      const low = g.perf.scale;
      for (let i = 0; i < 60 * 90; i++) g.adaptResolution(1 / 60); // 90 s of smooth frames
      const high = g.perf.scale;
      g.noAdapt = true;
      return { ok: low < 1 && high > low, detail: `scale ${low.toFixed(2)} -> ${high.toFixed(2)}` };
    },
  },
  {
    name: 'progress: lifetime stats and best combo are saved',
    run: () => {
      const g = window.__game, sim = window.__sim;
      localStorage.removeItem('rampedup.stats');
      sim.reset();
      g.tricks.addTrick('Test Trick', 500);
      sim.step(80, {});
      const saved = JSON.parse(localStorage.getItem('rampedup.stats') || 'null');
      return { ok: !!saved && saved.best >= 500 && typeof saved.grindDist === 'number', detail: JSON.stringify(saved) };
    },
  },
  // ---------------- phase 2: controls and feel ----------------
  {
    name: 'flips: pedalling through a hop does not start a flip',
    run: () => {
      const g = window.__game, sim = window.__sim;
      sim.reset();
      sim.step(180, { pedal: 1, flip: 1 });
      sim.step(20, { pedal: 1, flip: 1, hop: true });
      sim.step(1, { pedal: 1, flip: 1, hopReleased: true });
      sim.step(120, { pedal: 1, flip: 1 });
      return { ok: sim.has('ev:hop') && sim.has('ev:land') && !sim.has('ev:bail'), detail: sim.log.filter((l) => /bail|land|hop/.test(l)).join(',') };
    },
  },
  {
    name: 'flips: a fresh press in the air still flips; classic mode keeps the old behaviour',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      const air = (classic, frames) => {
        p.classic = classic;
        sim.reset();
        sim.step(60, { pedal: 1, flip: 1 });
        sim.step(10, { pedal: 1, flip: 1, hop: true });
        sim.step(1, { pedal: 1, flip: 1, hopReleased: true });
        p.vel.y = 12; // plenty of hang time
        let f = 0;
        for (const fr of frames) { sim.step(fr[0], fr[1]); }
        f = p.air ? p.air.flip : NaN;
        return f;
      };
      const held = air(false, [[20, { flip: 1 }]]);                      // never released: ignored
      const fresh = air(false, [[4, {}], [20, { flip: -1 }]]);           // released, then back flip
      const classic = air(true, [[20, { flip: 1 }]]);                    // classic: held key flips
      p.classic = false;
      sim.reset();
      return { ok: held === 0 && fresh < -0.5 && classic > 0.5, detail: `held=${held.toFixed(2)} fresh=${fresh.toFixed(2)} classic=${classic.toFixed(2)}` };
    },
  },
  {
    name: 'manual: starting one while pedalling gives a normal manual that holds',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(-60, 30, Math.PI / 2);
      sim.step(150, { pedal: 1, flip: 1 });
      sim.step(1, { pedal: 1, flip: 1, manual: true, manualPressed: true });
      const nose = p.manual && p.manual.nose;
      let t = 0;
      for (let i = 0; i < 120 && p.manual; i++) { sim.step(1, { pedal: 1, flip: 1, manual: true }); if (p.manual) t = p.manual.time; }
      return { ok: nose === false && t > 1.9 && !sim.has('ev:manualFail'), detail: `nose=${nose} lasted ${t.toFixed(2)}s` };
    },
  },
  {
    name: 'manual: holding brake as you start gives a nose manual',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(-60, 30, Math.PI / 2);
      p.vel.set(8, 0, 0);
      sim.step(1, { brake: 1, flip: -1, manual: true, manualPressed: true });
      const started = !!p.manual, nose = started && p.manual.nose === true;
      sim.step(5, {});
      return { ok: nose, detail: `started=${started} nose=${nose}` };
    },
  },
  {
    name: 'fakie: landing backwards rolls fakie; tapping brake reverts',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(-60, 30, Math.PI / 2);
      sim.step(1, { hop: true }); sim.step(12, { hop: true }); sim.step(1, { hopReleased: true });
      // in the air, travelling +x but facing -x
      p.vel.x = 7; p.vel.z = 0; p.heading = -Math.PI / 2; p.air.spin = Math.PI;
      sim.step(120, {});
      const facingBack = Math.cos(p.heading - Math.atan2(p.vel.x, p.vel.z)) < -0.9;
      const rolled = p.mode === 'ground' && p.fakie && facingBack && !sim.has('ev:revert') && !sim.has('ev:bail');
      const detail1 = `mode=${p.mode} fakie=${p.fakie} facingBack=${facingBack} speed=${p.speed.toFixed(1)} log=${sim.log.filter((l) => /land|bail|revert/.test(l)).join(',')}`;
      sim.step(1, { brake: 1, flip: -1 });
      sim.step(10, { brake: 1, flip: -1 });
      const facingFwd = Math.cos(p.heading - Math.atan2(p.vel.x, p.vel.z)) > 0.9;
      const reverted = sim.has('ev:revert') && !p.fakie && facingFwd && p.speed > 3;
      return { ok: rolled && reverted, detail: detail1 + ` | after tap: fakie=${p.fakie} fwd=${facingFwd} speed=${p.speed.toFixed(1)}` };
    },
  },
  {
    name: 'fakie: hop and spin 180 out of fakie is a Half Cab',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(-60, 30, -Math.PI / 2);
      p.vel.set(7, 0, 0); p.fakie = true; // rolling +x, facing -x
      sim.step(2, {});
      const wasFakie = p.fakie;
      sim.step(16, { hop: true }); sim.step(1, { hopReleased: true });
      for (let i = 0; i < 200 && p.mode === 'air'; i++) sim.step(1, { steer: Math.abs(p.air.spin) < 2.45 ? 1 : 0 });
      sim.step(60, {});
      return { ok: wasFakie && sim.log.some((l) => l.startsWith('land:Half Cab')) && !p.fakie && !sim.has('ev:bail'), detail: sim.log.filter((l) => /land|bail|bank/.test(l)).join(',') };
    },
  },
  {
    name: 'courses: Backspace returns to the last gate with the clock running; R starts the course over',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset();
      const c = g.courses.list.find((x) => x.id === 'yard');
      g.courses.start(c, { countdownFrom: 0.05 });
      sim.step(10, {});
      const r = g.courses.run;
      // roll through gate 1, carry on a while, then reset
      const gate = c.gates[0];
      p.spawn(gate.x, gate.z + 3, Math.PI);
      for (let i = 0; i < 300 && r.idx < 1; i++) sim.step(1, { pedal: 1 });
      sim.step(90, { pedal: 1, steer: 0.4 });
      const tBefore = r.time;
      g.backToSafe();          // Backspace: last gate, clock keeps running
      const back = Math.hypot(p.pos.x - gate.x, p.pos.z - gate.z) < 1.5;
      const same = g.courses.run === r && r.state === 'running' && r.idx === 1 && r.time >= tBefore;
      g.resetRider();          // R: start the course over with the full 3-2-1
      const fresh = g.courses.run && g.courses.run !== r && g.courses.run.state === 'countdown' && g.courses.run.countdown === 3;
      g.courses.cancel(true);
      return { ok: r.idx >= 1 && back && same && fresh, detail: `passedGate=${r.idx >= 1} backAtGate=${back} sameRun=${same} restarted=${fresh}` };
    },
  },
  {
    name: 'controls: rebinding a key works, and prompts follow it',
    run: () => {
      const g = window.__game, inp = g.input;
      const tap = (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); const s = inp.poll(); window.dispatchEvent(new KeyboardEvent('keyup', { code })); inp.poll(); return s; };
      const before = tap('Space').hop;
      inp.bindKey('hop', 'KeyQ');
      const q = tap('KeyQ').hop, space = tap('Space').hop, label = inp.label('hop');
      const saved = JSON.stringify(inp.bindsToSave());
      inp.setBinds(null);
      const restored = tap('Space').hop;
      inp.padActive = false;
      return { ok: before && q && !space && label === 'Q' && restored && saved.includes('KeyQ'), detail: `space=${before} Q=${q} spaceAfter=${space} label=${label} restored=${restored} saved=${saved}` };
    },
  },
  // ---------------- phase 3: trick depth ----------------
  {
    name: 'tricks: manual button + trick gives the variation (X-Up)',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset();
      sim.step(60, { pedal: 1 }); sim.step(12, { hop: true }); sim.step(1, { hopReleased: true });
      p.vel.y = 9;
      sim.step(3, {});
      sim.step(1, { manual: true, tricks: { barspin: true }, trickHeld: { barspin: true } });
      const type = p.anim && p.anim.type;
      sim.step(40, { manual: true });
      const pose = g.player.model.pose.xup;
      sim.step(200, {});
      return { ok: type === 'xup' && sim.log.some((l) => l.startsWith('land:X-Up')) && !sim.has('ev:bail'), detail: `anim=${type} pose=${pose.toFixed(2)} ${sim.log.filter((l) => /^land|bail/.test(l)).join(',')}` };
    },
  },
  {
    name: 'tricks: a 360 with a barspin is a Truckdriver',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(-60, 30, Math.PI / 2);
      sim.step(90, { pedal: 1 }); sim.step(12, { hop: true }); sim.step(1, { hopReleased: true });
      p.vel.y = 10;
      sim.step(1, { tricks: { barspin: true } });
      for (let i = 0; i < 400 && p.mode === 'air'; i++) sim.step(1, { steer: Math.abs(p.air.spin) < 5.6 ? 1 : 0 });
      sim.step(60, {});
      return { ok: sim.log.some((l) => l.startsWith('land:Truckdriver')) && !sim.has('ev:bail'), detail: sim.log.filter((l) => /^land|bail/.test(l)).join(',') };
    },
  },
  {
    name: 'tricks: variety bonus pays for mixing tricks',
    run: () => {
      const g = window.__game, sim = window.__sim;
      sim.reset();
      let ev = null; g.tricks.on((e) => { if (e.type === 'bank') ev = e; });
      for (const n of ['A', 'B', 'C', 'D', 'E']) g.tricks.addTrick('Test ' + n, 100);
      g.tricks.bank();
      return { ok: !!ev && Math.abs(ev.variety - 0.2) < 1e-9 && ev.score === Math.round(500 * 5 * 1.2), detail: ev ? `score=${ev.score} variety=${ev.variety}` : 'no bank' };
    },
  },
  {
    name: 'lip tricks: holding manual on the way back to the coping stalls, hop drops back in',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(-35, -28, Math.PI);
      let stalled = false, style = '', t = 0;
      for (let i = 0; i < 900 && !stalled; i++) {
        const air = p.mode === 'air' && p.air && p.air.vert;
        sim.step(1, air ? { manual: p.vel.y < 0 } : { pedal: 1 });
        if (p.mode === 'stall') { stalled = true; style = p.stall.style; }
        if (sim.has('ev:bail')) break;
      }
      const pre = sim.log.filter((l) => /bail|stall|takeoff/.test(l)).join(',');
      if (!stalled) return { ok: false, detail: 'never stalled: ' + pre + ` mode=${p.mode}` };
      for (let i = 0; i < 90; i++) { p.stall.bal = 0; p.stall.balVel = 0; sim.step(1, {}); }
      t = p.stall.time;
      sim.step(1, { hop: true, hopPressed: true });
      const left = p.mode === 'air';
      sim.step(240, {});
      const ok = left && t > 1.4 && !sim.has('ev:bail') && p.mode === 'ground' && sim.log.some((l) => l.startsWith('bank:'));
      return { ok, detail: `style=${style} held=${t.toFixed(1)}s after=${p.mode} ${sim.log.filter((l) => /bail|bank/.test(l)).join(',')}` };
    },
  },
  {
    name: 'wallride: a shallow approach sticks to a marked wall, hop pushes off',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(-29, 64.7, Math.PI / 2);
      sim.step(8, { hop: true }); sim.step(1, { hopReleased: true });
      p.vel.set(7.5, 5, 1.2); // along the wall, drifting into it
      let on = false;
      for (let i = 0; i < 90 && !on; i++) { sim.step(1, {}); on = p.mode === 'wall'; }
      if (!on) return { ok: false, detail: `never stuck: mode=${p.mode} pos=${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)} walls=${g.world.collision.walls.length} ${sim.log.filter((l) => /bail|bump|land/.test(l)).join(',')}` };
      sim.step(20, {});
      const riding = p.mode === 'wall';
      sim.step(1, { hop: true, hopPressed: true });
      sim.step(200, {});
      const ok = riding && sim.has('ev:wallEnd') && !sim.has('ev:bail') && p.mode === 'ground' && sim.log.some((l) => l.startsWith('bank:'));
      return { ok, detail: `riding=${riding} after=${p.mode} ${sim.log.filter((l) => /bail|bank|wall/.test(l)).join(',')}` };
    },
  },
  // ---------------- phase 4: things to do ----------------
  {
    name: 'gaps: pedalling north over the first jump box finds Box One and the Woods "Sprout" double',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim, G = g.goals;
      G.foundGaps.clear();
      const ride = (x, z, yaw, top, frames, id, speed = 0) => {
        sim.reset(x, z, yaw, top);
        if (speed) p.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
        for (let i = 0; i < frames && !G.foundGaps.has(id); i++) { sim.step(1, { pedal: p.mode === 'ground' ? 1 : 0 }); G.update(1 / 60); }
        return G.foundGaps.has(id);
      };
      const box1 = ride(56, 62, Math.PI, false, 600, 'box1', 10);
      const sprout = ride(288, 80, Math.PI, true, 600, 'woodsA1');
      return { ok: box1 && sprout && G.gaps.length >= 25, detail: `box1=${box1} sprout=${sprout} gaps=${G.gaps.length} found=${[...G.foundGaps].join(',')}` };
    },
  },
  {
    name: 'gaps: every gap sits over rideable ground inside its spot',
    run: () => {
      const g = window.__game, G = g.goals, col = g.world.collision;
      const bad = [];
      for (const gap of G.gaps) {
        const h = col.ground(gap.x, gap.z, 500, { n: g.player.normal.clone() }).h;
        if (!isFinite(h) || !isFinite(gap.x + gap.z)) bad.push(gap.id + ': bad position');
        if (gap.minY !== undefined && gap.minY < h - 0.5 && gap.id !== 'mega') bad.push(`${gap.id}: minY ${gap.minY.toFixed(1)} below ground ${h.toFixed(1)}`);
      }
      return { ok: !bad.length, detail: bad.join('; ') };
    },
  },
  {
    name: 'goals: spot goals complete in their spot, in any order, and pay XP',
    run: () => {
      const g = window.__game, sim = window.__sim, G = g.goals;
      G.done.clear();
      sim.reset(); // The Yard
      G.update(0.3);
      const xp0 = g.progress.xp;
      G.onEvent({ type: 'bank', score: 2500 });
      const warm = G.done.has('yard1');
      G.onEvent({ type: 'grindEnd', style: 'Double Peg', dist: 9, time: 1, stall: false });
      const rail = G.done.has('yard2');
      G.onEvent({ type: 'manualEnd', time: 9 }); // a Channel goal: must not count here
      const wrongSpot = G.done.has('channel1');
      const next = G.next('yard');
      return { ok: warm && rail && !wrongSpot && next && next.tier === 3 && g.progress.xp > xp0, detail: `warm=${warm} rail=${rail} wrongSpot=${wrongSpot} next=${next && next.name} xp+${g.progress.xp - xp0}` };
    },
  },
  {
    name: 'daily: the same date gives the same three challenges, and progress completes them',
    run: async () => {
      const g = window.__game, G = g.goals;
      const { dailyFor } = await import('./js/goals.js');
      const a = dailyFor('2026-11-12'), b = dailyFor('2026-11-12'), c = dailyFor('2026-11-13');
      const same = JSON.stringify(a) === JSON.stringify(b), differs = JSON.stringify(a) !== JSON.stringify(c);
      const distinct = new Set(a.map((x) => x.stat)).size === 3;
      G.daily = { key: G.daily.key, prog: {}, done: [] };
      const d = G.dailyList[0];
      G.bump(d.stat, d.n, d.max);
      G.onEvent({ type: 'tick' });
      return { ok: same && differs && distinct && G.daily.done.includes(0), detail: `same=${same} differs=${differs} distinct=${distinct} done=${G.daily.done}` };
    },
  },
  {
    name: 'sprockets: uncollected sprockets stay off the map until you have been near them',
    run: () => {
      const g = window.__game, sim = window.__sim, C = g.courses;
      C.seen.clear();
      sim.reset(-150, -150, 0); // far from most; one sprocket sits right here
      sim.step(2, {});
      const near = C.sprockets.filter((s) => Math.hypot(s.x + 150, s.z + 150) < 45).map((s) => s.id);
      const far = C.sprockets.find((s) => Math.hypot(s.x + 150, s.z + 150) > 200);
      return { ok: near.length > 0 && near.every((id) => C.seen.has(id) || C.found.has(id)) && !C.seen.has(far.id), detail: `near=${near} seen=${[...C.seen]}` };
    },
  },
  {
    name: 'street: the Yard and Port Rusty have at least twice the rails and ledges',
    run: () => {
      const rails = window.__game.world.collision.rails;
      const n = rails.length;
      return { ok: n >= 42, detail: `${n} grindable edges (was 21)` };
    },
  },
  {
    name: 'physics: riding off the lip of a jump box at speed launches without hopping',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(56, 62, Math.PI);
      p.vel.set(0, 0, -10);
      let air = 0, maxH = 0;
      for (let i = 0; i < 200; i++) { sim.step(1, { pedal: p.mode === 'ground' ? 1 : 0 }); if (p.mode === 'air') { air++; maxH = Math.max(maxH, p.pos.y - 3.05); } if (p.pos.z < 36) break; }
      return { ok: air > 12 && !sim.has('ev:bail') && !sim.has('ev:hop'), detail: `airborne ${air} frames, ${maxH.toFixed(2)} m over the table` };
    },
  },
  {
    name: 'gaps: Mega, Warehouse Roof, Box Cars and Lake Launch are all reachable',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim, G = g.goals;
      const out = {};
      const ride = (tag, x, z, yaw, top, frames, speed, ctl) => {
        G.foundGaps.clear(); sim.reset(x, z, yaw, top);
        if (speed) p.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
        for (let i = 0; i < frames; i++) { sim.step(1, Object.assign({ pedal: p.mode === 'ground' ? 1 : 0 }, ctl ? ctl() : {})); G.update(1 / 60); if (sim.has('ev:bail')) break; }
        out[tag] = { found: [...G.foundGaps], bail: sim.has('ev:bail') };
      };
      const d = g.world.anchors.megaDeck;
      ride('mega', d.x, d.z, 0, true, 700, 0);
      ride('roof', -250, 10, 0, true, 420, 11);
      ride('lake', -430, 60, -Math.PI / 2, true, 400, 9);
      let st = 0; // hop near the west edge of each container
      ride('boxcar', -338, 8, -Math.PI / 2, true, 700, 10, () => {
        const near = p.mode === 'ground' && [-352.5, -369.5, -386.5].some((e) => p.pos.x < e + 1.2 && p.pos.x > e - 1.5);
        if (near && st === 0) { st = 1; return { hop: true }; }
        if (st >= 1 && st < 10) { st++; return { hop: true }; }
        if (st === 10) { st = 0; return { hopReleased: true }; }
        return {};
      });
      const ok = out.mega.found.includes('mega') && !out.mega.bail && out.roof.found.includes('roof') && !out.roof.bail
        && out.lake.found.includes('lake') && out.boxcar.found.length === 3 && !out.boxcar.bail;
      return { ok, detail: JSON.stringify(out) };
    },
  },
  // ---------------- phase 5: multiplayer (no real network: connections are faked) ----------------
  {
    name: 'multiplayer: Quick Join moves on to the next public room when one is full',
    run: async () => {
      const net = window.__game.net;
      const realJoin = net.join, realHost = net.host;
      const tried = [];
      net.join = async (code) => { tried.push('join ' + code); if (code === 'PUBLIC') throw Object.assign(new Error('full'), { type: 'room-full' }); if (code === 'PUBLIC2') throw Object.assign(new Error('x'), { type: 'peer-unavailable' }); return code; };
      net.host = async (code) => { tried.push('host ' + code); return code; };
      let got; try { got = await net.quickJoin(); } catch (e) { got = 'threw ' + e.type; }
      net.join = realJoin; net.host = realHost;
      return { ok: got === 'PUBLIC2' && tried.join(',') === 'join PUBLIC,join PUBLIC2,host PUBLIC2', detail: `${got} via ${tried.join(',')}` };
    },
  },
  {
    name: 'multiplayer: snapshots use the unordered channel, and late ones are dropped',
    run: () => {
      const g = window.__game, net = g.net;
      const mk = (peer) => { const c = { peer, open: true, sent: [], send(m) { this.sent.push(m); } }; return c; };
      const a = mk('peer-a'), b = mk('peer-b'), bState = mk('peer-b');
      const was = { isHost: net.isHost, status: net.status, myId: net.myId };
      net.isHost = true; net.status = 'host'; net.myId = 'me';
      for (const c of [a, b]) { net.conns.set(c.peer, c); net.onMessage({ t: 'hello', name: c.peer, colors: {} }, c); }
      net.stateConns.set('peer-b', bState);
      const d = g.player.snapshot();
      net.onMessage({ t: 's', n: 5, d }, a);
      net.onMessage({ t: 's', n: 3, d }, a);   // older: must be ignored
      net.onMessage({ t: 's', n: 6, d }, a);
      const pa = net.players.get('peer-a');
      const relayedOnState = bState.sent.filter((m) => m.t === 's' && m.id === 'peer-a').length;
      const relayedOnMain = b.sent.filter((m) => m.t === 's').length;
      const ok = pa.buf.length === 2 && pa.lastN === 6 && relayedOnState === 2 && relayedOnMain === 0;
      for (const id of ['peer-a', 'peer-b']) net.removePlayer(id, true);
      net.conns.clear(); net.stateConns.clear(); Object.assign(net, was);
      return { ok, detail: `kept=${pa.buf.length} lastN=${pa.lastN} relayed state=${relayedOnState} main=${relayedOnMain}` };
    },
  },
  {
    name: 'multiplayer: the host corrects a race time that does not match its own clock',
    run: () => {
      const g = window.__game, net = g.net;
      const was = { isHost: net.isHost, status: net.status, myId: net.myId };
      net.isHost = true; net.status = 'host'; net.myId = 'me';
      const c = { peer: 'peer-a', open: true, send() {} };
      net.conns.set('peer-a', c); net.onMessage({ t: 'hello', name: 'Cheater', colors: {} }, c);
      net.raceResults = { course: 'yard', list: [], startAt: Date.now() - 40000 };
      net.onMessage({ t: 'fin', course: 'yard', time: 5 }, c);       // claims 5 s, 40 s after GO
      const t = net.raceResults.list[0] && net.raceResults.list[0].time;
      net.raceResults = { course: 'yard', list: [], startAt: Date.now() - 40000 };
      net.onMessage({ t: 'fin', course: 'yard', time: 39.4 }, c);    // honest: within lag
      const t2 = net.raceResults.list[0] && net.raceResults.list[0].time;
      net.removePlayer('peer-a', true); net.conns.clear(); net.raceResults = null; Object.assign(net, was);
      document.getElementById('result').classList.add('hidden');
      return { ok: Math.abs(t - 40) < 1 && t2 === 39.4, detail: `claimed 5 -> ${t && t.toFixed(1)}; claimed 39.4 -> ${t2}` };
    },
  },
  {
    name: 'Game of BIKE: set, match, letters, elimination and a winner',
    run: () => {
      const g = window.__game, net = g.net, bike = g.bike;
      const was = { isHost: net.isHost, status: net.status, myId: net.myId };
      const realNow = net.now; let clock = 1e6; net.now = () => clock;
      net.isHost = true; net.status = 'host'; net.myId = 'me';
      const sent = [];
      for (const id of ['peer-a', 'peer-b']) { const c = { peer: id, open: true, send: (m) => sent.push(m) }; net.conns.set(id, c); net.onMessage({ t: 'hello', name: id === 'peer-a' ? 'Ana' : 'Ben', colors: {} }, c); }
      const started = bike.start();
      const s = bike.state, log = [];
      const conn = (id) => net.conns.get(id);
      // round 1: host sets; Ana matches, Ben runs out of time
      bike.reportLanding('Truckdriver', 900);
      log.push(s.phase + ':' + s.pending.join('+'));
      net.onMessage({ t: 'bikeLand', name: '360', pts: 300 }, conn('peer-a'));          // wrong trick
      net.onMessage({ t: 'bikeLand', name: 'Truckdriver', pts: 880 }, conn('peer-a'));  // match
      clock += 41000; bike.update();
      log.push(`B=${s.letters['peer-b']} setter=${s.setter}`);
      // Ben fails three more times -> out; then Ana vs host until someone wins
      let guard = 0;
      while (s.phase !== 'over' && guard++ < 300) {
        if (s.phase === 'set') { const id = s.setter; if (id === 'me') bike.reportLanding('Tailwhip', 700); else net.onMessage({ t: 'bikeLand', name: 'Tailwhip', pts: 700 }, conn(id)); }
        else {
          // the host always matches; nobody else does
          if (s.pending.includes('me')) bike.reportLanding(s.trick.name, 700);
          if (s.phase === 'match') { clock += 41000; bike.update(); }
        }
      }
      const hud = bike.hud();
      const ok = started && log[0] === 'match:peer-a+peer-b' && log[1] === 'B=1 setter=peer-a' && s.phase === 'over' && s.winner === 'me'
        && s.letters['peer-a'] === 4 && s.letters['peer-b'] === 4 && sent.some((m) => m.t === 'bike') && hud && /You win/.test(hud.line);
      for (const id of ['peer-a', 'peer-b']) net.removePlayer(id, true);
      net.conns.clear(); bike.state = null; net.now = realNow; Object.assign(net, was);
      return { ok, detail: `${log.join(' | ')} | end=${s.phase} winner=${s.winner} letters=${JSON.stringify(s.letters)} hud=${hud && hud.line}` };
    },
  },
  {
    name: 'Game of BIKE: a client rebuilds a safe state from the host broadcast',
    run: () => {
      const g = window.__game, net = g.net, bike = g.bike;
      const was = { isHost: net.isHost, status: net.status, myId: net.myId };
      net.isHost = false; net.status = 'client'; net.myId = 'me';
      net.onMessage({ t: 'bike', id: 'host', s: { phase: 'match', order: ['host', 'me'], names: { host: '<img src=x onerror=1>', me: 'Me' }, letters: { host: 0, me: 2 }, setter: 'host', trick: { name: 'Flipwhip', pts: 2000 }, pending: ['me'], deadline: net.now() + 20000, msg: 'x' } }, { peer: 'host' });
      const h = bike.hud();
      const ok = !!h && /Match it: Flipwhip/.test(h.line) && h.mine === 'B I · ·' && !/[<>]/.test(h.board);
      bike.state = null; Object.assign(net, was);
      return { ok, detail: h ? `${h.line} | ${h.mine} | ${h.board}` : 'no hud' };
    },
  },
  {
    name: 'multiplayer: watching a rider freezes you and follows them; leaving restores control',
    run: () => {
      const g = window.__game, net = g.net, sim = window.__sim;
      sim.reset();
      const was = { isHost: net.isHost, status: net.status, myId: net.myId };
      net.isHost = true; net.status = 'host'; net.myId = 'me';
      const c = { peer: 'peer-a', open: true, send() {} };
      net.conns.set('peer-a', c); net.onMessage({ t: 'hello', name: 'Ana', colors: {} }, c);
      const rp = net.players.get('peer-a');
      rp.model.root.position.set(20, g.world.anchors.yy, 20);
      g.spectate('peer-a');
      const frozen = g.player.frozen, following = g.specView && g.specView.pos === rp.model.root.position;
      g.cam.update(1 / 60, g.specView, { orbitX: 0, orbitY: 0 }, true);
      const near = g.camera.position.distanceTo(rp.model.root.position) < 12;
      net.removePlayer('peer-a', true); // they left: we get our bike back
      const restored = !g.spectating && !g.player.frozen;
      net.conns.clear(); Object.assign(net, was);
      return { ok: frozen && following && near && restored, detail: `frozen=${frozen} following=${following} camNear=${near} restored=${restored} cam=${g.camera.position.toArray().map((v) => v.toFixed(1))} mode=${g.cam.mode}` };
    },
  },
  {
    name: 'camera: resetting right after a hard landing does not throw the camera away',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset();
      g.cam.addDip(1); g.cam.addShake(0.8);
      g.cam.update(1 / 60, p, { orbitX: 0, orbitY: 0 });
      g.cam.update(0.5, p, { orbitX: 0, orbitY: 0 });   // one very long frame
      g.resetRider();
      g.cam.update(1 / 60, p, { orbitX: 0, orbitY: 0 });
      const d = g.camera.position.distanceTo(p.pos);
      return { ok: isFinite(d) && d < 12, detail: `camera is ${d.toFixed(1)} m from the rider` };
    },
  },
  // ---------------- phase 6: sharing and polish ----------------
  {
    name: 'replay: the last ride plays back on the rider and exiting restores them',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim, R = g.replay;
      sim.reset(-60, 30, Math.PI / 2);
      R.buf.length = 0;
      for (let i = 0; i < 240; i++) { sim.step(1, { pedal: 1 }); R.record(1 / 60); }
      const end = p.pos.clone();
      const entered = R.enter();
      R.t = R.t0 + 0.2; R.setPlaying(false);
      R.update(1 / 60, g.input.blank());
      const back = end.distanceTo(p.model.root.position);       // early in the ride: well behind where we stopped
      R.setPlaying(true);
      for (let i = 0; i < 60; i++) R.update(1 / 60, g.input.blank());
      const moved = Math.abs(R.t - (R.t0 + 0.2) - 1) < 0.05;
      R.exit();
      const restored = p.model.root.position.distanceTo(end) < 0.7 && !R.active && !document.getElementById('hud').classList.contains('hidden');
      return { ok: entered && R.seconds > 3 && back > 8 && moved && restored, detail: `entered=${entered} buffer=${R.seconds.toFixed(1)}s rewound=${back.toFixed(1)}m playhead=${moved} restored=${restored}` };
    },
  },
  {
    name: 'replay: Save clip produces a video file',
    run: async () => {
      const g = window.__game, sim = window.__sim, R = g.replay;
      if (!R.canSaveClip()) return { ok: true, detail: 'skipped: this browser has no MediaRecorder' };
      sim.reset(-60, 30, Math.PI / 2);
      R.buf.length = 0;
      for (let i = 0; i < 90; i++) { sim.step(1, { pedal: 1 }); R.record(1 / 60); }
      const realClick = HTMLAnchorElement.prototype.click; let downloaded = '';
      HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
      R.enter(); R.lastClip = null;
      R.saveClip();
      const recording = !!R.rec;
      for (let i = 0; i < 400 && R.rec; i++) { R.update(1 / 30, g.input.blank()); g.composer.render(1 / 30); await new Promise((r) => setTimeout(r, 15)); }
      for (let i = 0; i < 100 && !R.lastClip; i++) await new Promise((r) => setTimeout(r, 30));
      HTMLAnchorElement.prototype.click = realClick;
      const clip = R.lastClip;
      R.exit();
      return { ok: recording && !!clip && clip.size > 2000 && /^rampedup-clip-\d+\.(webm|mp4)$/.test(downloaded), detail: clip ? `${clip.type}, ${(clip.size / 1024).toFixed(0)} KB, ${downloaded}` : `no clip (recording started: ${recording})` };
    },
  },
  {
    name: 'settings: quality switches live without a reload',
    run: () => {
      const g = window.__game;
      const before = g.settings.quality;
      const errs = [];
      for (const q of ['medium', 'low']) {
        try { g.setQuality(q); g.composer.render(0.016); } catch (e) { errs.push(q + ': ' + e.message); }
      }
      const size = g.env.sun.shadow.mapSize.x;
      g.setQuality(before); g.composer.render(0.016);
      return { ok: !errs.length && size === 1024 && g.settings.quality === before, detail: errs.join('; ') || `shadow map ${size}px at Low, back to ${before}` };
    },
  },
  {
    name: 'app: manifest, icons, service worker and link preview are present and valid',
    run: async () => {
      const m = await fetch('manifest.webmanifest').then((r) => r.json());
      const missing = [];
      for (const i of m.icons) { const r = await fetch(i.src); if (!r.ok) missing.push(i.src); }
      for (const f of ['sw.js', 'og.jpg']) { const r = await fetch(f); if (!r.ok) missing.push(f); }
      const linked = !!document.querySelector('link[rel=manifest]') && !!document.querySelector('meta[property="og:image"]');
      return { ok: !missing.length && linked && m.display === 'fullscreen' && m.icons.length >= 3, detail: missing.length ? 'missing: ' + missing.join(', ') : `${m.icons.length} icons, display=${m.display}` };
    },
  },
  // ---------------- phase 7: world and visuals ----------------
  {
    name: 'visuals: every time of day, including Night, renders without errors',
    run: async () => {
      const g = window.__game;
      const { TIMES } = await import('./js/world.js');
      const errs = [], keys = Object.keys(TIMES);
      for (const k of keys) { try { g.env.setTime(k); g.composer.render(0.016); } catch (e) { errs.push(k + ': ' + e.message); } }
      const nightGlow = (g.env.setTime('night'), g.env.glowMat && g.env.glowMat.opacity > 0.5);
      const dayGlow = (g.env.setTime('midday'), g.env.glowMat.opacity === 0);
      g.env.setTime(g.settings.time);
      return { ok: !errs.length && keys.includes('night') && nightGlow && dayGlow, detail: errs.join('; ') || `${keys.join(', ')}; lamp pools on at night=${nightGlow}, off by day=${dayGlow}` };
    },
  },
  {
    name: 'visuals: course start beams fade out when the camera is inside them',
    run: () => {
      const g = window.__game, sim = window.__sim, C = g.courses;
      sim.reset();
      const m = C.markers[0];
      g.camera.position.set(m.grp.position.x, m.grp.position.y + 1.5, m.grp.position.z);
      C.update(1 / 60);
      const inside = m.beam.material.uniforms.uFade.value;
      g.camera.position.set(m.grp.position.x + 30, m.grp.position.y + 3, m.grp.position.z);
      C.update(1 / 60);
      const away = m.beam.material.uniforms.uFade.value;
      return { ok: inside === 0 && away === 1, detail: `fade inside=${inside} at 30 m=${away}` };
    },
  },
  {
    name: 'visuals: Loam Woods is wooded, and the jump lines are still clear of trees',
    run: () => {
      const w = window.__game.world;
      const inZone = w.treePoints.filter(([x, z]) => Math.abs(x - 300) < 45 && Math.abs(z + 40) < 120);
      const onLine = inZone.filter(([x, z]) => [288, 313, 329].some((lx) => Math.abs(x - lx) < 6.5) || z > 66 || z < -122);
      return { ok: inZone.length >= 40 && onLine.length === 0, detail: `${inZone.length} trees inside the spot, ${onLine.length} on a line` };
    },
  },
  // ---------------- tweaks ----------------
  {
    name: 'courses: R restarts even in the middle of a crash',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset();
      const c = g.courses.list.find((x) => x.id === 'yard');
      g.courses.start(c, { countdownFrom: 0.05 });
      sim.step(10, {});
      const first = g.courses.run;
      p.doBail('hard');
      sim.step(5, {});
      g.resetRider();
      const r = g.courses.run;
      const ok = r && r !== first && r.state === 'countdown' && p.mode === 'ground' && Math.hypot(p.pos.x - c.start.x, p.pos.z - c.start.z) < 1;
      g.courses.cancel(true);
      return { ok, detail: `restarted=${r !== first} mode=${p.mode}` };
    },
  },
  {
    name: 'courses: each gate shows how far ahead or behind your best run you are',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset();
      const c = g.courses.list.find((x) => x.id === 'yard');
      const el = document.getElementById('hud-split');
      const gate = c.gates[0];
      const pass = (pb) => {
        if (pb) localStorage.setItem('rampedup.splits.yard', JSON.stringify(pb)); else localStorage.removeItem('rampedup.splits.yard');
        localStorage.removeItem('rampedup.ghost.yard');
        g.courses.start(c, { countdownFrom: 0.05 });
        sim.step(10, {});
        p.spawn(gate.x, gate.z + 3, Math.PI);
        for (let i = 0; i < 300 && g.courses.run.idx < 1; i++) sim.step(1, { pedal: 1 });
        const t = g.courses.run.splits[0];
        const out = { text: el.textContent, ahead: el.classList.contains('ahead'), behind: el.classList.contains('behind'), t };
        g.courses.cancel(true);
        return out;
      };
      const none = pass(null), slowPb = pass([99, 120]), fastPb = pass([0.1, 0.2]);
      localStorage.removeItem('rampedup.splits.yard');
      const ok = /^\d+:\d\d\.\d\d$/.test(none.text) && !none.ahead && !none.behind
        && slowPb.ahead && slowPb.text.startsWith('−') && fastPb.behind && fastPb.text.startsWith('+')
        && Math.abs(parseFloat(fastPb.text.slice(1)) - (fastPb.t - 0.1)) < 0.02;
      return { ok, detail: `no best: "${none.text}" · beating best: "${slowPb.text}" · behind best: "${fastPb.text}"` };
    },
  },
  {
    name: 'courses: split times are read off an old ghost when none were saved',
    run: () => {
      const g = window.__game;
      const c = g.courses.list.find((x) => x.id === 'yard');
      // a ghost that passes gate 1 at 4 s and gate 2 at 9 s
      const g1 = c.gates[0], g2 = c.gates[1];
      const frame = (t, x, z) => [t, x, 2, z, 0, 0, 0, 1];
      const ghost = [frame(0, c.start.x, c.start.z), frame(2, g1.x, g1.z + 20), frame(4, g1.x, g1.z), frame(7, g2.x, g2.z + 15), frame(9, g2.x, g2.z), frame(10, g2.x, g2.z - 5)];
      const s = g.courses.splitsFromGhost(c, ghost);
      return { ok: Array.isArray(s) && s[0] === 4 && s[1] === 9 && s.length === 2, detail: JSON.stringify(s) };
    },
  },
  {
    name: 'modded mode: the bike is faster, and nothing is recorded',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      const top = () => { sim.reset(-70, 62, Math.PI / 2); let v = 0; for (let i = 0; i < 600; i++) { sim.step(1, { pedal: 1 }); v = Math.max(v, p.speed); if (p.pos.x > 60) break; } return v; };
      g.settings.mod = { on: false, speed: 2, accel: 3 }; g.applySettings();
      const stock = top();
      g.settings.mod.on = true; g.applySettings();
      const modded = top();
      const xp0 = g.progress.xp, done0 = g.goals.done.size;
      g.progress.add(500, 'test');
      g.goals.onEvent({ type: 'bank', score: 999999 });
      const c = g.courses.list.find((x) => x.id === 'yard');
      const best0 = g.courses.best.yard;
      g.courses.start(c, { countdownFrom: 0.05 }); sim.step(10, {});
      g.courses.run.idx = c.gates.length - 1; g.courses.run.time = 1; // about to finish in an impossible time
      const last = c.gates[c.gates.length - 1];
      p.spawn(last.x, last.z + 2, Math.PI); sim.step(60, { pedal: 1 });
      const finished = !g.courses.run;
      const badge = !document.getElementById('hud-modded').classList.contains('hidden');
      const kept = g.courses.best.yard === best0 && g.progress.xp === xp0 && g.goals.done.size === done0;
      g.settings.mod.on = false; g.applySettings();
      document.getElementById('result').classList.add('hidden');
      const off = document.getElementById('hud-modded').classList.contains('hidden') && p.modSpeed === 1;
      return { ok: stock < 13 && modded > stock * 1.5 && finished && kept && badge && off, detail: `top speed ${Math.round(stock * 3.6)} -> ${Math.round(modded * 3.6)} km/h, finished=${finished}, records untouched=${kept}, badge=${badge}` };
    },
  },
  {
    name: 'performance: when resolution is already at its floor, quality drops a tier (and can be turned off)',
    run: () => {
      const g = window.__game;
      const before = g.settings.quality;
      g.noAdapt = false; g.playing = true; g.paused = false;
      g.setQuality('medium', true); g.settings.autoQuality = true;
      for (let i = 0; i < 20 * 40; i++) g.adaptResolution(1 / 20);
      const dropped = g.settings.quality;
      g.setQuality('medium', true); g.settings.autoQuality = false;
      for (let i = 0; i < 20 * 40; i++) g.adaptResolution(1 / 20);
      const kept = g.settings.quality, scale = g.perf.scale;
      g.settings.autoQuality = true; g.setQuality(before, true); g.noAdapt = true;
      return { ok: dropped === 'low' && kept === 'medium' && scale === 0.5, detail: `auto on: medium -> ${dropped}; auto off: stays ${kept} at ${scale}× resolution` };
    },
  },
  {
    name: 'rendering: every quality still draws a real picture after switching to it',
    run: new Function(`
      const g = window.__game, sim = window.__sim;
      const before = g.settings.quality, out = {}, bad = [];
      for (const q of ['low', 'medium', 'high']) {
        g.setQuality(q, true); g.env.setTime('midday'); sim.reset(); g.cam.snap(g.player);
        const r = (${PICTURE})(g);
        out[q] = r.text; for (const b of r.bad) bad.push(q + ': ' + b);
      }
      g.setQuality(before, true); g.env.setTime(g.settings.time); g.composer.render(0.016);
      return { ok: !bad.length, detail: bad.length ? bad.join('; ') : JSON.stringify(out) };
    `),
  },
  {
    name: 'performance: trees do not cast shadows on Low, and do on High',
    run: () => {
      const g = window.__game;
      const before = g.settings.quality;
      g.setQuality('low', true);
      const low = g.world.treeMeshes.some((m) => m.castShadow);
      g.setQuality('high', true);
      const high = g.world.treeMeshes.every((m) => m.castShadow);
      g.setQuality(before, true); g.composer.render(0.016);
      return { ok: !low && high && g.renderer.shadowMap.autoUpdate === true, detail: `low casts=${low} high casts=${high}` };
    },
  },
  {
    name: 'modded mode: jump power, gravity and no-crash landings take effect and switch off cleanly',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      const hop = () => { sim.reset(-60, 30, Math.PI / 2); sim.step(20, { hop: true }); sim.step(1, { hopReleased: true }); let top = 0, air = 0; for (let i = 0; i < 600 && (i < 3 || p.mode === 'air'); i++) { sim.step(1, {}); top = Math.max(top, p.pos.y); air++; } return { h: top - g.world.anchors.yy, air: air / 60 }; };
      const set = (m) => { g.settings.mod = Object.assign({ on: true, speed: 1, accel: 1, jump: 1, gravity: 1, spin: 1, flip: 1, balance: false, nobail: false }, m); g.applySettings(); };
      set({ on: false }); const stock = hop();
      set({ jump: 2 }); const jump = hop();
      set({ gravity: 0.5 }); const moon = hop();
      // no-crash: come down sideways and mid-flip
      set({ nobail: true });
      sim.reset(-60, 30, Math.PI / 2); p.vel.set(7, 0, 0); sim.step(12, { hop: true }); sim.step(1, { hopReleased: true });
      p.heading += 1.5; p.air.flip = 2.4;
      sim.step(120, {});
      const stuck = !sim.has('ev:bail') && p.mode !== 'bail';
      set({ on: false });
      sim.reset(-60, 30, Math.PI / 2); p.vel.set(7, 0, 0); sim.step(12, { hop: true }); sim.step(1, { hopReleased: true });
      p.heading += 1.5; p.air.flip = 2.4;
      sim.step(120, {});
      const normalBails = sim.has('ev:bail');
      sim.step(300, {}); sim.reset();
      const ok = jump.h > stock.h * 2.5 && moon.air > stock.air * 1.6 && stuck && normalBails && p.grav === 11 && p.modJump === 1;
      return { ok, detail: `hop height ${stock.h.toFixed(2)} m -> ${jump.h.toFixed(2)} m at 2× jump; airtime ${stock.air.toFixed(2)} s -> ${moon.air.toFixed(2)} s at half gravity; no-crash landing stuck=${stuck}; same landing normally bails=${normalBails}` };
    },
  },
  {
    name: 'respawn: coming back to a spot up on the mega ramp puts you on it, not underneath',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim, A = g.world.anchors;
      // free riding on the deck, then a crash
      sim.reset(A.megaDeck.x, A.megaDeck.z, 0, true);
      const deckY = p.pos.y;
      p.lastSafe.pos.copy(p.pos);
      p.doBail('hard'); sim.step(30, {}); p.ragdoll.active = false; p.respawnSafe();
      const free = Math.abs(p.pos.y - deckY) < 0.6;
      // Big Air Send: pass the air gate, crash, and press Backspace (last gate)
      const c = g.courses.list.find((x) => x.id === 'bigair');
      g.courses.start(c, { countdownFrom: 0.05 }); sim.step(10, {});
      const startY = p.pos.y;
      const gate = c.gates[0];
      p.pos.set(gate.x, gate.base, gate.z); p.mode = 'air'; p.air = { t: 1, tricks: [], flip: 0, spin: 0 }; // flying through the ring
      g.courses.update(1 / 60);
      const passed = g.courses.run.idx === 1;
      p.air = null; p.mode = 'ground';
      p.doBail('hard'); sim.step(30, {}); p.ragdoll.active = false;
      g.backToSafe();
      const back = Math.abs(p.pos.y - startY) < 0.6 && Math.hypot(p.pos.x - c.start.x, p.pos.z - c.start.z) < 1.5;
      // and we can ride away from there
      sim.step(120, { pedal: 1 });
      const moved = Math.hypot(p.pos.x - c.start.x, p.pos.z - c.start.z) > 3;
      g.courses.cancel(true);
      return { ok: free && passed && back && moved, detail: `free ride back on deck=${free} (deck ${deckY.toFixed(1)} m), air gate passed=${passed}, back at start on the deck=${back}, can ride off=${moved}` };
    },
  },
  {
    name: 'respawn: a gate on top of a container brings you back on top of it',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      const c = g.courses.list.find((x) => x.id === 'docks');
      const k = c.gates.findIndex((gt) => gt.top);
      g.courses.start(c, { countdownFrom: 0.05 }); sim.step(10, {});
      const gt = c.gates[k];
      g.courses.run.idx = k;
      p.spawn(gt.x, gt.z, -Math.PI / 2, true); g.courses.update(1 / 60);
      const passed = g.courses.run.idx === k + 1;
      p.pos.set(gt.x - 30, g.world.anchors.docksY, gt.z + 20);  // somewhere else, on the ground
      g.backToSafe();
      const onTop = Math.abs(p.pos.y - gt.base) < 0.6;
      g.courses.cancel(true);
      return { ok: passed && onTop, detail: `passed=${passed} height ${p.pos.y.toFixed(1)} m vs gate ${gt.base.toFixed(1)} m` };
    },
  },
  {
    name: 'graphics key: G steps through the qualities and the hint bar shows the current one',
    run: () => {
      const g = window.__game, sim = window.__sim;
      sim.reset();
      const before = g.settings.quality;
      g.setQuality('low', true);
      g.cycleQuality();
      const q1 = g.settings.quality, chosen = g.settings.qualityChosen;
      for (let i = 0; i < 25; i++) g.ui.update(1 / 60);
      const hint = document.getElementById('hud-hints').textContent;
      g.setQuality(before, true); g.settings.qualityChosen = false; g.composer.render(0.016);
      return { ok: q1 === 'medium' && chosen === true && /G\s+graphics: medium/i.test(hint) && g.input.label('quality') === 'G', detail: `low -> ${q1}; hint bar: "${hint.replace(/\s+/g, ' ').trim()}"` };
    },
  },
  {
    name: 'mods: the pause menu has a Mods panel that controls the bike',
    run: () => {
      const g = window.__game, p = g.player;
      g.playing = true; g.setPaused(true);
      const btn = document.querySelector('#pause [data-panel=mods]');
      btn.click();
      const panel = document.querySelector('#pause-panel-host .panel');
      const on = panel.querySelector('[data-bind=modon]'), jump = panel.querySelector('[data-bind=modjump]');
      on.checked = true; on.dispatchEvent(new Event('change', { bubbles: true }));
      jump.value = 2.5; jump.dispatchEvent(new Event('input', { bubbles: true }));
      const applied = g.modded && p.modJump === 2.5;
      panel.querySelector('[data-action=modreset]').click();
      on.checked = false; on.dispatchEvent(new Event('change', { bubbles: true }));
      const off = !g.modded && p.modJump === 1 && !document.querySelector('#tpl-settings').content.querySelector('[data-bind=modon]');
      g.setPaused(false);
      return { ok: !!btn && applied && off, detail: `applied=${applied} off=${off}` };
    },
  },
  {
    name: 'courses: the bike sits straight on the start line, whatever it was doing before',
    run: () => {
      const g = window.__game, p = g.player, sim = window.__sim;
      sim.reset(-60, 30, Math.PI / 2);
      // carve hard left with the bars turned, in a manual, mid-preload
      sim.step(90, { pedal: 1 }); sim.step(40, { pedal: 1, steer: 1, hop: true });
      const before = { steer: Math.abs(p.model.pose.steer), lean: Math.abs(p.lean) };
      const c = g.courses.list.find((x) => x.id === 'yard');
      g.courses.start(c);
      // keep holding steer through the countdown
      sim.step(60, { steer: 1 });
      const P = p.model.pose;
      const up = new (p.pos.constructor)(0, 1, 0).applyQuaternion(p.model.root.quaternion);
      const fwd = new (p.pos.constructor)(0, 0, 1).applyQuaternion(p.model.root.quaternion);
      const facing = Math.abs(Math.atan2(fwd.x, fwd.z) - c.start.yaw) % (Math.PI * 2);
      const ok = before.steer > 0.05 && before.lean > 0.05 && Math.abs(P.steer) < 0.01 && Math.abs(p.lean) < 0.01 && P.crouch < 0.05 && p.preload === 0
        && up.y > 0.995 && Math.min(facing, Math.PI * 2 - facing) < 0.02 && g.courses.run.state === 'countdown';
      g.courses.cancel(true);
      return { ok, detail: `before: bars ${before.steer.toFixed(2)} lean ${before.lean.toFixed(2)} · on the line: bars ${P.steer.toFixed(3)} lean ${p.lean.toFixed(3)} crouch ${P.crouch.toFixed(2)} upright ${up.y.toFixed(3)} off-heading ${Math.min(facing, Math.PI * 2 - facing).toFixed(3)}` };
    },
  },
  {
    name: 'HUD: the split time sits clear of the direction arrow',
    run: () => {
      const g = window.__game, sim = window.__sim;
      sim.reset();
      const hud = document.getElementById('hud'); hud.classList.remove('hidden');
      const c = g.courses.list.find((x) => x.id === 'yard');
      g.courses.start(c, { countdownFrom: 0.05 }); sim.step(10, {});
      for (let i = 0; i < 20; i++) g.ui.update(1 / 60);
      g.ui.splitPop(12.34, -0.42);
      const split = document.getElementById('hud-split').getBoundingClientRect();
      const arrow = document.getElementById('hud-compass').getBoundingClientRect();
      const shown = document.getElementById('hud-compass').classList.contains('on') && split.height > 0 && arrow.height > 0;
      const gap = arrow.top - split.bottom;
      g.courses.cancel(true);
      return { ok: shown && gap >= 4, detail: `split ends at ${Math.round(split.bottom)} px, arrow starts at ${Math.round(arrow.top)} px (gap ${Math.round(gap)} px), arrow shown=${shown}` };
    },
  },
  {
    name: 'audio: sound fades out when the tab is hidden and back in when it returns',
    run: async () => {
      const g = window.__game, a = g.audio;
      if (!a.sfx.master || !a.sfx.ctx) return { ok: false, detail: 'no audio engine' };
      const wasMuted = a.muted, wasVol = a.volume;
      a.muted = false; a.volume = 0.8; a.away = false; a.apply();
      try { await a.sfx.ctx.resume(); } catch (e) {}
      const running = a.sfx.ctx.state === 'running';
      const hide = (h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); };
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(250);
      const start = a.sfx.master.gain.value;
      hide(true);
      const tHidden = a.masterTarget;
      a.setVolume(0.8);                      // a settings change while away must not bring the sound back
      await wait(1500);
      const away = a.sfx.master.gain.value;
      hide(false);
      const tBack = a.masterTarget;
      await wait(2600);
      const back = a.sfx.master.gain.value;
      delete document.hidden;
      a.muted = wasMuted; a.volume = wasVol; a.away = false; a.apply();
      g.setPaused(false);
      // a headless browser may refuse to start audio; then only the targets can be checked
      const levels = !running || (start > 0.6 && away < 0.05 && back > 0.7);
      return { ok: tHidden === 0 && tBack === 0.8 && levels, detail: `audio running=${running}; level ${start.toFixed(2)} -> ${away.toFixed(2)} hidden -> ${back.toFixed(2)} back` };
    },
  },
  {
    name: 'world: the Channel floor is not level with the slab under it',
    run: () => {
      const g = window.__game, A = g.world.anchors, col = g.world.collision;
      const slab = A.channel.y;                 // top of the base slab
      const floor = col.ground(A.channel.x + 40, A.channel.z, slab + 1, { n: g.player.normal.clone() }).h;
      // everything that was built on the floor still stands on it
      const sim = window.__sim; sim.reset(A.channel.x - 50, A.channel.z, Math.PI / 2);
      sim.step(240, { pedal: 1 });
      return { ok: floor - slab > 0.02 && floor - slab < 0.06 && !sim.has('ev:bail'), detail: `floor is ${((floor - slab) * 100).toFixed(1)} cm above the slab; ride along it: ${sim.has('ev:bail') ? 'crashed' : 'clean'}` };
    },
  },
];

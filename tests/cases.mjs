// Test cases. Each `run` executes inside the page with `window.__game` (the game)
// and `window.__sim` (the driver from run.mjs) available, and returns { ok, detail }.

export const CASES = [
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
      return { ok: sim.has('ev:hop') && sim.has('ev:land') && !sim.has('ev:bail') && g.player.mode === 'ground', detail: sim.log.filter((l) => /bail|land|hop/.test(l)).join(',') };
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
    name: 'courses: reset returns to the last gate with the clock running; restart starts over',
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
      g.resetRider();
      const back = Math.hypot(p.pos.x - gate.x, p.pos.z - gate.z) < 1.5;
      const same = g.courses.run === r && r.state === 'running' && r.idx === 1 && r.time >= tBefore;
      g.restartCourse();
      const fresh = g.courses.run && g.courses.run !== r && g.courses.run.state === 'countdown';
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
];

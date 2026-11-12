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
];

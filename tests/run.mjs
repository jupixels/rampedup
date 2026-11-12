// Scripted test rides. Loads the real game in headless Chromium, stops the render
// loop and drives the simulation directly with synthetic input, so every case is
// deterministic enough to assert on.
//
//   npm test                 run everything
//   npm test -- flip manual  run cases whose name contains one of the words
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CASES } from './cases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.json': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

// Runs inside the page: a tiny driver around the game's own update functions.
function installSim() {
  const g = window.__game, p = g.player;
  g.renderer.setAnimationLoop(null);
  g.playing = true; g.noAdapt = true;
  const log = [];
  g.tricks.on((e) => { if (e.type !== 'trick') log.push(e.type + ':' + (e.name || e.reason || e.score || '')); });
  const DT = 1 / 60;
  const sim = {
    log,
    // advance n frames with the given input; perFrame(i) may return per-frame overrides
    step(n, over = {}, perFrame) {
      for (let i = 0; i < n; i++) {
        const s = Object.assign(g.input.blank(), over, perFrame ? perFrame(i) : {});
        g.input.state = s;
        p.update(DT, s);
        g.tricks.update(DT, p);
        for (const ev of p.events) log.push('ev:' + ev.type + (ev.reason ? ':' + ev.reason : ''));
        g.handlePlayerEvents();
        g.courses.update(DT);
      }
    },
    // put the rider somewhere, upright and stopped, with a clean slate
    reset(x = 0, z = 30, yaw = Math.PI, top = false) {
      if (g.courses.run) g.courses.cancel(true);
      if (p.mode === 'bail') { p.ragdoll.active = false; }
      p.spawn(x, z, yaw, top);
      p.preload = 0;
      g.tricks.combo = null;
      log.length = 0;
    },
    has(prefix) { return log.some((l) => l.startsWith(prefix)); },
  };
  window.__sim = sim;
}

const filters = process.argv.slice(2).map((s) => s.toLowerCase());
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let failed = 0, ran = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  // no outside network: fonts and the signalling server are not needed for these rides
  await page.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('rampedup.settings', JSON.stringify({ quality: 'low' })); } catch (e) {} });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__game.player && document.getElementById('loading').classList.contains('hidden'), null, { timeout: 180000 });
  await page.evaluate(installSim);
  for (const c of CASES) {
    if (filters.length && !filters.some((f) => c.name.toLowerCase().includes(f))) continue;
    ran++;
    let res;
    try { res = await page.evaluate(c.run); } catch (e) { res = { ok: false, detail: String(e) }; }
    if (!res || !res.ok) failed++;
    console.log(`${res && res.ok ? 'PASS' : 'FAIL'}  ${c.name}${res && res.detail ? '  — ' + (typeof res.detail === 'string' ? res.detail : JSON.stringify(res.detail)) : ''}`);
  }
  if (errors.length) { failed++; console.log('FAIL  page errors:\n  ' + errors.join('\n  ')); }
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${ran - Math.min(failed, ran)}/${ran} passed`);
process.exit(failed ? 1 : 0);

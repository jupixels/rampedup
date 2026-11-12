# Ramped Up

**Open-world BMX in your browser.** Dirt jump lines in the woods, a 24 m mega ramp, a concrete pool, a downhill trail off the top of a mountain, a container yard by the lake — and your friends riding it with you.

No install, no accounts, no build step. It runs straight from GitHub Pages.

## Play

Once GitHub Pages is enabled (see below) the game lives at:

```
https://jupixels.github.io/rampedup/
```

Share `?room=CODE` links to drop friends straight into your session.

## What's in it

- **An open world, ~1.6 km across** — seven riding spots connected by roads and trails:
  - **The Yard** (spawn) — skatepark with a vert ramp, mini halfpipe, funbox, spine, jump-box line, stairs, ledges, rails and a pump line.
  - **Loam Woods** — two dirt-jump lines (a flowy one and a big one) dropped in from a roll-in mound.
  - **Port Rusty** — shipping containers to gap, a warehouse roof gap, a kinked rail, a quay rail, a pipe, and a pier kicker that launches you into the lake.
  - **Big Air** — a 24 m mega ramp: roll-in, 15 m gap, landing, and a 9 m quarter pipe. Take the lift.
  - **The Pool** — a round concrete bowl with tile and coping.
  - **The Channel** — a 120 m banked concrete ditch.
  - **Summit Ridge** — the top of a ~870 m downhill trail with doubles, drops and rollers.
- **Real-feeling BMX physics** — pedalling, momentum, transitions and quarter pipes, vert airs that bring you back in, bunny hops (with late pop off lips), manuals, peg and ledge grinds with balance, and full ragdoll bails: rider and bike tumble separately with slow-mo and a caption for every crash.
- **Tricks & combos** — 180–1440 spins, front and back flips (doubles too), barspins, tailwhips, supermans, no-handers, can-cans, table tops and no-footers, plus five variations (X-up, turndown, tuck no-hander, seat grab, one-footer), lip tricks on coping, wallrides, fakie tricks and real names for classic combos (Truckdriver, Flipwhip, Flair…). Hold the button to extend a pose. Chain airs, grinds and manuals to build the multiplier; bail and the combo is gone.
- **Obstacle courses** — five timed gate courses plus two score-attack modes, bronze/silver/gold medals, personal bests, and a **ghost** of your best run to race.
- **Things to do everywhere** — 35 spot goals (five per spot, each revealed when you finish the one before), 29 named gaps to find, three daily challenges that are the same for every rider, 18 challenges, and **38 golden sprockets** that only appear on the map once you have been near them. A stats page keeps lifetime totals. Progress is saved in your browser.
- **Multiplayer** — peer-to-peer over WebRTC (PeerJS), so it works on static hosting. Quick Join a public room or host a private one with a 5-letter code. See other riders live with name tags, chat, a scoreboard, a trick feed, and **host-started races** with synced countdowns and results. If the host leaves, someone else takes over the room.
- **Looks** — physically based materials with procedurally generated textures, a physical sky with four times of day, soft sun shadows, image-based lighting, GPU grass that sways in the wind, thousands of instanced trees, water, clouds, bloom, optional ambient occlusion, and filmic tone mapping. Resolution scales automatically to keep the frame rate up.
- **Feel** — dust kicked up on landings and dirt, sparks off grinds, splashes, skid marks, confetti, a landing camera dip, a camera that pulls back on big airs, and a Perfect Landing bonus for smooth landings.
- **Progression** — XP from combos, courses, sprockets, challenges and the tutorial. Levels unlock paint jobs (raw steel, matte, chrome, gold, oil slick), rims, tyres, bars and helmets, and from level 16 pegs, seats, grips, shoes and gloves.
- **Music** — a generated lo-fi soundtrack that never quite repeats, muffled while paused.
- **Photo mode** (P) — freeze the moment, fly the camera, change the light and lens, hide the rider, and save a PNG.
- **Settings** — separate music and effects volume, camera distance, field of view, mouse sensitivity, invert, reduce motion, mph, minimap toggle.
- **Controls** — keyboard, gamepad (standard layout, including menu navigation) and touch. Every key and button can be rebound in Settings, and on-screen prompts follow the device you are using.

## New to BMX games?

Pick **Tutorial** in the main menu for a 16-step guided run (pedal, hop, air, spins, barspin, grind, lip trick, variations, manual, combos, flips, map), or open the **Guide** for every control, trick, spot and rule.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Pedal / brake | W / S | RT / LT |
| Steer · spin in the air | A / D | Left stick |
| Front / back flip (press once airborne) | W / S | Left stick ↑ / ↓ |
| Bunny hop (hold, release) | Space | A |
| Manual (balance with W/S; hold S for a nose manual) | Shift | LB |
| Revert out of fakie | S (tap) | LT / stick ↓ (tap) |
| Barspin · Tailwhip | J · K | X · Y |
| Superman · No Hander · Can Can | L · U · I | B · RB · D-pad ← |
| Table Top · No Footer | O · H | D-pad ↓ · ↑ |
| Start course / take lift | E | D-pad → |
| Back to last gate / safe spot | R | Back |
| Restart course | Backspace | pause menu |
| Camera · Map | C · M | Right stick click · Left stick click |
| Chat · Riders | T · Tab | — |
| Photo mode | P | — |
| Pause | Esc | Start |

Grinding is automatic: land on a rail or ledge roughly lined up with it. Hold W/S/A/D as you lock on to pick the grind (Icepick, Feeble, Smith…), balance with A/D, and hop off with Space.

## Deploy to GitHub Pages

The repo includes a workflow at `.github/workflows/pages.yml` that publishes the site on every push to `main`.

1. Push this repository to GitHub.
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push (or re-run the workflow). The URL appears in the workflow summary.

Alternatively choose **Deploy from a branch → `main` / root** — the game is plain static files, so that works too.

## Tests

Scripted test rides load the real game in headless Chromium and drive the physics with synthetic input:

```bash
npm install
npx playwright install chromium   # first time only
npm test                          # or: npm test -- manual gamepad
```

They run on every pull request, and a push to `main` only deploys if they pass. Add a case to `tests/cases.mjs` for each bug you fix.

## Run locally

Any static file server works (ES modules need `http://`, not `file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Multiplayer notes

- Signalling uses the free public PeerJS server; game traffic then goes directly between players over WebRTC.
- The host relays positions to everyone else, so a room works best with up to about 8 riders.
- Some strict corporate or mobile networks block peer-to-peer connections. If a friend can't connect, try another network.
- To use your own signalling server ([peerjs-server](https://github.com/peers/peerjs-server)), add `?peerhost=your.host&peerport=443&peerpath=/` to the URL.

## Project layout

```
index.html          menus, HUD markup, import map
css/style.css       UI styling
js/main.js          bootstrap, renderer, post-processing, main loop
js/world.js         sky, lighting, vegetation, water and every riding spot
js/terrain.js       heightmap generation, splat-mapped terrain shader
js/props.js         ramp builder (profiles → meshes + colliders), rails, containers…
js/collision.js     terrain + triangle-grid ground queries, rail registry
js/player.js        BMX physics, airs, grinds, manuals, bails
js/ragdoll.js       Verlet ragdoll for the rider and bike when you crash
js/tutorial.js      interactive tutorial
js/fx.js            particles and skid marks
js/progress.js      XP, levels and unlocks
js/music.js         generative soundtrack
js/photo.js         photo mode
js/bikeModel.js     procedural bike + rider with IK and trick poses
js/tricks.js        trick naming, scoring and combos
js/courses.js       courses, ghosts, golden sprockets, challenges
js/goals.js         spot goals, named gaps, daily challenges
js/network.js       PeerJS multiplayer
js/ui.js            menus, HUD, minimap, map, chat, touch controls
js/audio.js         sound effects + procedural tyre/wind/freewheel layers
js/textures.js      procedural PBR textures (no image assets), built in Web Workers
js/texpixels.js     pure pixel programs for the textures
js/texworker.js     texture worker
vendor/             three.js r186, PeerJS 1.5.5, sfx.js
sounds/             sound effects
```

Everything world-related is seeded, so every player generates exactly the same world.

## Credits

- Rendering: [three.js](https://threejs.org) (MIT)
- Networking: [PeerJS](https://peerjs.com) (MIT)
- Sound effects: [Kenney](https://kenney.nl) (CC0) via the game-sounds library
- Fonts: Anton and Barlow Condensed from Google Fonts (OFL)

Game code is released under the MIT License — see `LICENSE`.

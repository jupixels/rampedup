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
- **Tricks & combos** — 180–1440 spins, front and back flips (doubles too), barspins, tailwhips, supermans, no-handers, can-cans, table tops and no-footers. Hold the button to extend a pose. Chain airs, grinds and manuals to build the multiplier; bail and the combo is gone.
- **Obstacle courses** — five timed gate courses plus two score-attack modes, bronze/silver/gold medals, personal bests, and a **ghost** of your best run to race.
- **38 golden sprockets** hidden around the world and **18 challenges** to complete. Progress is saved in your browser.
- **Multiplayer** — peer-to-peer over WebRTC (PeerJS), so it works on static hosting. Quick Join a public room or host a private one with a 5-letter code. See other riders live with name tags, chat, a scoreboard, a trick feed, and **host-started races** with synced countdowns and results. If the host leaves, someone else takes over the room.
- **Looks** — physically based materials with procedurally generated textures, a physical sky with four times of day, soft sun shadows, image-based lighting, GPU grass that sways in the wind, thousands of instanced trees, water, clouds, bloom, optional ambient occlusion, and filmic tone mapping. Resolution scales automatically to keep the frame rate up.
- **Controls** — keyboard, gamepad (standard layout) and touch.

## New to BMX games?

Pick **Tutorial** in the main menu for a 14-step guided run (pedal, hop, air, spins, barspin, grind, manual, combos, flips, map), or open the **Guide** for every control, trick, spot and rule.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Pedal / brake | W / S | RT / LT |
| Steer · spin in the air | A / D | Left stick |
| Front / back flip (air) | W / S | Left stick ↑ / ↓ |
| Bunny hop (hold, release) | Space | A |
| Manual (balance with W/S) | Shift | LB |
| Barspin · Tailwhip | J · K | X · Y |
| Superman · No Hander · Can Can | L · U · I | B · LB · RB |
| Table Top · No Footer | O · H | D-pad ↓ · ↑ |
| Start course / take lift | E | D-pad ← / → |
| Reset to last safe spot | R | Back |
| Camera · Map · Chat · Riders | C · M · T · Tab | Stick click |
| Pause | Esc | Start |

Grinding is automatic: land on a rail or ledge roughly lined up with it. Hold W/S/A/D as you lock on to pick the grind (Icepick, Feeble, Smith…), balance with A/D, and hop off with Space.

## Deploy to GitHub Pages

The repo includes a workflow at `.github/workflows/pages.yml` that publishes the site on every push to `main`.

1. Push this repository to GitHub.
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push (or re-run the workflow). The URL appears in the workflow summary.

Alternatively choose **Deploy from a branch → `main` / root** — the game is plain static files, so that works too.

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
js/bikeModel.js     procedural bike + rider with IK and trick poses
js/tricks.js        trick naming, scoring and combos
js/courses.js       courses, ghosts, golden sprockets, challenges
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

// World layout: zones, roads and trails. Shared by terrain generation, props,
// courses and the map, so everything lines up.

export const WORLD = {
  size: 1600,          // metres, square, centred on the origin
  segments: 320,       // terrain grid resolution (5 m cells)
  waterLevel: -2,
  seed: 1337,
};

// Rectangular flattened zones. h: target height (null = sample natural terrain at centre)
export const ZONES = {
  yard:   { name: 'The Yard',     x: 0,    z: 0,    hx: 78,  hz: 68,  h: 2,    falloff: 35, surface: 'concrete', color: '#ff5a1f', blurb: 'Skatepark, spawn & hub' },
  woods:  { name: 'Loam Woods',   x: 300,  z: -40,  hx: 45,  hz: 120, h: null, falloff: 30, surface: 'dirt',     color: '#c58a4a', blurb: 'Dirt jump lines in the trees' },
  docks:  { name: 'Port Rusty',   x: -320, z: 40,   hx: 100, hz: 85,  h: 1,    falloff: 22, surface: 'concrete', color: '#3fa7ff', blurb: 'Containers, rails & a lake launch' },
  bigair: { name: 'Big Air',      x: 40,   z: 398,  hx: 36,  hz: 162, h: null, falloff: 30, surface: 'concrete', color: '#ffd21f', blurb: 'Mega ramp. Commit.' },
  pool:   { name: 'The Pool',     x: -120, z: 150,  hx: 20,  hz: 20,  h: null, falloff: 22, surface: 'concrete', color: '#ff5fa2', blurb: 'Concrete bowl. Carve it.' },
  channel:{ name: 'The Channel',  x: 170,  z: -160, hx: 66,  hz: 14,  h: null, falloff: 24, surface: 'concrete', color: '#b28cff', blurb: 'Long banked concrete ditch' },
  summit: { name: 'Summit Ridge', x: -40,  z: -560, hx: 16,  hz: 16,  h: null, falloff: 18, surface: 'dirt',     color: '#8be07a', blurb: 'Top of the downhill trail' },
};

export const MOUNTAIN = { x: -40, z: -560, height: 130, sigma: 175 };
export const LAKE = { x: -610, z: 110, radius: 200, depth: 14 };

// Downhill trail from the summit to the north edge of The Yard
export const TRAIL = [
  [-40, -560], [30, -540], [85, -490], [95, -440], [40, -405], [-40, -385],
  [-105, -345], [-115, -300], [-60, -262], [20, -240], [80, -205], [95, -160],
  [55, -125], [10, -100], [0, -72],
];

// Roads connecting the zones (polyline, width)
export const ROADS = [
  { pts: [[78, 0], [140, -10], [200, -30], [255, -40]], width: 6 },          // yard -> woods
  { pts: [[-78, 10], [-140, 20], [-200, 35], [-220, 40]], width: 7 },        // yard -> docks
  { pts: [[20, 68], [30, 130], [45, 200], [60, 250]], width: 6 },           // yard -> big air
  { pts: [[255, 80], [200, 160], [120, 230], [76, 250]], width: 5 },        // woods -> big air loop
  { pts: [[-220, 120], [-160, 200], [-60, 240], [4, 250]], width: 5 },      // docks -> big air loop
];

export const SPAWN = { x: 0, z: 30, yaw: Math.PI }; // facing north (-Z)

export const FAST_TRAVEL = [
  { id: 'yard', label: 'The Yard', x: 0, z: 30, yaw: Math.PI },
  { id: 'woods', label: 'Loam Woods', x: 288, z: 80, yaw: Math.PI, deck: true },
  { id: 'docks', label: 'Port Rusty', x: -228, z: 62, yaw: -Math.PI / 2 },
  { id: 'bigair', label: 'Big Air (deck)', x: 40, z: 243, yaw: 0, deck: true },
  { id: 'summit', label: 'Summit Ridge', x: -36, z: -556, yaw: 1.2 },
  { id: 'pool', label: 'The Pool', x: -120, z: 163, yaw: Math.PI, deck: true },
  { id: 'channel', label: 'The Channel', x: 100, z: -160, yaw: Math.PI / 2 },
];

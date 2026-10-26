// Static collision world: terrain heightfield + a uniform grid of prop triangles
// (only up-facing surfaces are stored: they define "ground"; walls are inferred
// from tall surfaces), plus grindable rail segments.
import * as THREE from 'three';

const CELL = 4;
const key = (ix, iz) => ((ix + 1024) << 11) | (iz + 1024);

export class Collision {
  constructor(terrain) {
    this.terrain = terrain;
    this.grid = new Map();
    this.tris = []; // flat numeric arrays
    this.data = null;
    this.rails = [];
    this.railGrid = new Map();
    this._n = new THREE.Vector3();
    this.waterLevel = -1e9;
  }

  addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, surface = 'concrete') {
    // normal
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } // we only care about the surface, not winding
    if (ny < 0.06) return; // vertical faces are inferred
    const id = this.tris.length;
    const d = nx * ax + ny * ay + nz * az;
    this.tris.push({ ax, az, bx, bz, cx, cz, nx, ny, nz, d, surface, maxY: Math.max(ay, by, cy) });
    const minX = Math.floor(Math.min(ax, bx, cx) / CELL), maxX = Math.floor(Math.max(ax, bx, cx) / CELL);
    const minZ = Math.floor(Math.min(az, bz, cz) / CELL), maxZ = Math.floor(Math.max(az, bz, cz) / CELL);
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) {
      const k = key(ix, iz);
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(id);
    }
  }

  addMesh(mesh, surface) {
    mesh.updateWorldMatrix(true, false);
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const m = mesh.matrixWorld;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m);
      b.fromBufferAttribute(pos, ib).applyMatrix4(m);
      c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      this.addTriangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, surface);
    }
  }

  // Highest prop surface at (x,z) whose height is <= yMax (and > yMin)
  propAt(x, z, yMin, yMax) {
    const arr = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return null;
    let best = null, bestH = -1e9;
    const E = 1e-4;
    for (let i = 0; i < arr.length; i++) {
      const t = this.tris[arr[i]];
      // point in triangle (xz) via edge signs
      const d1 = (x - t.bx) * (t.az - t.bz) - (t.ax - t.bx) * (z - t.bz);
      const d2 = (x - t.cx) * (t.bz - t.cz) - (t.bx - t.cx) * (z - t.cz);
      const d3 = (x - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (z - t.az);
      const neg = d1 < -E || d2 < -E || d3 < -E;
      const pos = d1 > E || d2 > E || d3 > E;
      if (neg && pos) continue;
      const h = (t.d - t.nx * x - t.nz * z) / t.ny;
      if (h > yMax || h <= yMin) continue;
      if (h > bestH) { bestH = h; best = t; }
    }
    return best ? { h: bestH, tri: best } : null;
  }

  // Ground under a point: max(terrain, prop surface below yMax)
  ground(x, z, yMax, out) {
    const th = this.terrain.sample(x, z);
    const p = this.propAt(x, z, -1e9, yMax);
    if (p && p.h > th) {
      out.h = p.h; out.n.set(p.tri.nx, p.tri.ny, p.tri.nz); out.surface = p.tri.surface; out.prop = true;
    } else {
      out.h = th; this.terrain.normal(x, z, out.n); out.surface = this.terrain.surfaceAt(x, z); out.prop = false;
    }
    out.water = out.h < this.waterLevel;
    return out;
  }

  // Is there a surface between yLo and yHi? (used for wall detection) returns its height or null
  obstacle(x, z, yLo, yHi) {
    const th = this.terrain.sample(x, z);
    let best = th > yLo && th <= yHi ? th : null;
    const p = this.propAt(x, z, yLo, yHi);
    if (p && (best === null || p.h > best)) best = p.h;
    return best;
  }

  addRail(a, b, kind = 'rail') {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.divideScalar(len);
    const r = { a: a.clone(), b: b.clone(), dir, len, kind, id: this.rails.length };
    this.rails.push(r);
    const RC = 8;
    const minX = Math.floor(Math.min(a.x, b.x) / RC) - 1, maxX = Math.floor(Math.max(a.x, b.x) / RC) + 1;
    const minZ = Math.floor(Math.min(a.z, b.z) / RC) - 1, maxZ = Math.floor(Math.max(a.z, b.z) / RC) + 1;
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) {
      const k = key(ix, iz);
      let arr = this.railGrid.get(k);
      if (!arr) this.railGrid.set(k, (arr = []));
      arr.push(r);
    }
    return r;
  }

  railsNear(x, z) {
    return this.railGrid.get(key(Math.floor(x / 8), Math.floor(z / 8))) || [];
  }
}

export function makeGroundResult() {
  return { h: 0, n: new THREE.Vector3(0, 1, 0), surface: 'grass', prop: false, water: false };
}

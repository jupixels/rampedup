// Prop builders: ramps from 2D profiles, boxes, rails, containers, lamps...
// Static geometry is batched per material to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTex, pbr, graffitiTexture, decalTexture } from './textures.js';
import { TAU } from './util.js';

// ---------- Profiles (s = distance along +z, y = height) ----------
export class Profile {
  constructor(s = 0, y = 0) { this.pts = [[s, y]]; }
  get end() { return this.pts[this.pts.length - 1]; }
  to(s, y) { this.pts.push([s, y]); return this; }
  by(ds, dy) { const [s, y] = this.end; return this.to(s + ds, y + dy); }
  // circular arc: tangent angle from a0 to a1 (radians, 0 = flat, + = going up), radius R
  arc(R, a0, a1, steps = 12) {
    const [s0, y0] = this.end;
    // centre for this arc
    const sign = a1 > a0 ? 1 : -1; // concave (curving up) if angle increases
    const cx = s0 - sign * R * Math.sin(a0);
    const cy = y0 + sign * R * Math.cos(a0);
    for (let i = 1; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      this.pts.push([cx + sign * R * Math.sin(a), cy - sign * R * Math.cos(a)]);
    }
    return this;
  }
  line(angle, len) { return this.by(Math.cos(angle) * len, Math.sin(angle) * len); }
  down() { const [s] = this.end; return this.to(s, 0); }
  sine(len, amp, waves, steps = 40) {
    const [s0, y0] = this.end;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.pts.push([s0 + len * t, y0 + amp * (0.5 - 0.5 * Math.cos(t * waves * TAU))]);
    }
    return this;
  }
}

export const profiles = {
  kicker(h, angleDeg = 35) {
    const a = (angleDeg * Math.PI) / 180;
    const R = h / (1 - Math.cos(a));
    return new Profile().arc(R, 0, a, 14).down();
  },
  quarter(h, R, deck = 2, maxDeg = 82) {
    const amax = (maxDeg * Math.PI) / 180;
    const arcH = R * (1 - Math.cos(amax));
    const p = new Profile().arc(R, 0, Math.min(amax, Math.acos(Math.max(-1, 1 - h / R))), 22);
    if (arcH < h) p.line(amax, (h - p.end[1]) / Math.sin(amax));
    return p.by(0.02, 0).by(deck, 0).down();
  },
  funbox(h, ramp, top) {
    return new Profile().line(Math.atan2(h, ramp), Math.hypot(h, ramp)).by(top, 0).line(-Math.atan2(h, ramp), Math.hypot(h, ramp));
  },
  box(h, len) { return new Profile().to(0, h).by(len, 0).down(); },
  landing(h, top, slopeDeg = 28) {
    const a = (slopeDeg * Math.PI) / 180;
    const p = new Profile().to(0, h).by(top, 0).arc(3, 0, -a, 8);
    const tail = 4 * (1 - Math.cos(a));
    p.line(-a, (p.end[1] - tail) / Math.sin(a));
    return p.arc(4, -a, 0, 10);
  },
  // kicker -> flat table -> landing, all one piece (casing lands you on the table)
  jumpbox(h, angleDeg = 34, table = 4, landDeg = 26) {
    const a = (angleDeg * Math.PI) / 180, b = (landDeg * Math.PI) / 180;
    const R = h / (1 - Math.cos(a));
    const p = new Profile().arc(R, 0, a, 14).by(0.05, 0).by(table, 0).arc(3, 0, -b, 8);
    const tail = 4 * (1 - Math.cos(b));
    p.line(-b, (p.end[1] - tail) / Math.sin(b));
    return p.arc(4, -b, 0, 10);
  },
  dirtDouble(h, gap, lipDeg = 38) {
    // lip, flat gap at ground, landing mound
    const a = (lipDeg * Math.PI) / 180;
    const R = h / (1 - Math.cos(a));
    const p = new Profile().arc(R, 0, a, 14);
    // steep back face of the lip
    p.line(-1.1, (p.end[1]) / Math.sin(1.1));
    p.to(p.end[0] + gap, 0);
    const lh = h * 0.95;
    p.line(0.68, lh / Math.sin(0.68)).by(0.6, 0);
    const b = 0.42;
    p.arc(2, 0, -b, 6);
    p.line(-b, (p.end[1] - 0.25) / Math.sin(b));
    return p.arc(3, -b, 0, 8);
  },
  rollers(len, amp, waves) { return new Profile().sine(len, amp, waves, waves * 16); },
  stairs(n, rise, run) {
    const p = new Profile().to(0, n * rise);
    for (let i = 0; i < n; i++) p.by(run, 0).by(0, -rise);
    return p;
  },
  spine(h, R) {
    const q = profiles.quarter(h, R, 0.15, 80).pts.slice(0, -1);
    const peak = q[q.length - 1][0];
    const back = q.slice(0, -1).reverse().map(([s, y]) => [peak + (peak - s) + 0.05, y]);
    const p = new Profile(); p.pts = [...q, ...back];
    return p;
  },
  bank(h, len, deck = 3) { return new Profile().line(Math.atan2(h, len), Math.hypot(h, len)).by(deck, 0).down(); },
};

// ---------- Geometry ----------
function extrudeProfile(pts, width, opts = {}) {
  const tile = opts.tile || 2;
  const sideTile = opts.sideTile || tile;
  const slope = opts.sideSlope || 0;
  const base = opts.base ?? -1.5;
  const hw = width / 2;
  const top = { p: [], n: [], uv: [], idx: [] };
  const side = { p: [], n: [], uv: [], idx: [] };
  // segment normals in profile plane
  const segN = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const ds = pts[k + 1][0] - pts[k][0], dy = pts[k + 1][1] - pts[k][1];
    const L = Math.hypot(ds, dy) || 1;
    segN.push([-dy / L, ds / L]); // (ns, ny)
  }
  let arcLen = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [s0, y0] = pts[k], [s1, y1] = pts[k + 1];
    const L = Math.hypot(s1 - s0, y1 - y0);
    if (L < 1e-6) continue;
    const n = segN[k];
    const nAt = (kk, own) => {
      const other = segN[kk];
      if (!other) return own;
      const dot = other[0] * own[0] + other[1] * own[1];
      if (dot < 0.88) return own; // hard edge
      const x = own[0] + other[0], y = own[1] + other[1], l = Math.hypot(x, y);
      return [x / l, y / l];
    };
    const n0 = nAt(k - 1, n), n1 = nAt(k + 1, n);
    const b = top.p.length / 3;
    top.p.push(-hw, y0, s0, hw, y0, s0, -hw, y1, s1, hw, y1, s1);
    top.n.push(0, n0[1], n0[0], 0, n0[1], n0[0], 0, n1[1], n1[0], 0, n1[1], n1[0]);
    top.uv.push(-hw / tile, arcLen / tile, hw / tile, arcLen / tile, -hw / tile, (arcLen + L) / tile, hw / tile, (arcLen + L) / tile);
    top.idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    arcLen += L;
  }
  // sides
  for (const sx of [-1, 1]) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [s0, y0] = pts[k], [s1, y1] = pts[k + 1];
      if (Math.abs(s1 - s0) < 1e-6) continue;
      const b = side.p.length / 3;
      const o0 = slope * Math.max(0, y0 - base), o1 = slope * Math.max(0, y1 - base);
      side.p.push(sx * hw, y0, s0, sx * hw, y1, s1, sx * (hw + o0), base, s0, sx * (hw + o1), base, s1);
      const len = Math.hypot(1, slope);
      const nx = sx / len, ny = slope / len;
      side.n.push(nx, ny, 0, nx, ny, 0, nx, ny, 0, nx, ny, 0);
      side.uv.push(s0 / sideTile, y0 / sideTile, s1 / sideTile, y1 / sideTile, s0 / sideTile, base / sideTile, s1 / sideTile, base / sideTile);
      if (sx > 0) side.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      else side.idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  // end caps (vertical) if profile starts/ends above ground
  const cap = (k, dir) => {
    const [s, y] = pts[k];
    if (y <= 0.01) return;
    const b = side.p.length / 3;
    side.p.push(-hw, y, s, hw, y, s, -hw, base, s, hw, base, s);
    side.n.push(0, 0, dir, 0, 0, dir, 0, 0, dir, 0, 0, dir);
    side.uv.push(-hw / sideTile, y / sideTile, hw / sideTile, y / sideTile, -hw / sideTile, base / sideTile, hw / sideTile, base / sideTile);
    if (dir < 0) side.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    else side.idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  };
  cap(0, -1); cap(pts.length - 1, 1);
  const mk = (d) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    g.setIndex(d.idx);
    return g;
  };
  return { top: mk(top), side: mk(side) };
}

// Box with UVs in metres / tile on every face
export function boxGeo(w, h, d, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  return g;
}

// ---------- Builder ----------
export class Builder {
  constructor(scene, collision, terrain) {
    this.scene = scene;
    this.col = collision;
    this.terrain = terrain;
    this.batches = new Map(); // matKey -> {mat, geos[], cast}
    this.mats = {};
    this.dynamic = []; // objects needing per-frame update
    this.anchors = {};
  }

  mat(name) {
    if (this.mats[name]) return this.mats[name];
    let m;
    switch (name) {
      case 'skatelite': m = pbr('skatelite', { roughness: 1, env: 0.8 }); break;
      case 'plywood': m = pbr('planks', { roughness: 1, color: 0xd8c8b0 }); break;
      case 'deck': m = pbr('deck', { roughness: 1 }); break;
      case 'wood': m = pbr('planks', { roughness: 1 }); break;
      case 'concrete': m = pbr('concrete', { roughness: 1 }); break;
      case 'concreteSmooth': m = pbr('concreteSmooth', { roughness: 1 }); break;
      case 'concreteDark': m = pbr('concreteDark', { roughness: 1 }); break;
      case 'asphalt': m = pbr('asphalt', { roughness: 1 }); break;
      case 'dirt': m = pbr('trackDirt', { roughness: 1 }); break;
      case 'dirtLight': m = pbr('dirt', { roughness: 1 }); break;
      case 'rock': m = pbr('rock', { roughness: 1 }); break;
      case 'metal': {
        const t = getTex('metal');
        m = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.32, normalMap: t.normalMap, roughnessMap: t.roughnessMap, envMapIntensity: 1.2 });
        break;
      }
      case 'steel': m = new THREE.MeshStandardMaterial({ color: 0x4a4e54, metalness: 0.85, roughness: 0.5 }); break;
      case 'railYellow': m = new THREE.MeshPhysicalMaterial({ color: 0xf2b705, metalness: 0.2, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 }); break;
      case 'railRed': m = new THREE.MeshPhysicalMaterial({ color: 0xd8341c, metalness: 0.2, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 }); break;
      case 'railBlack': m = new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.6, roughness: 0.4 }); break;
      case 'containerRed': case 'containerBlue': case 'containerGreen': case 'containerYellow': case 'containerGrey':
        m = pbr(name, { roughness: 1, metalness: 0.45 }); break;
      case 'lamp': m = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffe2a8, emissiveIntensity: 3 }); break;
      case 'glass': m = new THREE.MeshStandardMaterial({ color: 0x5a6a78, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.5 }); break;
      case 'roof': m = new THREE.MeshStandardMaterial({ color: 0x6b6f75, metalness: 0.6, roughness: 0.55 }); break;
      case 'warehouse': m = pbr('containerGrey', { roughness: 1, metalness: 0.3, color: 0xd8dde2 }); break;
      case 'rubber': m = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 }); break;
      case 'white': m = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6 }); break;
      case 'craneYellow': m = new THREE.MeshStandardMaterial({ color: 0xe5a50a, roughness: 0.5, metalness: 0.4 }); break;
      default: throw new Error('mat ' + name);
    }
    this.mats[name] = m;
    return m;
  }

  // queue geometry (already in local space) with a world transform
  add(geo, matName, matrix, { cast = true, receive = true } = {}) {
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const key = matName + (cast ? '' : '|nc');
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = { matName, geos: [], cast, receive }));
    // merge requires consistent attributes
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    b.geos.push(g);
    return g;
  }

  finalize() {
    for (const [key, b] of this.batches) {
      // split huge batches into spatial chunks for culling
      const chunks = new Map();
      for (const g of b.geos) {
        g.computeBoundingSphere();
        const c = g.boundingSphere.center;
        const ck = Math.floor(c.x / 200) + ':' + Math.floor(c.z / 200);
        if (!chunks.has(ck)) chunks.set(ck, []);
        chunks.get(ck).push(g);
      }
      for (const list of chunks.values()) {
        const merged = mergeGeometries(list, false);
        if (!merged) { console.warn('merge failed', key); continue; }
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, this.mat(b.matName));
        mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
        mesh.matrixAutoUpdate = false;
        this.scene.add(mesh);
      }
    }
    this.batches.clear();
  }

  groundY(x, z) { return this.terrain.sample(x, z); }

  matrix(x, y, z, yaw = 0, pitch = 0) {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    if (pitch) m.multiply(new THREE.Matrix4().makeRotationX(pitch));
    return m.setPosition(x, y, z);
  }

  // Ramp from profile. (x,z) is the start of the profile; it runs along local +z rotated by yaw.
  // pitch > 0 tilts the ramp to run downhill.
  ramp(profile, { x, z, y, yaw = 0, pitch = 0, width = 4, top = 'skatelite', side = 'plywood', surface = 'wood', sideSlope = 0, tile = 2.44, sideTile = 2, collide = true, base = -1.5 }) {
    const pts = profile.pts || profile;
    y = y ?? this.groundY(x, z);
    const { top: tg, side: sg } = extrudeProfile(pts, width, { tile, sideTile, sideSlope, base });
    const m = this.matrix(x, y, z, yaw, pitch);
    const t = this.add(tg, top, m);
    const s = this.add(sg, side, m);
    if (collide) {
      this.addCollider(t, surface);
      if (sideSlope > 0) this.addCollider(s, surface);
    }
    return { m, y, pts, toWorld: (sv, yv, xv = 0) => new THREE.Vector3(xv, yv, sv).applyMatrix4(m) };
  }

  addCollider(geo, surface) {
    const tmp = new THREE.Mesh(geo);
    tmp.matrixWorld.identity();
    tmp.matrixAutoUpdate = false;
    tmp.updateWorldMatrix = () => {};
    this.col.addMesh(tmp, surface);
  }

  box({ x, z, y, w, h, d, yaw = 0, mat = 'concrete', top = null, surface = 'concrete', tile = 2, collide = true, cast = true, ledge = false, invisible = false }) {
    y = y ?? this.groundY(x, z);
    const m = this.matrix(x, y + h / 2, z, yaw);
    const g = boxGeo(w, h, d, tile);
    let added;
    if (invisible) { added = g.clone().applyMatrix4(m); }
    else if (top) {
      // separate top face material by drawing a thin cap
      added = this.add(g, mat, m, { cast });
      const cap = boxGeo(w, 0.02, d, tile);
      const mc = this.matrix(x, y + h + 0.005, z, yaw);
      this.add(cap, top, mc, { cast: false });
    } else added = this.add(g, mat, m, { cast });
    if (collide) this.addCollider(added, surface);
    if (ledge) {
      // grindable top edges along the long axis
      const along = w > d ? 'x' : 'z';
      const L = Math.max(w, d) / 2 - 0.15, off = Math.min(w, d) / 2;
      for (const s of [-1, 1]) {
        const a = along === 'x' ? new THREE.Vector3(-L, h, s * off) : new THREE.Vector3(s * off, h, -L);
        const b = along === 'x' ? new THREE.Vector3(L, h, s * off) : new THREE.Vector3(s * off, h, L);
        const rm = this.matrix(x, y, z, yaw);
        this.col.addRail(a.applyMatrix4(rm), b.applyMatrix4(rm), 'ledge');
      }
    }
    return { y, top: y + h };
  }

  // Grindable round rail from a to b (world, top-of-rail points), with posts
  rail(a, b, { r = 0.04, mat = 'railYellow', posts = true, postEvery = 3, kind = 'rail' } = {}) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mid.y -= r;
    const g = new THREE.CylinderGeometry(r, r, len, 12, 1);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, new THREE.Vector3(0, 1, 0));
    // lookAt makes -z point along dir; cylinder along z is symmetric so fine
    m.setPosition(mid);
    this.add(g, mat, m);
    if (posts) {
      const n = Math.max(2, Math.ceil(len / postEvery) + 1);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : 0.08 + 0.84 * (i / (n - 1));
        const p = new THREE.Vector3().lerpVectors(a, b, t);
        const gy = this.col.ground(p.x, p.z, p.y - 0.1, { n: new THREE.Vector3() }).h;
        const ph = p.y - r * 2 - gy;
        if (ph < 0.05) continue;
        const pg = new THREE.CylinderGeometry(r * 0.9, r * 0.9, ph + 0.3, 8);
        this.add(pg, mat, new THREE.Matrix4().makeTranslation(p.x, gy + ph / 2 - 0.15, p.z));
        const foot = new THREE.CylinderGeometry(0.09, 0.09, 0.02, 10);
        this.add(foot, 'steel', new THREE.Matrix4().makeTranslation(p.x, gy + 0.01, p.z));
      }
    }
    return this.col.addRail(a, b, kind);
  }

  coping(a, b) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const g = new THREE.CylinderGeometry(0.03, 0.03, len, 10);
    g.rotateZ(Math.PI / 2);
    const yaw = Math.atan2(dir.z, dir.x);
    this.add(g, 'metal', new THREE.Matrix4().makeRotationY(-yaw).setPosition(mid));
  }

  // QP with coping + optional deck rails. Faces toward -z local (riders approach from -z side going +z)
  quarterPipe(o) {
    const pr = profiles.quarter(o.h, o.R, o.deck ?? 2, o.maxDeg ?? 82);
    const r = this.ramp(pr, o);
    // find coping point (end of curve)
    let k = pr.pts.findIndex((p, i) => i > 0 && Math.abs(p[1] - o.h) < 1e-3);
    if (k < 0) k = pr.pts.length - 3;
    const s = pr.pts[k][0];
    this.coping(r.toWorld(s, o.h + 0.02, -o.width / 2), r.toWorld(s, o.h + 0.02, o.width / 2));
    return r;
  }

  container({ x, z, y, yaw = 0, color = 'containerRed', stackOn = 0 }) {
    const W = 2.44, H = 2.6, L = 12.2;
    y = (y ?? this.groundY(x, z)) + stackOn * H;
    const m = this.matrix(x, y + H / 2, z, yaw);
    const body = boxGeo(L, H, W, 2.6);
    const g = this.add(body, color, m);
    this.addCollider(g, 'metal');
    // door end detail
    const door = boxGeo(0.06, H * 0.92, W * 0.94, 2.6);
    this.add(door, 'steel', this.matrix(x, y + H / 2, z, yaw).multiply(new THREE.Matrix4().makeTranslation(L / 2, 0, 0)), { cast: false });
    // corner castings
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0, 1]) {
      const cg = boxGeo(0.18, 0.12, 0.18, 1);
      const cm = this.matrix(x, y + (sy ? H - 0.06 : 0.06), z, yaw).multiply(new THREE.Matrix4().makeTranslation(sx * (L / 2 - 0.09), 0, sz * (W / 2 - 0.09)));
      this.add(cg, 'steel', cm, { cast: false });
    }
    return { top: y + H };
  }

  lamp(x, z, h = 7, yaw = 0) {
    const y = this.groundY(x, z);
    this.add(new THREE.CylinderGeometry(0.07, 0.11, h, 10), 'steel', new THREE.Matrix4().makeTranslation(x, y + h / 2, z));
    const arm = new THREE.BoxGeometry(1.2, 0.08, 0.08);
    const m = this.matrix(x, y + h, z, yaw).multiply(new THREE.Matrix4().makeTranslation(0.55, 0, 0));
    this.add(arm, 'steel', m);
    const head = new THREE.BoxGeometry(0.6, 0.12, 0.3);
    this.add(head, 'steel', this.matrix(x, y + h - 0.05, z, yaw).multiply(new THREE.Matrix4().makeTranslation(1.05, 0, 0)));
    const bulb = new THREE.BoxGeometry(0.5, 0.03, 0.22);
    this.add(bulb, 'lamp', this.matrix(x, y + h - 0.125, z, yaw).multiply(new THREE.Matrix4().makeTranslation(1.05, 0, 0)), { cast: false });
  }

  bench(x, z, yaw = 0) {
    const y = this.groundY(x, z);
    const m = this.matrix(x, y, z, yaw);
    this.add(boxGeo(1.8, 0.06, 0.45, 1), 'wood', m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.45, 0)));
    for (const s of [-0.75, 0.75]) this.add(boxGeo(0.06, 0.45, 0.4, 1), 'steel', m.clone().multiply(new THREE.Matrix4().makeTranslation(s, 0.22, 0)));
  }

  decal(kind, x, z, y, size, rot) {
    this.decalMats = this.decalMats || {};
    const m = this.decalMats[kind] ||= new THREE.MeshStandardMaterial({ map: decalTexture(kind), transparent: true, depthWrite: false, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const g = new THREE.PlaneGeometry(size, size * (kind === 'tire' ? 2 : 1)).rotateX(-Math.PI / 2).rotateY(rot);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
  }

  graffitiWall(x, z, yaw, w = 8, h = 2.4, idx = 0) {
    const y = this.groundY(x, z);
    const r = this.box({ x, z, y, w, h, d: 0.4, yaw, mat: 'concreteDark', surface: 'concrete', tile: 3 });
    const tex = graffitiTexture(idx);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, h * 2.6), h * 0.98), mat);
      p.position.set(x + Math.sin(yaw) * 0.21 * s, y + h / 2, z + Math.cos(yaw) * 0.21 * s);
      p.rotation.y = yaw + (s < 0 ? Math.PI : 0);
      p.receiveShadow = true;
      this.scene.add(p);
    }
    return r;
  }

  scaffold(x0, z0, x1, z1, yTop, yaw = 0) {
    // vertical posts + braces under a raised structure (visual only)
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const pts = [];
    const stepX = (x1 - x0) / Math.max(1, Math.round((x1 - x0) / 3));
    const stepZ = (z1 - z0) / Math.max(1, Math.round((z1 - z0) / 3));
    for (let x = x0; x <= x1 + 1e-3; x += stepX) for (let z = z0; z <= z1 + 1e-3; z += stepZ) pts.push([x, z]);
    for (const [x, z] of pts) {
      const gy = this.groundY(x, z);
      const h = yTop(x, z) - gy;
      if (h < 0.3) continue;
      this.add(new THREE.BoxGeometry(0.16, h, 0.16), 'steel', new THREE.Matrix4().makeTranslation(x, gy + h / 2, z), { cast: true });
    }
  }
}

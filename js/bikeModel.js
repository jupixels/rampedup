// Procedural BMX + rider with two-bone IK, steering/barspin/tailwhip pivots and
// trick poses. Used for the local player and every remote rider.
import * as THREE from 'three';
import { lerp, clamp } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// geometry
const WR = 0.255;           // wheel radius
const WB = 0.98;            // wheelbase
const REAR = V(0, WR, -WB / 2);
const FRONT = V(0, WR, WB / 2);
const BB = V(0, 0.29, -0.07);
const HB = V(0, 0.53, 0.385);       // head tube bottom
const HEAD_TILT = -15 * Math.PI / 180;
const AXIS = V(0, Math.cos(HEAD_TILT), Math.sin(HEAD_TILT)); // steering axis (leans back)
const HT = HB.clone().addScaledVector(AXIS, 0.14);
const SEAT_TOP = V(0, 0.6, -0.17);
const CRANK = 0.175;

let sharedTex = null;
function treadTexture() {
  if (sharedTex) return sharedTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 32);
  for (let i = 0; i < 32; i++) {
    g.fillStyle = '#d0d0d0';
    const x = i * 8;
    g.fillRect(x + 1, 4, 5, 10); g.fillRect(x + 4, 18, 5, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // turn into a normal map
  const d = g.getImageData(0, 0, 256, 32).data;
  const nc = document.createElement('canvas'); nc.width = 256; nc.height = 32;
  const ng = nc.getContext('2d'); const img = ng.createImageData(256, 32);
  const h = (x, y) => d[(((y + 32) % 32) * 256 + ((x + 256) % 256)) * 4] / 255;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 256; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * 3, dy = (h(x, y + 1) - h(x, y - 1)) * 3;
    const l = Math.hypot(dx, dy, 1), i = (y * 256 + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ng.putImageData(img, 0, 0);
  sharedTex = new THREE.CanvasTexture(nc);
  sharedTex.wrapS = sharedTex.wrapT = THREE.RepeatWrapping;
  return sharedTex;
}

function tube(a, b, r, mat, seg = 10) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}

function curveTube(points, r, mat, seg = 40) {
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.Mesh(new THREE.TubeGeometry(c, seg, r, 10, false), mat);
}

function makeWheel(mats) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  const tire = new THREE.Mesh(new THREE.TorusGeometry(WR - 0.03, 0.03, 14, 48), mats.tire);
  tire.rotation.y = Math.PI / 2;
  spin.add(tire);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WR - 0.052, 0.011, 8, 48), mats.rim);
  rim.rotation.y = Math.PI / 2;
  rim.scale.set(1, 1, 1.7);
  spin.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.11, 12), mats.chrome);
  hub.rotation.z = Math.PI / 2;
  spin.add(hub);
  // spokes as line segments (36)
  const pts = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const side = i % 2 ? 0.04 : -0.04;
    const a2 = a + (i % 4 < 2 ? 0.35 : -0.35);
    pts.push(side, Math.cos(a2) * 0.02, Math.sin(a2) * 0.02, 0, Math.cos(a) * (WR - 0.06), Math.sin(a) * (WR - 0.06));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  spin.add(new THREE.LineSegments(sg, mats.spoke));
  // pegs
  for (const s of [-1, 1]) {
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.11, 12), mats.peg);
    peg.rotation.z = Math.PI / 2;
    peg.position.x = s * 0.115;
    g.add(peg);
  }
  return { group: g, spin };
}

function solveIK(a, target, l1, l2, pole, outMid) {
  const d = new THREE.Vector3().subVectors(target, a);
  let dist = d.length();
  dist = clamp(dist, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  d.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // bend direction: pole projected perpendicular to d
  const p = pole.clone().addScaledVector(d, -pole.dot(d));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(d, -d.z);
  if (p.lengthSq() < 1e-8) p.set(1, 0, 0);
  p.normalize();
  outMid.copy(a).addScaledVector(d, cosA * l1).addScaledVector(p, sinA * l1);
  return outMid;
}

export class RiderBike {
  constructor(colors = {}) {
    this.root = new THREE.Group();
    this.colors = { frame: '#ff5a1f', helmet: '#f2f2f2', shirt: '#1d2b3a', pants: '#2a2a2a', ...colors };
    const tread = treadTexture();
    const mats = this.mats = {
      frame: new THREE.MeshPhysicalMaterial({ color: this.colors.frame, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xe8e8ea, metalness: 1, roughness: 0.12 }),
      black: new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.6, roughness: 0.38 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92, normalMap: tread, normalScale: new THREE.Vector2(0.8, 0.8) }),
      rim: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.8, roughness: 0.3 }),
      spoke: new THREE.LineBasicMaterial({ color: 0x9a9da3, transparent: true, opacity: 0.85 }),
      peg: new THREE.MeshStandardMaterial({ color: 0xbfc2c8, metalness: 1, roughness: 0.25 }),
      seat: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
      grip: new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.95 }),
      shirt: new THREE.MeshStandardMaterial({ color: this.colors.shirt, roughness: 0.92 }),
      pants: new THREE.MeshStandardMaterial({ color: this.colors.pants, roughness: 0.95 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.7 }),
      helmet: new THREE.MeshPhysicalMaterial({ color: this.colors.helmet, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }),
      visor: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.15, metalness: 0.6 }),
      lens: new THREE.MeshStandardMaterial({ color: 0x3a2410, metalness: 0.9, roughness: 0.12 }),
      strap: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
      shoe: new THREE.MeshStandardMaterial({ color: 0xf0efe9, roughness: 0.8 }),
      sole: new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.9 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
    };

    this.bike = new THREE.Group();
    this.root.add(this.bike);

    // ---- steering pivots ----
    const mkPivot = () => { const p = new THREE.Group(); p.position.copy(HB); p.rotation.x = HEAD_TILT; return p; };
    this.whipPivot = mkPivot(); // rear end rotates here (tailwhip)
    this.forkPivot = mkPivot();
    this.barPivot = mkPivot();
    this.bike.add(this.whipPivot, this.forkPivot, this.barPivot);
    this.bike.updateMatrixWorld(true);

    const rear = new THREE.Group(); // built in bike space, then attached
    const fork = new THREE.Group();
    const bars = new THREE.Group();
    this.bike.add(rear, fork, bars);

    // frame tubes
    const R = 0.0175;
    const st = SEAT_TOP;
    rear.add(tube(HB.clone().addScaledVector(AXIS, -0.01), HT.clone().addScaledVector(AXIS, 0.02), 0.024, mats.frame, 14)); // head tube
    rear.add(tube(HT.clone().add(V(0, -0.025, -0.01)), st.clone().add(V(0, -0.02, 0.02)), R, mats.frame));    // top tube
    rear.add(tube(HB.clone().add(V(0, 0.02, 0)), BB, R * 1.15, mats.frame));                                  // down tube
    rear.add(tube(BB, st, R, mats.frame));                                                                     // seat tube
    for (const s of [-1, 1]) {
      rear.add(tube(BB.clone().add(V(s * 0.03, 0, 0)), REAR.clone().add(V(s * 0.06, 0.005, 0.02)), 0.011, mats.frame)); // chain stays
      rear.add(tube(st.clone().add(V(s * 0.02, -0.06, 0)), REAR.clone().add(V(s * 0.06, 0.02, 0.02)), 0.009, mats.frame)); // seat stays
      const drop = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.06), mats.frame);
      drop.position.copy(REAR).add(V(s * 0.062, 0, 0.01));
      rear.add(drop);
    }
    rear.add(tube(BB.clone().add(V(0.045, 0, 0)), BB.clone().add(V(-0.045, 0, 0)), 0.022, mats.frame)); // BB shell
    // gusset
    rear.add(tube(HB.clone().add(V(0, 0.07, -0.01)), HB.clone().add(V(0, 0.01, -0.1)), 0.008, mats.frame));
    // seat & post
    const post = tube(st, st.clone().add(V(0, 0.08, -0.025)), 0.012, mats.chrome);
    rear.add(post);
    const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 4, 10), mats.seat);
    seat.rotation.x = Math.PI / 2 + 0.25;
    seat.scale.set(1.25, 1, 0.55);
    seat.position.copy(st).add(V(0, 0.1, -0.02));
    rear.add(seat);
    // rear wheel
    const rw = makeWheel(mats);
    rw.group.position.copy(REAR);
    rear.add(rw.group);
    this.rearSpin = rw.spin;
    // drivetrain
    const crankG = new THREE.Group();
    crankG.position.copy(BB);
    rear.add(crankG);
    this.crankSpin = new THREE.Group();
    crankG.add(this.crankSpin);
    const sprocket = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.006, 6, 30), mats.chrome);
    sprocket.rotation.y = Math.PI / 2; sprocket.position.x = -0.055;
    this.crankSpin.add(sprocket);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.004, 24), mats.black);
    guard.rotation.z = Math.PI / 2; guard.position.x = -0.06;
    this.crankSpin.add(guard);
    this.pedals = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.rotation.x = s > 0 ? 0 : Math.PI;
      arm.position.x = s * 0.075;
      const crank = new THREE.Mesh(new THREE.BoxGeometry(0.018, CRANK + 0.03, 0.028), mats.black);
      crank.position.y = -CRANK / 2;
      arm.add(crank);
      const pedal = new THREE.Group();
      pedal.position.set(s * 0.055, -CRANK, 0);
      const plat = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.1), mats.black);
      pedal.add(plat);
      arm.add(pedal);
      this.crankSpin.add(arm);
      this.pedals.push({ arm, pedal, side: s });
    }
    // chain (simplified): two runs
    for (const off of [0.085, -0.085]) {
      rear.add(tube(BB.clone().add(V(-0.055, off, 0)), REAR.clone().add(V(-0.055, off * 0.42, 0)), 0.004, mats.black, 6));
    }
    const driver = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.006, 6, 18), mats.black);
    driver.rotation.y = Math.PI / 2; driver.position.copy(REAR).add(V(-0.055, 0, 0));
    rear.add(driver);

    // fork + front wheel
    const crown = HB.clone().addScaledVector(AXIS, -0.03);
    for (const s of [-1, 1]) {
      fork.add(curveTube([crown.clone().add(V(s * 0.05, 0, 0)), crown.clone().add(V(s * 0.055, -0.12, 0.03)), FRONT.clone().add(V(s * 0.058, 0.03, -0.005)), FRONT.clone().add(V(s * 0.058, 0, 0))], 0.012, mats.chrome, 16));
    }
    fork.add(tube(crown.clone().add(V(-0.06, 0, 0)), crown.clone().add(V(0.06, 0, 0)), 0.016, mats.chrome));
    const fw = makeWheel(mats);
    fw.group.position.copy(FRONT);
    fork.add(fw.group);
    this.frontSpin = fw.spin;

    // stem + bars
    const stemTop = HT.clone().addScaledVector(AXIS, 0.05);
    bars.add(tube(HT, stemTop, 0.02, mats.black));
    const clamp = stemTop.clone().add(V(0, 0.01, 0.045));
    bars.add(tube(stemTop, clamp, 0.02, mats.black));
    this.grips = [];
    const barPts = (s) => [clamp.clone().add(V(0, 0, 0)), clamp.clone().add(V(s * 0.12, 0, -0.005)), clamp.clone().add(V(s * 0.19, 0.06, -0.03)), clamp.clone().add(V(s * 0.25, 0.2, -0.06)), clamp.clone().add(V(s * 0.37, 0.235, -0.085))];
    for (const s of [-1, 1]) {
      bars.add(curveTube(barPts(s), 0.011, mats.chrome, 24));
      const end = barPts(s)[4];
      const grip = tube(end.clone().add(V(-s * 0.1, -0.004, 0.003)), end.clone().add(V(s * 0.02, 0.001, -0.002)), 0.016, mats.grip, 10);
      bars.add(grip);
      const marker = new THREE.Object3D();
      marker.position.copy(end).add(V(-s * 0.05, 0, 0));
      bars.add(marker);
      this.grips.push(marker);
    }
    bars.add(tube(clamp.clone().add(V(-0.17, 0.12, -0.04)), clamp.clone().add(V(0.17, 0.12, -0.04)), 0.008, mats.chrome)); // crossbar

    // re-parent into pivots (preserve transforms)
    this.whipPivot.attach(rear);
    this.forkPivot.attach(fork);
    this.barPivot.attach(bars);

    // ---- rider ----
    this.rider = new THREE.Group();
    this.root.add(this.rider);
    const cap = (r, len, mat) => {
      const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 12);
      return new THREE.Mesh(g, mat);
    };
    // torso: lathe profile (waist -> chest -> shoulders), wider than deep
    const tp = [[0.0, -0.02], [0.125, 0.0], [0.13, 0.08], [0.15, 0.2], [0.165, 0.3], [0.16, 0.38], [0.13, 0.44], [0.07, 0.475], [0.0, 0.48]].map(([r, y]) => new THREE.Vector2(r, y));
    const torsoGeo = new THREE.LatheGeometry(tp, 20);
    mats.pad = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.6 });
    const knee = () => new THREE.Mesh(new THREE.SphereGeometry(0.068, 12, 10), mats.pad);
    this.parts = {
      torso: new THREE.Mesh(torsoGeo, mats.shirt),
      neck: cap(0.05, 0.12, mats.skin),
      head: new THREE.Group(),
      uArm: [cap(0.052, 0.3, mats.shirt), cap(0.052, 0.3, mats.shirt)],
      fArm: [cap(0.044, 0.29, mats.shirt), cap(0.044, 0.29, mats.shirt)],
      hand: [new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mats.glove), new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mats.glove)],
      thigh: [cap(0.08, 0.45, mats.pants), cap(0.08, 0.45, mats.pants)],
      shin: [cap(0.061, 0.45, mats.pants), cap(0.061, 0.45, mats.pants)],
      kneePad: [knee(), knee()],
      foot: [new THREE.Group(), new THREE.Group()],
      hips: cap(0.135, 0.36, mats.pants),
    };
    this.parts.torso.scale.set(1.18, 1, 0.74);
    // full-face BMX helmet with goggles
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.138, 26, 18), mats.helmet);
    shell.scale.set(0.94, 1, 1.08);
    const chin = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.036, 10, 20, Math.PI), mats.helmet);
    chin.rotation.set(Math.PI / 2 + 0.35, 0, Math.PI);
    chin.position.set(0, -0.07, 0.02);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.02), mats.visor);
    mouth.position.set(0, -0.075, 0.145);
    const goggle = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 10), mats.lens);
    goggle.rotation.z = Math.PI / 2;
    goggle.position.set(0, 0.0, 0.128);
    goggle.scale.set(1, 1, 0.7);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.012, 6, 30), mats.strap);
    strap.rotation.x = Math.PI / 2 - 0.05; strap.scale.set(0.94, 1.08, 1);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.09), mats.helmet);
    peak.position.set(0, 0.085, 0.14); peak.rotation.x = -0.28;
    this.parts.head.add(shell, chin, mouth, goggle, strap, peak);
    for (let i = 0; i < 2; i++) {
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.075, 0.27), mats.shoe);
      shoe.position.set(0, 0.03, 0.03);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.28), mats.sole);
      sole.position.set(0, -0.012, 0.03);
      this.parts.foot[i].add(shoe, sole);
    }
    for (const v of Object.values(this.parts)) {
      for (const m of Array.isArray(v) ? v : [v]) this.rider.add(m);
    }
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // state
    this.pose = { crank: 0, steer: 0, barspin: 0, whip: 0, crouch: 0, shift: 0, superman: 0, nohander: 0, cancan: 0, nofooter: 0, tuck: 0, wheel: 0 };
    this._v = Array.from({ length: 12 }, () => new THREE.Vector3());
    this.nameTag = null;
  }

  setColors(c) {
    Object.assign(this.colors, c);
    this.mats.frame.color.set(this.colors.frame);
    this.mats.helmet.color.set(this.colors.helmet);
    this.mats.shirt.color.set(this.colors.shirt);
    this.mats.pants.color.set(this.colors.pants);
  }

  setNameTag(text, color = '#ffffff') {
    if (this.nameTag) { this.root.remove(this.nameTag); this.nameTag.material.map.dispose(); }
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.font = '700 54px "Barlow Condensed", "Arial Narrow", sans-serif';
    const w = Math.min(500, g.measureText(text).width + 50);
    g.fillStyle = 'rgba(10,10,12,0.62)';
    g.beginPath(); g.roundRect((512 - w) / 2, 12, w, 72, 36); g.fill();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 50);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true }));
    s.scale.set(1.6, 0.3, 1);
    s.position.y = 2.25;
    this.nameTag = s;
    this.root.add(s);
  }

  // Update joints from this.pose. Called every frame after pose fields are set.
  updatePose() {
    const P = this.pose;
    this.forkPivot.rotation.y = P.steer;
    this.barPivot.rotation.y = P.steer + P.barspin;
    this.whipPivot.rotation.y = P.whip;
    this.crankSpin.rotation.x = P.crank;
    this.rearSpin.rotation.x = P.wheel;
    this.frontSpin.rotation.x = P.wheel;
    for (const p of this.pedals) p.pedal.rotation.x = -P.crank - p.arm.rotation.x; // pedals stay level

    this.root.updateMatrixWorld(true);
    const inv = this._inv || (this._inv = new THREE.Matrix4());
    inv.copy(this.rider.matrixWorld).invert();
    const v = this._v;
    // grips + pedals in rider space
    const grip = [this.grips[0].getWorldPosition(v[0]).applyMatrix4(inv), this.grips[1].getWorldPosition(v[1]).applyMatrix4(inv)];
    const pedal = [this.pedals[0].pedal.getWorldPosition(v[2]).applyMatrix4(inv), this.pedals[1].pedal.getWorldPosition(v[3]).applyMatrix4(inv)];
    // pedals: pedal[0] is side -1 (rider's right when facing +z is -x)

    const crouch = P.crouch, shift = P.shift;
    const sm = P.superman, nh = P.nohander, cc = P.cancan, nf = P.nofooter, tk = P.tuck;
    // pelvis & chest
    const pelvis = v[4].set(0, 1.0 - crouch * 0.25 + sm * 0.08 - tk * 0.12, -0.16 - crouch * 0.08 - shift * 0.22 - sm * 0.3);
    const chest = v[5].set(0, pelvis.y + 0.42 - crouch * 0.1 - sm * 0.28 + nh * 0.05, pelvis.z + 0.2 + crouch * 0.06 + sm * 0.3 - shift * 0.08 - nh * 0.12);
    const spineDir = v[6].subVectors(chest, pelvis).normalize();
    const place = (mesh, a, b) => {
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      const d = this._tmp.subVectors(b, a);
      if (d.lengthSq() > 1e-10) mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    };
    this._tmp = this._tmp || new THREE.Vector3();
    // torso lathe spans 0.48 along its local y from the pelvis
    const tLen = pelvis.distanceTo(chest);
    this.parts.torso.position.copy(pelvis).addScaledVector(spineDir, -0.04);
    this.parts.torso.quaternion.setFromUnitVectors(UP, spineDir);
    this.parts.torso.scale.y = (tLen + 0.06) / 0.48;
    this.parts.hips.position.copy(pelvis).add(V(0, -0.03, -0.01));
    this.parts.hips.rotation.set(0, 0, Math.PI / 2);
    const headPos = v[9].copy(chest).addScaledVector(spineDir, 0.06).add(V(0, 0.17, 0.035));
    place(this.parts.neck, chest.clone().addScaledVector(spineDir, -0.02), headPos);
    this.parts.head.position.copy(headPos);
    this.parts.head.rotation.set(-0.12 + sm * 0.55 - crouch * 0.08 + (chest.z - pelvis.z) * 0.6, 0, 0);
    // joint positions (rider space) for the ragdoll to start from
    const J = this.joints || (this.joints = { pelvis: V(), chest: V(), head: V(), shoulder: [V(), V()], elbow: [V(), V()], hand: [V(), V()], hip: [V(), V()], knee: [V(), V()], foot: [V(), V()] });
    J.pelvis.copy(pelvis); J.chest.copy(chest); J.head.copy(headPos);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1; // side
      const shoulder = chest.clone().addScaledVector(spineDir, -0.06).add(V(s * 0.19, 0, -0.02));
      let hand = grip[i].clone();
      // no-hander: arms out wide
      if (nh > 0) hand.lerp(V(s * 0.75, chest.y + 0.35, chest.z - 0.1), nh);
      if (P.barspin && Math.abs(Math.sin(P.barspin / 2)) > 0.2) hand.lerp(V(s * 0.25, grip[i].y + 0.05, grip[i].z - 0.1), 0.6);
      const elbow = solveIK(shoulder, hand, 0.3, 0.3, V(s * 0.8, -0.3, -0.6), V());
      J.shoulder[i].copy(shoulder); J.elbow[i].copy(elbow); J.hand[i].copy(hand);
      place(this.parts.uArm[i], shoulder, elbow);
      place(this.parts.fArm[i], elbow, hand);
      this.parts.hand[i].position.copy(hand);

      const hip = pelvis.clone().add(V(s * 0.1, -0.05, 0));
      // pedal: right foot (s=-1) on pedals[0]
      let foot = pedal[i].clone().add(V(0, 0.05, 0));
      if (sm > 0) foot.lerp(V(s * 0.16, pelvis.y + 0.05, pelvis.z - 0.85), sm);
      if (nf > 0) foot.lerp(V(s * 0.5, 0.55, -0.15), nf);
      if (cc > 0 && i === 1) foot.lerp(V(-0.38, 0.7, 0.18), cc);
      if (tk > 0) foot.lerp(V(s * 0.12, pelvis.y - 0.3, pelvis.z + 0.25), tk * 0.6);
      const knee = solveIK(hip, foot, 0.45, 0.46, V(s * 0.12, 0.2, 1), V());
      J.hip[i].copy(hip); J.knee[i].copy(knee); J.foot[i].copy(foot);
      place(this.parts.thigh[i], hip, knee);
      place(this.parts.shin[i], knee, foot);
      this.parts.kneePad[i].position.copy(knee).add(V(0, 0, 0.03));
      const ft = this.parts.foot[i];
      ft.position.copy(foot).add(V(0, -0.04, 0));
      ft.rotation.set(sm * -1.2, 0, 0);
    }
  }
}

export const BIKE = { WR, WB, REAR, FRONT, CRANK };

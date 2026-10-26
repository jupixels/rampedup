// Visual effects: CPU-simulated particles (dust, sparks, spray, confetti) drawn as
// soft point sprites, plus tyre skid marks laid down as a ring buffer of quads.
import * as THREE from 'three';

const DUST = { grass: [0.42, 0.45, 0.3], dirt: [0.55, 0.42, 0.3], sand: [0.78, 0.7, 0.55], rock: [0.55, 0.53, 0.5], concrete: [0.72, 0.7, 0.66], asphalt: [0.45, 0.45, 0.45], wood: [0.6, 0.5, 0.38], metal: [0.6, 0.6, 0.6] };

class Particles {
  constructor(max, additive) {
    this.max = max;
    this.n = 0;
    this.i = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('size', this.aSize);
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec4 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard;
          gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - r) * (1.0 - r)); }`,
    });
    this.mat = mat;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.geo = g;
  }

  emit(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav = 9, drag = 2, grow = 0) {
    const i = this.i;
    this.i = (this.i + 1) % this.max;
    if (this.n < this.max) this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }

  update(dt) {
    const sz = this.aSize.array;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { sz[i] = 0; continue; }
      alive++;
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.size[i] += this.grow[i] * dt;
      sz[i] = this.size[i];
      this.col[i * 4 + 3] = Math.min(this.col[i * 4 + 3], t * 1.4) ;
    }
    this.geo.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
    this.points.visible = alive > 0;
  }
}

class Skids {
  constructor(max = 500) {
    this.max = max; this.i = 0;
    const pos = new Float32Array(max * 4 * 3), alpha = new Float32Array(max * 4);
    const idx = [];
    for (let q = 0; q < max; q++) { const b = q * 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aA = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('alpha', this.aA); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.04, 0.035, 0.03, vA); }',
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.last = null;
  }
  // Lay a mark from the last point to p (world), width w, along surface normal n
  add(p, n, side, w = 0.06, a = 0.5) {
    if (!this.last || this.last.distanceTo(p) > 1.2) { this.last = p.clone(); return; }
    if (this.last.distanceTo(p) < 0.15) return;
    const dir = new THREE.Vector3().subVectors(p, this.last).normalize();
    const s = new THREE.Vector3().crossVectors(dir, n).normalize().multiplyScalar(w);
    const off = n.clone().multiplyScalar(0.015);
    const q = this.i; this.i = (this.i + 1) % this.max;
    const P = this.aPos.array, A = this.aA.array, b = q * 4;
    const set = (k, v) => { P[(b + k) * 3] = v.x; P[(b + k) * 3 + 1] = v.y; P[(b + k) * 3 + 2] = v.z; A[b + k] = a; };
    set(0, this.last.clone().add(s).add(off)); set(1, this.last.clone().sub(s).add(off));
    set(2, p.clone().add(s).add(off)); set(3, p.clone().sub(s).add(off));
    this.aPos.needsUpdate = this.aA.needsUpdate = true;
    this.last.copy(p);
  }
  break() { this.last = null; }
}

export class FX {
  constructor(scene) {
    this.soft = new Particles(1400, false);
    this.glow = new Particles(600, true);
    this.skids = new Skids(600);
    scene.add(this.soft.points, this.glow.points, this.skids.mesh);
    this.enabled = true;
    this.dustT = 0;
  }

  setScale(h) { this.soft.mat.uniforms.uScale.value = this.glow.mat.uniforms.uScale.value = h * 0.55; }

  dust(pos, surface, amount = 10, spread = 1, vel = null) {
    if (!this.enabled) return;
    const c = DUST[surface] || DUST.concrete;
    const strength = surface === 'dirt' || surface === 'sand' ? 1 : surface === 'grass' ? 0.6 : 0.4;
    const n = Math.round(amount * strength);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.6 + Math.random() * 1.6) * spread;
      const v = Math.random();
      this.soft.emit(pos.x + Math.cos(a) * 0.3, pos.y + 0.05, pos.z + Math.sin(a) * 0.3,
        Math.cos(a) * s + (vel ? vel.x * 0.25 : 0), 0.6 + Math.random() * 1.4 * spread, Math.sin(a) * s + (vel ? vel.z * 0.25 : 0),
        c[0] * (0.85 + v * 0.3), c[1] * (0.85 + v * 0.3), c[2] * (0.85 + v * 0.3), 0.55,
        0.25 + Math.random() * 0.35, 0.8 + Math.random() * 0.9, 0.6, 1.8, 0.9);
    }
  }

  sparks(pos, dir, amount = 6) {
    if (!this.enabled) return;
    for (let i = 0; i < amount; i++) {
      const s = 2 + Math.random() * 5;
      this.glow.emit(pos.x, pos.y, pos.z,
        -dir.x * s + (Math.random() - 0.5) * 3, 1 + Math.random() * 3, -dir.z * s + (Math.random() - 0.5) * 3,
        1.0, 0.62 + Math.random() * 0.3, 0.25, 1, 0.05 + Math.random() * 0.05, 0.25 + Math.random() * 0.35, 12, 1.2);
    }
  }

  splash(pos, amount = 60) {
    if (!this.enabled) return;
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 3.5;
      this.soft.emit(pos.x, pos.y, pos.z, Math.cos(a) * s, 3 + Math.random() * 6, Math.sin(a) * s,
        0.82, 0.9, 0.95, 0.75, 0.12 + Math.random() * 0.2, 0.8 + Math.random() * 0.8, 11, 0.6, 0.3);
    }
  }

  confetti(pos, amount = 120) {
    if (!this.enabled) return;
    const pal = [[1, 0.35, 0.12], [1, 0.82, 0.12], [0.25, 0.83, 1], [0.34, 0.88, 0.54], [1, 0.37, 0.64], [0.95, 0.95, 0.92]];
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 4, c = pal[i % pal.length];
      this.soft.emit(pos.x, pos.y + 1.6, pos.z, Math.cos(a) * s, 4 + Math.random() * 5, Math.sin(a) * s,
        c[0], c[1], c[2], 1, 0.07 + Math.random() * 0.05, 1.6 + Math.random() * 1.2, 5, 1.6);
    }
  }

  // continuous effects driven by the rider's state
  update(dt, player) {
    const p = player;
    if (this.enabled && p.mode === 'grind' && p.grind && Math.random() < 0.8) {
      const d = p.grind.rail.dir.clone().multiplyScalar(p.grind.sign);
      this.sparks(p.pos.clone().add(new THREE.Vector3(0, 0.22, 0)), d, 2 + Math.round(p.grind.speed / 4));
    }
    if (this.enabled && p.mode === 'ground' && p.speed > 4) {
      const s = p.ground.surface;
      if (s === 'dirt' || s === 'sand') {
        this.dustT += dt * p.speed;
        if (this.dustT > 0.9) {
          this.dustT = 0;
          const back = new THREE.Vector3(-Math.sin(p.heading) * 0.5, 0, -Math.cos(p.heading) * 0.5).add(p.pos);
          this.dust(back, s, 2, 0.5);
        }
      }
    }
    // skid marks while braking hard or sliding sideways on hard ground
    const hard = p.ground && ['concrete', 'asphalt', 'wood', 'metal'].includes(p.ground.surface);
    if (p.mode === 'ground' && hard && p.skidding) {
      const rear = new THREE.Vector3(-Math.sin(p.heading) * 0.49, 0, -Math.cos(p.heading) * 0.49).add(p.pos);
      this.skids.add(rear, p.normal, 0, 0.035, 0.55);
    } else this.skids.break();
    this.soft.update(dt);
    this.glow.update(dt);
  }
}

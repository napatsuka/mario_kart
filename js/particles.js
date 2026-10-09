import * as THREE from 'three';

// GPU ポイントスプライトによる軽量パーティクル(火花・炎・煙・砂ぼこり)
export class Particles {
  constructor(max, additive, opacity = 1) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 400 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vA; varying vec3 vC; uniform float scale;
        void main() { vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard;
          float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vC * (${additive ? '1.6' : '1.0'}), a * vA * ${opacity.toFixed(2)}); }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.geometry = g;
  }

  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, grow = 0, grav = 0) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max); else this.n++;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.alpha[i] = 1;
    this.grow[i] = grow; this.grav[i] = grav;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // 末尾と入れ替えて詰める
        const last = --this.n;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[last * 3 + k]; this.vel[i * 3 + k] = this.vel[last * 3 + k]; this.col[i * 3 + k] = this.col[last * 3 + k];
          }
          this.size[i] = this.size[last]; this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
          this.grow[i] = this.grow[last]; this.grav[i] = this.grav[last]; this.alpha[i] = this.alpha[last];
        }
        continue;
      }
      const o = i * 3;
      this.vel[o + 1] -= this.grav[i] * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = Math.min(1, this.life[i] / this.maxLife[i] * 1.5);
      i++;
    }
    const g = this.geometry;
    g.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'alpha']) g.attributes[k].needsUpdate = true;
  }

  setScale(px) { this.material.uniforms.scale.value = px; }
}

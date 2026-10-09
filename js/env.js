import * as THREE from 'three';

// 空・雲・遠景の山・星・海・ライトをまとめて作る
export function buildEnvironment(scene, theme, rnd, opts = {}) {
  const group = new THREE.Group();
  scene.add(group);

  // 空のグラデーション + 太陽のにじみ
  const sunDir = new THREE.Vector3(0.45, theme.night ? 0.35 : 0.55, 0.3).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(theme.skyTop) }, horizon: { value: new THREE.Color(theme.skyHorizon) },
        sunDir: { value: sunDir }, sunColor: { value: new THREE.Color(theme.sun) }, night: { value: theme.night ? 1 : 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: `
        uniform vec3 top, horizon, sunColor, sunDir; uniform float night; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += sunColor * (pow(s, 900.0) * (night > 0.5 ? 1.2 : 3.0) + pow(s, 12.0) * 0.18 * (1.0 - night * 0.6));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // 星
  if (theme.stars || theme.night) {
    const n = 900, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * Math.PI * 2, v = 0.08 + rnd() * 0.9;
      p[i * 3] = Math.cos(u) * Math.cos(v) * 1200; p[i * 3 + 1] = Math.sin(v) * 1200; p[i * 3 + 2] = Math.sin(u) * Math.cos(v) * 1200;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    group.add(stars);
  }

  // 遠景の山(フラットシェーディングのローポリ)。宇宙では代わりに惑星を浮かべる
  if (theme.space) {
    const planet = (r, color, x, y, z, ring) => {
      const p = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive: color, emissiveIntensity: 0.25 }));
      p.position.set(x, y, z); group.add(p);
      if (ring) { const rg = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2.1, 64), new THREE.MeshBasicMaterial({ color: ring, side: THREE.DoubleSide, transparent: true, opacity: 0.7, fog: false })); rg.position.copy(p.position); rg.rotation.x = 1.2; rg.rotation.y = 0.4; group.add(rg); }
      p.material.fog = false;
    };
    planet(120, 0xff8a5c, -600, 220, -700, 0xffd59a);
    planet(60, 0x5cc8ff, 700, 160, 300, null);
    planet(30, 0xc58aff, 200, 300, 800, 0xffffff);
  }
  const mGeo = new THREE.ConeGeometry(1, 1, 7, 3);
  const pos = mGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0.49 && y > -0.49) { pos.setX(i, pos.getX(i) * (0.85 + rnd() * 0.3)); pos.setZ(i, pos.getZ(i) * (0.85 + rnd() * 0.3)); }
  }
  mGeo.translate(0, 0.5, 0);
  mGeo.computeVertexNormals();
  const count = theme.noMountains ? 0 : 46;
  const mtn = new THREE.InstancedMesh(mGeo, new THREE.MeshStandardMaterial({ color: theme.mountain, roughness: 1, flatShading: true }), count);
  const cap = theme.snowcap ? new THREE.InstancedMesh(mGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), count) : null;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.1;
    const d = 720 + rnd() * 220;
    const h = 90 + rnd() * 190, w = 120 + rnd() * 160;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6);
    s.set(w, h, w); t.set(Math.cos(a) * d, -2, Math.sin(a) * d);
    m.compose(t, q, s); mtn.setMatrixAt(i, m);
    if (cap) { s.set(w * 0.36, h * 0.36, w * 0.36); t.y = -2 + h * 0.64; m.compose(t, q, s); cap.setMatrixAt(i, m); }
  }
  group.add(mtn); if (cap) group.add(cap);

  // 火山の噴煙・溶岩の光
  if (theme.lava) {
    const v = new THREE.Mesh(new THREE.ConeGeometry(260, 330, 9, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a1414, roughness: 1, flatShading: true }));
    v.position.set(-650, 150, -500); group.add(v);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(70, 90, 20, 16), new THREE.MeshBasicMaterial({ color: 0xff5a1a }));
    glow.position.set(-650, 312, -500); group.add(glow);
  }

  // 雲
  if (theme.clouds) {
    const cg = new THREE.IcosahedronGeometry(1, 1);
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, emissive: 0xaab8c8, emissiveIntensity: 0.35 });
    const n = 26 * 5;
    const clouds = new THREE.InstancedMesh(cg, cm, n);
    let k = 0;
    for (let c = 0; c < 26; c++) {
      const a = rnd() * Math.PI * 2, d = 250 + rnd() * 450, y = 130 + rnd() * 90;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
      for (let j = 0; j < 5; j++) {
        const r = 14 + rnd() * 16;
        s.set(r * 1.4, r * 0.8, r); t.set(cx + (j - 2) * 18 + rnd() * 6, y + rnd() * 8, cz + rnd() * 10);
        q.identity(); m.compose(t, q, s); clouds.setMatrixAt(k++, m);
      }
    }
    group.add(clouds);
  }

  // 海
  if (theme.sea) {
    const sea = new THREE.Mesh(new THREE.RingGeometry(520, 1400, 64), new THREE.MeshStandardMaterial({ color: 0x1aa3c8, roughness: 0.15, metalness: 0.1 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = 0.3;
    group.add(sea);
  }

  // ライト
  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.night ? 1.0 : 0.9);
  const sun = new THREE.DirectionalLight(theme.sun, theme.sunI);
  sun.position.copy(sunDir).multiplyScalar(120);
  if (opts.shadows) {
    sun.castShadow = true;
    const S = opts.shadowSize || 2048;
    sun.shadow.mapSize.set(S, S);
    const c = sun.shadow.camera; c.left = -55; c.right = 55; c.top = 55; c.bottom = -55; c.near = 10; c.far = 320;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
  }
  scene.add(hemi, sun, sun.target);
  scene.fog = new THREE.Fog(theme.fog, 160, 1100);

  // 昼(0) → 夕(0.5) → 夜(1)。ギミック「昼から夜に変わるコース」で使う
  const day = { top: new THREE.Color(theme.skyTop), hor: new THREE.Color(theme.skyHorizon), fog: new THREE.Color(theme.fog), sun: theme.sunI, hemi: hemi.intensity };
  const dusk = { top: new THREE.Color(0x3a3a8a), hor: new THREE.Color(0xff9a5a), fog: new THREE.Color(0xd08a6a), sun: theme.sunI * 0.55, hemi: hemi.intensity * 0.7 };
  const nightC = { top: new THREE.Color(0x05071a), hor: new THREE.Color(0x1d1f4a), fog: new THREE.Color(0x15183a), sun: 0.35, hemi: 0.35 };
  const tmp = new THREE.Color();
  const mix = (a, b, t, out) => out.copy(a).lerp(b, t);

  return {
    setTime(t) {
      const [a, b, u] = t < 0.5 ? [day, dusk, t / 0.5] : [dusk, nightC, (t - 0.5) / 0.5];
      const su = sky.material.uniforms;
      mix(a.top, b.top, u, su.top.value); mix(a.hor, b.hor, u, su.horizon.value);
      mix(a.fog, b.fog, u, tmp); scene.fog.color.copy(tmp);
      sun.intensity = a.sun + (b.sun - a.sun) * u;
      hemi.intensity = a.hemi + (b.hemi - a.hemi) * u;
      su.night.value = t > 0.6 ? 1 : 0;
    },
    group, sun, sunDir,
    follow(x, z) {
      sun.position.set(x + sunDir.x * 120, sunDir.y * 120, z + sunDir.z * 120);
      sun.target.position.set(x, 0, z);
      sun.target.updateMatrixWorld();
    },
  };
}

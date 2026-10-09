import * as THREE from 'three';
import { buildFigure } from './figure.js';

// カートは +x が前方。共有ジオメトリで8台分の負荷を抑える
const shared = g => { g.userData.shared = true; return g; };
let G = null;
function geos() {
  if (G) return G;
  const prof = new THREE.Shape();
  prof.moveTo(-1.35, 0.28);
  prof.lineTo(1.35, 0.28);
  prof.quadraticCurveTo(1.62, 0.3, 1.58, 0.42);
  prof.quadraticCurveTo(1.45, 0.58, 1.0, 0.64);
  prof.lineTo(0.55, 0.7);
  prof.quadraticCurveTo(0.15, 0.78, -0.05, 0.62);
  prof.lineTo(-0.55, 0.6);
  prof.quadraticCurveTo(-0.72, 0.62, -0.78, 0.9);
  prof.lineTo(-1.25, 0.95);
  prof.quadraticCurveTo(-1.45, 0.92, -1.42, 0.6);
  prof.closePath();
  const chassis = new THREE.ExtrudeGeometry(prof, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.12, bevelSegments: 4, curveSegments: 10 });
  chassis.translate(0, 0, -0.55);
  chassis.computeVertexNormals();

  const tire = (r, w) => {
    const pts = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI;
      pts.push(new THREE.Vector2(r - 0.1 + Math.sin(a) * 0.1, -w / 2 + (i / n) * w));
    }
    return new THREE.LatheGeometry(pts, 28).rotateX(Math.PI / 2);
  };
  G = {
    chassis: shared(chassis),
    pod: shared(new THREE.CapsuleGeometry(0.2, 1.3, 6, 16).rotateZ(Math.PI / 2)),
    bumper: shared(new THREE.CapsuleGeometry(0.12, 1.5, 6, 12).rotateX(Math.PI / 2)),
    wing: shared(new THREE.BoxGeometry(0.45, 0.07, 1.75)),
    strut: shared(new THREE.BoxGeometry(0.06, 0.32, 0.06)),
    pipe: shared(new THREE.CylinderGeometry(0.09, 0.11, 0.42, 14, 1, true).rotateZ(Math.PI / 2)),
    flame: shared(new THREE.ConeGeometry(0.11, 0.7, 12, 1, true).rotateZ(Math.PI / 2).translate(-0.35, 0, 0)),
    seat: shared(new THREE.CapsuleGeometry(0.32, 0.4, 6, 12)),
    wheelF: shared(tire(0.4, 0.36)),
    wheelR: shared(tire(0.47, 0.46)),
    rimF: shared(new THREE.CylinderGeometry(0.25, 0.25, 0.38, 20).rotateX(Math.PI / 2)),
    rimR: shared(new THREE.CylinderGeometry(0.3, 0.3, 0.48, 20).rotateX(Math.PI / 2)),
    hub: shared(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 12).rotateX(Math.PI / 2)),
    steer: shared(new THREE.TorusGeometry(0.22, 0.035, 8, 24)),
    column: shared(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8)),
    light: shared(new THREE.SphereGeometry(0.11, 14, 10)),
    shadow: shared(new THREE.PlaneGeometry(4.2, 2.8).rotateX(-Math.PI / 2)),
    shield: shared(new THREE.SphereGeometry(2.3, 32, 24)),
  };
  return G;
}

function shadowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
let shadowMat = null;
const M = {};
function mats() {
  if (M.tire) return M;
  M.tire = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.92 });
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.18, metalness: 1 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.55, metalness: 0.3 });
  M.seat = new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: 0.7 });
  M.light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3c4, emissiveIntensity: 1.5 });
  M.flame = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  return M;
}

export function makeKartMesh({ bodyColor, char, ghost = false }) {
  const g = geos(), m = mats();
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);

  const paint = new THREE.MeshPhysicalMaterial({ color: bodyColor, roughness: 0.32, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
  const all = [];
  const add = (mesh, parent = tilt) => { parent.add(mesh); all.push(mesh); return mesh; };

  add(new THREE.Mesh(g.chassis, paint));
  for (const s of [-1, 1]) {
    const pod = add(new THREE.Mesh(g.pod, paint)); pod.position.set(0.05, 0.42, s * 0.82);
    const st = add(new THREE.Mesh(g.strut, m.dark)); st.position.set(-1.3, 1.08, s * 0.55);
    const pipe = add(new THREE.Mesh(g.pipe, m.chrome)); pipe.position.set(-1.55, 0.72, s * 0.28);
    const hl = add(new THREE.Mesh(g.light, m.light)); hl.position.set(1.52, 0.48, s * 0.4); hl.scale.set(0.5, 1, 1);
  }
  const bumper = add(new THREE.Mesh(g.bumper, m.dark)); bumper.position.set(1.7, 0.32, 0);
  const wing = add(new THREE.Mesh(g.wing, paint)); wing.position.set(-1.32, 1.27, 0); wing.rotation.z = 0.12;
  const seat = add(new THREE.Mesh(g.seat, m.seat)); seat.position.set(-0.55, 0.95, 0); seat.rotation.z = 0.25;
  const column = add(new THREE.Mesh(g.column, m.dark)); column.position.set(0.55, 0.92, 0); column.rotation.z = -0.9;
  const steer = add(new THREE.Mesh(g.steer, m.dark)); steer.position.set(0.42, 1.05, 0); steer.rotation.y = Math.PI / 2; steer.rotation.x = 0; steer.rotateX(0.6);

  // 排気の炎(ブースト時)
  const flames = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(g.flame, m.flame.clone());
    f.position.set(-1.75, 0.72, s * 0.28); f.visible = false;
    tilt.add(f); flames.push(f);
  }

  const wheels = [];
  for (const [x, z, front] of [[1.05, 0.88, true], [1.05, -0.88, true], [-0.9, 0.92, false], [-0.9, -0.92, false]]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(front ? g.wheelF : g.wheelR, m.tire));
    w.add(new THREE.Mesh(front ? g.rimF : g.rimR, m.chrome));
    const hub = new THREE.Mesh(g.hub, paint); hub.scale.set(1, 1, front ? 0.8 : 1); w.add(hub);
    w.position.set(x, front ? 0.4 : 0.47, z);
    tilt.add(w); wheels.push(w);
    w.traverse(o => o.isMesh && all.push(o));
  }

  // ドライバー
  const driver = new THREE.Group();
  driver.position.set(-0.38, -0.02, 0);
  const fig = buildFigure(char);
  fig.root.scale.setScalar(0.8);
  driver.add(fig.root);
  tilt.add(driver);

  if (!ghost) {
    shadowMat ??= new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
    const sh = new THREE.Mesh(g.shadow, shadowMat); sh.position.y = 0.05; sh.renderOrder = -1;
    root.add(sh);
  }

  const sparkMat = null;
  const shield = new THREE.Mesh(g.shield, new THREE.MeshBasicMaterial({ color: 0xffef7a, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
  shield.position.y = 1.2; shield.visible = false;
  root.add(shield);

  const held = new THREE.Group();
  held.position.set(-2.3, 0.6, 0);
  held.visible = false;
  root.add(held);

  if (ghost) {
    root.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.transparent = true; o.material.opacity = 0.4; o.material.depthWrite = false;
    });
  } else {
    all.forEach(o => (o.castShadow = true));
  }
  return { root, tilt, bodyMat: paint, wheels, frontWheels: wheels.slice(0, 2), driver, fig, flames, shield, held, sparkMat };
}

export function makeItemMesh(type) {
  switch (type) {
    case 'missile': {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0xff1744, roughness: 0.25, clearcoat: 1, emissive: 0x440000 }));
      b.scale.set(1.15, 0.9, 0.9);
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 16).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
      c.position.x = 0.85;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 8, 24), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.3, metalness: 0.6 }));
      ring.rotation.y = Math.PI / 2; ring.position.x = -0.2;
      g.add(b, c, ring); return g;
    }
    case 'bomb': {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0x20242c, roughness: 0.3, clearcoat: 0.8 }));
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5), new THREE.MeshStandardMaterial({ color: 0xbfa070 }));
      f.position.y = 0.85;
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
      spark.position.y = 1.12;
      g.add(b, f, spark); return g;
    }
    case 'boomerang': { // さかな
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0x4fa3ff, roughness: 0.3, clearcoat: 1 }));
      body.scale.set(1.5, 0.7, 0.45);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 3), new THREE.MeshStandardMaterial({ color: 0x2b7fe0 }));
      tail.rotation.z = Math.PI / 2; tail.position.x = -1.2; tail.scale.z = 0.3;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      eye.position.set(0.75, 0.15, 0.25);
      g.add(body, tail, eye); g.userData.spin = true; return g;
    }
    case 'yarn': {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.8, 20, 14), new THREE.MeshStandardMaterial({ color: 0xff5fa2, roughness: 0.9 }));
      g.add(b);
      for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 6, 30), new THREE.MeshStandardMaterial({ color: 0xffc1dc })); r.rotation.set(i * 0.8, i * 1.3, 0); g.add(r); }
      g.userData.roll = true; return g;
    }
    case 'stamp': { // 大きな肉球の足跡
      const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
      c.fillStyle = '#ff7eb0';
      c.beginPath(); c.ellipse(64, 80, 34, 28, 0, 0, 7); c.fill();
      [[28, 40], [52, 26], [78, 26], [100, 40]].forEach(([x, y]) => { c.beginPath(); c.ellipse(x, y, 13, 16, 0, 0, 7); c.fill(); });
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32), new THREE.MeshStandardMaterial({ map: t, transparent: true, emissive: 0xff5fa2, emissiveIntensity: 0.3 }));
      m.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.add(m); return g;
    }
    case 'firework': {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0xff3b3b, roughness: 0.4 }));
      b.rotation.z = Math.PI / 2;
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshStandardMaterial({ color: 0xbbbbbb }));
      ear.position.set(0.4, 0.2, 0);
      g.add(b, ear); return g;
    }
    case 'ice': {
      const m = new THREE.Mesh(new THREE.CircleGeometry(9, 40), new THREE.MeshPhysicalMaterial({ color: 0xbfefff, roughness: 0.05, transparent: true, opacity: 0.75, clearcoat: 1, emissive: 0x2a6a8a, emissiveIntensity: 0.3 }));
      m.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.add(m); return g;
    }
    case 'cushion': {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.8, 6, 16), new THREE.MeshStandardMaterial({ color: 0xfff1f6, roughness: 0.9 }));
      m.rotation.z = Math.PI / 2; m.scale.set(1, 1, 0.7);
      const g = new THREE.Group(); g.add(m); return g;
    }
    case 'topbomb': {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0x2b6bff, roughness: 0.25, clearcoat: 1, emissive: 0x0a2a88 }));
      g.add(b);
      for (let i = 0; i < 10; i++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
        const a = (i / 10) * Math.PI * 2, e = (i % 2 ? 0.5 : -0.2);
        sp.position.set(Math.cos(a) * 0.95, e, Math.sin(a) * 0.95); sp.lookAt(Math.cos(a) * 3, e * 3, Math.sin(a) * 3); sp.rotateX(Math.PI / 2);
        g.add(sp);
      }
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
        w.scale.set(0.5, 0.15, 1); w.position.set(-0.2, 0.6, s * 1.0); w.rotation.x = s * 0.5; g.add(w);
      }
      return g;
    }
    case 'jelly': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0x2ee86e, roughness: 0.1, transmission: 0.6, thickness: 0.8, transparent: true, opacity: 0.9, emissive: 0x0a4020 }));
      m.scale.y = 0.6; m.castShadow = true; return m;
    }
  }
  return new THREE.Group();
}

export function makeItemBoxMesh(tex) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, transparent: true, opacity: 0.8, roughness: 0.05, clearcoat: 1, depthWrite: false }));
  const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe9a0, emissiveIntensity: 1.2 }));
  g.add(inner, outer);
  return g;
}

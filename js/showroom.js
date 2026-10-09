import * as THREE from 'three';
import { makeKartMesh } from './kart.js';

function gradientTexture(top, bottom) {
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, top); g.addColorStop(1, bottom);
  c.fillStyle = g; c.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// キャラ選択の展示台(ターンテーブル)
export class Showroom {
  constructor(envMap) {
    this.scene = new THREE.Scene();
    this.scene.background = gradientTexture('#1b2a6b', '#5a8de0');
    if (envMap) this.scene.environment = envMap;
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
    this.camera.position.set(9.5, 3.4, 0);
    this.camera.lookAt(0, 1.0, 0);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 10, 5); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
    key.shadow.bias = -0.0005; key.shadow.radius = 4;
    const rim = new THREE.DirectionalLight(0x9fc4ff, 2.2); rim.position.set(-6, 5, -4);
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x30305a, 0.7);
    this.scene.add(key, rim, hemi);

    // 台座
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.5, 64), new THREE.MeshPhysicalMaterial({ color: 0x1a2a6a, roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }));
    base.position.y = -0.25; base.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.06, 8, 96), new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffb000, emissiveIntensity: 1.6 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.0;
    this.scene.add(base, ring);

    this.turn = new THREE.Group();
    this.scene.add(this.turn);
    this.t = 0;
  }

  setKart(char, bodyColor) {
    if (this.kart) { this.turn.remove(this.kart.root); }
    this.kart = makeKartMesh({ bodyColor, char });
    this.kart.root.children.forEach(c => { if (c.isMesh && c.material?.map) c.visible = false; }); // 丸影は台座では不要
    this.turn.add(this.kart.root);
    this.hop = 0.35;
  }

  update(dt) {
    this.t += dt;
    this.turn.rotation.y += dt * 0.55;
    if (this.kart) {
      this.hop = Math.max(0, this.hop - dt);
      this.kart.tilt.position.y = Math.sin((this.hop / 0.35) * Math.PI) * 0.5;
      this.kart.driver.position.y = -0.02 + Math.abs(Math.sin(this.t * 3)) * 0.04;
      for (const w of this.kart.wheels) w.rotation.z -= dt * 1.5;
    }
  }

  render(draw, dt) { this.update(dt); draw(this.scene, this.camera); }

  resize(w, h) {
    this.camera.aspect = w / h;
    // 縦長では横の画角が狭いので引きで撮る
    const far = w < h ? 1.9 : 1;
    this.camera.position.set(9.5 * far, 3.4 * far, 0);
    this.camera.lookAt(0, 1.0, 0);
    // 横長画面では左側にUIがあるので、カートを右寄せにする
    if (w > h) this.camera.setViewOffset(w, h, -w * (h < 560 ? 0.27 : 0.2), h * 0.02, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.22, w, h); // 縦長では上側に表示
    this.camera.updateProjectionMatrix();
  }
}

// 3Dフィギュアの顔アイコンをオフスクリーンで描いて dataURL にする
export function renderPortraits(chars, buildFigure) {
  const size = 192;
  const cv = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(size, size, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(5, 6, 3);
  scene.add(key, new THREE.HemisphereLight(0xffffff, 0x8899bb, 1.3));
  const cam = new THREE.PerspectiveCamera(22, 1, 0.1, 50);
  cam.position.set(6.4, 2.45, 1.5); cam.lookAt(0, 2.25, 0.08);
  const out = {};
  for (const ch of chars) {
    const f = buildFigure(ch);
    scene.add(f.root);
    r.render(scene, cam);
    out[ch.id] = cv.toDataURL('image/png');
    scene.remove(f.root);
  }
  r.dispose();
  r.forceContextLoss?.();
  return out;
}

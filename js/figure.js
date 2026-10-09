import * as THREE from 'three';

// 写真シルエットから作ったロフト形状に、正面/背面/横の画像を投影して貼る3Dフィギュア。
// にゃん兵衛(黒ネコ)は写真を、ほかの動物は手描き(キャンバス)の顔を同じ方法で投影する。
// 座標: +x が前、+y が上、+z がキャラの左手側(カート右側)。足元 y=0、耳先 y≈3.1

let META = null;
const TEX = {};

// 単体HTML版では画像・データを埋め込み(data URL)から読む
export const assetUrl = p => globalThis.__ASSETS?.[p] ?? p;

export async function loadFigureAssets() {
  META = await (await fetch(assetUrl('assets/figure/kuro.json'))).json();
  const loader = new THREE.TextureLoader();
  await Promise.all(['front', 'rear', 'side'].map(async v => {
    const t = await loader.loadAsync(assetUrl(`assets/figure/kuro_${v}.webp`));
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.shared = true;
    TEX[v] = t;
  }));
}

// ---------- ロフト形状 ----------
const LOFT = {};
function loftGeometry(passes = 1) {
  if (LOFT[passes]) return LOFT[passes];
  const rows = META.rows.map(r => ({ ...r }));
  // しっぽの混入を抑える(背中側を前側の厚みに合わせて制限)し、上下に軽くならす
  for (const r of rows) r.x0 = Math.max(r.x0, -Math.max(r.x1, 0.32) * 1.15);
  let sm = rows;
  for (let n = 0; n < passes; n++) {
    sm = sm.map((r, i) => {
      const a = sm[Math.max(0, i - 1)], b = sm[Math.min(sm.length - 1, i + 1)];
      const avg = k => (a[k] + 2 * r[k] + b[k]) / 4;
      return { y: r.y, z0: avg('z0'), z1: avg('z1'), x0: avg('x0'), x1: avg('x1') };
    });
  }
  const SEG = 56, P = 2.5;
  const pos = [], idx = [];
  const ring = r => {
    const xc = (r.x0 + r.x1) / 2, zc = (r.z0 + r.z1) / 2, rx = (r.x1 - r.x0) / 2, rz = (r.z1 - r.z0) / 2;
    for (let i = 0; i < SEG; i++) {
      const t = (i / SEG) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      pos.push(xc + rx * Math.sign(c) * Math.abs(c) ** (2 / P), r.y, zc + rz * Math.sign(s) * Math.abs(s) ** (2 / P));
    }
  };
  // 下のふた
  const first = sm[0], last = sm[sm.length - 1];
  pos.push((first.x0 + first.x1) / 2, Math.max(0, first.y - 0.05), (first.z0 + first.z1) / 2);
  sm.forEach(ring);
  // 頭頂は少し丸める
  // 頭頂: 最上段の楕円から球面状に閉じる
  const capH = 0.16;
  const capRows = [0.45, 0.8, 1.1, 1.35];
  const xc = (last.x0 + last.x1) / 2, zc = (last.z0 + last.z1) / 2;
  capRows.forEach(t => {
    const k = Math.cos(t);
    ring({ y: last.y + Math.sin(t) * capH, x0: xc + (last.x0 - xc) * k, x1: xc + (last.x1 - xc) * k, z0: zc + (last.z0 - zc) * k, z1: zc + (last.z1 - zc) * k });
  });
  const topY = last.y + capH;
  pos.push((last.x0 + last.x1) / 2, topY, (last.z0 + last.z1) / 2);
  const nRings = sm.length + capRows.length;
  const topIdx = 1 + nRings * SEG;
  for (let i = 0; i < SEG; i++) idx.push(0, 1 + i, 1 + ((i + 1) % SEG));
  for (let r = 0; r < nRings - 1; r++) for (let i = 0; i < SEG; i++) {
    const a = 1 + r * SEG + i, b = 1 + r * SEG + ((i + 1) % SEG), c = a + SEG, d = b + SEG;
    idx.push(a, c, b, b, c, d);
  }
  for (let i = 0; i < SEG; i++) idx.push(topIdx, 1 + (nRings - 1) * SEG + ((i + 1) % SEG), 1 + (nRings - 1) * SEG + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.shared = true;
  LOFT[passes] = g;
  return g;
}

// ---------- 投影マテリアル ----------
function projUniform(view) {
  const p = META.proj[view];
  // u = (c + a / s) / w,  v = 1 - (feet - y / s) / h
  return new THREE.Vector4(p.c, p.s, p.w, p.feet / p.h);
}

/**
 * maps: { front, rear, side } のテクスチャ(無いものは null)。base: 地の色
 * photoMode: 写真の陰影を活かして少し自己発光させる
 */
function projectionMaterial({ maps, base, photoMode = false, roughness = 0.75, topFade = true }) {
  const m = new THREE.MeshStandardMaterial({ color: base, roughness, metalness: 0 });
  const uni = {
    pFront: { value: maps.front || null }, pRear: { value: maps.rear || null }, pSide: { value: maps.side || null },
    uFront: { value: projUniform('front') }, uRear: { value: projUniform('rear') }, uSide: { value: projUniform('side') },
    hFront: { value: META.proj.front.h }, hRear: { value: META.proj.rear.h }, hSide: { value: META.proj.side.h },
    useFront: { value: maps.front ? 1 : 0 }, useRear: { value: maps.rear ? 1 : 0 }, useSide: { value: maps.side ? 1 : 0 },
    photo: { value: photoMode ? 1 : 0 },
    headTop: { value: topFade ? META.rows[META.rows.length - 1].y : 99 },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOP; varying vec3 vON;
        uniform sampler2D pFront, pRear, pSide; uniform vec4 uFront, uRear, uSide;
        uniform float hFront, hRear, hSide, useFront, useRear, useSide, photo, headTop;
        vec4 projSample(sampler2D t, vec4 u, float h, float a, float y) {
          vec2 uv = vec2((u.x + a / u.y) / u.z, 1.0 - (u.w - y / u.y / h));
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
          return texture2D(t, uv);
        }`)
      .replace('#include <map_fragment>', `
        vec3 n = normalize(vON);
        float wf = pow(max(n.x, 0.0), 2.0) * useFront, wr = pow(max(-n.x, 0.0), 2.0) * useRear, ws = pow(abs(n.z), 2.0) * useSide;
        // 頭頂(耳の付け根より上)や真上向きの面は投影が伸びるので使わない
        float topFade = 1.0 - smoothstep(headTop - 0.08, headTop + 0.02, vOP.y) * smoothstep(0.35, 0.7, n.y);
        wf *= topFade; wr *= topFade; ws *= topFade;
        vec4 cf = projSample(pFront, uFront, hFront, -vOP.z, vOP.y);
        vec4 cr = projSample(pRear, uRear, hRear, vOP.z, vOP.y);
        vec4 cs = projSample(pSide, uSide, hSide, -vOP.x, vOP.y);
        wf *= cf.a; wr *= cr.a; ws *= cs.a;
        float wsum = wf + wr + ws;
        if (photo > 0.5) {
          if (wsum > 0.001) diffuseColor.rgb = (cf.rgb * wf + cr.rgb * wr + cs.rgb * ws) / wsum;
          // 写真の陰影があるので、照明は弱めに混ぜる
          totalEmissiveRadiance += diffuseColor.rgb * 0.45;
        } else {
          // デカール: 正面の絵だけを地の色の上に重ねる
          float a = cf.a * smoothstep(0.05, 0.45, n.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, cf.rgb, a);
        }`);
  };
  m.customProgramCacheKey = () => (photoMode ? 'figPhoto' : 'figDecal');
  m.userData.make = opts => projectionMaterial({ maps, base, photoMode, roughness, ...opts });
  return m;
}

// ---------- 手描きの顔(デカール) ----------
// 正面投影画像と同じ座標系(ピクセル)でキャンバスに描く
function px(z, y) { const p = META.proj.front; return [p.c - z / p.s, p.feet - y / p.s]; }
function faceTexture(L) {
  const p = META.proj.front;
  const cv = document.createElement('canvas'); cv.width = p.w * 2; cv.height = p.h * 2;
  const c = cv.getContext('2d');
  c.scale(2, 2);
  const R = 0.2 / p.s; // 目の基準サイズ(px)
  const ell = (z, y, rx, ry, fill, rot = 0) => { const [x, yy] = px(z, y); c.save(); c.translate(x, yy); c.rotate(rot); c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, 7); c.fillStyle = fill; c.fill(); c.restore(); };
  // お腹
  if (L.belly) ell(0, 0.95, R * 2.2, R * 2.6, L.belly);
  // 顔の模様
  if (L.mask) for (const s of [-1, 1]) ell(s * 0.33, 2.08, R * 1.25, R * 0.95, L.mask, s * 0.35);
  if (L.patch) for (const s of [-1, 1]) ell(s * 0.33, 2.02, R * 1.05, R * 1.35, L.patch, s * -0.5);
  if (L.face) ell(0, 1.95, R * 3.4, R * 3.0, L.face);
  if (L.cheeks) for (const s of [-1, 1]) ell(s * 0.42, 1.78, R * 1.5, R * 1.1, L.cheeks);
  if (L.muzzle) ell(0, 1.8, R * 1.5, R * 1.05, L.muzzle);
  if (L.brows) for (const s of [-1, 1]) ell(s * 0.3, 2.4, R * 0.42, R * 0.28, L.brows);
  // 目
  for (const s of [-1, 1]) {
    const ez = s * 0.3, ey = L.eyeY ?? 2.08;
    if (L.eyes === 'frog') {
      ell(ez * 1.2, 2.84, R * 0.95, R * 0.95, '#ffffff'); ell(ez * 1.2, 2.82, R * 0.5, R * 0.4, '#111');
      ell(ez * 1.2 - 0.03, 2.88, R * 0.18, R * 0.18, '#fff');
    } else if (L.eyes === 'sharp') {
      const [x, y] = px(ez, ey);
      c.save(); c.translate(x, y);
      c.beginPath(); c.ellipse(0, 0, R * 0.95, R * 0.75, 0, 0, 7); c.fillStyle = '#1a1010'; c.fill();
      c.beginPath(); c.ellipse(0, 0, R * 0.82, R * 0.62, 0, 0, 7); c.fillStyle = L.eyeColor || '#ffb000'; c.fill();
      c.beginPath(); c.ellipse(0, R * 0.05, R * 0.16, R * 0.5, 0, 0, 7); c.fillStyle = '#111'; c.fill();
      c.fillStyle = L.fur; c.beginPath(); c.moveTo(-R, -R * 0.9); c.lineTo(R, -R * 0.9); c.lineTo(R * s * -1, -R * 0.15); c.closePath(); c.fill();
      c.beginPath(); c.arc(R * 0.3 * -s, -R * 0.2, R * 0.16, 0, 7); c.fillStyle = '#fff'; c.fill();
      c.restore();
    } else {
      ell(ez, ey, R * 0.55, R * 0.72, L.eyeColor || '#16141c');
      ell(ez + s * 0.04, ey + 0.06, R * 0.24, R * 0.24, '#ffffff');
      ell(ez - s * 0.03, ey - 0.05, R * 0.11, R * 0.11, '#ffffff');
    }
  }
  // 鼻・口
  if (L.beak) {
    const [x, y] = px(0, 1.86);
    c.beginPath(); c.moveTo(x - R * 0.8, y - R * 0.2); c.lineTo(x + R * 0.8, y - R * 0.2); c.lineTo(x, y + R * 0.9); c.closePath(); c.fillStyle = L.beak; c.fill();
  }
  if (L.nose) ell(0, L.muzzle ? 1.87 : 1.9, R * 0.38, R * 0.26, L.nose);
  {
    const [x, y] = px(0, L.muzzle ? 1.76 : 1.8);
    c.strokeStyle = L.mouthColor || '#3a1e1e'; c.lineWidth = R * 0.14; c.lineCap = 'round';
    if (L.eyes === 'frog') { c.beginPath(); c.arc(x, y - R * 0.6, R * 1.6, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke(); }
    else if (!L.beak) { c.beginPath(); c.arc(x - R * 0.3, y, R * 0.3, 0, Math.PI); c.arc(x + R * 0.3, y, R * 0.3, Math.PI, 0, true); c.stroke(); }
  }
  if (L.blush) for (const s of [-1, 1]) ell(s * 0.5, 1.86, R * 0.5, R * 0.3, L.blush);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------- パーツ ----------
const mats = {};
const flat = (color, rough = 0.75) => (mats[color + '_' + rough] ??= new THREE.MeshStandardMaterial({ color, roughness: rough }));

function makeEar(type, L, side, projMat) {
  const g = new THREE.Group();
  const ear = META.ears.find(e => Math.sign(e.tip[2]) === side) || META.ears[0];
  const tip = new THREE.Vector3(...ear.tip);
  if (type === 'photo' || type === 'cat' || type === 'shiba' || type === 'fox') {
    const scale = type === 'fox' ? 1.15 : type === 'shiba' ? 0.85 : 1;
    const base = new THREE.Vector3(0.0, 2.62, side * 0.5);
    const len = tip.distanceTo(base) * scale;
    const cone = new THREE.ConeGeometry(0.3, len, 24, 1);
    cone.translate(0, len / 2, 0); cone.scale(type === "photo" ? 0.35 : 0.55, 1, 1);
    const mesh = new THREE.Mesh(cone, type === 'photo' ? projMat : flat(L.fur));
    mesh.position.copy(base);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(base).normalize());
    const q = mesh.quaternion.clone();
    if (type === 'photo') bake(mesh);
    g.add(mesh);
    if (type !== 'photo') {
      const inner = new THREE.Mesh(cone, flat(L.earInner || '#f3b6c0'));
      inner.scale.set(0.55, 0.78, 0.6); inner.position.copy(base).add(new THREE.Vector3(0.1, 0.02, 0));
      inner.quaternion.copy(q);
      g.add(inner);
      if (L.earTip) {
        const tipm = new THREE.Mesh(cone, flat(L.earTip));
        tipm.scale.set(0.6, 0.35, 0.6); tipm.quaternion.copy(q);
        tipm.position.copy(base).addScaledVector(tip.clone().sub(base), 0.66 * scale);
        g.add(tipm);
      }
    }
  } else if (type === 'bunny') {
    const geo = new THREE.CapsuleGeometry(0.17, 1.0, 8, 20); geo.translate(0, 0.65, 0); geo.scale(0.6, 1, 1);
    const o = new THREE.Mesh(geo, flat(L.fur)); const i = new THREE.Mesh(geo, flat(L.earInner));
    i.scale.set(0.5, 0.85, 0.6); i.position.x = 0.07;
    const holder = new THREE.Group(); holder.add(o, i);
    holder.position.set(0, 2.65, side * 0.36); holder.rotation.x = side * 0.18; holder.rotation.z = -0.15;
    g.add(holder);
  } else if (type === 'round') {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 18), flat(L.earColor || L.fur));
    e.scale.set(0.55, 1, 1); e.position.set(-0.02, 2.78, side * 0.62);
    g.add(e);
  }
  return g;
}

function makeTail(type, color) {
  const m = flat(color, 0.8);
  const tube = (pts, r) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 48, r, 14, false), m);
  const g = new THREE.Group();
  switch (type) {
    case 'cat': {
      const pts = [[-0.45, 0.45, 0.3], [-0.68, 0.7, 0.75], [-0.66, 1.25, 0.95], [-0.6, 1.65, 0.85], [-0.48, 1.8, 0.66]];
      g.add(tube(pts, 0.14));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), m); cap.position.set(...pts[pts.length - 1]); g.add(cap);
      break;
    }
    case 'curl': {
      const pts = [];
      for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI * 1.7; pts.push([-0.55 - Math.sin(a) * 0.3, 0.75 + (1 - Math.cos(a)) * 0.3, 0]); }
      g.add(tube(pts, 0.13)); break;
    }
    case 'fox': {
      const t = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), m); t.scale.set(0.3, 0.75, 0.32); t.position.set(-0.85, 1.0, 0.25); t.rotation.z = 0.5;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), flat('#ffffff')); tip.scale.set(0.2, 0.3, 0.22); tip.position.set(-1.12, 1.55, 0.3); tip.rotation.z = 0.5;
      g.add(t, tip); break;
    }
    case 'puff': { const p = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), m); p.position.set(-0.68, 0.7, 0); g.add(p); break; }
    case 'stub': { const p = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), m); p.position.set(-0.6, 0.65, 0); g.add(p); break; }
    case 'striped': {
      const t = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), flat('#8a6748', 0.8)); t.scale.set(0.24, 0.6, 0.26); t.position.set(-0.78, 0.9, 0.2); t.rotation.z = 0.45;
      g.add(t);
      for (let i = 0; i < 2; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.21 - i * 0.03, 0.06, 8, 24), m); r.position.set(-0.86 - i * 0.13, 1.05 + i * 0.28, 0.2); r.rotation.y = Math.PI / 2; r.rotation.x = Math.PI / 2 - 0.45; g.add(r); }
      break;
    }
  }
  return g;
}

// 投影マテリアルはローカル座標で計算するので、部品の位置・向きを形状に焼き込む
function bake(mesh) {
  mesh.updateMatrix();
  mesh.geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
  mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
  return mesh;
}

/** キャラクターのフィギュアを作る。戻り値の root を座席に置く */
export function buildFigure(char) {
  const L = char.look;
  const root = new THREE.Group();
  const loft = loftGeometry(L.photo ? 1 : 6);
  let bodyMat;
  if (L.photo) {
    bodyMat = projectionMaterial({ maps: { front: TEX.front, rear: TEX.rear, side: TEX.side }, base: 0x2d2f33, photoMode: true });
  } else {
    bodyMat = projectionMaterial({ maps: { front: faceTexture(L) }, base: new THREE.Color(L.fur), roughness: 0.7 });
  }
  const body = new THREE.Mesh(loft, bodyMat);
  root.add(body);
  const earMat = L.photo ? bodyMat.userData.make({ topFade: false }) : bodyMat;
  if (L.ears !== 'none') for (const s of [-1, 1]) root.add(makeEar(L.photo ? 'photo' : L.ears, L, s, earMat));
  if (L.muzzle3d) {
    const mz = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), flat(L.muzzle3d));
    mz.scale.set(0.2, 0.17, 0.26); mz.position.set(0.66, 1.82, 0); root.add(mz);
  }
  if (L.eyes === 'frog') {
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 18), bodyMat);
      e.position.set(0.2, 2.8, s * 0.36); root.add(bake(e));
    }
  }
  if (L.tail !== 'none') root.add(makeTail(L.tail, L.tailColor || L.fur));
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, body };
}

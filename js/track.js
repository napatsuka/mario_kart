import * as THREE from 'three';

export const TRACK_WIDTH = 14;
export const OFFROAD_START = TRACK_WIDTH / 2;
export const WALL_OFF = TRACK_WIDTH / 2 + 5.5;
const SAMPLES = 800;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 閉曲線を等間隔の N 点に置き直す
function resample(dense, N) {
  const M = dense.length, cum = [0];
  for (let i = 0; i < M; i++) { const a = dense[i], b = dense[(i + 1) % M]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[M], out = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const d = (i / N) * L;
    while (cum[j + 1] < d) j++;
    const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1), a = dense[j], b = dense[(j + 1) % M];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return { pts: out, length: L };
}

// コースとして成立するか: 曲率半径が壁幅より大きく、離れた区間どうしが壁ごと重ならない
function validate(pts, spacing) {
  const N = pts.length;
  let minR = Infinity;
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 4 + N) % N], b = pts[i], c = pts[(i + 4) % N];
    const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
    const r = (4 * spacing) / Math.max(d, 1e-6);
    if (r < minR) minR = r;
  }
  if (minR < WALL_OFF + 3.5) return false;
  const win = Math.ceil((Math.PI * (WALL_OFF + 6)) / spacing) + 4;
  const need = (2 * WALL_OFF + 7) ** 2;
  for (let i = 0; i < N; i += 2) for (let j = i + win; j < N; j += 2) {
    if (N - (j - i) < win) continue;
    const dx = pts[i][0] - pts[j][0], dz = pts[i][1] - pts[j][1];
    if (dx * dx + dz * dz < need) return false;
  }
  return true;
}

const cache = new Map();
/**
 * 極座標 r(θ)>0 の閉曲線(自己交差しない)に、高い次数の波を重ねてヘアピンやS字を作る。
 * diff(0〜3)が大きいほど曲がりがきつく、コースも長くなる。成立しない形は検査して作り直す
 */
export function generateCenterline(seed, diff = 0) {
  const key = seed + ':' + diff;
  if (cache.has(key)) { const c = cache.get(key); return { pts: c.pts, rnd: mulberry32(seed * 7919 + 13) }; }
  const rnd = mulberry32(seed * 9973 + 7 + diff * 101);
  const targetLen = 1600 + diff * 70;
  let amp = 0.3 + diff * 0.07, best = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const harm = [];
    let total = 0;
    for (const k of [2, 3, 4, 5, 6, 7, 9]) {
      const w = k <= 3 ? 1 : k <= 5 ? 1 : k <= 7 ? 0.55 : 0.3;
      const a = rnd() * amp * w * (k >= 6 ? (diff >= 1 ? 1 : 0.4) : 1);
      harm.push({ k, a, p: rnd() * Math.PI * 2 });
      total += a;
    }
    const cap = 0.82 + diff * 0.03;
    if (total > cap) harm.forEach(h => (h.a *= cap / total));
    const sx = 1 + rnd() * 0.45, sz = 1 - rnd() * 0.25, shear = (rnd() - 0.5) * 0.4;
    const warp = (0.05 + diff * 0.045) * rnd(), wf = 3 + rnd() * 3, wp1 = rnd() * 6.3, wp2 = rnd() * 6.3;
    const dense = [];
    const M = 3200;
    for (let i = 0; i < M; i++) {
      const t = (i / M) * Math.PI * 2;
      let r = 1;
      for (const h of harm) r += h.a * Math.sin(h.k * t + h.p);
      let x = Math.cos(t) * r * sx + shear * Math.sin(t) * r, z = -Math.sin(t) * r * sz;
      // 座標をゆがめて対称性を崩し、うねり・ヘアピンを作る
      x += warp * Math.sin(z * wf + wp1); z += warp * Math.sin(x * wf + wp2);
      dense.push([x, z]);
    }
    let { pts, length } = resample(dense, SAMPLES);
    const s = targetLen / length;
    pts = pts.map(([x, z]) => [x * s, z * s]);
    best = pts;
    if (validate(pts, targetLen / SAMPLES)) break;
    if (attempt % 12 === 11) amp *= 0.92; // なかなか成立しないときは少しおだやかに
  }
  // スタートはいちばんまっすぐな区間に
  const N = best.length;
  let bestI = 0, bestTurn = Infinity;
  for (let i = 0; i < N; i += 4) {
    let turn = 0;
    for (let k = -30; k < 30; k += 3) {
      const a = best[(i + k + N) % N], b = best[(i + k + 3 + N) % N], c = best[(i + k + 6 + N) % N];
      let d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      turn += Math.abs(d);
    }
    if (turn < bestTurn) { bestTurn = turn; bestI = i; }
  }
  const pts = best.slice(bestI).concat(best.slice(0, bestI));
  cache.set(key, { pts });
  return { pts, rnd: mulberry32(seed * 7919 + 13) };
}

// 帯状メッシュ(各区間に独立した4頂点。uv の v は累積距離)。y0/y1 は数値か「サンプル番号→高さ」の関数
function stripGeometry(N, getL, getR, y0, y1, opts = {}) {
  const { colorFn, cum, vScale = 1, flip = false, range } = opts;
  const Y = (v, i) => (typeof v === 'function' ? v(i) : v);
  const list = range ? range : null;
  const count = list ? list.length : N;
  const pos = new Float32Array(count * 4 * 3), uv = new Float32Array(count * 4 * 2);
  const col = colorFn ? new Float32Array(count * 4 * 3) : null;
  const idx = [];
  const c = new THREE.Color();
  for (let n = 0; n < count; n++) {
    const i = list ? list[n] : n;
    const j = (i + 1) % N;
    const quad = [getL(i), getR(i), getL(j), getR(j)];
    const ys = [Y(y0, i), Y(y1, i), Y(y0, j), Y(y1, j)];
    const v0 = cum ? cum[i] / vScale : i, v1 = cum ? (cum[i] + cum.step[i]) / vScale : i + 1;
    const uvs = [[0, v0], [1, v0], [0, v1], [1, v1]];
    for (let q = 0; q < 4; q++) {
      const o = (n * 4 + q) * 3;
      pos[o] = quad[q][0]; pos[o + 1] = ys[q]; pos[o + 2] = quad[q][1];
      uv[(n * 4 + q) * 2] = uvs[q][0]; uv[(n * 4 + q) * 2 + 1] = uvs[q][1];
      if (col) { c.setHex(colorFn(i)); col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; }
    }
    const b = n * 4;
    // 左→右・手前→奥の順で上向きの面になる(flip で下向き)
    if (flip) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function canvasTexture(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const hexCss = n => '#' + n.toString(16).padStart(6, '0');

function noiseFill(c, w, h, base, amt, n, rnd, size = 2) {
  c.fillStyle = hexCss(base); c.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (rnd() - 0.5) * amt;
    c.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    c.fillRect(rnd() * w, rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
}

function decorParts(type) {
  const M = (geo, color, opt = {}) => ({ geo, color, ...opt });
  const T = (g, y) => g.translate(0, y, 0);
  switch (type) {
    case 'tree': return [M(T(new THREE.CylinderGeometry(0.45, 0.6, 2.6, 7), 1.3), 0x7a5238), M(T(new THREE.IcosahedronGeometry(2.6, 0), 4.6), 0x3f9a3a), M(T(new THREE.IcosahedronGeometry(1.9, 0), 6.8), 0x58b84a)];
    case 'pine': return [M(T(new THREE.CylinderGeometry(0.35, 0.5, 1.8, 6), 0.9), 0x5d4030), M(T(new THREE.ConeGeometry(2.5, 4.2, 8), 3.6), 0x1f5e33), M(T(new THREE.ConeGeometry(1.9, 3.6, 8), 5.9), 0x24703c), M(T(new THREE.ConeGeometry(1.0, 1.8, 8), 7.9), 0xffffff)];
    case 'cactus': return [M(T(new THREE.CapsuleGeometry(0.7, 4, 4, 10), 2.7), 0x5f9a3a), M(T(new THREE.CapsuleGeometry(0.4, 1.4, 4, 8).rotateZ(Math.PI / 2).translate(0.9, 0, 0), 2.6), 0x5f9a3a), M(T(new THREE.CapsuleGeometry(0.35, 1.2, 4, 8).translate(1.6, 0.5, 0), 2.8), 0x5f9a3a)];
    case 'island': return [M(T(new THREE.CylinderGeometry(7, 9, 1.6, 12), 0.3), 0xf3dca0), M(T(new THREE.CylinderGeometry(0.3, 0.55, 8, 7).translate(0.6, 0, 0).rotateZ(-0.12), 5), 0xa98c6a), M(T(new THREE.ConeGeometry(3.8, 1.4, 8, 1, true), 9.2), 0x2f9e44, { side: THREE.DoubleSide })];
    case 'iceberg': return [M(T(new THREE.ConeGeometry(6, 14, 6), 5), 0xf4fbff), M(T(new THREE.ConeGeometry(4, 9, 5).translate(5, 0, 2), 3.5), 0xcfeeff), M(T(new THREE.CylinderGeometry(9, 10, 1.2, 7), 0.2), 0xe8f7ff)];
    case 'spire': return [M(T(new THREE.ConeGeometry(4, 22, 6), 9), 0x3a2622), M(T(new THREE.ConeGeometry(2.4, 13, 5).translate(4, 0, 1), 5), 0x4a2e28)];
    case 'asteroid': return [M(new THREE.DodecahedronGeometry(4, 1), 0x6a5a8a)];
    case 'rock': return [M(T(new THREE.DodecahedronGeometry(2.4, 0), 1.1), 0x4a3030)];
    case 'building': return [M(T(new THREE.BoxGeometry(9, 1, 9), 0.5), 0xffffff, { windows: true })];
  }
  return [];
}

// 道の高さ: 数本の波を重ね、坂がきつすぎないように抑える。スタート付近は平らにする
function computeHeights(N, spacing, course, theme, rnd) {
  const elev = course.elev ?? 0;
  const H = new Float32Array(N);
  const p = [rnd() * 6.3, rnd() * 6.3, rnd() * 6.3];
  for (let i = 0; i < N; i++) {
    const s = i / N, d = Math.min(i, N - i);
    const flat = Math.min(1, Math.max(0, (d - 18) / 40));
    H[i] = elev * flat * (0.55 * Math.sin(2 * Math.PI * 2 * s + p[0]) + 0.3 * Math.sin(2 * Math.PI * 3 * s + p[1]) + 0.15 * Math.sin(2 * Math.PI * 5 * s + p[2]));
  }
  let maxSlope = 0;
  for (let i = 0; i < N; i++) maxSlope = Math.max(maxSlope, Math.abs(H[(i + 1) % N] - H[i]) / spacing);
  if (maxSlope > 0.27) for (let i = 0; i < N; i++) H[i] *= 0.27 / maxSlope;
  let min = Infinity; for (const h of H) min = Math.min(min, h);
  const floor = theme.base === 'water' ? 5 : theme.base === 'lava' ? 7 : theme.base === 'void' ? 0 : theme.deck ? 7 : 0.35;
  for (let i = 0; i < N; i++) H[i] += floor - min;
  return H;
}

export function buildTrack(course, theme, opts = {}) {
  const { pts, rnd } = generateCenterline(course.seed, course.diff ?? 0);
  const N = pts.length;
  const samples = pts.map(([x, z], i) => {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    return { x, z, tx, tz, nx: -tz, nz: tx, angle: Math.atan2(tz, tx) };
  });
  const cum = new Float32Array(N); cum.step = new Float32Array(N);
  let length = 0;
  for (let i = 0; i < N; i++) {
    const a = samples[i], b = samples[(i + 1) % N];
    cum[i] = length;
    cum.step[i] = Math.hypot(b.x - a.x, b.z - a.z);
    length += cum.step[i];
  }
  const spacing = length / N;
  for (let i = 0; i < N; i++) {
    const a = samples[(i - 6 + N) % N], b = samples[(i + 6) % N];
    let d = b.angle - a.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    samples[i].curv = d / (12 * spacing);
  }
  const H = computeHeights(N, spacing, course, theme, rnd);
  samples.forEach((s, i) => (s.y = H[i]));
  const Hf = add => i => H[i] + add;

  const off = (i, lat) => [samples[i].x + samples[i].nx * lat, samples[i].z + samples[i].nz * lat];
  const group = new THREE.Group();
  const recv = m => { m.receiveShadow = true; return m; };
  const isGround = theme.base === 'ground' && !theme.deck;

  // 近くのコース点を素早く探すためのバケット
  const BK = 40, buckets = new Map();
  samples.forEach((s, i) => { const k = Math.floor(s.x / BK) + ',' + Math.floor(s.z / BK); (buckets.get(k) || buckets.set(k, []).get(k)).push(i); });
  function nearestSample(x, z) {
    const bx = Math.floor(x / BK), bz = Math.floor(z / BK);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 3 && (best < 0 || r <= 1); r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const list = buckets.get((bx + dx) + ',' + (bz + dz)); if (!list) continue;
        for (const i of list) { const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
      }
    }
    if (best < 0) for (let i = 0; i < N; i += 2) { const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return { i: best, d: Math.sqrt(bd) };
  }

  // トンネルの区間
  const tunnels = [];
  const nT = course.tunnels ?? 0;
  for (let t = 0; t < nT; t++) {
    // ギミックの区間(27%・56%・84%付近)と重ならない位置に置く
    const center = Math.floor(N * [0.42, 0.7][t % 2] + (rnd() - 0.5) * 16) % N;
    const len = 40 + Math.floor(rnd() * 24);
    tunnels.push({ a: center - (len >> 1), b: center + (len >> 1) });
  }
  const inTunnel = i => tunnels.some(t => i >= t.a && i <= t.b);

  // 地形(地面のコース): 道の近くは道の高さに沿い、離れると丘や山になる。トンネルの上は山にする
  let terrainAt = () => 0;
  if (isGround) {
    const hillAmp = 6 + (course.elev ?? 0) * 0.9;
    const ph = [rnd() * 9, rnd() * 9, rnd() * 9, rnd() * 9];
    const natural = (x, z) => hillAmp * (0.5 + 0.5 * Math.sin(x * 0.011 + ph[0]) * Math.cos(z * 0.013 + ph[1])) + hillAmp * 0.35 * Math.sin(x * 0.031 + z * 0.027 + ph[2]) - 1;
    terrainAt = (x, z) => {
      const { i, d } = nearestSample(x, z);
      // 地形の網目は粗いので、道から少し離れるまでは道より低くしておく(道路の上に斜面がはみ出さないように)
      const road = H[i] - 2.5, BUF = WALL_OFF + 11;
      if (d < BUF) return road;
      const sm = v => { const k = Math.min(1, Math.max(0, v)); return k * k * (3 - 2 * k); };
      if (inTunnel(i)) return road + (Math.max(natural(x, z), H[i] + 14) - road) * sm((d - BUF) / 12);
      return road + (Math.max(natural(x, z), H[i] * 0.6) - road) * sm((d - BUF) / 36);
    };
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of samples) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }

  // ---------- 地面 / 海 / 溶岩 ----------
  if (isGround) {
    const pad = 220, G = opts.detail === false ? 110 : 180;
    const w = maxX - minX + pad * 2, h = maxZ - minZ + pad * 2;
    const geo = new THREE.PlaneGeometry(w, h, G, G); geo.rotateX(-Math.PI / 2);
    geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const pa = geo.attributes.position;
    for (let k = 0; k < pa.count; k++) pa.setY(k, terrainAt(pa.getX(k), pa.getZ(k)));
    geo.computeVertexNormals();
    const groundTex = canvasTexture(256, 256, (c, W, Hh) => {
      noiseFill(c, W, Hh, theme.ground, 0.16, 5000, rnd, 3);
      for (let i = 0; i < 40; i++) { c.fillStyle = hexCss(theme.ground2) + '55'; c.beginPath(); c.arc(rnd() * W, rnd() * Hh, 8 + rnd() * 26, 0, 7); c.fill(); }
    }, [w / 12, h / 12]);
    group.add(recv(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }))));
    // 外側の平地
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -1.2; group.add(recv(outer));
  } else if (theme.base === 'ground') {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; group.add(recv(ground));
  } else if (theme.base === 'water') {
    const wtex = canvasTexture(128, 128, (c, W, Hh) => {
      c.fillStyle = hexCss(theme.water); c.fillRect(0, 0, W, Hh);
      for (let i = 0; i < 90; i++) { c.strokeStyle = `rgba(255,255,255,${0.12 + rnd() * 0.18})`; c.lineWidth = 2; c.beginPath(); const x = rnd() * W, y = rnd() * Hh; c.moveTo(x, y); c.quadraticCurveTo(x + 6, y - 4, x + 12, y); c.stroke(); }
    }, [140, 140]);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: wtex, roughness: 0.15, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2; water.userData.water = true; group.add(recv(water));
  } else if (theme.base === 'lava') {
    const lavaTex = canvasTexture(128, 128, (c, W, Hh) => {
      c.fillStyle = '#c62800'; c.fillRect(0, 0, W, Hh);
      for (let i = 0; i < 70; i++) { c.fillStyle = rnd() < 0.5 ? '#ffb000' : '#ff5a00'; c.beginPath(); c.arc(rnd() * W, rnd() * Hh, 4 + rnd() * 14, 0, 7); c.fill(); }
      for (let i = 0; i < 40; i++) { c.fillStyle = 'rgba(40,10,10,.55)'; c.beginPath(); c.arc(rnd() * W, rnd() * Hh, 6 + rnd() * 16, 0, 7); c.fill(); }
    }, [90, 90]);
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: lavaTex, emissive: 0xffffff, emissiveMap: lavaTex, emissiveIntensity: 1.2 }));
    lava.rotation.x = -Math.PI / 2; lava.userData.lava = true; group.add(lava);
  }

  // ---------- 道 ----------
  const shoulderTex = canvasTexture(128, 128, (c, w, h) => noiseFill(c, w, h, new THREE.Color(theme.space ? theme.road : theme.ground).multiplyScalar(0.8).getHex(), 0.25, 1600, rnd, 3));
  shoulderTex.wrapS = shoulderTex.wrapT = THREE.RepeatWrapping; shoulderTex.repeat.set(4, 1);
  group.add(recv(new THREE.Mesh(stripGeometry(N, i => off(i, -WALL_OFF), i => off(i, WALL_OFF), Hf(0.015), Hf(0.015), { cum, vScale: 12 }),
    new THREE.MeshStandardMaterial({ map: shoulderTex, roughness: 1, emissive: theme.space ? 0x221155 : 0, emissiveIntensity: theme.space ? 0.6 : 0 }))));

  const roadTex = canvasTexture(256, 256, (c, w, h) => {
    noiseFill(c, w, h, theme.road, 0.22, 9000, rnd, 2);
    c.fillStyle = 'rgba(0,0,0,0.12)';
    c.fillRect(w * 0.28, 0, w * 0.1, h); c.fillRect(w * 0.62, 0, w * 0.1, h);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillRect(w * 0.035, 0, w * 0.025, h); c.fillRect(w * 0.94, 0, w * 0.025, h);
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillRect(w * 0.494, 0, w * 0.012, h * 0.5);
  });
  roadTex.wrapT = THREE.RepeatWrapping;
  const road = stripGeometry(N, i => off(i, -TRACK_WIDTH / 2), i => off(i, TRACK_WIDTH / 2), Hf(0.04), Hf(0.04), { cum, vScale: 10 });
  group.add(recv(new THREE.Mesh(road, new THREE.MeshStandardMaterial({ map: roadTex, roughness: theme.night ? 0.55 : 0.85, emissive: theme.space ? 0x3322aa : 0, emissiveIntensity: theme.space ? 0.25 : 0 }))));

  const curbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, emissive: theme.space ? 0xffffff : 0, emissiveIntensity: theme.space ? 0.35 : 0 });
  const curbColor = i => (Math.floor(i / 3) % 2 ? theme.curbA : theme.curbB);
  for (const sgn of [-1, 1]) {
    const g = stripGeometry(N, i => off(i, sgn * (TRACK_WIDTH / 2)), i => off(i, sgn * (TRACK_WIDTH / 2 + 1.4)), Hf(0.12), Hf(0.07), { colorFn: curbColor });
    group.add(recv(new THREE.Mesh(g, curbMat)));
  }

  // ガードレール(壁)
  const wallTex = canvasTexture(64, 64, (c, w, h) => {
    c.fillStyle = hexCss(theme.wall); c.fillRect(0, 0, w, h);
    c.fillStyle = hexCss(theme.wall2); c.fillRect(0, h * 0.18, w, h * 0.22);
    c.fillStyle = 'rgba(0,0,0,0.15)'; c.fillRect(0, h * 0.9, w, h * 0.1);
  });
  wallTex.wrapS = THREE.RepeatWrapping;
  const glowWall = theme.night || theme.space;
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.DoubleSide, roughness: 0.5, emissive: glowWall ? 0xffffff : 0x000000, emissiveMap: glowWall ? wallTex : null, emissiveIntensity: glowWall ? 0.4 : 0 });
  for (const sgn of [-1, 1]) {
    const g = stripGeometry(N, i => off(i, sgn * WALL_OFF), i => off(i, sgn * WALL_OFF), Hf(0), Hf(1.4), { cum, vScale: 6 });
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) { const u = uv.getX(k), v = uv.getY(k); uv.setXY(k, v, 1 - u); }
    const wall = new THREE.Mesh(g, wallMat); wall.castShadow = true; wall.receiveShadow = true;
    group.add(wall);
  }

  // ---------- 橋(柱で支える道) / 盛り土の側面 ----------
  const rockTex = canvasTexture(128, 128, (c, w, h) => {
    noiseFill(c, w, h, theme.rock, 0.3, 2500, rnd, 4);
    c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 2;
    for (let i = 0; i < 18; i++) { c.beginPath(); c.moveTo(rnd() * w, rnd() * h); c.lineTo(rnd() * w, rnd() * h); c.stroke(); }
  });
  rockTex.wrapS = rockTex.wrapT = THREE.RepeatWrapping;
  if (theme.deck) {
    const deckMat = new THREE.MeshStandardMaterial({ color: theme.space ? 0x2a2070 : 0xb9bec8, roughness: 0.7, emissive: theme.space ? 0x6a3cff : 0, emissiveIntensity: theme.space ? 0.5 : 0 });
    // 床板の裏と側面
    group.add(new THREE.Mesh(stripGeometry(N, i => off(i, -WALL_OFF), i => off(i, WALL_OFF), Hf(-1.4), Hf(-1.4), { flip: true }), deckMat));
    for (const sgn of [-1, 1]) group.add(new THREE.Mesh(stripGeometry(N, i => off(i, sgn * WALL_OFF), i => off(i, sgn * WALL_OFF), Hf(-1.4), Hf(0.02)), new THREE.MeshStandardMaterial({ color: theme.space ? theme.curbA : 0x9aa0aa, side: THREE.DoubleSide, roughness: 0.6, emissive: theme.space ? theme.curbA : 0, emissiveIntensity: theme.space ? 0.8 : 0 })));
    if (!theme.space) {
      const baseY = 0;
      const pillarGeo = new THREE.CylinderGeometry(1.1, 1.4, 1, 12); pillarGeo.translate(0, 0.5, 0);
      const stations = [];
      for (let i = 0; i < N; i += 20) if (H[i] - 1.4 - baseY > 1.2 && !inTunnel(i)) stations.push(i);
      const pillars = new THREE.InstancedMesh(pillarGeo, new THREE.MeshStandardMaterial({ map: rockTex, color: 0xd8dce4, roughness: 0.8 }), stations.length * 2);
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ss = new THREE.Vector3(), pp = new THREE.Vector3();
      let k = 0;
      for (const i of stations) for (const sgn of [-1, 1]) {
        const [x, z] = off(i, sgn * (WALL_OFF - 2.5));
        mm.compose(pp.set(x, baseY - 1, z), qq.identity(), ss.set(1, H[i] - 1.4 - baseY + 1, 1));
        pillars.setMatrixAt(k++, mm);
      }
      pillars.castShadow = true; pillars.receiveShadow = true;
      group.add(pillars);
    }
  } else if (isGround) {
    // 盛り土の側面(地形との段差を埋める)
    const skirtMat = new THREE.MeshStandardMaterial({ map: rockTex, roughness: 1, side: THREE.DoubleSide });
    for (const sgn of [-1, 1]) {
      group.add(recv(new THREE.Mesh(stripGeometry(N, i => off(i, sgn * (WALL_OFF + 0.05)), i => off(i, sgn * (WALL_OFF + 0.05)), Hf(-6), Hf(0.02), { cum, vScale: 8 }), skirtMat)));
    }
  }

  // ---------- トンネル ----------
  if (tunnels.length) {
    const archTex = canvasTexture(128, 128, (c, w, h) => { noiseFill(c, w, h, new THREE.Color(theme.rock).multiplyScalar(0.7).getHex(), 0.35, 3000, rnd, 4); });
    archTex.wrapS = archTex.wrapT = THREE.RepeatWrapping; archTex.repeat.set(3, 1);
    const archMat = new THREE.MeshStandardMaterial({ map: archTex, roughness: 1, side: THREE.DoubleSide, color: theme.space ? 0x6a5aff : 0xffffff, emissive: theme.space ? 0x3322aa : 0, emissiveIntensity: theme.space ? 0.4 : 0 });
    const lampGeo = new THREE.BoxGeometry(1.6, 0.25, 0.6);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: theme.space ? 0xff7cf8 : 0xffe2a0, emissiveIntensity: 3 });
    const portalMat = new THREE.MeshStandardMaterial({ color: theme.wall2, roughness: 0.5, emissive: theme.wall2, emissiveIntensity: 0.3 });
    for (const t of tunnels) {
      const R = WALL_OFF + 0.4, RH = 8.5, SEG = 16;
      const idxs = []; for (let i = t.a; i <= t.b; i++) idxs.push(((i % N) + N) % N);
      const pos = [], uvs = [], ind = [];
      idxs.forEach((i, n) => {
        for (let k = 0; k <= SEG; k++) {
          const th = (k / SEG) * Math.PI;
          const [x, z] = off(i, Math.cos(th) * R);
          pos.push(x, H[i] + Math.sin(th) * RH, z); uvs.push(k / SEG, n / 6);
        }
        if (n > 0) for (let k = 0; k < SEG; k++) { const a = (n - 1) * (SEG + 1) + k, b = n * (SEG + 1) + k; ind.push(a, b, a + 1, a + 1, b, b + 1); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(ind); g.computeVertexNormals();
      const arch = new THREE.Mesh(g, archMat); arch.castShadow = true; arch.receiveShadow = true;
      group.add(arch);
      // 天井のライト
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, Math.ceil(idxs.length / 6));
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ss = new THREE.Vector3(1, 1, 1), pp = new THREE.Vector3();
      let k = 0;
      for (let n = 0; n < idxs.length; n += 6) {
        const i = idxs[n];
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -samples[i].angle);
        mm.compose(pp.set(samples[i].x, H[i] + RH - 0.35, samples[i].z), qq, ss);
        lamps.setMatrixAt(k++, mm);
      }
      lamps.count = k; group.add(lamps);
      // 入口と出口の枠
      for (const i of [idxs[0], idxs[idxs.length - 1]]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.9, 8, 24, Math.PI), portalMat);
        ring.position.set(samples[i].x, H[i], samples[i].z);
        ring.rotation.y = -samples[i].angle - Math.PI / 2;
        ring.scale.set(1, RH / R, 1);
        group.add(ring);
      }
    }
  }

  // ---------- スタートライン / ゲート ----------
  const startTex = canvasTexture(128, 32, (c, w, h) => {
    const cell = 8;
    for (let y = 0; y < h / cell; y++) for (let x = 0; x < w / cell; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#fff'; c.fillRect(x * cell, y * cell, cell, cell); }
  });
  const startLine = recv(new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, 3), new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.6 })));
  startLine.position.set(samples[0].x, H[0] + 0.06, samples[0].z);
  startLine.rotation.set(-Math.PI / 2, -samples[0].angle - Math.PI / 2, 0, 'YXZ');
  group.add(startLine);
  const gateMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1 });
  const bannerTex = canvasTexture(512, 64, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#ff2d55'); g.addColorStop(1, '#ff8a00');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.font = '900 40px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('NYARIO KART', w / 2, h / 2 + 2);
  });
  const gate = new THREE.Group();
  for (const sgn of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 8, 16), gateMat);
    pole.position.set(0, 4, sgn * (TRACK_WIDTH / 2 + 2.5)); pole.castShadow = true;
    gate.add(pole);
  }
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.35, roughness: 0.4 });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.9, TRACK_WIDTH + 5.6), [gateMat, gateMat, gateMat, gateMat, bannerMat, bannerMat]);
  banner.position.y = 7.4; banner.castShadow = true;
  gate.add(banner);
  gate.position.set(samples[0].x, H[0], samples[0].z);
  gate.rotation.y = -samples[0].angle;
  group.add(gate);

  // ---------- 装飾 ----------
  const parts = decorParts(theme.decor);
  const placements = [];
  const pad = theme.decor === 'asteroid' ? 260 : 160;
  const maxDecor = (opts.decorCount ?? 260) * (theme.decor === 'iceberg' || theme.decor === 'island' || theme.decor === 'spire' ? 0.35 : theme.decor === 'asteroid' ? 0.5 : 1);
  for (let tries = 0; tries < 5000 && placements.length < maxDecor; tries++) {
    const x = minX - pad + rnd() * (maxX - minX + pad * 2);
    const z = minZ - pad + rnd() * (maxZ - minZ + pad * 2);
    const { i: ni, d } = nearestSample(x, z);
    const big = ['iceberg', 'island', 'spire', 'asteroid'].includes(theme.decor);
    if (d < WALL_OFF + (big ? 14 : 5) || d > WALL_OFF + (big ? 260 : 150)) continue;
    let y = 0;
    if (isGround) y = terrainAt(x, z);
    if (theme.decor === 'asteroid') y = H[ni] + (rnd() - 0.5) * 70;
    placements.push({ x, y, z, s: (0.8 + rnd() * 0.8) * (big ? 1 + rnd() * 1.2 : 1), r: rnd() * Math.PI * 2, h: 8 + rnd() * 34, tilt: theme.decor === 'asteroid' ? rnd() * 6 : 0 });
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const windowTex = theme.decor === 'building' ? canvasTexture(64, 128, (c, w, h) => {
    c.fillStyle = '#181a2e'; c.fillRect(0, 0, w, h);
    for (let y = 4; y < h - 4; y += 10) for (let x = 4; x < w - 4; x += 12) {
      const on = rnd() < 0.55;
      c.fillStyle = on ? ['#ffe9a8', '#9fe8ff', '#ffb3e6'][Math.floor(rnd() * 3)] : '#262a44';
      c.fillRect(x, y, 7, 6);
    }
  }) : null;
  const buildingColors = [0x5c6bc0, 0x7e57c2, 0x26c6da, 0xec407a, 0x3949ab];
  for (const part of parts) {
    const mat = part.windows
      ? new THREE.MeshStandardMaterial({ map: windowTex, emissive: 0xffffff, emissiveMap: windowTex, emissiveIntensity: 1.1, roughness: 0.6 })
      : new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.85, flatShading: true, side: part.side ?? THREE.FrontSide, emissive: theme.space ? 0x221144 : 0 });
    const mesh = new THREE.InstancedMesh(part.geo, mat, placements.length);
    placements.forEach((pl, i) => {
      q.setFromEuler(new THREE.Euler(pl.tilt, pl.r, pl.tilt * 0.5));
      if (part.windows) sc.set(pl.s, pl.h, pl.s); else sc.setScalar(pl.s);
      p.set(pl.x, pl.y, pl.z);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      if (part.windows) mesh.setColorAt(i, new THREE.Color(buildingColors[i % buildingColors.length]).lerp(new THREE.Color(0xffffff), 0.5));
    });
    mesh.castShadow = !theme.space; mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 草むら(地面のコース)
  if (opts.detail !== false && isGround && ['tree', 'pine', 'cactus'].includes(theme.decor)) {
    const tuftGeo = new THREE.ConeGeometry(0.35, 1.0, 4).translate(0, 0.5, 0);
    const n = 700;
    const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.ground2).multiplyScalar(theme.decor === 'pine' ? 0.6 : 0.85), roughness: 1, flatShading: true }), n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const si = Math.floor(rnd() * N), side = rnd() < 0.5 ? -1 : 1;
      const lat = side * (WALL_OFF + 2 + rnd() * 30);
      const [x, z] = off(si, lat);
      q.setFromAxisAngle(up, rnd() * 6); sc.set(0.6 + rnd(), 0.5 + rnd() * 0.9, 0.6 + rnd());
      p.set(x, terrainAt(x, z), z); m.compose(p, q, sc); tufts.setMatrixAt(k++, m);
    }
    tufts.count = k;
    group.add(tufts);
  }

  // 街灯(夜の街)
  if (theme.lamps) {
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 8).translate(0, 3.5, 0);
    const bulbGeo = new THREE.SphereGeometry(0.45, 12, 10).translate(0, 7.2, 0);
    const cnt = Math.ceil(N / 40) * 2;
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x8890b0, roughness: 0.4, metalness: 0.8 }), cnt);
    const bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 3 }), cnt);
    let k = 0;
    for (let i = 0; i < N; i += 40) for (const sgn of [-1, 1]) {
      const [x, z] = off(i, sgn * (WALL_OFF - 0.4));
      q.identity(); sc.setScalar(1); p.set(x, H[i], z); m.compose(p, q, sc);
      poles.setMatrixAt(k, m); bulbs.setMatrixAt(k, m); k++;
    }
    poles.count = bulbs.count = k;
    group.add(poles, bulbs);
  }

  // ---------- アイテムボックス / ダッシュパネル ----------
  const itemSlots = [];
  for (const f of [0.18, 0.47, 0.76]) {
    const i = Math.floor(f * N);
    for (const lat of [-4.5, -1.5, 1.5, 4.5]) {
      const [x, z] = off(i, lat);
      itemSlots.push({ idx: i, lat, x, z, y: H[i] });
    }
  }
  const boostPads = [];
  const padTex = canvasTexture(64, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ff9100'); g.addColorStop(1, '#ffd600');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff';
    for (let k = 0; k < 3; k++) { const y = 10 + k * 40; c.beginPath(); c.moveTo(w / 2, y); c.lineTo(w - 8, y + 26); c.lineTo(w / 2, y + 16); c.lineTo(8, y + 26); c.closePath(); c.fill(); }
  });
  const padMat = new THREE.MeshStandardMaterial({ map: padTex, emissive: 0xffffff, emissiveMap: padTex, emissiveIntensity: 0.9, roughness: 0.3 });
  for (const f of [0.33, 0.62, 0.9]) {
    const i = Math.floor(f * N);
    const lat = (rnd() - 0.5) * 7;
    const [x, z] = off(i, lat);
    const padMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 7), padMat);
    padMesh.rotation.set(-Math.PI / 2, 0, 0);
    const holder = new THREE.Group();
    holder.add(padMesh);
    holder.position.set(x, H[i] + 0.08, z);
    holder.rotation.y = -samples[i].angle - Math.PI / 2;
    // 坂に沿って傾ける
    holder.rotateX(Math.atan2(H[(i + 2) % N] - H[(i - 2 + N) % N], 4 * spacing));
    group.add(holder);
    boostPads.push({ idx: i, lat, x, z });
  }

  // 障害物(後半のカップほど多い)
  const obstacles = [];
  const nObs = (course.diff ?? 0) * 4;
  if (nObs) {
    const barrelTex = canvasTexture(64, 64, (c, w, h) => {
      c.fillStyle = '#ff7a00'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff'; for (let y = 4; y < h; y += 20) c.fillRect(0, y, w, 8);
    });
    const geo = new THREE.CylinderGeometry(1.0, 1.05, 1.7, 18); geo.translate(0, 0.85, 0);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.45 }), nObs);
    const busy = [...itemSlots.map(s => s.idx), ...boostPads.map(b => b.idx)];
    for (let tries = 0; tries < 600 && obstacles.length < nObs; tries++) {
      const i = 60 + Math.floor(rnd() * (N - 120));
      if (Math.abs(samples[i].curv) > 0.012 || inTunnel(i)) continue;
      if (obstacles.some(o => Math.abs(o.idx - i) < 30) || busy.some(b => Math.abs(b - i) < 14)) continue;
      const lat = (rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * 3.5);
      const [x, z] = off(i, lat);
      m.compose(p.set(x, H[i], z), q.identity(), sc.setScalar(1));
      inst.setMatrixAt(obstacles.length, m);
      obstacles.push({ idx: i, lat, x, z });
    }
    inst.count = obstacles.length;
    inst.castShadow = true; inst.receiveShadow = true;
    group.add(inst);
  }

  function nearest(hint, x, z, range = 30) {
    if (hint == null || hint < 0) { hint = 0; range = N / 2; }
    let best = hint, bd = Infinity;
    for (let k = -range; k <= range; k++) {
      const i = (hint + k + N) % N;
      const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function lateral(i, x, z) {
    const s = samples[i];
    return (x - s.x) * s.nx + (z - s.z) * s.nz;
  }
  // 道の高さ(前後のサンプルで補間)
  function heightAt(i, x, z) {
    const s = samples[i];
    const t = ((x - s.x) * s.tx + (z - s.z) * s.tz) / spacing;
    const j = t >= 0 ? (i + 1) % N : (i - 1 + N) % N;
    return H[i] + (H[j] - H[i]) * Math.min(1, Math.abs(t));
  }
  // 進捗(サンプル単位の連続値)から高さ
  function heightAlong(pos) {
    const f = Math.floor(pos), t = pos - f;
    const i = ((f % N) + N) % N, j = (i + 1) % N;
    return H[i] + (H[j] - H[i]) * t;
  }

  return { samples, N, length, spacing, group, itemSlots, boostPads, obstacles, tunnels, heights: H, nearest, lateral, off, heightAt, heightAlong, width: TRACK_WIDTH };
}

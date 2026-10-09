import * as THREE from 'three';
import { TRACK_WIDTH, WALL_OFF } from './track.js';
import { buildFigure } from './figure.js';
import { CHARACTERS } from './data.js';

// コースのギミック。各ギミックは update(dt) で動き、ai(k, lane) で CPU の走るラインを変える。
// 共通の仕掛け: race.startRide(乗り物で運ぶ)、race.respawn(落下して戻る)、race.blockers(通行止め)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const std = (color, opt = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opt });

export function buildGimmicks(race, list) {
  const tr = race.track, N = tr.N, S = tr.samples, H = tr.heights;
  const scene = race.scene;
  const P = (i, lat) => tr.off(((i % N) + N) % N, lat);
  const Y = i => H[((i % N) + N) % N];
  const ang = i => S[((i % N) + N) % N].angle;
  const W = i => ((i % N) + N) % N;
  // k が区間 [a, a+len) に入っているか(周回のつなぎ目もまたぐ)
  const rel = (k, a) => { let d = k.idx - W(a); if (d > N / 2) d -= N; if (d < -N / 2) d += N; return d; };
  const inZone = (k, a, len) => { const d = rel(k, a); return d >= 0 && d < len; };
  const approaching = (k, a, range = 40) => { const d = rel(k, a); return d < 0 && d > -range; };
  const place = (obj, i, lat, yOff = 0, rot = 0) => {
    const [x, z] = P(i, lat);
    obj.position.set(x, Y(i) + yOff, z);
    obj.rotation.y = -ang(i) + rot;
    scene.add(obj);
    return obj;
  };
  // 道の上に貼る帯(区間 a..a+len、横 lat0..lat1)
  const roadPatch = (a, len, lat0, lat1, mat, lift = 0.07) => {
    const pos = [], idx = [];
    for (let n = 0; n <= len; n++) {
      const i = W(a + n);
      for (const lat of [lat0, lat1]) { const [x, z] = P(i, lat); pos.push(x, H[i] + lift, z); }
      if (n > 0) { const b = (n - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const uv = []; for (let n = 0; n <= len; n++) uv.push(0, n / 4, 1, n / 4);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); scene.add(m); return m;
  };
  const pad = (i, lat, color) => { // 光るジャンプ台/乗り口
    const g = new THREE.Group();
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 4), std(color, { emissive: color, emissiveIntensity: 0.6 }));
    ramp.position.y = 0.25; ramp.rotation.z = 0.12; g.add(ramp);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 3), std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }));
    arrow.rotation.z = -Math.PI / 2; arrow.position.set(0.3, 0.7, 0); arrow.scale.z = 0.3; g.add(arrow);
    return place(g, i, lat, 0.02);
  };
  const near = (k, i, lat, r) => { const [x, z] = P(i, lat); return (k.x - x) ** 2 + (k.z - z) ** 2 < r * r; };
  const toast = (k, msg) => { if (k.isPlayer) race.hooks.toast(msg); };

  // 区間の位置: 最大3つまで、スタート付近を避けて等間隔に置く
  const slots = [0.27, 0.56, 0.84];
  const out = [];
  list.forEach((name, n) => {
    const f = FACTORY[name];
    if (!f) return;
    const at = Math.floor(N * slots[n % slots.length]);
    const g = f({ race, tr, N, S, H, P, Y, ang, W, rel, inZone, approaching, place, roadPatch, pad, near, toast, scene, at, rnd: race.rnd, side: n % 2 ? -1 : 1 });
    g.name = name;
    out.push(g);
  });
  return out;
}

const FACTORY = {
  // 🌋 噴火する火山: 周回ごとに噴火し、溶岩が流れる側が入れ替わる
  eruption(c) {
    const { race, at, place, roadPatch, inZone, approaching, scene } = c;
    const len = 30;
    const volcano = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(38, 46, 10, 1, true), std(0x3a2420, { flatShading: true }));
    cone.position.y = 23; volcano.add(cone);
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 2, 16), new THREE.MeshBasicMaterial({ color: 0xff6a00 }));
    crater.position.y = 45; volcano.add(crater);
    place(volcano, at + len / 2, -c.side * (WALL_OFF + 55), -6);
    const lavaMat = new THREE.MeshStandardMaterial({ color: 0xff5a00, emissive: 0xff4a00, emissiveIntensity: 1.6, transparent: true, opacity: 0.92 });
    const left = roadPatch(at, len, -WALL_OFF, -0.6, lavaMat.clone());
    const right = roadPatch(at, len, 0.6, WALL_OFF, lavaMat.clone());
    let lap = -1, side = 1, warn = 0;
    const burnCd = new Map();
    return {
      update(dt) {
        const leaderLap = Math.max(1, ...race.karts.map(k => k.lap));
        if (leaderLap !== lap) { // 噴火!
          lap = leaderLap; side = lap % 2 ? 1 : -1; warn = 1.2;
          for (let n = 0; n < 60; n++) race.fxAdd.spawn(volcano.position.x + (Math.random() - 0.5) * 10, volcano.position.y + 46, volcano.position.z + (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 30, 20 + Math.random() * 25, (Math.random() - 0.5) * 30, 1.6, 2.5, 1, 0.4, 0.05, 0, 18);
          if (lap > 1) { race.hooks.se('boom'); for (const k of race.karts) c.toast(k, '噴火! 溶岩の流れが変わった'); }
        }
        warn = Math.max(0, warn - dt);
        const t = race.time;
        left.visible = side < 0 || (warn > 0 && Math.sin(t * 20) > 0);
        right.visible = side > 0 || (warn > 0 && Math.sin(t * 20) > 0);
        for (const m of [left, right]) m.material.emissiveIntensity = 1.3 + Math.sin(t * 4) * 0.4;
        for (const k of race.karts) {
          if (!inZone(k, at, len) || k.air || k.ride) continue;
          if (k.lat * side < 0.6) continue;
          const cd = burnCd.get(k) || 0;
          if (race.time < cd) continue;
          burnCd.set(k, race.time + 1.5);
          race._hit(k, 'trap', null); k.slowT = Math.max(k.slowT, 1.2);
          c.toast(k, 'あちち! 溶岩!');
        }
      },
      ai(k, lane) { return approaching(k, at, 45) || inZone(k, at, len) ? -side * 4 : null; },
    };
  },

  // 🌊 満ち引きの海岸: 潮が引くと砂浜の近道が現れ、満ちると沈む
  tide(c) {
    const { race, at, P, Y, near, toast, scene, tr, N } = c;
    const L = 46, inside = -Math.sign(c.S[c.W(at + L / 2)].curv || 1) || 1;
    // 近道の膨らみ = 区間の中点と、両端を結ぶ線の中点との距離
    const [ax, az] = P(at, 0), [bx, bz] = P(at + L, 0), [mx, mz] = P(at + L / 2, 0);
    const bulge = Math.min(40, Math.hypot((ax + bx) / 2 - mx, (az + bz) / 2 - mz));
    const latAt = t => inside * (6 + Math.max(0, bulge - 4) * Math.sin(Math.PI * t));
    const pts = [];
    for (let n = 0; n <= 24; n++) { const t = n / 24; const pos = at + L * t; const [x, z] = tr.off(c.W(Math.floor(pos)), latAt(t)); pts.push(new THREE.Vector3(x, Y(Math.floor(pos)) - 0.3, z)); }
    const sand = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 4.5, 8, false), std(0xf3dca0, { roughness: 1 }));
    sand.scale.y = 0.25; sand.position.y = 0; scene.add(sand);
    const baseY = sand.position.y;
    const pd = c.pad(at, inside * 5.5, 0xffc94d);
    let low = false;
    return {
      update(dt) {
        const t = race.time % 24;
        const nowLow = t > 4 && t < 15;
        const level = nowLow ? 0 : -6;
        sand.position.y += (level - sand.position.y) * Math.min(1, dt * 1.5);
        pd.visible = nowLow;
        if (nowLow !== low) {
          low = nowLow;
          for (const k of race.karts) toast(k, low ? '潮が引いた! 砂浜の近道が出現' : '潮が満ちてきた!');
        }
        if (!low) return;
        for (const k of race.karts) {
          if (k.ride || k.air) continue;
          if (near(k, at, inside * 5.5, 3.6)) {
            race.startRide(k, { to: L, dur: 1.5, peak: 2.5, latFn: latAt, kind: 'tide' });
            toast(k, '砂浜の近道!');
          }
        }
      },
      ai(k, lane) { return low && c.approaching(k, at, 60) && k.id % 2 === 0 ? inside * 5.5 : null; },
    };
  },

  // 🧊 割れる氷河: 最初に通ったカートの側の氷が割れ、後続は反対側を選ぶ(周回ごとにリセット)
  glacier(c) {
    const { race, at, roadPatch, inZone, approaching } = c;
    const len = 26;
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g2 = cv.getContext('2d');
    g2.fillStyle = '#dff6ff'; g2.fillRect(0, 0, 128, 128);
    g2.strokeStyle = '#7fbcd8'; g2.lineWidth = 3;
    for (let n = 0; n < 9; n++) { g2.beginPath(); g2.moveTo(Math.random() * 128, Math.random() * 128); for (let k = 0; k < 4; k++) g2.lineTo(Math.random() * 128, Math.random() * 128); g2.stroke(); }
    const crackTex = new THREE.CanvasTexture(cv); crackTex.colorSpace = THREE.SRGBColorSpace;
    const iceMat = () => new THREE.MeshPhysicalMaterial({ color: 0xe8f8ff, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.85 });
    const halves = [-1, 1].map(s => ({ s, mesh: roadPatch(at, len, s < 0 ? -TRACK_WIDTH / 2 : 0.3, s < 0 ? -0.3 : TRACK_WIDTH / 2, iceMat()), cracked: false, crackT: 0 }));
    let lap = -1;
    return {
      update(dt) {
        const leaderLap = Math.max(1, ...race.karts.map(k => k.lap));
        if (leaderLap !== lap) { lap = leaderLap; for (const h of halves) { h.cracked = false; h.crackT = 0; h.mesh.material.map = null; h.mesh.material.color.setHex(0xe8f8ff); h.mesh.material.needsUpdate = true; h.mesh.position.y = 0; } }
        for (const h of halves) {
          if (h.crackT > 0) { h.crackT -= dt; if (h.crackT <= 0) { h.cracked = true; h.mesh.material.map = crackTex; h.mesh.material.color.setHex(0x4a7f9a); h.mesh.material.needsUpdate = true; h.mesh.position.y = -0.04; race.hooks.se('ink'); } }
        }
        for (const k of race.karts) {
          if (!inZone(k, at, len) || k.ride) continue;
          const h = halves[k.lat < 0 ? 0 : 1];
          if (!h.cracked && h.crackT <= 0 && !halves.some(o => o.cracked || o.crackT > 0)) { h.crackT = 0.8; c.toast(k, 'ピキッ… 氷が割れる!'); }
          if (h.cracked && !k.air && !race._invuln(k)) {
            k.slipT = Math.max(k.slipT, 0.8); k.slowT = Math.max(k.slowT, 0.4);
            if (Math.random() < 0.3) race.fxSmoke.spawn(k.x, k.y + 0.3, k.z, (Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3, 0.6, 1, 0.8, 0.95, 1, 1.5, 4);
          }
        }
      },
      ai(k, lane) {
        if (!(approaching(k, at, 35) || inZone(k, at, len))) return null;
        const bad = halves.find(h => h.cracked || h.crackT > 0);
        return bad ? -bad.s * 3.5 : null;
      },
    };
  },

  // 🌉 跳ね上がる橋: 船が通るたびに橋が上がる。ジャンプすれば飛び越えられる
  drawbridge(c) {
    const { race, at, place, P, Y, ang, scene, approaching } = c;
    const gap = 10;
    const halfLen = gap * c.tr.spacing / 2;
    const deckMat = std(0x8a6a4a), railMat = std(0xe53935);
    const mkHalf = dir => {
      const pivot = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(halfLen, 0.6, TRACK_WIDTH + 3), deckMat);
      deck.position.x = dir * halfLen / 2; pivot.add(deck);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(halfLen, 0.62, 0.8), railMat); stripe.position.x = dir * halfLen / 2; pivot.add(stripe);
      return pivot;
    };
    const A = mkHalf(1), B = mkHalf(-1);
    place(A, at, 0, 0.1); place(B, at + gap, 0, 0.1);
    for (const [i, s] of [[at, 1], [at, -1], [at + gap, 1], [at + gap, -1]]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 2), std(0x6d7a8a)); place(tower, i, s * (WALL_OFF + 1.5), 7);
    }
    // 船
    const ship = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(30, 6, 9), std(0x2b4c7e)); hull.position.y = 3; ship.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 7), std(0xffffff)); cabin.position.set(-4, 9, 0); ship.add(cabin);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 6), std(0xe53935)); funnel.position.set(-4, 15, 0); ship.add(funnel);
    scene.add(ship);
    const mid = at + gap / 2;
    let raised = 0, wasUp = false;
    const blocker = { idx: c.W(at - 1), active: false };
    race.blockers.push(blocker);
    return {
      update(dt) {
        const t = race.time % 16;
        const want = t > 6 && t < 12 ? 1 : 0;
        raised += (want - raised) * Math.min(1, dt * 1.6);
        A.rotation.z = raised * 1.1; B.rotation.z = -raised * 1.1;
        blocker.active = raised > 0.25;
        // 船は橋の下を横切る
        const s = (t - 4) / 10;
        const [mx, mz] = P(mid, (s - 0.5) * 240);
        ship.position.set(mx, Math.min(Y(mid) - 14, 0), mz);
        ship.rotation.y = -ang(mid) + Math.PI / 2;
        ship.visible = t > 3 && t < 15;
        if (blocker.active !== wasUp) { wasUp = blocker.active; if (wasUp) for (const k of race.karts) c.toast(k, '橋が上がる! ジャンプで飛び越えろ'); }
        if (!blocker.active) return;
        for (const k of race.karts) {
          if (k.ride) continue;
          const d = c.rel(k, at);
          if (d >= -10 && d <= -3) {
            const jumped = k.jumpT > 0 || k.boostT > 0.3 || (!k.isPlayer && (k.id * 7 + Math.floor(race.time)) % 3 === 0);
            if (jumped && k.speed > 16) { race.startRide(k, { to: gap + 12, dur: 1.1, peak: 7, kind: 'jump' }); c.toast(k, 'ナイスジャンプ!'); }
          }
        }
      },
      ai(k, lane) { return null; },
    };
  },

  // 🏔 崩れる崖道: 先頭が通ると外側の足場が崩れ、後続は内側へ(崩れるのは控えめに外側だけ)
  cliff(c) {
    const { race, at, roadPatch, inZone, approaching, P, Y, scene } = c;
    const len = 26, s = c.side;
    const lat0 = s > 0 ? 2.2 : -WALL_OFF, lat1 = s > 0 ? WALL_OFF : -2.2;
    const rubble = roadPatch(at, len, lat0, lat1, std(0x8d7a66, { roughness: 1, flatShading: true }), 0.09);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x0a0806 });
    const hole = roadPatch(at, len, lat0, lat1, holeMat, 0.05); hole.visible = false;
    const chunks = [];
    for (let n = 0; n < 14; n++) {
      const ch = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + Math.random(), 0), std(0x8d7a66, { flatShading: true }));
      const i = at + Math.floor(Math.random() * len), lat = s * (2.5 + Math.random() * (WALL_OFF - 3));
      const [x, z] = P(i, lat); ch.position.set(x, Y(i) + 0.4, z); ch.visible = false; scene.add(ch); chunks.push(ch);
    }
    let state = 'ok', t = 0;
    return {
      update(dt) {
        if (state === 'ok') {
          const leader = race.karts.find(k => c.rel(k, at) >= len && c.rel(k, at) < len + 30);
          if (leader) { state = 'falling'; t = 0; for (const k of race.karts) c.toast(k, 'ガラガラ… 崖が崩れた!'); race.hooks.se('boom'); }
        } else if (state === 'falling') {
          t += dt;
          rubble.position.y -= dt * t * 12;
          for (const ch of chunks) { ch.visible = true; ch.position.y -= dt * (6 + t * 20); ch.rotation.x += dt * 3; }
          if (t > 1.5) { state = 'gone'; hole.visible = true; rubble.visible = false; chunks.forEach(ch => (ch.visible = false)); }
        }
        if (state === 'ok') return;
        for (const k of race.karts) {
          if (!inZone(k, at, len) || k.ride || k.air || k.respawnT > 0 || k.lat * s < 2.2) continue;
          race.respawn(k, 10); c.toast(k, 'がけから落ちた!');
        }
      },
      ai(k, lane) { return state !== 'ok' && (approaching(k, at, 40) || inZone(k, at, len)) ? -s * 3.5 : null; },
    };
  },

  // 🚂 コースを横切る列車: 踏切が閉まると通れない。手前のジャンプ台で飛び越えられる
  train(c) {
    const { race, at, place, P, Y, ang, scene, near } = c;
    const rails = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 260), std(0x5a4a3a)); place(rails, at, 0, 0.05);
    const gateArms = [], lights = [];
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 4), std(0xffffff)); place(post, at - 3, s * (WALL_OFF - 0.6), 2);
      const arm = new THREE.Group(); const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, WALL_OFF - 0.5), std(0xffffff, { emissive: 0xff2222, emissiveIntensity: 0.2 }));
      bar.position.z = -s * (WALL_OFF - 0.5) / 2; arm.add(bar); place(arm, at - 3, s * (WALL_OFF - 0.6), 3.6); gateArms.push(arm);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), std(0x330000, { emissive: 0xff1a1a, emissiveIntensity: 0 })); place(lamp, at - 3, s * (WALL_OFF - 0.6), 4.3); lights.push(lamp);
    }
    const train = new THREE.Group();
    const colors = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047];
    for (let n = 0; n < 5; n++) { const car = new THREE.Mesh(new THREE.BoxGeometry(5, 6, 16), std(colors[n % 4])); car.position.set(0, 3.6, n * 17); train.add(car); }
    scene.add(train);
    const rampLat = c.side * 4.5;
    c.pad(at - 16, rampLat, 0x00e5ff);
    const blocker = { idx: c.W(at - 4), active: false };
    race.blockers.push(blocker);
    let warned = false;
    return {
      update(dt) {
        const t = race.time % 14;
        const closed = t > 8 && t < 13.2;
        const passing = t > 9.2 && t < 12.6;
        blocker.active = closed;
        for (const a of gateArms) a.rotation.x += ((closed ? 0 : -1.4) - a.rotation.x) * Math.min(1, dt * 4);
        lights.forEach((l, n) => (l.material.emissiveIntensity = closed && Math.sin(race.time * 10 + n * Math.PI) > 0 ? 3 : 0));
        const s = (t - 9) / 4;
        const [x, z] = P(at, (s - 0.5) * 300 - 40);
        train.position.set(x, Y(at), z); train.rotation.y = -ang(at);
        train.visible = t > 8.6 && t < 13.4;
        if (closed && !warned) { warned = true; race.hooks.se('count'); for (const k of race.karts) if (Math.abs(c.rel(k, at)) < 80) c.toast(k, 'カンカン… 踏切が閉まる!'); }
        if (!closed) warned = false;
        for (const k of race.karts) {
          if (k.ride || k.air) continue;
          if (near(k, at - 16, rampLat, 3.4) && k.speed > 12) { race.startRide(k, { to: 30, dur: 1.15, peak: 10, kind: 'jump' }); c.toast(k, '列車を飛び越えた!'); continue; }
          if (passing && Math.abs(c.rel(k, at)) <= 1) { race._hit(k, 'front', null); race.respawn(k, 6); }
        }
      },
      ai(k, lane) { return c.approaching(k, at - 16, 60) && (k.id % 3 !== 0) ? rampLat : null; },
    };
  },

  // 🎡 巨大観覧車: 乗り口から乗ると高く上がって先の区間へ。ジャンプボタンで好きな位置で降りられる
  ferris(c) {
    const { race, at, place, near } = c;
    const s = c.side, R = 26;
    const wheel = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.8, 8, 48), std(0xffffff, { emissive: 0xff7ab0, emissiveIntensity: 0.4 }));
    wheel.add(ring);
    for (let n = 0; n < 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.4, R, 0.4), std(0xdddddd)); spoke.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0); spoke.rotation.z = a - Math.PI / 2; wheel.add(spoke);
      const gondola = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), std([0xe53935, 0x1e88e5, 0xfdd835, 0x43a047][n % 4])); gondola.position.set(Math.cos(a) * R, Math.sin(a) * R - 2, 0); gondola.userData.a = a; wheel.add(gondola);
    }
    const holder = new THREE.Group(); holder.add(wheel); wheel.position.y = R + 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, R + 4), std(0xb0b8c8)); leg.position.y = (R + 4) / 2; holder.add(leg);
    place(holder, at + 30, s * (WALL_OFF + R * 0.6), -1);
    const padLat = s * 5;
    c.pad(at, padLat, 0xff7ab0);
    return {
      update(dt) {
        wheel.rotation.z += dt * 0.25;
        wheel.children.forEach(g => { if (g.userData.a != null) g.rotation.z = -wheel.rotation.z; });
        for (const k of race.karts) {
          if (k.ride || k.air) continue;
          if (near(k, at, padLat, 3.4)) { race.startRide(k, { to: 70, dur: 4, peak: 26, kind: 'ferris', exitable: true }); c.toast(k, '観覧車! ジャンプで降りる位置を選べる'); }
        }
      },
      ai(k, lane) { return c.approaching(k, at, 60) && k.id % 2 === 1 ? padLat : null; },
    };
  },

  // 🐋 泳ぐクジラ: 背中に乗ると潮吹きで高く打ち上げられて空中ルートへ
  whale(c) {
    const { race, at, place, near } = c;
    const s = c.side;
    const whale = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), std(0x2f5f9e, { roughness: 0.4 })); body.scale.set(16, 5, 6.5); whale.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), std(0xe8eef8)); belly.scale.set(13, 3, 5.5); belly.position.y = -1.8; whale.add(belly);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(4, 8, 4), std(0x2f5f9e)); tail.rotation.z = Math.PI / 2; tail.position.x = -18; tail.scale.z = 0.3; whale.add(tail);
    for (const z of [-2.5, 2.5]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), std(0x111111)); e.position.set(12, 1, z); whale.add(e); }
    place(whale, at + 4, s * (WALL_OFF + 7), -3);
    const baseY = whale.position.y;
    const padLat = s * 5.5;
    const pd = c.pad(at, padLat, 0x40c4ff);
    let up = false;
    return {
      update(dt) {
        const t = race.time % 10;
        const surf = t < 6;
        whale.position.y += ((surf ? baseY + 2 : baseY - 9) - whale.position.y) * Math.min(1, dt * 1.5);
        whale.rotation.z = Math.sin(race.time * 0.8) * 0.05;
        pd.visible = surf;
        if (surf && Math.random() < 0.5) race.fxSmoke.spawn(whale.position.x + (Math.random() - 0.5), whale.position.y + 5, whale.position.z, (Math.random() - 0.5) * 3, 10 + Math.random() * 6, (Math.random() - 0.5) * 3, 1, 1.2, 0.85, 0.95, 1, 1, 6);
        if (surf !== up) { up = surf; }
        if (!surf) return;
        for (const k of race.karts) {
          if (k.ride || k.air) continue;
          if (near(k, at, padLat, 3.6)) { race.startRide(k, { to: 55, dur: 2.2, peak: 20, kind: 'whale' }); c.toast(k, 'クジラの潮吹き! 空中ルートへ'); race.hooks.se('boost'); }
        }
      },
      ai(k, lane) { return pd.visible && c.approaching(k, at, 60) && k.id % 2 === 0 ? padLat : null; },
    };
  },

  // 🛫 滑走路と飛行機: 離陸する飛行機の翼に乗って空中を移動
  plane(c) {
    const { race, at, place, roadPatch, near, P, Y, ang, scene } = c;
    const s = c.side;
    roadPatch(at - 6, 70, s * (WALL_OFF + 0.5), s * (WALL_OFF + 9), std(0x3a3f4a, { roughness: 0.9 }), 0.02);
    const plane = new THREE.Group();
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 12, 8, 16), std(0xffffff)); fus.rotation.z = Math.PI / 2; plane.add(fus);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 20), std(0xe53935)); plane.add(wing);
    const tailW = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.4), std(0xe53935)); tailW.position.set(-7, 2, 0); plane.add(tailW);
    scene.add(plane);
    const padLat = s * 5;
    const pd = c.pad(at, padLat, 0xffd23f);
    return {
      update(dt) {
        const t = race.time % 15;
        const boarding = t < 7;
        pd.visible = boarding;
        // 待機 → 滑走 → 離陸
        const prog = t < 7 ? 0 : (t - 7) * 9;
        const i = at + 4 + prog;
        const [x, z] = P(Math.floor(i), s * (WALL_OFF + 5));
        plane.position.set(x, Y(Math.floor(i)) + 2 + Math.max(0, t - 9) ** 2 * 1.2, z);
        plane.rotation.set(0, -ang(Math.floor(i)), Math.max(0, Math.min(0.35, (t - 9) * 0.12)));
        if (!boarding) return;
        for (const k of race.karts) {
          if (k.ride || k.air) continue;
          if (near(k, at, padLat, 3.4)) { race.startRide(k, { to: 60, dur: 2.6, peak: 15, kind: 'plane' }); c.toast(k, '飛行機の翼に乗った!'); }
        }
      },
      ai(k, lane) { return pd.visible && c.approaching(k, at, 60) && k.id % 2 === 1 ? padLat : null; },
    };
  },

  // 🏗 動くクレーン: 運よく選ばれるとつまみ上げられて前方へ運ばれる
  crane(c) {
    const { race, at, place, inZone } = c;
    const s = c.side;
    const crane = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.5, 30, 2.5), std(0xffc400)); tower.position.y = 15; crane.add(tower);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 32), std(0xffc400)); jib.position.set(0, 30, -s * 13); crane.add(jib);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(1, 0.25, 6, 12), std(0x555555)); hook.position.set(0, 22, -s * 22); crane.add(hook);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 8), std(0x333333)); cable.position.set(0, 26, -s * 22); crane.add(cable);
    place(crane, at, s * (WALL_OFF + 6), 0);
    let ready = 0;
    return {
      update(dt) {
        ready -= dt;
        crane.rotation.y = -c.ang(at) + Math.sin(race.time * 0.6) * 0.3;
        if (ready > 0) return;
        for (const k of race.karts) {
          if (k.ride || k.air || !inZone(k, at - 2, 5)) continue;
          ready = 6;
          if (Math.random() < 0.55) { race.startRide(k, { to: 42, dur: 2.0, peak: 13, kind: 'crane' }); c.toast(k, 'クレーンに運ばれた! ラッキー'); }
          break;
        }
      },
    };
  },

  // 🎠 回転するメリーゴーランド: 回転の向きに走ると加速、逆らうと減速
  merry(c) {
    const { race, at, P, Y, scene } = c;
    const R = WALL_OFF - 0.3, w = 0.7;
    const [cx, cz] = P(at, 0); const cy = Y(at);
    const disc = new THREE.Group();
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g2 = cv.getContext('2d');
    for (let n = 0; n < 16; n++) { g2.fillStyle = n % 2 ? '#ff7ab0' : '#ffe14d'; g2.beginPath(); g2.moveTo(128, 128); g2.arc(128, 128, 128, (n / 16) * Math.PI * 2, ((n + 1) / 16) * Math.PI * 2); g2.fill(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 48), std(0xffffff, { map: tex })); floor.rotation.x = -Math.PI / 2; disc.add(floor);
    for (let n = 0; n < 8; n++) {
      const a = (n / 8) * Math.PI * 2, r = R + 1.2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6), std(0xffd700, { metalness: 0.8, roughness: 0.3 })); pole.position.set(Math.cos(a) * r, 3, Math.sin(a) * r); disc.add(pole);
      const horse = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.4, 4, 8), std(0xffffff)); horse.rotation.z = Math.PI / 2; horse.position.set(Math.cos(a) * r, 2.5, Math.sin(a) * r); horse.userData.a = a; disc.add(horse);
    }
    disc.position.set(cx, cy + 0.1, cz); scene.add(disc);
    return {
      update(dt) {
        disc.rotation.y -= w * dt;
        disc.children.forEach((h, n) => { if (h.userData.a != null) h.position.y = 2.5 + Math.sin(race.time * 3 + n) * 0.6; });
        for (const k of race.karts) {
          if (k.ride) continue;
          const dx = k.x - cx, dz = k.z - cz, d = Math.hypot(dx, dz);
          if (d > R || d < 0.5) continue;
          // 回転方向の接線
          const tx = dz / d, tz = -dx / d;
          const align = Math.cos(k.h) * tx + Math.sin(k.h) * tz;
          k.zoneMul *= 1 + 0.32 * align;
          k.h += -w * dt * 0.6;
          k.x += tx * w * d * dt * 0.4; k.z += tz * w * d * dt * 0.4;
        }
      },
    };
  },

  // ⚙️ 巨大歯車ステージ: 床の歯車のすき間に落ちないよう、歯の位置を見て走る
  gears(c) {
    const { race, at, P, Y, scene, place } = c;
    const gears = [];
    for (const [off, lat, dir] of [[0, -2.5, 1], [16, 2.5, -1]]) {
      const R = 7.2;
      const [cx, cz] = P(at + off, lat); const cy = Y(at + off);
      const grp = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CircleGeometry(R, 40), std(0xb0b8c8, { metalness: 0.8, roughness: 0.35 })); base.rotation.x = -Math.PI / 2; grp.add(base);
      const holes = [];
      for (let n = 0; n < 2; n++) {
        const a = (n / 2) * Math.PI * 2;
        const hole = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 16, a, 0.6), new THREE.MeshBasicMaterial({ color: 0x080808 })); hole.rotation.x = -Math.PI / 2; hole.position.y = 0.02; grp.add(hole); holes.push(a);
      }
      for (let n = 0; n < 16; n++) { const a = (n / 16) * Math.PI * 2; const tooth = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), std(0x8a93a5, { metalness: 0.8 })); tooth.position.set(Math.cos(a) * (R + 0.4), 0.3, Math.sin(a) * (R + 0.4)); grp.add(tooth); }
      grp.position.set(cx, cy + 0.08, cz); scene.add(grp);
      gears.push({ grp, cx, cz, R, dir, holes });
    }
    // 横に立つ飾りの大歯車
    for (const s of [-1, 1]) { const big = new THREE.Mesh(new THREE.TorusGeometry(14, 2, 8, 20), std(0x9aa3b5, { metalness: 0.8, roughness: 0.3 })); place(big, at + 8, s * (WALL_OFF + 16), 14, Math.PI / 2); gears.push({ deco: big, dir: s }); }
    return {
      update(dt) {
        for (const g of gears) {
          if (g.deco) { g.deco.rotation.x += dt * 0.5 * g.dir; continue; }
          g.grp.rotation.y += dt * 0.9 * g.dir;
          for (const k of race.karts) {
            if (k.ride || k.air || k.respawnT > 0) continue;
            const dx = k.x - g.cx, dz = k.z - g.cz, d = Math.hypot(dx, dz);
            if (d > g.R * 0.95 || d < 1.2) continue;
            // 歯車の回転を差し引いた角度がすき間に入っているか
            let a = Math.atan2(-dz, dx) - g.grp.rotation.y;
            a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            if (g.holes.some(h => { const x = ((a - h) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); return x < 0.6; })) {
              race.respawn(k, 14); c.toast(k, '歯車のすき間に落ちた!');
            }
          }
        }
      },
    };
  },

  // 🛝 スライダー迷路: 分岐するすべり台。左右で距離と速さが違う
  slider(c) {
    const { race, at, P, Y, scene, near } = c;
    const routes = [{ s: -1, L: 56, dur: 2.0, bulge: 30 }, { s: 1, L: 34, dur: 2.2, bulge: 18 }];
    for (const r of routes) {
      const latAt = t => r.s * (6 + r.bulge * Math.sin(Math.PI * t));
      r.latAt = latAt;
      const pts = [];
      for (let n = 0; n <= 30; n++) { const t = n / 30, pos = at + r.L * t; const [x, z] = P(Math.floor(pos), latAt(t)); pts.push(new THREE.Vector3(x, Y(Math.floor(pos)) - 2 * Math.sin(Math.PI * t) + 0.6, z)); }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 2.8, 12, false), new THREE.MeshPhysicalMaterial({ color: r.s < 0 ? 0x40c4ff : 0xff7ab0, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      scene.add(tube);
      r.pad = c.pad(at, r.s * 5.5, r.s < 0 ? 0x40c4ff : 0xff7ab0);
    }
    return {
      update(dt) {
        for (const k of race.karts) {
          if (k.ride || k.air) continue;
          for (const r of routes) if (near(k, at, r.s * 5.5, 3.2)) {
            race.startRide(k, { to: r.L, dur: r.dur, peak: -1.5, latFn: r.latAt, kind: 'slide' });
            c.toast(k, r.s < 0 ? 'ながーいすべり台!' : 'みじかいすべり台!');
          }
        }
      },
      ai(k, lane) { return c.approaching(k, at, 55) && k.id % 3 !== 2 ? (k.id % 2 ? 5.5 : -5.5) : null; },
    };
  },

  // 🎳 ボウリング: 巨大な玉が転がってくる。レーンの端を通れば避けられる
  bowling(c) {
    const { race, at, P, Y, scene, place, inZone, approaching } = c;
    const len = 46, snow = race.theme.base === 'ground' && race.theme.snowcap;
    for (const s of [-1, 1]) for (let n = 0; n < 3; n++) {
      const pin = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 4, 6, 12), std(0xffffff)); place(pin, at + len + 2 + n * 2, s * (WALL_OFF + 3 + n * 2), 3);
    }
    const balls = [];
    let spawnT = 1;
    const mat = snow ? std(0xffffff, { roughness: 0.9 }) : new THREE.MeshPhysicalMaterial({ color: 0x2b1a5a, roughness: 0.15, clearcoat: 1 });
    return {
      update(dt) {
        spawnT -= dt;
        if (spawnT <= 0) {
          spawnT = 3.2;
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 18), mat); scene.add(mesh);
          balls.push({ mesh, pos: at + len, lat: (race.rnd() - 0.5) * 5, life: 8 });
        }
        for (const b of balls) {
          b.pos -= (30 * dt) / c.tr.spacing; b.life -= dt;
          const [x, z] = P(Math.floor(b.pos), b.lat);
          b.mesh.position.set(x, Y(Math.floor(b.pos)) + 2.6, z);
          b.mesh.rotation.z += dt * 10;
          if (b.pos < at - 6) b.life = 0;
          for (const k of race.karts) {
            if (k.ride || k.air) continue;
            if ((k.x - x) ** 2 + (k.z - z) ** 2 < 4.4 * 4.4) { race._hit(k, 'front', null); c.toast(k, 'ストライク…!'); }
          }
        }
        for (const b of balls) if (b.life <= 0) scene.remove(b.mesh);
        for (let n = balls.length - 1; n >= 0; n--) if (balls[n].life <= 0) balls.splice(n, 1);
      },
      ai(k, lane) { return approaching(k, at + len, 30) || inZone(k, at - 6, len + 6) ? Math.sign(lane || 1) * 5.8 : null; },
    };
  },

  // 🌪 コースを移動する竜巻: 巻き込まれると大きく飛ばされ、着地点はランダム
  tornado(c) {
    const { race, at, P, Y, scene } = c;
    const len = 50;
    const tw = new THREE.Group();
    for (let n = 0; n < 7; n++) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(2 + n * 1.3, 1.4 + n * 1.3, 3.2, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfb8a8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      cone.position.y = 1.6 + n * 3; tw.add(cone);
    }
    scene.add(tw);
    let pos = at, dir = 1, lat = 0;
    return {
      update(dt) {
        pos += dir * dt * 3; if (pos > at + len) dir = -1; if (pos < at) dir = 1;
        lat = Math.sin(race.time * 0.7) * 4.5;
        const [x, z] = P(Math.floor(pos), lat);
        tw.position.set(x, Y(Math.floor(pos)), z);
        tw.children.forEach((cn, n) => (cn.rotation.y += dt * (4 + n)));
        if (Math.random() < 0.6) race.fxSmoke.spawn(x + (Math.random() - 0.5) * 8, tw.position.y + Math.random() * 18, z + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, 4, (Math.random() - 0.5) * 6, 0.8, 1.5, 0.7, 0.66, 0.6, 1, -2);
        for (const k of race.karts) {
          if (k.ride) continue;
          if ((k.x - x) ** 2 + (k.z - z) ** 2 < 5.5 * 5.5) {
            const to = Math.floor(-8 + race.rnd() * 38);
            race.startRide(k, { to, dur: 1.9, peak: 18, latTo: (race.rnd() - 0.5) * 8, kind: 'tornado', spin: true });
            c.toast(k, to > 0 ? '竜巻で前へ飛ばされた!' : '竜巻に巻き込まれた!');
          }
        }
      },
      ai(k, lane) { const d = c.rel(k, Math.floor(pos)); return d < 0 && d > -30 ? (lat > 0 ? -5 : 5) : null; },
    };
  },

  // 🌩 嵐の落雷ゾーン: 光の円が出て数秒後に落雷。よければ加速ボーナス
  storm(c) {
    const { race, at, P, Y, scene, place } = c;
    const len = 60;
    for (let n = 0; n < 8; n++) { const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(9 + Math.random() * 5, 1), std(0x4a4e5e, { flatShading: true, roughness: 1 })); place(cloud, at + n * 8, (Math.random() - 0.5) * 30, 34 + Math.random() * 6); }
    const marks = [];
    let spawnT = 0;
    const ringGeo = new THREE.RingGeometry(3.1, 3.6, 32);
    return {
      update(dt) {
        spawnT -= dt;
        if (spawnT <= 0) {
          spawnT = 1.1;
          // カートの少し先をねらう
          const inside = race.karts.filter(k => { const d = c.rel(k, at); return d > -20 && d < len; });
          const k = inside[Math.floor(race.rnd() * Math.max(1, inside.length))];
          const pos = k ? k.dist + 14 + race.rnd() * 8 : at + race.rnd() * len;
          const rel = ((Math.floor(pos) - at) % c.N + c.N) % c.N;
          if (rel < len) {
            const lat = (race.rnd() - 0.5) * 10, i = Math.floor(pos);
            const [x, z] = P(i, lat);
            const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, side: THREE.DoubleSide }));
            ring.rotation.x = -Math.PI / 2; ring.position.set(x, Y(i) + 0.12, z); scene.add(ring);
            marks.push({ ring, x, z, y: Y(i), t: 2, lat, i });
          }
        }
        for (const m of marks) {
          m.t -= dt;
          m.ring.material.opacity = 0.5 + Math.sin(race.time * 18) * 0.4;
          m.ring.scale.setScalar(1 + (2 - m.t) * 0.08);
          if (m.t <= 0 && !m.done) {
            m.done = true;
            race.bolts.push({ x: m.x, z: m.z, y: m.y, life: 0.3 });
            race.hooks.se('thunder');
            for (const k of race.karts) {
              if (k.ride) continue;
              const d2 = (k.x - m.x) ** 2 + (k.z - m.z) ** 2;
              if (d2 < 3.6 * 3.6) { race._hit(k, 'lightning', null); c.toast(k, '雷に打たれた!'); }
              else if (d2 < 9 * 9) { k.boostT = Math.max(k.boostT, 0.7); c.toast(k, 'よけた! 加速ボーナス'); }
            }
          }
        }
        for (const m of marks) if (m.done) scene.remove(m.ring);
        for (let n = marks.length - 1; n >= 0; n--) if (marks[n].done) marks.splice(n, 1);
      },
      ai(k, lane) {
        for (const m of marks) { const d = m.i - k.idx; if (d > 0 && d < 25 && Math.abs(m.lat - lane) < 4) return m.lat > 0 ? m.lat - 6.5 : m.lat + 6.5; }
        return null;
      },
    };
  },

  // 🌅 昼から夜に変わるコース: レースが進むほど 昼→夕→夜。夜は光の道しるべが頼り
  daynight(c) {
    const { race, tr, N, P, Y, scene } = c;
    const cnt = Math.ceil(N / 10) * 2;
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x7ef9ff, emissiveIntensity: 0 }), cnt);
    const m = new THREE.Matrix4(); let n = 0;
    for (let i = 0; i < N; i += 10) for (const s of [-1, 1]) { const [x, z] = P(i, s * (TRACK_WIDTH / 2 + 0.7)); m.makeTranslation(x, Y(i) + 0.45, z); lamps.setMatrixAt(n++, m); }
    lamps.count = n; scene.add(lamps);
    let last = -1;
    return {
      update(dt) {
        const p = race.player;
        const t = clamp(p.dist / (race.laps * N), 0, 1);
        race.env.setTime?.(race.mode === 'attract' ? (Math.sin(race.time * 0.1) + 1) / 2 : t);
        const night = clamp((t - 0.45) / 0.4, 0, 1);
        lamps.material.emissiveIntensity = night * 3;
        const phase = t < 0.33 ? 0 : t < 0.66 ? 1 : 2;
        if (phase !== last && race.mode !== 'attract') { if (last >= 0) race.hooks.toast(['昼になった', '夕方になった…', '夜! 光の道しるべをたどれ'][phase]); last = phase; }
      },
    };
  },

  // 🦖 歩く恐竜の群れ: 大きな足でコースをまたぐ。足の下をくぐるか、背中のジャンプ台へ
  dinos(c) {
    const { race, at, P, Y, ang, scene, near } = c;
    const dinos = [];
    for (const [off, phase] of [[0, 0], [24, Math.PI]]) {
      const d = new THREE.Group();
      const mat = std(0x6fae4a, { flatShading: true });
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat); body.scale.set(4, 3.2, 9); body.position.y = 11; d.add(body);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2, 9, 10), mat); neck.position.set(0, 16, 8); neck.rotation.x = 0.7; d.add(neck);
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 10), mat); head.scale.set(1, 0.8, 1.5); head.position.set(0, 19.5, 11.5); d.add(head);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(2, 12, 10), mat); tail.rotation.x = -Math.PI / 2 - 0.3; tail.position.set(0, 10, -13); d.add(tail);
      const plates = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.5, 12), std(0xffa040)); plates.position.y = 14.5; d.add(plates);
      const legs = [];
      for (const [lx, lz] of [[2.5, 4.5], [-2.5, 4.5], [2.5, -4.5], [-2.5, -4.5]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 10, 10), mat); leg.position.set(lx, 5, lz); d.add(leg); legs.push(leg); }
      scene.add(d);
      dinos.push({ d, legs, i: at + off, phase });
    }
    return {
      update(dt) {
        for (const dn of dinos) {
          // コースの横方向に行ったり来たりする
          const latC = Math.sin(race.time * 0.35 + dn.phase) * 36;
          const [x, z] = P(dn.i, latC);
          dn.d.position.set(x, Y(dn.i), z);
          dn.d.rotation.y = -ang(dn.i) + Math.PI / 2 * (Math.cos(race.time * 0.35 + dn.phase) > 0 ? 1 : -1);
          dn.legs.forEach((l, n) => (l.rotation.x = Math.sin(race.time * 3 + n * Math.PI / 2) * 0.35));
          dn.latC = latC;
          for (const k of race.karts) {
            if (k.ride || k.air) continue;
            const dd = c.rel(k, dn.i);
            if (Math.abs(dd) > 4) continue;
            // 足にぶつかる
            for (const lz of [-4.5, 4.5]) if (Math.abs(k.lat - (latC + lz)) < 1.6) { race._hit(k, 'front', null); c.toast(k, '恐竜の足にぶつかった!'); }
          }
          // 恐竜がコース上にいるときは、しっぽ側にジャンプ台(背中を飛び越える)
          if (Math.abs(latC) < 7) {
            for (const k of race.karts) if (!k.ride && !k.air && c.rel(k, dn.i) === -7 && Math.abs(k.lat - latC) < 3) { race.startRide(k, { to: 22, dur: 1.2, peak: 14, kind: 'jump' }); c.toast(k, '恐竜の背中を飛び越えた!'); }
          }
        }
      },
      ai(k, lane) {
        for (const dn of dinos) { const dd = c.rel(k, dn.i); if (dd < 0 && dd > -25 && dn.latC != null) for (const lz of [-4.5, 4.5]) if (Math.abs(lane - (dn.latC + lz)) < 2.5) return dn.latC; }
        return null;
      },
    };
  },

  // 🐉 コースを守るドラゴン: 定期的に炎を吐いて片側を燃やす。炎を避けた先に近道
  dragon(c) {
    const { race, at, place, roadPatch, inZone, approaching, near } = c;
    const s = c.side, len = 24;
    const dg = new THREE.Group();
    const mat = std(0xc0262e, { flatShading: true });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat); body.scale.set(5, 4, 9); body.position.y = 6; dg.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2, 8, 10), mat); neck.position.set(0, 11, 7); neck.rotation.x = 0.8; dg.add(neck);
    const head = new THREE.Mesh(new THREE.ConeGeometry(2, 5, 8), mat); head.rotation.x = Math.PI / 2; head.position.set(0, 14, 11); dg.add(head);
    for (const w of [-1, 1]) { const wing = new THREE.Mesh(new THREE.ConeGeometry(7, 12, 3), std(0x7a1218, { side: THREE.DoubleSide, flatShading: true })); wing.scale.z = 0.12; wing.rotation.z = w * 1.2; wing.position.set(w * 7, 10, 0); wing.userData.w = w; dg.add(wing); }
    const holder = place(dg, at, s * (WALL_OFF + 10), 0);
    holder.rotation.y += s > 0 ? Math.PI / 2 : -Math.PI / 2;
    const fireMat = new THREE.MeshStandardMaterial({ color: 0xff7a00, emissive: 0xff5000, emissiveIntensity: 2, transparent: true, opacity: 0.75 });
    const halves = [roadPatch(at + 2, len, -WALL_OFF, -0.5, fireMat.clone()), roadPatch(at + 2, len, 0.5, WALL_OFF, fireMat.clone())];
    halves.forEach(h => (h.visible = false));
    const padLat = -s * 5;
    c.pad(at + len + 4, padLat, 0xffd23f);
    let fireSide = 0, burnT = 0, cycle = 0;
    const burnCd = new Map();
    return {
      update(dt) {
        cycle += dt;
        dg.children.forEach(ch => { if (ch.userData.w) ch.rotation.y = Math.sin(race.time * 3) * 0.3 * ch.userData.w; });
        if (cycle > 6.5) { cycle = 0; fireSide = race.rnd() < 0.5 ? -1 : 1; burnT = 2.6; race.hooks.se('boom'); for (const k of race.karts) if (Math.abs(c.rel(k, at)) < 70) c.toast(k, 'ドラゴンの炎!'); }
        burnT = Math.max(0, burnT - dt);
        halves[0].visible = burnT > 0 && fireSide < 0; halves[1].visible = burnT > 0 && fireSide > 0;
        if (burnT > 0) {
          const h = halves[fireSide < 0 ? 0 : 1];
          h.material.opacity = 0.55 + Math.random() * 0.3;
          for (let n = 0; n < 4; n++) { const i = at + 2 + Math.floor(Math.random() * len); const [x, z] = c.P(i, fireSide * (1 + Math.random() * 6)); race.fxAdd.spawn(x, c.Y(i) + 0.5, z, 0, 4 + Math.random() * 4, 0, 0.5, 1.4, 1, 0.45, 0.05, -1, -2); }
          for (const k of race.karts) {
            if (k.ride || k.air || !inZone(k, at + 2, len) || k.lat * fireSide < 0.5) continue;
            if (race.time < (burnCd.get(k) || 0)) continue;
            burnCd.set(k, race.time + 1.2);
            race._hit(k, 'trap', null); c.toast(k, 'あちち!');
          }
        }
        for (const k of race.karts) {
          if (k.ride || k.air) continue;
          if (near(k, at + len + 4, padLat, 3.4)) { race.startRide(k, { to: 40, dur: 1.5, peak: 9, kind: 'jump' }); c.toast(k, '炎の先の近道!'); }
        }
      },
      ai(k, lane) {
        if (burnT > 0 && (approaching(k, at + 2, 30) || inZone(k, at + 2, len))) return -fireSide * 4.5;
        return approaching(k, at + len + 4, 50) && k.id % 2 ? padLat : null;
      },
    };
  },

  // 🐈 巨大ネコの寝返り: 寝返りのたびに床が傾いてカートが滑る。しっぽが道をふさぐことも
  giantcat(c) {
    const { race, at, P, Y, ang, scene, inZone } = c;
    const s = c.side;
    const fig = buildFigure(CHARACTERS[0]);
    fig.root.scale.setScalar(7);
    const holder = new THREE.Group(); holder.add(fig.root);
    fig.root.rotation.z = Math.PI / 2; fig.root.position.y = 4.5;
    const [x, z] = P(at, s * (WALL_OFF + 20));
    holder.position.set(x, Y(at), z); holder.rotation.y = -ang(at) + Math.PI / 2;
    scene.add(holder);
    // しっぽ(道の半分をふさぐ)
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, TRACK_WIDTH / 2 + 4, 6, 12), std(0x2d2f33, { roughness: 0.9 }));
    scene.add(tail);
    let rollT = 0, cycle = 0, dir = 1, tailSide = 1;
    const setTail = () => {
      const i = at + 18;
      const [tx, tz] = P(i, tailSide * (TRACK_WIDTH / 4 + 1));
      tail.position.set(tx, Y(i) + 1.2, tz);
      tail.rotation.set(0, -ang(i), Math.PI / 2, 'YXZ');
      tail.rotation.order = 'YXZ'; tail.rotation.set(Math.PI / 2, -ang(i) + Math.PI / 2, 0);
    };
    setTail();
    const zone = 34;
    return {
      update(dt) {
        cycle += dt;
        if (cycle > 9) {
          cycle = 0; rollT = 1.6; dir = -dir; tailSide = -tailSide; setTail();
          race.hooks.se('land');
          for (const k of race.karts) if (Math.abs(c.rel(k, at)) < 60) c.toast(k, 'ネコが寝返り! 床がかたむく');
        }
        if (rollT > 0) {
          rollT -= dt;
          fig.root.rotation.x = Math.sin((1 - rollT / 1.6) * Math.PI) * 0.5 * dir;
          for (const k of race.karts) {
            if (k.ride || !inZone(k, at - zone / 2, zone)) continue;
            const sm = c.S[k.idx];
            k.x += sm.nx * dir * 7 * dt; k.z += sm.nz * dir * 7 * dt;
          }
        } else fig.root.rotation.x *= 0.95;
        tail.rotation.z = Math.sin(race.time * 2) * 0.05;
        // しっぽに当たると止められる
        for (const k of race.karts) {
          if (k.ride || k.air) continue;
          const d = c.rel(k, at + 18);
          if (Math.abs(d) <= 1 && k.lat * tailSide > 0.3) { k.speed *= 0.4; k.x -= Math.cos(k.h) * 1.5; k.z -= Math.sin(k.h) * 1.5; if (k.isPlayer && race.time % 1 < 0.1) race.hooks.vibrate(20); }
        }
      },
      ai(k, lane) { const d = c.rel(k, at + 18); return d < 0 && d > -30 ? -tailSide * 4 : null; },
    };
  },
};

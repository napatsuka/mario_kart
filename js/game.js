import * as THREE from 'three';
import { buildTrack, WALL_OFF, OFFROAD_START, TRACK_WIDTH, mulberry32 } from './track.js';
import { makeKartMesh, makeItemMesh, makeItemBoxMesh } from './kart.js';
import { buildEnvironment } from './env.js';
import { Particles } from './particles.js';
import { buildGimmicks } from './gimmicks.js';
import { CHARACTERS, TIRES, THEMES, ITEMS, ITEM_USES, rollItem, DIFFICULTY } from './data.js';

export const STEP = 1 / 60;
const SPARK_COLORS = [[0x40c4ff, 0xff9100, 0xd500f9], [0xffffff, 0xffea00, 0x00b0ff]];
const DRIFT_LEVELS = [0.75, 1.6, 2.5];
const TURBO_TIME = [0, 0.55, 0.95, 1.35];
const COUNTDOWN = 3.6;
export const COIN_MAX = 10;
const COIN_BONUS = 0.01; // 1枚あたり最高速 +1%(10枚で +10%)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

function statsFor(char, tire) {
  const sp = clamp(char.speed + tire.speed, 1, 6);
  const ac = clamp(char.accel + tire.accel, 1, 6);
  const hd = clamp(char.handling + tire.handling, 1, 7);
  return { maxSpeed: 30 + sp * 1.0, accel: 11 + ac * 2.6, turn: (1.55 + hd * 0.11) * 0.8 }; // 曲がりすぎないよう控えめ
}

function itemBoxTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 64, 64);
  ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb'].forEach((col, i) => g.addColorStop(i / 4, col));
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  c.strokeStyle = '#fff'; c.lineWidth = 6; c.strokeRect(3, 3, 58, 58);
  c.fillStyle = '#fff'; c.font = 'bold 44px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('?', 32, 35);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Race {
  /**
   * opts: { course, mode: 'cup'|'quick'|'ta'|'daily-time'|'daily-rank'|'ghost', laps, settings, profile,
   *         ghost, cpuCount, hooks: { toast, flash, vibrate, se, hud, countdown, onFinish, engine } }
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.laps = opts.laps ?? 2;
    this.theme = THEMES[this.course.theme];
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.5, 2500);
    const gfx = this.gfx || { shadows: true, shadowSize: 2048, detail: true };
    this.rnd = mulberry32((Date.now() & 0xffff) + this.course.seed);
    this.env = buildEnvironment(this.scene, this.theme, mulberry32(this.course.seed * 7 + 3), gfx);

    this.track = buildTrack(this.course, this.theme, { detail: gfx.detail, decorCount: gfx.detail ? 260 : 140 });
    this.scene.add(this.track.group);

    // パーティクル(加算: 火花/炎、通常: 煙/砂ぼこり)
    this.fxAdd = new Particles(1400, true);
    this.fxSmoke = new Particles(900, false, 0.32);
    this.scene.add(this.fxAdd.points, this.fxSmoke.points);
    this.groundCol = new THREE.Color(this.theme.ground2);

    this.time = 0;
    this.state = this.mode === 'attract' ? 'race' : 'countdown';
    this.countdownT = this.mode === 'attract' ? 0 : COUNTDOWN;
    if (this.mode === 'attract') { this.laps = 999; this.shotT = 0; this.shot = 0; }
    this.lastCount = 4;
    this.karts = [];
    this.projectiles = [];
    this.bolts = [];
    this.camY = 0;
    this.hazards = [];
    this.ghostFrames = [];
    this.ghostRecT = 0;
    this.finishTimer = 0;
    this.wrongWayT = 0;
    this.rouletteSeT = 0;

    this._spawnKarts();
    this._applyEnv();
    this._spawnItemBoxes();
    this._spawnCoins();
    // コースのギミック(通行止めは blockers に登録される)
    this.blockers = [];
    this.gimmicks = buildGimmicks(this, this.course.gimmicks || []);
    this._prepareMinimap();
    this.camH = this.player.h;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this._placeCamera(1, true);
  }

  get player() { return this._player; }

  _spawnKarts() {
    const tr = this.track, N = tr.N;
    const profile = this.profile;
    const others = CHARACTERS.filter(c => c.id !== profile.character);
    const cpuCount = this.cpuCount ?? 7;
    const total = cpuCount + 1;
    const playerSlot = cpuCount === 0 ? 0 : Math.min(total - 1, 4);
    const diff = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.normal;
    let cpuI = 0;
    for (let slot = 0; slot < total; slot++) {
      const isPlayer = slot === playerSlot;
      const char = isPlayer ? CHARACTERS.find(c => c.id === profile.character) || CHARACTERS[0] : others[cpuI++ % others.length];
      const tire = isPlayer ? TIRES.find(t => t.id === profile.tire) || TIRES[0] : TIRES[0];
      const row = Math.floor(slot / 2), side = slot % 2 ? 1 : -1;
      const idx = N - 4 - row * 4;
      const lat = cpuCount === 0 ? 0 : side * 3.6;
      const [x, z] = tr.off(idx, lat);
      const bodyColor = isPlayer ? profile.bodyColor : [0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xff6f00, 0x212121, 0xf5f5f5, 0xe53935][cpuI % 8];
      const mesh = makeKartMesh({ bodyColor, char });
      this.scene.add(mesh.root);
      const k = {
        id: slot, name: isPlayer ? profile.name : char.name, char, isPlayer, mesh,
        stats: statsFor(char, tire),
        x, z, h: tr.samples[idx].angle, speed: 0, y: tr.heights[idx], vy: 0, air: false,
        idx, prevIdx: idx, dist: idx - N, lat, lap: 0, rank: slot,
        finished: false, finishTime: 0,
        item: null, itemCount: 0, item2: null, item2Count: 0, roulette: 0,
        tangleT: 0, squashT: 0, slipT: 0, reverseT: 0, mirrorT: 0, ride: null, jumpPrev: false,
        drifting: false, driftDir: 0, driftCharge: 0, driftLevel: 0,
        boostT: 0, starT: 0, spinT: 0, spinAngle: 0, hopT: 0, wallCd: 0,
        megaT: 0, dashT: 0, slowT: 0, inkT: 0, scaleVis: 1, coins: 0,
        guarding: false, aiFactor: 1, offroad: false, adTimer: 0, autoDrift: false,
        ai: { lane: (this.rnd() - 0.5) * 8, laneT: 1 + this.rnd() * 3, itemT: 1, skill: diff.ai * (0.97 + this.rnd() * 0.05) },
      };
      this.karts.push(k);
      if (isPlayer) this._player = k;
    }
    // ゴースト(タイムアタック/フレンドゴースト)
    if (this.ghost) {
      const ch = CHARACTERS.find(c => c.id === this.ghost.character) || CHARACTERS[0];
      this.ghostMesh = makeKartMesh({ bodyColor: this.ghost.bodyColor ?? 0xffffff, char: ch, ghost: true });
      this.scene.add(this.ghostMesh.root);
    }
  }

  // 反射はカート(塗装・メッキ)とキャラだけに効かせ、地面などは直接光のコントラストを保つ
  _applyEnv() {
    if (!this.envMap) return;
    const roots = this.karts.map(k => k.mesh.root);
    if (this.ghostMesh) roots.push(this.ghostMesh.root);
    for (const r of roots) r.traverse(o => {
      if (!o.isMesh || !o.material || o.material.envMap === this.envMap) return;
      if (!o.material.isMeshStandardMaterial) return;
      o.material.envMap = this.envMap;
      o.material.envMapIntensity = o.material.metalness > 0.5 ? 1.0 : o.material.clearcoat ? 0.8 : 0.35;
      o.material.needsUpdate = true;
    });
  }

  // コース上のコイン: 7か所に5枚ずつ一列に並べる。取ると最高速が少し上がる(上限 COIN_MAX 枚)
  _spawnCoins() {
    const tr = this.track, N = tr.N;
    const geo = new THREE.CylinderGeometry(0.75, 0.75, 0.18, 24).rotateZ(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffc928, metalness: 0.8, roughness: 0.25, emissive: 0x7a5200, emissiveIntensity: 0.6 });
    this.coins = [];
    const rnd = mulberry32(this.course.seed * 31 + 9);
    for (const f of [0.06, 0.25, 0.39, 0.52, 0.66, 0.8, 0.94]) {
      const base = Math.floor(f * N), lat0 = (rnd() - 0.5) * 9, drift = (rnd() - 0.5) * 0.6;
      for (let n = 0; n < 5; n++) {
        const i = (base + n * 3) % N, lat = clamp(lat0 + drift * n * 3, -5.5, 5.5);
        const [x, z] = tr.off(i, lat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, tr.heights[i] + 1.1, z);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.coins.push({ x, z, y: tr.heights[i], idx: i, lat, mesh, active: true, respawn: 0 });
      }
    }
  }

  _updateCoins(dt) {
    for (const c of this.coins) {
      if (!c.active) { c.respawn -= dt; if (c.respawn <= 0) { c.active = true; c.mesh.visible = true; } continue; }
      c.mesh.rotation.y += dt * 4;
      c.mesh.position.y = c.y + 1.1 + Math.sin(this.time * 4 + c.idx) * 0.12;
      for (const k of this.karts) {
        if (k.ride) continue;
        if ((k.x - c.x) ** 2 + (k.z - c.z) ** 2 > 2.2 * 2.2 || Math.abs(k.y - c.y) > 3) continue;
        c.active = false; c.mesh.visible = false; c.respawn = 9;
        if (k.coins < COIN_MAX) k.coins++;
        if (k.isPlayer) this.hooks.se('coin');
        this.burst(c.x, c.y + 1.1, c.z, { n: 8, hue: 0.13, speed: 3 });
        break;
      }
    }
  }

  _spawnItemBoxes() {
    this.boxes = [];
    if (this.mode === 'ta' || this.mode === 'ghost' || this.mode === 'daily-time') {
      this.player.item = 'triple'; this.player.itemCount = 3;
      return;
    }
    const tex = itemBoxTexture();
    for (const s of this.track.itemSlots) {
      const mesh = makeItemBoxMesh(tex);
      mesh.position.set(s.x, s.y + 1.4, s.z);
      this.scene.add(mesh);
      this.boxes.push({ ...s, mesh, active: true, respawn: 0 });
    }
  }

  _prepareMinimap() {
    const s = this.track.samples;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of s) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    this.mm = { minX, minZ, w: maxX - minX, h: maxZ - minZ };
  }

  drawMinimap(ctx, W, H) {
    const { minX, minZ, w, h } = this.mm;
    const pad = 8, sc = Math.min((W - pad * 2) / w, (H - pad * 2) / h);
    const ox = (W - w * sc) / 2, oz = (H - h * sc) / 2;
    const P = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
    ctx.clearRect(0, 0, W, H);
    if (!this._mmPath) {
      this._mmPath = new Path2D();
      this.track.samples.forEach((p, i) => { const [a, b] = P(p.x, p.z); i ? this._mmPath.lineTo(a, b) : this._mmPath.moveTo(a, b); });
      this._mmPath.closePath();
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 7; ctx.stroke(this._mmPath);
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 4; ctx.stroke(this._mmPath);
    const [sx, sz] = P(this.track.samples[0].x, this.track.samples[0].z);
    ctx.fillStyle = '#111'; ctx.fillRect(sx - 3, sz - 3, 6, 6);
    if (this.ghostMesh && this.ghostMesh.root.visible) {
      const g = this.ghostMesh.root.position; const [a, b] = P(g.x, g.z);
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(a, b, 4, 0, 7); ctx.fill();
    }
    for (const k of this.karts) {
      if (k.isPlayer) continue;
      const [a, b] = P(k.x, k.z);
      ctx.fillStyle = '#' + k.mesh.bodyMat.color.getHexString();
      ctx.beginPath(); ctx.arc(a, b, 4, 0, 7); ctx.fill();
    }
    const p = this.player; const [a, b] = P(p.x, p.z);
    ctx.fillStyle = '#ff1744'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(a, b, 6.5, 0, 7); ctx.fill(); ctx.stroke();
  }

  // ---------------- 更新 ----------------
  update(dt, input) {
    const hooks = this.hooks;
    if (this.state === 'countdown') {
      this.countdownT -= dt;
      const n = Math.ceil(this.countdownT);
      // スタート信号: 残り3・2・1秒で赤ランプが1つずつ点き、0で全部緑になってスタート
      if (n < this.lastCount && n <= 3 && n >= 1) { hooks.countdown(String(n)); hooks.lights?.(4 - n); hooks.se('count'); }
      this.lastCount = n;
      // ロケットスタート: ドリフトボタンを押し始めた時刻を覚え、スタートまで押し続けていれば判定
      if (input.drift && this.rocketPressAt == null) this.rocketPressAt = this.countdownT;
      if (!input.drift) this.rocketPressAt = null;
      this.revving = !!input.drift;
      if (this.countdownT <= 0) {
        this.state = 'race';
        hooks.countdown('GO!'); hooks.lights?.('go'); hooks.se('go');
        const t = input.drift ? this.rocketPressAt : null;
        const p = this.player;
        if (t != null && t <= 2.05) {
          // 2つ目のランプ(残り2秒)以降に押し始めていれば大成功、1つ目のあとなら小さな加速
          const great = t <= 2.05 && t > 0.15;
          p.boostT = great ? 1.5 : 0.6; p.speed = Math.max(p.speed, 14);
          hooks.toast(great ? 'ロケットスタート!' : 'ちょっとダッシュ!'); hooks.se('boost'); hooks.vibrate(great ? [40, 30, 60] : 30);
          this.burst(p.x, p.y + 0.6, p.z, { n: great ? 40 : 15, hue: 0.08, speed: 6 });
        } else if (t != null && t <= 3.05) {
          p.boostT = 0.5; hooks.toast('ちょっとダッシュ!'); hooks.se('turbo1');
        } else if (t != null) {
          p.spinT = 0.9; hooks.toast('エンスト! 押すのが早すぎ'); hooks.se('hit'); hooks.vibrate(60);
        }
        for (const k of this.karts) if (!k.isPlayer && this.rnd() < 0.45) k.boostT = this.rnd() < 0.5 ? 1.4 : 0.6;
      }
    } else if (this.state === 'race' || this.state === 'finished') {
      this.time += dt;
    }

    for (const k of this.karts) k.zoneMul = 1;
    for (const g of this.gimmicks) g.update(dt);
    for (const k of this.karts) {
      let ctl;
      if (k.isPlayer && !k.finished && this.mode !== 'attract' && k.dashT <= 0) ctl = this._playerControl(k, input, dt);
      else ctl = this._aiControl(k, dt);
      this._stepKart(k, ctl, dt);
    }
    this._collideKarts();
    this._updateProjectiles(dt);
    this._updateHazards(dt);
    this._updateBoxes(dt);
    this._updateCoins(dt);
    this._rank();

    // ゴースト記録(10Hz)
    if (this.state === 'race' && !this.player.finished) {
      this.ghostRecT -= dt;
      if (this.ghostRecT <= 0) { this.ghostRecT += 0.1; this.ghostFrames.push([this.player.x, this.player.z, this.player.h]); }
    }

    if (this.state === 'finished') {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0 && !this.resultSent) { this.resultSent = true; hooks.onFinish(this._results()); }
    }
  }

  _playerControl(k, input, dt) {
    let steer = input.steer;
    let drift = input.drift;
    const tr = this.track, s = tr.samples[k.idx];
    if (this.settings.smartSteer && this.state === 'race') {
      const edge = TRACK_WIDTH / 2 - 1.5;
      if (Math.abs(k.lat) > edge) {
        const want = s.angle - Math.sign(k.lat) * 0.3;
        const corr = clamp(angDiff(want, k.h) * 1.6, -0.9, 0.9);
        if (Math.sign(corr) !== Math.sign(steer) || Math.abs(steer) < Math.abs(corr)) steer = clamp(steer + corr, -1, 1);
      }
    }
    if (this.settings.autoDrift) {
      if (!k.autoDrift) {
        k.adTimer = Math.abs(steer) > 0.6 && k.speed > 18 ? k.adTimer + dt : 0;
        if (k.adTimer > 0.2) k.autoDrift = true;
      } else if (Math.abs(steer) < 0.25 || k.spinT > 0) k.autoDrift = false;
      drift = drift || k.autoDrift;
    }
    // 逆走検知
    if (this.state === 'race' && Math.abs(angDiff(s.angle, k.h)) > 2.2 && k.speed > 5) {
      this.wrongWayT += dt;
      if (this.wrongWayT > 1.5) { this.hooks.toast('逆走しています!'); this.wrongWayT = -2; }
    } else if (this.wrongWayT > 0) this.wrongWayT = 0;
    if (this.wrongWayT < 0) this.wrongWayT += dt;

    // アイテム
    k.guarding = !!(input.itemHolding && (k.item === 'jelly' || k.item === 'bomb') && k.spinT <= 0);
    if (input.itemReleased && this.state === 'race') this._useItem(k);
    return { steer, drift };
  }

  _aiControl(k, dt) {
    const tr = this.track, N = tr.N;
    if (this.state === 'countdown') return { steer: 0, drift: false };
    const look = Math.round(8 + k.speed * 0.35);
    const ti = (k.idx + look) % N;
    k.ai.laneT -= dt;
    if (k.ai.laneT <= 0) { k.ai.lane = (this.rnd() - 0.5) * 9; k.ai.laneT = 2 + this.rnd() * 4; }
    let lane = k.ai.lane;
    if ((!k.item || !k.item2) && !k.roulette) {
      for (const b of this.boxes) {
        if (!b.active) continue;
        let d = b.idx - k.idx; if (d < 0) d += N;
        if (d > 4 && d < 45) { lane = b.lat; break; }
      }
    }
    for (const hz of this.hazards) {
      let d = hz.idx - k.idx; if (d < 0) d += N;
      if (d > 0 && d < 30 && Math.abs(hz.lat - lane) < 3) lane = hz.lat + (hz.lat > 0 ? -5 : 5);
    }
    for (const o of tr.obstacles) {
      let d = o.idx - k.idx; if (d < 0) d += N;
      if (d > 0 && d < 35 && Math.abs(o.lat - lane) < 3.4) lane = o.lat + (o.lat > 0 ? -4.4 : 4.4);
    }
    // コーナーでは内側寄り
    lane += -Math.sign(tr.samples[ti].curv) * Math.min(3, Math.abs(tr.samples[ti].curv) * 120);
    let aim = ti;
    for (const g of this.gimmicks) { const l = g.ai?.(k, lane); if (l != null) { lane = l; aim = (k.idx + 9) % N; break; } } // ギミックの乗り口などは近くを狙ってすばやく寄せる
    lane = clamp(lane, -TRACK_WIDTH / 2 + 1.5, TRACK_WIDTH / 2 - 1.5);
    const [tx, tz] = tr.off(aim, lane);
    let steer = clamp(angDiff(Math.atan2(tz - k.z, tx - k.x), k.h) * 2.4, -1, 1);
    if (k.inkT > 0) steer = clamp(steer + Math.sin(this.time * 7 + k.id) * 0.55, -1, 1); // スミで前が見えずふらつく

    // ラバーバンド(離れすぎない・追いつけるように)
    if (this.mode === 'attract') k.aiFactor = k.ai.skill + (k.isPlayer ? 0.02 : 0);
    else if (k.isPlayer) k.aiFactor = 0.92;
    else {
      const gap = this.player.dist - k.dist;
      k.aiFactor = k.ai.skill + clamp(gap / 500, -0.07, 0.12);
    }
    // 前方のきついカーブでは曲がり切れる速度まで落とす
    let maxC = 0;
    for (let i = 4; i < 34; i += 2) maxC = Math.max(maxC, Math.abs(tr.samples[(k.idx + i) % N].curv));
    if (maxC > 0.001) k.aiFactor = Math.min(k.aiFactor, Math.max(0.42, (k.stats.turn * 0.9) / maxC / k.stats.maxSpeed));
    if (k.inkT > 0) k.aiFactor *= 0.88;

    let itemReleased = false, itemHolding = false;
    if (k.item && !k.finished) {
      k.ai.itemT -= dt;
      const guardType = k.item === 'jelly' || k.item === 'bomb';
      if (guardType) {
        itemHolding = k.ai.itemT > 0;
        if (k.ai.itemT <= 0) itemReleased = true;
      } else if (k.ai.itemT <= 0) {
        if (['missile', 'missile3', 'ink', 'topbomb', 'rod', 'dizzy', 'boomerang', 'yarn'].includes(k.item)) { if (k.rank > 0) itemReleased = true; }
        else itemReleased = true;
        if (k.item === 'triple' || k.item === 'missile3') k.ai.itemT = 1.2;
      }
    }
    k.guarding = itemHolding && k.spinT <= 0;
    if (itemReleased) this._useItem(k);
    return { steer, drift: false };
  }

  _stepKart(k, ctl, dt) {
    const tr = this.track, N = tr.N;
    k.boostT = Math.max(0, k.boostT - dt);
    k.starT = Math.max(0, k.starT - dt);
    k.megaT = Math.max(0, k.megaT - dt);
    k.respawnT = Math.max(0, (k.respawnT || 0) - dt);
    k.tangleT = Math.max(0, k.tangleT - dt); k.squashT = Math.max(0, k.squashT - dt); k.slipT = Math.max(0, k.slipT - dt);
    k.reverseT = Math.max(0, k.reverseT - dt); k.mirrorT = Math.max(0, k.mirrorT - dt);
    k.dashT = Math.max(0, k.dashT - dt);
    k.slowT = Math.max(0, k.slowT - dt);
    k.inkT = Math.max(0, k.inkT - dt);
    if (k.isPlayer && (k.inkT > 0) !== !!this._inkShown) { this._inkShown = k.inkT > 0; this.hooks.ink?.(this._inkShown); }
    k.spinT = Math.max(0, k.spinT - dt);
    k.hopT = Math.max(0, k.hopT - dt);
    k.wallCd = Math.max(0, k.wallCd - dt);
    const hooks = this.hooks;

    let target = k.stats.maxSpeed * k.aiFactor;
    if (k.isPlayer && !k.finished && this.mode !== 'attract') target = k.stats.maxSpeed;
    if (k.offroad && k.boostT <= 0 && !this._invuln(k)) target *= 0.55;
    if (k.boostT > 0) target *= 1.32;
    if (k.starT > 0) target *= 1.15;
    if (k.megaT > 0) target *= 1.1;
    if (k.dashT > 0) target = k.stats.maxSpeed * 1.6;
    if (k.slowT > 0) target *= 0.62;
    if (k.tangleT > 0) target *= 0.85;
    target *= k.zoneMul ?? 1;
    target *= 1 + COIN_BONUS * k.coins; // コイン1枚ごとに最高速が少し上がる
    if (k.squashT > 0) target *= 0.75;
    { // 上り坂は少し遅く、下り坂は少し速く
      const H = tr.heights, i = k.idx;
      const slope = (H[(i + 2) % N] - H[(i - 2 + N) % N]) / (4 * tr.spacing);
      target *= clamp(1 - slope * 0.7, 0.82, 1.15);
    }
    if (!k.drifting) target *= 1 - 0.25 * Math.min(1, Math.abs(k.lastSteer || 0)); // 大きく切ると少し減速(ヘアピンも曲がれる)
    if (k.spinT > 0 || this.state === 'countdown') target = 0;
    if (k.speed < target) k.speed = Math.min(target, k.speed + k.stats.accel * dt * (k.boostT > 0 ? 3 : 1));
    else k.speed = Math.max(target, k.speed - (k.offroad ? 40 : 22) * dt);

    let steer = ctl.steer;
    if (k.reverseT > 0) steer = k.isPlayer ? -steer : -steer * 0.6; // くるくるメガネ
    if (k.tangleT > 0) steer *= 0.45; // 毛糸で重い
    if (k.slipT > 0) { steer *= 0.5; k.h += Math.sin(this.time * 9 + k.id) * dt * 0.9; } // 氷で滑る
    k.lastSteer = steer;
    const sf = clamp(k.speed / 10, 0, 1);
    if (k.spinT > 0) { k.spinAngle += dt * 13; steer = 0; } else k.spinAngle = 0;

    // 乗り物から降りる(観覧車などはジャンプボタンで好きな位置で降りられる)
    if (k.ride && k.ride.exitable && ctl.drift && !k.jumpPrev && k.ride.t > 0.12) { k.ride = null; k.air = true; k.vy = 2; if (k.isPlayer) hooks.toast('ここで降りる!'); }
    // ドリフトボタンを押した瞬間に1回ジャンプ(着地してからドリフトに入る)
    if (ctl.drift && !k.jumpPrev && !k.air && !k.ride && this.state !== 'countdown' && k.spinT <= 0) {
      // 道の上下の動き(坂)に上乗せするので、上り坂でも下り坂でも同じ高さ・滞空時間になる
      k.air = true; k.vy = (k.vy || 0) + 9; k.jumpT = 0.4; k.jumpDrift = true; // 小さく素早いジャンプ(約0.2秒で着地)
      if (k.isPlayer) hooks.se('jump');
    }
    k.jumpPrev = !!ctl.drift;
    k.jumpT = Math.max(0, (k.jumpT || 0) - dt);
    // ドリフトに入れるのはジャンプの着地から0.5秒以内だけ。その間に左右を押さなければドリフトしない
    k.landT = Math.max(0, (k.landT || 0) - dt);
    const canDrift = !k.drifting && !k.air && k.landT > 0 && k.speed > 14 && k.spinT <= 0 && this.state !== 'countdown';
    if (canDrift && Math.abs(steer) > 0.25) {
      k.drifting = true; k.driftDir = Math.sign(steer); k.driftCharge = 0; k.driftLevel = 0; k.driftT = 0;
      k.driftByJump = !ctl.drift;
      k.landT = 0;
    }
    if (k.drifting) {
      // ボタンを押している間、またはジャンプから入ったドリフトは同じ向きに押している間だけ続く
      const holding = ctl.drift || (k.driftByJump && steer * k.driftDir > 0.15);
      if (ctl.drift) k.driftByJump = false;
      if (!holding || k.speed < 10 || k.spinT > 0) {
        if (k.driftLevel > 0 && k.spinT <= 0) {
          k.boostT = Math.max(k.boostT, TURBO_TIME[k.driftLevel]);
          if (k.isPlayer) { hooks.se('turbo1'); hooks.toast(['', 'ミニターボ!', 'スーパーターボ!', 'ウルトラターボ!'][k.driftLevel]); hooks.vibrate(25 + 15 * k.driftLevel); }
        }
        k.drifting = false; k.driftLevel = 0;
      } else {
        const rel = steer * k.driftDir;
        // ドリフト中の旋回は控えめ(外側に入力すると大回り、内側で少し締まる)
        // 入った瞬間は控えめに曲がり、約0.4秒かけて本来の曲がり量になる
        k.driftT = (k.driftT || 0) + dt;
        const ease = Math.min(1, 0.35 + k.driftT * 1.6);
        k.h += k.stats.turn * k.driftDir * (0.48 + 0.3 * rel) * ease * dt * sf * (this.theme.slippery ? 0.9 : 1); // ドリフト中は少し曲がりやすく
        k.driftCharge += dt * (0.8 + 0.6 * Math.max(0, rel));
        let lv = 0; for (const t of DRIFT_LEVELS) if (k.driftCharge >= t) lv++;
        if (lv > k.driftLevel) { k.driftLevel = lv; if (k.isPlayer) { hooks.se('spark'); hooks.vibrate(12); } }
      }
    } else {
      k.h += k.stats.turn * steer * dt * sf * (this.theme.slippery ? 0.86 : 1); // 氷のコースは曲がりにくい
    }

    // 通行止め(踏切・跳ね橋): 手前で止まって待つ
    for (const b of this.blockers) {
      if (!b.active || k.ride || k.air) continue;
      let d = b.idx - k.idx; if (d > N / 2) d -= N; if (d < -N / 2) d += N;
      if (d >= 0 && d < 3) k.speed = Math.min(k.speed, d * 3);
    }
    k.x += Math.cos(k.h) * k.speed * dt;
    k.z += Math.sin(k.h) * k.speed * dt;
    if (k.ride) this._rideStep(k, dt);

    k.idx = tr.nearest(k.idx, k.x, k.z);
    let lat = tr.lateral(k.idx, k.x, k.z);
    const s = tr.samples[k.idx];
    const lim = WALL_OFF - 1.1;
    if (Math.abs(lat) > lim && !k.ride) {
      const sg = Math.sign(lat), d = lat - sg * lim;
      k.x -= s.nx * d; k.z -= s.nz * d; lat = sg * lim;
      const into = (Math.cos(k.h) * s.nx + Math.sin(k.h) * s.nz) * sg;
      if (into > 0.05) {
        k.speed *= 1 - 0.55 * into;
        k.h += angDiff(s.angle, k.h) * 0.25; // 壁に当たったときだけ少し向きを戻す
        if (k.isPlayer && k.wallCd <= 0) { hooks.se('wall'); hooks.vibrate(18); k.wallCd = 0.4; }
      }
    }
    for (const o of tr.obstacles) {
      if (k.ride) break;
      let di = Math.abs(k.idx - o.idx); di = Math.min(di, N - di);
      if (di > 6) continue;
      const dx = k.x - o.x, dz = k.z - o.z, d = Math.hypot(dx, dz), R = 2.15;
      if (d < R && d > 1e-3) {
        k.x = o.x + (dx / d) * R; k.z = o.z + (dz / d) * R;
        const into = -(Math.cos(k.h) * dx + Math.sin(k.h) * dz) / d;
        if (into > 0.2) {
          k.speed *= 0.45; k.h += (dx * Math.sin(k.h) - dz * Math.cos(k.h) > 0 ? -0.35 : 0.35);
          if (k.isPlayer && k.wallCd <= 0) { hooks.se('wall'); hooks.vibrate(30); k.wallCd = 0.4; }
        }
      }
    }
    // 高さ: 道に沿って上下し、坂の頂上では浮いてジャンプする
    {
      const ground = tr.heightAt(k.idx, k.x, k.z), G = 80; // 重力を強めて素早く着地
      // 道そのものの上下の速さ(坂を走るときの上下動)
      const gvy = k.gPrev == null ? 0 : clamp((ground - k.gPrev) / dt, -40, 40);
      k.gPrev = ground;
      if (k.ride) { /* 乗り物の高さは _rideStep が決める */ }
      else if (k.air) {
        k.vy -= G * dt; k.y += k.vy * dt;
        if (k.y <= ground) {
          if (k.isPlayer && k.vy < -9) { hooks.vibrate(25); hooks.se('land'); }
          k.y = ground; k.vy = gvy; k.air = false;
          if (k.jumpDrift) { k.landT = 0.5; k.jumpDrift = false; } // ジャンプからの着地: ここから0.5秒以内ならドリフトに入れる
        }
      } else if (gvy < k.vy - G * dt * 2.2 && k.speed > 20) {
        // 坂の頂上で道が重力より速く下がる → 浮いてジャンプ
        k.air = true; k.vy -= G * dt; k.y += k.vy * dt;
      } else { k.vy = gvy; k.y = ground; }
    }
    if (k.dashT > 0) { // ねこロケット: コース中央へ吸い寄せて進行方向にそろえる
      k.h += angDiff(s.angle, k.h) * Math.min(1, dt * 8);
      const pull = lat * Math.min(1, dt * 3); k.x -= s.nx * pull; k.z -= s.nz * pull; lat -= pull;
    }
    k.lat = lat;
    k.offroad = Math.abs(lat) > OFFROAD_START + 1.3;

    let d = k.idx - k.prevIdx;
    if (d > N / 2) d -= N; if (d < -N / 2) d += N;
    k.dist += d; k.prevIdx = k.idx;

    for (const p of tr.boostPads) {
      let di = Math.abs(k.idx - p.idx); di = Math.min(di, N - di);
      if (di <= 2 && Math.abs(lat - p.lat) < 2.3) {
        if (k.boostT < 0.3 && k.isPlayer) { hooks.se('boost'); hooks.vibrate(20); }
        k.boostT = Math.max(k.boostT, 0.9);
      }
    }

    const lap = Math.floor(k.dist / N) + 1;
    if (lap > k.lap && !k.finished) {
      k.lap = lap;
      if (lap > this.laps) {
        k.finished = true; k.finishTime = this.time;
        if (k.isPlayer) {
          this.state = 'finished'; this.finishTimer = 2.8;
          hooks.se('finish'); hooks.countdown('ゴール!'); hooks.vibrate([50, 60, 50]);
          k.guarding = false;
        }
      } else if (k.isPlayer && lap > 1) {
        hooks.se('lap'); hooks.toast(lap === this.laps ? 'ファイナルラップ!' : `ラップ ${lap}`);
      }
    }

    // ルーレット
    if (k.roulette > 0) {
      k.roulette -= dt;
      if (k.isPlayer) { this.rouletteSeT -= dt; if (this.rouletteSeT <= 0) { hooks.se('roll'); this.rouletteSeT = 0.08; } }
      if (k.roulette <= 0) {
        const rf = this.karts.length > 1 ? k.rank / (this.karts.length - 1) : 0;
        const got = rollItem(rf, this.rnd);
        // アイテムは2つまでストック(空いている枠に入る)
        if (!k.item) { k.item = got; k.itemCount = ITEM_USES[got] || 1; }
        else { k.item2 = got; k.item2Count = ITEM_USES[got] || 1; }
        k.ai.itemT = 0.6 + this.rnd() * 2.5;
        if (k.item === 'jelly' || k.item === 'bomb') k.ai.itemT = 2 + this.rnd() * 5;
        if (k.isPlayer) { hooks.se('item'); hooks.toast('ゲット: ' + ITEMS[got].name); }
      }
    }
  }

  // 使ったアイテムを減らし、使い切ったら2つ目の枠を繰り上げる
  _consumeItem(k) {
    k.itemCount--;
    if (k.itemCount <= 0) { k.item = k.item2; k.itemCount = k.item2Count; k.item2 = null; k.item2Count = 0; }
  }

  // 前方(dist が大きい)のカートを近い順に
  _ahead(k, range = 200) {
    return this.karts.filter(o => o !== k && !o.finished && o.dist > k.dist && o.dist - k.dist < range).sort((a, b) => a.dist - b.dist);
  }

  _dropHazard(k, kind, x, z, extra = {}) {
    const tr = this.track;
    const idx = tr.nearest(k.idx, x, z);
    const mesh = makeItemMesh(kind);
    mesh.position.set(x, tr.heightAt(idx, x, z) + (kind === 'cushion' ? 0.7 : kind === 'firework' ? 0.4 : 0.06), z);
    mesh.rotation.y = -k.h;
    this.scene.add(mesh);
    const life = { stamp: 20, ice: 14, firework: 8, cushion: 30 }[kind] ?? 30;
    this.hazards.push({ kind, x, z, idx, lat: tr.lateral(idx, x, z), mesh, life, owner: k, safeT: kind === 'ice' ? 99 : 0.8, ...extra });
  }

  _useItem(k) {
    if (!k.item || k.spinT > 0) return;
    const hooks = this.hooks, tr = this.track;
    const type = k.item;
    const consume = () => this._consumeItem(k);
    switch (type) {
      case 'boost': case 'triple':
        k.boostT = Math.max(k.boostT, 1.2);
        if (k.isPlayer) { hooks.se('boost'); hooks.vibrate(30); }
        consume(); break;
      case 'star':
        k.starT = 6; k.boostT = Math.max(k.boostT, 0.5);
        if (k.isPlayer) { hooks.se('star'); hooks.toast('スター!'); }
        consume(); break;
      case 'mega':
        k.megaT = 7;
        if (k.isPlayer) { hooks.se('mega'); hooks.toast('ビッグにゃん!'); hooks.vibrate(60); }
        consume(); break;
      case 'dash':
        k.dashT = 4.5; k.drifting = false;
        if (k.isPlayer) { hooks.se('boost'); hooks.toast('ねこロケット!'); hooks.vibrate([40, 30, 40]); }
        consume(); break;
      case 'lightning': {
        hooks.flash('rgba(255,250,190,.85)'); hooks.se('thunder'); hooks.vibrate([30, 40, 90]);
        for (const o of this.karts) {
          if (o === k || o.finished) continue;
          this.bolts.push({ x: o.x, z: o.z, y: o.y, life: 0.35 });
          if (this._invuln(o)) continue;
          o.guarding = false;
          this._hit(o, 'lightning', k);
          o.slowT = 3.2;
        }
        if (k.isPlayer) hooks.toast('カミナリ!');
        consume(); break;
      }
      case 'ink':
        for (const o of this.karts) if (o !== k && o.dist > k.dist && !o.finished && !this._invuln(o)) o.inkT = 4;
        hooks.se('ink');
        if (k.isPlayer) hooks.toast('まっくろスミ!');
        consume(); break;
      case 'topbomb': {
        const leader = [...this.karts].filter(o => o !== k && !o.finished).sort((a, b) => b.dist - a.dist)[0];
        if (leader) this._spawnProjectile('topbomb', k, 2, 88, leader);
        if (k.isPlayer) { hooks.se('shoot'); hooks.toast('トップねらい弾!'); }
        consume(); break;
      }
      case 'boomerang':
        this._spawnProjectile('boomerang', k, 3, 58, null);
        if (k.isPlayer) hooks.se('shoot');
        consume(); break;
      case 'yarn': {
        this._spawnProjectile('yarn', k, 3, 0, null);
        const p = this.projectiles[this.projectiles.length - 1];
        p.free = true; p.vx = Math.cos(k.h) * 46; p.vz = Math.sin(k.h) * 46; p.idx = k.idx; p.life = 7;
        if (k.isPlayer) hooks.se('shoot');
        consume(); break;
      }
      case 'stamp': {
        const pos = k.dist + 16;
        const [x, z] = this._posAlong(pos, k.lat);
        this._dropHazard(k, 'stamp', x, z);
        if (k.isPlayer) { hooks.se('drop'); hooks.toast('にくきゅうスタンプ!'); }
        consume(); break;
      }
      case 'firework': {
        const [x, z] = this._posAlong(k.dist + 4, k.lat);
        this._dropHazard(k, 'firework', x, z, { heading: k.h + (this.rnd() - 0.5), wander: 0 });
        if (k.isPlayer) hooks.se('shoot');
        consume(); break;
      }
      case 'ice':
        this._dropHazard(k, 'ice', k.x, k.z);
        if (k.isPlayer) { hooks.se('drop'); hooks.toast('こおりアイス!'); }
        consume(); break;
      case 'cushion':
        this._dropHazard(k, 'cushion', k.x - Math.cos(k.h) * 3.6, k.z - Math.sin(k.h) * 3.6);
        if (k.isPlayer) hooks.se('drop');
        consume(); break;
      case 'mirror':
        k.mirrorT = 10;
        if (k.isPlayer) { hooks.se('guard'); hooks.toast('はねかえしミラー!'); }
        consume(); break;
      case 'dizzy': {
        const targets = this._ahead(k, 220).filter(o => !this._invuln(o));
        for (const o of targets) { o.reverseT = 3.5; if (o.isPlayer) { hooks.toast('ハンドルがさかさま!'); hooks.vibrate(40); } }
        hooks.se('ink');
        if (k.isPlayer) hooks.toast('くるくるメガネ!');
        consume(); break;
      }
      case 'rod': {
        // 前のカートを釣り上げて自分の後ろに落とす(順位が入れ替わる)
        const o = this._ahead(k, 160).find(t => !this._invuln(t) && !t.ride);
        if (o) {
          this.burst(o.x, o.y + 1.5, o.z, { n: 30, hue: 0.55, speed: 8 });
          const pos = k.dist - 6;
          const [x, z] = this._posAlong(pos, -k.lat * 0.5);
          o.dist = pos; o.idx = ((Math.floor(pos) % this.track.N) + this.track.N) % this.track.N; o.prevIdx = o.idx;
          o.x = x; o.z = z; o.y = this.track.heightAlong(pos) + 3; o.air = true; o.vy = 0;
          o.h = this.track.samples[o.idx].angle; o.speed *= 0.4; o.spinT = Math.max(o.spinT, 0.6); o.drifting = false;
          this.burst(o.x, o.y, o.z, { n: 30, hue: 0.55, speed: 8 });
          if (o.isPlayer) { hooks.toast('つり上げられた!'); hooks.vibrate([40, 30, 40]); }
          if (k.isPlayer) hooks.toast(`${o.name}をつり上げた!`);
          hooks.se('item');
        }
        consume(); break;
      }
      case 'missile': case 'missile3': {
        const ahead = this.karts.filter(o => o !== k && !o.finished && o.dist > k.dist).sort((a, b) => a.dist - b.dist)[0];
        this._spawnProjectile('missile', k, 3, 62, ahead);
        if (k.isPlayer) hooks.se('shoot');
        consume(); break;
      }
      case 'bomb':
        this._spawnProjectile('bomb', k, -3, -42, null);
        if (k.isPlayer) hooks.se('shoot');
        consume(); break;
      case 'jelly': {
        const x = k.x - Math.cos(k.h) * 3, z = k.z - Math.sin(k.h) * 3;
        const mesh = makeItemMesh('jelly');
        const idx = tr.nearest(k.idx, x, z);
        mesh.position.set(x, tr.heightAt(idx, x, z) + 0.5, z);
        this.scene.add(mesh);
        this.hazards.push({ x, z, idx, lat: tr.lateral(idx, x, z), mesh, life: 30, owner: k, safeT: 0.8 });
        if (k.isPlayer) hooks.se('drop');
        consume(); break;
      }
    }
    k.guarding = false;
  }

  _spawnProjectile(type, owner, offset, speed, target) {
    const mesh = makeItemMesh(type);
    this.scene.add(mesh);
    this.projectiles.push({ type, owner, mesh, pos: owner.dist + offset, lat: owner.lat, speed, target, life: type === 'missile' ? 7 : type === 'topbomb' ? 20 : type === 'boomerang' ? 4 : 2.6, age: 0, x: owner.x, z: owner.z });
  }

  _posAlong(pos, lat) {
    const tr = this.track, N = tr.N;
    const f = Math.floor(pos), t = pos - f;
    const i = ((f % N) + N) % N, j = (i + 1) % N;
    const a = tr.samples[i], b = tr.samples[j];
    const nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
    return [a.x + (b.x - a.x) * t + nx * lat, a.z + (b.z - a.z) * t + nz * lat, Math.atan2(b.z - a.z, b.x - a.x)];
  }

  _updateProjectiles(dt) {
    const tr = this.track;
    for (const p of this.projectiles) {
      p.age += dt; p.life -= dt;
      p.pos += (p.speed * dt) / tr.spacing;
      if (p.type === 'missile' && p.target && !p.target.finished) {
        const gap = p.target.dist - p.pos;
        if (gap < 90) p.lat += clamp(p.target.lat - p.lat, -10 * dt, 10 * dt);
        if (gap < -6) p.target = null;
      }
      if (p.type === 'topbomb') { // 1位をコース沿いに追いかけ、追いついたら周りごと爆発
        const t = p.target;
        if (!t || t.finished) { p.life = 0; continue; }
        p.lat += clamp(t.lat - p.lat, -12 * dt, 12 * dt);
        if (p.pos >= t.dist - 1) {
          this.burst(t.x, t.y + 2, t.z, { n: 90, hue: 0.6, speed: 16 });
          this.hooks.se('boom');
          for (const o of this.karts) {
            if ((o.x - t.x) ** 2 + (o.z - t.z) ** 2 < 7.5 * 7.5 && !this._invuln(o)) { o.guarding = false; this._hit(o, 'bomb', p.owner); o.spinT = 1.6; }
          }
          if (t.isPlayer || p.owner.isPlayer) this.hooks.flash('rgba(120,170,255,.5)');
          p.life = 0; continue;
        }
      }
      if (p.type === 'boomerang' && !p.back && p.age > 1.1) { p.back = true; p.speed = -62; p.hitSet = new Set(); }
      if (p.type === 'boomerang' && p.back && p.pos <= p.owner.dist + 1) { p.life = 0; continue; }
      let x, z, a;
      if (p.free) { // 毛糸玉: 自由に転がって壁で跳ね返る
        p.x += p.vx * dt; p.z += p.vz * dt;
        p.idx = tr.nearest(p.idx, p.x, p.z);
        const s = tr.samples[p.idx], lat = tr.lateral(p.idx, p.x, p.z);
        if (Math.abs(lat) > WALL_OFF - 1) {
          const nx = s.nx * Math.sign(lat), nz = s.nz * Math.sign(lat), vn = p.vx * nx + p.vz * nz;
          if (vn > 0) { p.vx -= 2 * vn * nx; p.vz -= 2 * vn * nz; }
          p.x -= nx * (Math.abs(lat) - (WALL_OFF - 1)); p.z -= nz * (Math.abs(lat) - (WALL_OFF - 1));
        }
        // 少しずつコースの向きへ曲がる
        const sp = Math.hypot(p.vx, p.vz), ang = Math.atan2(p.vz, p.vx) + angDiff(s.angle, Math.atan2(p.vz, p.vx)) * Math.min(1, dt * 1.5);
        p.vx = Math.cos(ang) * sp; p.vz = Math.sin(ang) * sp;
        x = p.x; z = p.z; a = ang; p.pos = p.owner.dist + 0; p.pos = p.idx + Math.floor(p.owner.dist / tr.N) * tr.N;
      } else {
        [x, z, a] = this._posAlong(p.pos, p.lat);
      }
      p.x = x; p.z = z;
      p.mesh.position.set(x, (p.type === 'topbomb' ? 3 + Math.sin(p.age * 6) * 0.4 : 0.8 + (p.type === 'bomb' ? Math.abs(Math.sin(p.age * 8)) * 0.8 : 0)) + this._groundY(x, z, p.pos), z);
      p.mesh.rotation.y = -a + (p.speed < 0 ? Math.PI : 0);
      if (p.mesh.userData.spin) p.mesh.rotation.y += p.age * 18;
      if (p.mesh.userData.roll) p.mesh.rotation.z -= p.age * 6;
      for (const k of this.karts) {
        if (p.type === 'topbomb') break;
        if (k === p.owner && (p.age < 0.5 || p.type === 'boomerang')) continue;
        if (k.ride) continue;
        if ((k.x - x) ** 2 + (k.z - z) ** 2 < 2.4 * 2.4) {
          if (p.type === 'boomerang') { // 行きと帰りで1回ずつ当たり、そのまま飛び続ける
            p.hitSet ??= new Set();
            if (!p.hitSet.has(k)) { p.hitSet.add(k); this._hit(k, 'front', p.owner); }
            continue;
          }
          if (p.type === 'yarn') {
            if (this._invuln(k)) { p.life = 0; break; }
            if (this._reflect(k, p.owner)) { p.life = 0; break; }
            k.tangleT = 3.5; this.burst(k.x, k.y + 1, k.z, { n: 20, hue: 0.9, speed: 5 });
            if (k.isPlayer) { this.hooks.toast('毛糸がからまった!'); this.hooks.vibrate(40); }
            p.life = 0; break;
          }
          this._hit(k, p.pos < k.dist ? 'behind' : 'front', p.owner);
          p.life = 0; break;
        }
      }
      for (const hz of this.hazards) {
        const kind = hz.kind || 'jelly';
        if (kind !== 'jelly' && kind !== 'cushion') continue;
        const r = kind === 'cushion' ? 3 : 2.2;
        if ((hz.x - x) ** 2 + (hz.z - z) ** 2 < r * r) { hz.life = 0; p.life = 0; if (kind === 'cushion') this.burst(hz.x, hz.mesh.position.y + 1, hz.z, { n: 25, hue: 0.0, speed: 4 }); }
      }
      for (const o of this.track.obstacles) if ((o.x - x) ** 2 + (o.z - z) ** 2 < 2 * 2) p.life = 0;
    }
    this.projectiles = this.projectiles.filter(p => {
      if (p.life > 0) return true;
      this.scene.remove(p.mesh); return false;
    });
  }

  _updateHazards(dt) {
    const tr = this.track;
    for (const hz of this.hazards) {
      hz.life -= dt; hz.safeT -= dt;
      const kind = hz.kind || 'jelly';
      if (kind === 'jelly') hz.mesh.scale.y = 0.6 + Math.sin(this.time * 6 + hz.x) * 0.08;
      if (kind === 'firework') { // 不規則に走り回る
        hz.wander += (this.rnd() - 0.5) * dt * 14;
        hz.heading += hz.wander * dt;
        hz.x += Math.cos(hz.heading) * 16 * dt; hz.z += Math.sin(hz.heading) * 16 * dt;
        hz.idx = tr.nearest(hz.idx, hz.x, hz.z);
        const lat = tr.lateral(hz.idx, hz.x, hz.z), s = tr.samples[hz.idx];
        if (Math.abs(lat) > TRACK_WIDTH / 2) { hz.heading += Math.PI * 0.7; hz.x -= s.nx * Math.sign(lat) * 0.6; hz.z -= s.nz * Math.sign(lat) * 0.6; }
        hz.mesh.position.set(hz.x, tr.heightAt(hz.idx, hz.x, hz.z) + 0.4, hz.z);
        hz.mesh.rotation.y += dt * 20;
        if (this.rnd() < 0.7) this.fxAdd.spawn(hz.x, hz.mesh.position.y + 0.3, hz.z, (this.rnd() - 0.5) * 4, 2 + this.rnd() * 3, (this.rnd() - 0.5) * 4, 0.3, 0.35, 1, 0.5 + this.rnd() * 0.4, 0.2, -0.5, 8);
        if (hz.life <= 0) this.burst(hz.x, hz.mesh.position.y + 0.5, hz.z, { n: 40, rainbow: true, speed: 9 });
      }
      if (kind === 'ice') hz.mesh.children[0].material.opacity = Math.min(0.75, hz.life / 2);
      if (kind === 'cushion') continue;
      const R = { jelly: 2.0, stamp: 3.4, ice: 9, firework: 2.2 }[kind];
      for (const k of this.karts) {
        if (k.ride) continue;
        if (k === hz.owner && hz.safeT > 0) continue;
        if ((k.x - hz.x) ** 2 + (k.z - hz.z) ** 2 >= R * R) continue;
        if (kind === 'jelly') { this._hit(k, 'trap', hz.owner); hz.life = 0; break; }
        if (kind === 'firework') { // 弾き飛ばす
          if (this._invuln(k)) continue;
          if (this._reflect(k, hz.owner)) { hz.life = 0; break; }
          const dx = k.x - hz.x, dz = k.z - hz.z, d = Math.hypot(dx, dz) || 1;
          k.x += (dx / d) * 2; k.z += (dz / d) * 2; k.air = true; k.vy = 8; k.speed *= 0.5; k.spinT = Math.max(k.spinT, 0.5);
          this.burst(hz.x, hz.mesh.position.y + 0.5, hz.z, { n: 40, rainbow: true, speed: 9 });
          if (k.isPlayer) { this.hooks.se('boom'); this.hooks.vibrate(50); }
          hz.life = 0; break;
        }
        if (kind === 'stamp' && !this._invuln(k) && k.squashT <= 0) {
          k.squashT = 3;
          if (k.isPlayer) { this.hooks.toast('ぺたん!'); this.hooks.se('land'); this.hooks.vibrate(40); }
        }
        if (kind === 'ice' && !this._invuln(k)) k.slipT = Math.max(k.slipT, 0.5);
      }
    }
    this.hazards = this.hazards.filter(h => {
      if (h.life > 0) return true;
      this.scene.remove(h.mesh); return false;
    });
  }

  _updateBoxes(dt) {
    for (const b of this.boxes) {
      if (!b.active) {
        b.respawn -= dt;
        if (b.respawn <= 0) { b.active = true; b.mesh.visible = true; }
        continue;
      }
      b.mesh.rotation.y += dt * 1.6; b.mesh.rotation.x += dt * 0.9;
      b.mesh.position.y = b.y + 1.4 + Math.sin(this.time * 3 + b.lat) * 0.2;
      for (const k of this.karts) {
        if ((k.x - b.x) ** 2 + (k.z - b.z) ** 2 < 2.3 * 2.3) {
          b.active = false; b.mesh.visible = false; b.respawn = 2.5;
          this.burst(b.x, b.y + 1.4, b.z, { n: 26, rainbow: true, speed: 6 });
          if ((!k.item || !k.item2) && k.roulette <= 0) { k.roulette = k.isPlayer ? 1.3 : 0.9; }
          break;
        }
      }
    }
  }

  _hit(k, from, attacker) {
    const hooks = this.hooks;
    if (this._invuln(k) || (k.finished && !k.isPlayer) || k.ride) return;
    if (from !== 'lightning' && this._reflect(k, attacker)) return;
    if (k.guarding && (from === 'behind' || from === 'trap') && k.item) {
      this._consumeItem(k);
      k.guarding = false;
      if (k.isPlayer) { hooks.se('guard'); hooks.toast('ガード成功!'); hooks.vibrate(15); }
      return;
    }
    if (k.spinT > 0) return;
    k.spinT = 1.1; k.speed *= 0.25; k.drifting = false; k.driftLevel = 0; k.boostT = 0;
    const lost = Math.min(3, k.coins); k.coins -= lost; // ぶつけられるとコインを落とす
    if (lost) this.burst(k.x, k.y + 1.5, k.z, { n: 12 * lost, hue: 0.13, speed: 7 });
    this.burst(k.x, k.y + 1.2, k.z, { n: 40, hue: 0.12, speed: 9 });
    if (k.isPlayer) {
      hooks.se('hit'); hooks.flash('rgba(255,40,40,.45)'); hooks.vibrate([70, 40, 70]);
      hooks.toast(from === 'trap' ? 'トラップを踏んだ!' : 'ヒット!');
    } else if (attacker && attacker.isPlayer) {
      hooks.toast(`${k.name}にヒット!`);
    }
  }

  _groundY(x, z, pos) { return this.track.heightAlong(pos); }

  // 乗り物・ジャンプ台で運ぶ: to = 進むサンプル数、peak = 弧の高さ、latFn(t) = 横位置の軌道
  startRide(k, o) {
    if (k.ride) return;
    k.ride = { from: k.dist, to: k.dist + o.to, latFrom: k.lat, latTo: o.latTo ?? 0, latFn: o.latFn, t: 0, dur: o.dur, peak: o.peak, y0: k.y, kind: o.kind, exitable: !!o.exitable, spin: !!o.spin };
    k.drifting = false; k.air = false; k.vy = 0; k.guarding = false;
    if (k.isPlayer) { this.hooks.se('jump'); this.hooks.vibrate(30); }
  }

  _rideStep(k, dt) {
    const r = k.ride;
    r.t = Math.min(1, r.t + dt / r.dur);
    const pos = r.from + (r.to - r.from) * r.t;
    const lat = r.latFn ? r.latFn(r.t) : r.latFrom + (r.latTo - r.latFrom) * r.t;
    const [x, z, a] = this._posAlong(pos, lat);
    k.x = x; k.z = z; k.h = a;
    k.spinAngle = r.spin ? k.spinAngle + dt * 12 : 0;
    const gEnd = this.track.heightAlong(r.to);
    k.y = r.y0 + (gEnd - r.y0) * r.t + Math.sin(Math.PI * r.t) * r.peak;
    k.speed = Math.max(k.speed, 24);
    if (r.kind !== 'slide' && Math.random() < 0.4) this.fxAdd.spawn(k.x, k.y + 0.5, k.z, 0, -1, 0, 0.4, 0.6, 1, 0.9, 0.5, -1, 0);
    if (r.t >= 1) { k.ride = null; k.spinAngle = 0; k.air = true; k.vy = -2; }
  }

  // 落下などでコースに戻す(back サンプルぶん手前の中央に落とす)
  respawn(k, back = 8) {
    const tr = this.track, N = tr.N, pos = k.dist - back;
    const i = ((Math.floor(pos) % N) + N) % N;
    const [x, z] = this._posAlong(pos, 0);
    k.dist = pos; k.idx = i; k.prevIdx = i; k.x = x; k.z = z; k.h = tr.samples[i].angle; k.lat = 0;
    k.y = tr.heights[i] + 6; k.air = true; k.vy = 0; k.speed = 0; k.drifting = false; k.ride = null; k.boostT = 0;
    k.respawnT = 2.5; // 戻った直後はギミックの落下判定をしない
    this.burst(x, k.y, z, { n: 20, hue: 0.6, speed: 5 });
    if (k.isPlayer) { this.hooks.vibrate([60, 40, 60]); this.hooks.se('hit'); }
  }

  // はねかえしミラー: 攻撃を撃った相手に返す
  _reflect(k, attacker) {
    if (k.mirrorT <= 0 || !attacker || attacker === k) return false;
    k.mirrorT = 0;
    this.burst(k.x, k.y + 1.2, k.z, { n: 30, hue: 0.5, speed: 8 });
    if (k.isPlayer) { this.hooks.toast('はねかえした!'); this.hooks.se('guard'); }
    if (attacker.isPlayer) this.hooks.toast('はねかえされた!');
    if (attacker.mirrorT <= 0) this._hit(attacker, 'front', null);
    return true;
  }

  _invuln(k) { return k.starT > 0 || k.megaT > 0 || k.dashT > 0; }

  _collideKarts() {
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j];
      if (a.ride || b.ride) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      const R = 2.4 * Math.max(1, (a.scaleVis + b.scaleVis) / 2);
      if (d2 > R * R || d2 === 0) continue;
      const d = Math.sqrt(d2), push = (R - d) / 2;
      const nx = dx / d, nz = dz / d;
      a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
      if (this._invuln(a) && !this._invuln(b)) this._hit(b, 'front', a);
      else if (this._invuln(b) && !this._invuln(a)) this._hit(a, 'front', b);
      else if ((a.isPlayer || b.isPlayer) && this.state === 'race') this.hooks.vibrate(10);
    }
  }

  _rank() {
    const sorted = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.dist - a.dist;
    });
    sorted.forEach((k, i) => (k.rank = i));
  }

  _results() {
    const tr = this.track, total = this.laps * tr.N;
    const rows = this.karts.map(k => {
      let t = k.finishTime;
      if (!k.finished) {
        const remain = Math.max(0, total - k.dist) * tr.spacing;
        t = this.time + remain / (k.stats.maxSpeed * Math.max(0.8, k.aiFactor) * 0.93);
      }
      return { name: k.name, char: k.char, time: t, isPlayer: k.isPlayer };
    }).sort((a, b) => a.time - b.time);
    rows.forEach((r, i) => (r.rank = i));
    return { rows, playerRank: rows.findIndex(r => r.isPlayer), time: this.player.finishTime, ghostFrames: this.ghostFrames };
  }

  // ---------------- 描画 ----------------
  render(draw, dt) {
    const colorSet = SPARK_COLORS[this.settings.colorAssist ? 1 : 0];
    const cam = this.camera.position;
    const fa = this.fxAdd, fs = this.fxSmoke, R = Math.random;
    const col = new THREE.Color();
    for (const k of this.karts) {
      const m = k.mesh;
      const yaw = k.h + (k.drifting ? k.driftDir * 0.24 : 0) + k.spinAngle;
      m.root.position.set(k.x, k.y, k.z);
      // ビッグにゃんで巨大化、カミナリで小さく
      const wantScale = k.megaT > 0 ? 1.8 : k.slowT > 0 ? 0.55 : 1;
      k.scaleVis += (wantScale - k.scaleVis) * Math.min(1, dt * 6);
      m.root.scale.set(k.scaleVis, k.scaleVis * (k.squashT > 0 ? 0.45 : 1), k.scaleVis);
      m.root.rotation.y = -yaw;
      m.tilt.position.y = k.hopT > 0 ? Math.sin((k.hopT / 0.22) * Math.PI) * 0.55 : (k.offroad ? Math.sin(this.time * 40) * 0.05 : 0);
      m.tilt.rotation.x = k.drifting ? -k.driftDir * 0.07 : 0;
      k.steerVis = (k.steerVis || 0) + ((k.lastSteer || 0) - (k.steerVis || 0)) * Math.min(1, dt * 10);
      for (const w of m.wheels) w.rotation.z -= (k.speed * dt) / 0.44;
      for (const w of m.frontWheels) w.rotation.y = -k.steerVis * 0.45;
      // ドライバー: ハンドルに合わせて体を傾け、走行中は小さく弾む
      m.driver.rotation.x = -k.steerVis * 0.12;
      m.driver.position.y = -0.02 + Math.abs(Math.sin(this.time * 8 + k.id)) * 0.03 * Math.min(1, k.speed / 20);
      m.shield.visible = k.starT > 0 || k.mirrorT > 0;
      if (k.mirrorT > 0 && k.starT <= 0) m.shield.material.color.setHSL(0.55, 0.3, 0.75 + Math.sin(this.time * 10) * 0.1); else m.shield.material.color.setHex(0xffef7a);
      if (k.starT > 0) m.bodyMat.emissive.setHSL((this.time * 2) % 1, 1, 0.3);
      else m.bodyMat.emissive.setHex(0x000000);
      const boosting = k.boostT > 0 || k.dashT > 0;
      for (const f of m.flames) {
        f.visible = boosting;
        if (boosting) { const s = 0.8 + R() * 0.6; f.scale.set(s * (k.boostT > 0.6 ? 1.3 : 1), 1 + R() * 0.3, 1 + R() * 0.3); f.material.color.setHSL(0.08 + R() * 0.05, 1, 0.6); }
      }
      if (k.guarding !== m._guardShown || k.item !== m._heldType) {
        m.held.clear();
        if (k.guarding && k.item) m.held.add(makeItemMesh(k.item));
        m.held.visible = !!k.guarding;
        m._guardShown = k.guarding; m._heldType = k.item;
      }

      // ---- パーティクル(カメラ近くのカートだけ) ----
      if ((k.x - cam.x) ** 2 + (k.z - cam.z) ** 2 > 140 * 140) continue;
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const sv = k.scaleVis;
      const W = (lx, ly, lz) => [k.x + (c * lx - sn * lz) * sv, k.y + ly * sv, k.z + (sn * lx + c * lz) * sv];
      const back = [-c * k.speed * 0.15, -sn * k.speed * 0.15];
      const n = Math.min(3, Math.round(dt * 90));
      if (k.drifting) {
        for (const side of [-1, 1]) {
          const [x, y, z] = W(-0.95, 0.2, side * 0.95);
          if (k.driftLevel > 0) {
            col.setHex(colorSet[k.driftLevel - 1]);
            for (let i = 0; i < n + 1; i++) fa.spawn(x, y, z, back[0] + (R() - 0.5) * 6, 1 + R() * 3.5, back[1] + (R() - 0.5) * 6, 0.18 + R() * 0.2, 0.25 + R() * 0.35 + k.driftLevel * 0.08, col.r, col.g, col.b, -0.6, 14);
          }
          if (R() < 0.6) fs.spawn(x, k.y + 0.3, z, back[0] * 0.3 + (R() - 0.5), 0.6 + R(), back[1] * 0.3 + (R() - 0.5), 0.5 + R() * 0.3, 0.6, 0.9, 0.9, 0.92, 1.4, -0.3);
        }
      }
      if (boosting) {
        for (const side of [-1, 1]) {
          const [x, y, z] = W(-1.85, 0.72, side * 0.28);
          for (let i = 0; i < n; i++) fa.spawn(x, y, z, back[0] * 2 + (R() - 0.5) * 2, (R() - 0.3) * 1.5, back[1] * 2 + (R() - 0.5) * 2, 0.12 + R() * 0.12, 0.45 + R() * 0.3, 1, 0.45 + R() * 0.35, 0.1, -1.5, 0);
        }
      }
      if (k.isPlayer && this.state === 'countdown' && this.revving) {
        for (const side of [-1, 1]) { const [x, y, z] = W(-1.85, 0.72, side * 0.28); fs.spawn(x, y, z, back[0] - c * 3 + (R() - 0.5), 0.8 + R(), back[1] - sn * 3 + (R() - 0.5), 0.5, 0.5, 0.75, 0.75, 0.8, 1.6, -0.5); }
      }
      if (k.offroad && k.speed > 6 && R() < 0.7) {
        const [x, , z] = W(-1.1, 0.2, (R() - 0.5) * 2);
        fs.spawn(x, k.y + 0.3, z, back[0] * 0.4 + (R() - 0.5) * 2, 1 + R() * 1.5, back[1] * 0.4 + (R() - 0.5) * 2, 0.45 + R() * 0.3, 0.6, this.groundCol.r, this.groundCol.g, this.groundCol.b, 1.8, 1);
      }
      if ((k.starT > 0 || k.megaT > 0) && R() < 0.8) {
        col.setHSL(R(), 1, 0.6);
        fa.spawn(k.x + (R() - 0.5) * 3, k.y + 0.5 + R() * 2.5, k.z + (R() - 0.5) * 3, 0, 1.5, 0, 0.4, 0.35, col.r, col.g, col.b, -0.5, 0);
      }
    }
    for (const p of this.projectiles) {
      if (p.type === 'missile' && R() < 0.8) fa.spawn(p.x, this._groundY(p.x, p.z, p.pos) + 0.9, p.z, 0, 0.5, 0, 0.3, 0.5, 1, 0.35, 0.2, -1, 0);
      if (p.type === 'topbomb') fa.spawn(p.x, this._groundY(p.x, p.z, p.pos) + 3, p.z, 0, 0.5, 0, 0.4, 0.8, 0.3, 0.6, 1, -1, 0);
    }
    // カミナリの稲妻
    for (const b of this.bolts) {
      if (!b.mesh) {
        b.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 46, 6, 6), new THREE.MeshBasicMaterial({ color: 0xfff6a0 }));
        const pa = b.mesh.geometry.attributes.position;
        for (let k = 0; k < pa.count; k++) { const y = pa.getY(k); if (Math.abs(y) < 22) { pa.setX(k, pa.getX(k) + Math.sin(y * 0.7 + b.x) * 1.4); pa.setZ(k, pa.getZ(k) + Math.cos(y * 0.5 + b.z)); } }
        b.mesh.position.set(b.x, b.y + 23, b.z);
        this.scene.add(b.mesh);
        this.burst(b.x, b.y + 1, b.z, { n: 30, hue: 0.15, speed: 10 });
      }
      b.life -= dt;
      b.mesh.visible = Math.random() < 0.8;
    }
    this.bolts = this.bolts.filter(b => { if (b.life > 0) return true; this.scene.remove(b.mesh); b.mesh.geometry.dispose(); return false; });
    if (this.bursts) {
      for (const b of this.bursts) {
        for (let i = 0; i < b.n; i++) {
          col.setHSL(b.rainbow ? R() : b.hue + R() * 0.05, 1, 0.6);
          const a = R() * Math.PI * 2, sp = 3 + R() * b.speed;
          fa.spawn(b.x, b.y, b.z, Math.cos(a) * sp, 2 + R() * 6, Math.sin(a) * sp, 0.4 + R() * 0.4, 0.4 + R() * 0.4, col.r, col.g, col.b, -0.4, 9);
        }
      }
      this.bursts.length = 0;
    }
    fa.update(dt); fs.update(dt);
    if (this.pxScale) { fa.setScale(this.pxScale); fs.setScale(this.pxScale); }

    if (this.ghostMesh && this.ghost) {
      const f = this.ghost.frames;
      const t = Math.max(0, this.state === 'countdown' ? 0 : this.time) / 0.1;
      const i = Math.floor(t);
      if (i < f.length - 1) {
        const a = f[i], b = f[i + 1], u = t - i;
        this.ghostMesh.root.visible = true;
        const gx = a[0] + (b[0] - a[0]) * u, gz = a[1] + (b[1] - a[1]) * u;
        this._gIdx = this.track.nearest(this._gIdx ?? -1, gx, gz);
        this.ghostMesh.root.position.set(gx, this.track.heightAt(this._gIdx, gx, gz), gz);
        const gy = a[2] + angDiff(b[2], a[2]) * u;
        this.ghostMesh.root.rotation.y = -gy;
      } else if (i >= f.length - 1 && this.state !== 'countdown') this.ghostMesh.root.visible = false;
    }

    for (const b of this.boxes) if (b.active) b.mesh.children[0].rotation.y -= dt * 3;
    this._placeCamera(dt, false);
    const focus = this.mode === 'attract' ? this.karts[this.shotKart ?? 0] : this.player;
    this.env.follow(focus.x, focus.z);
    draw(this.scene, this.camera);
  }

  burst(x, y, z, opt = {}) {
    (this.bursts ||= []).push({ x, y, z, n: opt.n ?? 30, hue: opt.hue ?? 0.13, rainbow: !!opt.rainbow, speed: opt.speed ?? 8 });
  }

  // デモ(タイトル背景)用のカメラワーク。木や壁にめり込まないよう、高めの位置かコース内側からだけ撮る
  _cinematic(dt) {
    const cam = this.camera, tr = this.track;
    this.shotT = (this.shotT ?? 0) - dt;
    if (this.shotT <= 0) {
      this.shot = this.heroOnly ? 3 : ((this.shot ?? -1) + 1) % 4;
      this.shotT = 7 + this.rnd() * 3;
      const sorted = [...this.karts].sort((a, b) => b.dist - a.dist);
      this.shotKart = this.karts.indexOf(sorted[Math.floor(this.rnd() * 3)]);
      this.shotSide = this.rnd() < 0.5 ? -1 : 1;
      this.shotAge = 0;
      const k0 = this.karts[this.shotKart];
      this.cinH = k0.h;
      this.fixIdx = (k0.idx + 45) % tr.N; // コース脇カメラの設置位置(前方)
    }
    this.shotAge += dt;
    const k = this.karts[this.shotKart ?? 0];
    this.cinH = (this.cinH ?? k.h) + angDiff(k.h, this.cinH ?? k.h) * (1 - Math.exp(-dt * 2.5));
    const c = Math.cos(this.cinH), s = Math.sin(this.cinH);
    let px, py, pz, lx = k.x + c * 3, ly = 1.2 + k.y, lz = k.z + s * 3, fov = 50;
    if (this.shot === 3) { // 正面から: 先頭集団が手前に迫ってくる(コース上に置くので木にめり込まない)
      // ショットの間は撮るカートを固定(先頭が入れ替わってもカメラが飛ばない)
      if (this.heroKart == null || this.shotAge < 0.05) this.heroKart = [...this.karts].sort((a, b) => b.dist - a.dist)[0];
      const lead = this.heroKart;
      this.shotKart = this.karts.indexOf(lead);
      // 進み具合を小数まで求める(dist はサンプル単位の整数なので)
      const sm = tr.samples[lead.idx];
      const leadPos = lead.dist + ((lead.x - sm.x) * sm.tx + (lead.z - sm.z) * sm.tz) / tr.spacing;
      // コースの点に吸い付かせず、進み具合(小数)で連続的に動かす(カクつき防止)
      this.heroLat = (this.heroLat ?? 0) + (clamp(lead.lat * 0.4 + this.shotSide * 2.5, -5, 5) - (this.heroLat ?? 0)) * Math.min(1, dt * 2);
      const [hx, hz] = this._posAlong(leadPos + 5, this.heroLat);
      px = hx; py = 1.6 + tr.heightAlong(leadPos + 5); pz = hz;
      const [bx, bz] = this._posAlong(leadPos - 6, 0);
      lx = (lead.x * 2 + bx) / 3; ly = 1.4 + lead.y; lz = (lead.z * 2 + bz) / 3; fov = 58;
    } else if (this.shot === 0) { // 高めの追従
      px = k.x - c * 10; py = 5 + k.y; pz = k.z - s * 10;
    } else if (this.shot === 1) { // 上空をゆっくり回る
      const a = this.shotAge * 0.22 + this.shotSide;
      px = k.x + Math.cos(a) * 30; py = 17 + k.y; pz = k.z + Math.sin(a) * 30; lx = k.x; ly = 0.5 + k.y; lz = k.z; fov = 45;
    } else { // コースの内側に置いた固定カメラで通過を撮る
      const [fx, fz] = tr.off(this.fixIdx, this.shotSide * (TRACK_WIDTH / 2 + 2));
      px = fx; py = 3.2 + tr.heights[this.fixIdx]; pz = fz; lx = k.x; ly = 1.2 + k.y; lz = k.z; fov = 40;
      let d = this.fixIdx - k.idx; if (d < -tr.N / 2) d += tr.N; if (d > tr.N / 2) d -= tr.N;
      if (d < -14) this.shotT = 0; // 通り過ぎたら次のショットへ
    }
    const snap = this.shotAge < 0.05;
    const f = snap ? 1 : 1 - Math.exp(-dt * (this.shot === 2 || this.shot === 3 ? 20 : 5));
    this.camPos.lerp(new THREE.Vector3(px, py, pz), f);
    this.camLook.lerp(new THREE.Vector3(lx, ly, lz), snap ? 1 : 1 - Math.exp(-dt * 8));
    cam.position.copy(this.camPos); cam.lookAt(this.camLook);
    cam.fov = fov; cam.updateProjectionMatrix();
  }

  _placeCamera(dt, snap) {
    if (this.mode === 'attract') { if (snap) this.shotT = 0; return this._cinematic(snap ? 1 : dt); }
    const k = this.player, cam = this.camera;
    let intro = 0;
    if (this.state === 'countdown') intro = clamp((this.countdownT - 1.4) / (COUNTDOWN - 1.4), 0, 1);
    const ease = intro * intro * (3 - 2 * intro);
    const followH = k.h + (k.drifting ? k.driftDir * 0.08 : 0);
    if (snap) this.camH = followH;
    else this.camH += angDiff(followH, this.camH) * (1 - Math.exp(-dt * 5));
    const h = this.camH + ease * Math.PI;
    // 縦長画面では横の視野が狭くなるので、少し引いて高めから映す
    const portrait = cam.aspect < 1;
    const dist = (portrait ? 9.6 : 8) + ease * 4, height = (portrait ? 4.8 : 3.7) + ease * 1.2;
    const tx = k.x - Math.cos(h) * dist, tz = k.z - Math.sin(h) * dist;
    this.camY = snap ? k.y : this.camY + (k.y - this.camY) * (1 - Math.exp(-dt * 7));
    const desired = new THREE.Vector3(tx, height + this.camY, tz);
    const look = new THREE.Vector3(k.x + Math.cos(this.camH) * (4 - ease * 4), 1.5 + this.camY, k.z + Math.sin(this.camH) * (4 - ease * 4));
    if (snap) { this.camPos.copy(desired); this.camLook.copy(look); }
    else {
      const f = 1 - Math.exp(-dt * 14);
      this.camPos.lerp(desired, f); this.camLook.lerp(look, f);
    }
    cam.position.copy(this.camPos);
    if (k.spinT > 0.8) cam.position.y += (Math.random() - 0.5) * 0.15;
    cam.lookAt(this.camLook);
    const baseFov = portrait ? clamp((2 * Math.atan(Math.tan((36 * Math.PI) / 180) / cam.aspect) * 180) / Math.PI, 68, 92) : 68;
    const fov = baseFov + (k.boostT > 0 ? 10 : 0) + (k.starT > 0 ? 4 : 0);
    cam.fov += (fov - cam.fov) * (snap ? 1 : 1 - Math.exp(-dt * 6));
    cam.updateProjectionMatrix();
  }

  hudState() {
    const p = this.player;
    return {
      rank: p.rank + 1, total: this.karts.length,
      lap: clamp(p.lap, 1, this.laps), laps: this.laps,
      time: this.state === 'countdown' ? 0 : (p.finished ? p.finishTime : this.time),
      item: p.roulette > 0 && !p.item ? Object.values(ITEMS)[Math.floor(this.time * 14) % Object.keys(ITEMS).length].icon : p.item ? ITEMS[p.item].icon : '',
      item2: p.roulette > 0 && p.item ? Object.values(ITEMS)[Math.floor(this.time * 14) % Object.keys(ITEMS).length].icon : p.item2 ? ITEMS[p.item2].icon : '',
      count: p.itemCount, rolling: p.roulette > 0,
      driftLevel: p.drifting ? p.driftLevel : 0,
      speed: p.speed / p.stats.maxSpeed,
      boosting: p.boostT > 0,
      coins: p.coins, revving: this.state === 'countdown' && !!this.revving,
      guarding: p.guarding,
    };
  }

  dispose() {
    this.scene.traverse(o => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { m.map?.dispose(); m.dispose(); }
    });
  }
}

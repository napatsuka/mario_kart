import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Race, STEP } from './game.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Showroom, renderPortraits } from './showroom.js';
import { loadFigureAssets, buildFigure, assetUrl } from './figure.js';
import { generateCenterline } from './track.js';
import { CHARACTERS, BODY_COLORS, TIRES, CUPS, ALL_COURSES, CUP_POINTS, DIFFICULTY, THEMES } from './data.js';
import * as store from './storage.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = n => '#' + n.toString(16).padStart(6, '0');
const fmt = t => { if (!isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
const isTouch = matchMedia('(pointer: coarse)').matches;
const NOOP_HOOKS = { toast() {}, flash() {}, vibrate() {}, se() {}, countdown() {}, onFinish() {}, ink() {} };

let settings = store.loadSettings();
let profile = store.loadProfile();
if (!CHARACTERS.some(c => c.id === profile.character)) { profile.character = CHARACTERS[0].id; store.saveProfile(profile); }
const audio = new Audio();
audio.setVolumes(settings.bgm, settings.se);
const input = new Input($('#controls'));
input.apply(settings);

// ---------- レンダラー / ポストエフェクト ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const envMap = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

// 画質ティア: 3=最高 2=標準 1=軽量 0=省電力
let tier = settings.quality === 'high' ? 3 : settings.quality === 'low' ? 0 : 2;
const TIERS = [
  { pr: 0.75, bloom: false, shadows: false, shadowSize: 512, detail: false, msaa: 0 },
  { pr: 1.0, bloom: false, shadows: true, shadowSize: 1024, detail: false, msaa: 0 },
  { pr: 1.5, bloom: true, shadows: true, shadowSize: 1024, detail: true, msaa: 2 },
  { pr: 2.0, bloom: true, shadows: true, shadowSize: 2048, detail: true, msaa: 4 },
];
const gfx = () => ({ ...TIERS[tier], shadows: TIERS[tier].shadows });
let pixelRatio = Math.min(TIERS[tier].pr, devicePixelRatio || 1);

let composer = null, renderPass = null, bloomPass = null;
function buildComposer() {
  const t = TIERS[tier];
  composer?.dispose?.();
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: t.msaa });
  composer = new EffectComposer(renderer, rt);
  renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.38, 0.5, 1.0);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(pixelRatio);
  composer.setSize(innerWidth, innerHeight);
}
function draw(scene, camera) {
  if (TIERS[tier].bloom) {
    if (!composer) buildComposer();
    renderPass.scene = scene; renderPass.camera = camera;
    composer.render();
  } else renderer.render(scene, camera);
}
function pointScale() { return (innerHeight * pixelRatio) / (2 * Math.tan(((race?.camera.fov ?? 60) * Math.PI) / 360)); }

function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
  if (composer) { composer.dispose?.(); composer = null; } // サイズ変更時は作り直す
  const cam = race?.camera ?? bg?.obj.camera;
  if (cam) {
    cam.aspect = innerWidth / innerHeight;
    if (!race && bg?.kind === 'attract' && bgShift) cam.setViewOffset(innerWidth, innerHeight, -innerWidth * bgShift, 0, innerWidth, innerHeight);
    else if (!race && bg?.kind === 'attract') cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
  if (bg?.kind === 'showroom') bg.obj.resize(innerWidth, innerHeight);
  checkRotate();
}
addEventListener('resize', resize);

// ---------- 状態 ----------
let race = null;
let raceCtx = null;
let paused = false;
let lowPower = false;
let bg = null; // メニュー背景 { kind: 'attract' | 'showroom', obj }
let portraits = {};
navigator.getBattery?.().then(b => {
  const upd = () => (lowPower = !b.charging && b.level <= 0.2);
  upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd);
}).catch(() => {});

// タイトル/メニューの背景は晴れたコースで走らせる
const SUNNY = ALL_COURSES.filter(c => ['meadow', 'beach'].includes(c.theme));
// shift: メニューのパネルで隠れない右側にカメラ映像を寄せる量(画面幅比)
let bgShift = 0;
function setBackground(kind, hero = false, shift = 0) {
  bgShift = shift;
  if (bg?.kind === kind) { if (kind === 'attract' && bg.obj.heroOnly !== hero) { bg.obj.heroOnly = hero; bg.obj.shotT = 0; } resize(); return; }
  disposeBackground();
  if (kind === 'attract') {
    const course = SUNNY[Math.floor(Math.random() * SUNNY.length)];
    const obj = new Race({ course, mode: 'attract', settings: { ...settings, difficulty: 'hard' }, profile, cpuCount: 7, hooks: NOOP_HOOKS, envMap, gfx: gfx() });
    // デモは少し進めた状態から
    for (let i = 0; i < 60 * 6; i++) obj.update(STEP, { steer: 0, drift: false, itemReleased: false, itemHolding: false });
    obj.heroOnly = hero; obj.shotT = 0;
    bg = { kind, obj };
  } else if (kind === 'showroom') {
    const obj = new Showroom(envMap);
    obj.setKart(CHARACTERS.find(c => c.id === profile.character), profile.bodyColor);
    bg = { kind, obj };
  }
  resize();
}
function disposeBackground() {
  if (!bg) return;
  if (bg.kind === 'attract') bg.obj.dispose();
  bg = null;
}

// ---------- HUD ----------
const hud = {
  root: $('#hud'), rank: $('#hud .rank'), lap: $('#hud .lap'), mm: $('#hud canvas.mm'), toast: $('#hud .toast'),
  count: $('#hud .count'), drift: $('#hud .drift'), tutorial: $('#hud .tutorial'),
};
const mmCtx = hud.mm.getContext('2d');
let toastTimer = 0, countTimer = 0;
function toast(text) {
  hud.toast.textContent = text; hud.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => hud.toast.classList.remove('show'), 1400);
}
// スタート信号: n = 点いている赤ランプの数(1〜3)、'go' で全部緑、null で隠す
let signalTimer = 0;
function lights(n) {
  const el = $('#hud .signal');
  clearTimeout(signalTimer);
  if (n == null) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.classList.toggle('go', n === 'go');
  el.querySelectorAll('i').forEach((l, i) => l.classList.toggle('on', n !== 'go' && i < n));
  if (n === 'go') signalTimer = setTimeout(() => el.classList.add('hidden'), 1200);
}
function countdown(text) {
  hud.count.textContent = text;
  hud.count.classList.toggle('go', text === 'GO!' || text === 'ゴール!');
  hud.count.classList.remove('pop'); void hud.count.offsetWidth; hud.count.classList.add('pop');
  clearTimeout(countTimer); countTimer = setTimeout(() => (hud.count.textContent = ''), text === 'ゴール!' ? 2600 : 900);
}
function flash(color) {
  const f = $('#flash'); f.style.background = color; f.style.transition = 'none'; f.style.opacity = 1;
  requestAnimationFrame(() => { f.style.transition = 'opacity .45s'; f.style.opacity = 0; });
}
// まっくろスミ: 画面に墨のしみを出す
function ink(on) {
  const el = $('#ink');
  if (on) {
    el.innerHTML = Array.from({ length: 7 }, (_, i) => `<i style="left:${10 + ((i * 37) % 75)}%;top:${15 + ((i * 53) % 60)}%;width:${22 + (i % 3) * 10}vmin;height:${20 + (i % 4) * 8}vmin"></i>`).join('');
    el.classList.add('show');
  } else el.classList.remove('show');
}
function vibrate(p) { if (settings.vibration && navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) try { navigator.vibrate(p); } catch {} }
const SUFFIX = ['st', 'nd', 'rd'];
let lastHud = '';
function updateHud() {
  const s = race.hudState();
  const key = `${s.rank}|${s.lap}|${Math.floor(s.time * 20)}|${s.item}|${s.item2}|${s.count}|${s.driftLevel}|${s.guarding}|${s.coins}`;
  if (key !== lastHud) {
    lastHud = key;
    hud.rank.innerHTML = `${s.rank}<small>${SUFFIX[s.rank - 1] || 'th'}</small>`;
    hud.rank.dataset.rank = s.rank;
    hud.lap.innerHTML = `<span>LAP</span><b>${s.lap}/${s.laps}</b><i>${fmt(s.time)}</i>`;
    input.setItem(s.item, s.count, s.item2);
    const coinEl = $('#hud .coins'); coinEl.querySelector('b').textContent = s.coins; coinEl.classList.toggle('max', s.coins >= 10);
    const lvName = ['', 'Lv1 ミニ', 'Lv2 スーパー', 'Lv3 ウルトラ'];
    hud.drift.textContent = s.guarding ? '🛡 後ろにガード中' : s.driftLevel ? `ドリフト ${lvName[s.driftLevel]}` : '';
    hud.drift.classList.toggle('show', !!(s.guarding || s.driftLevel >= 1));
  }
  race.drawMinimap(mmCtx, hud.mm.width, hud.mm.height);
  audio.engineSet(s.revving ? 0.9 + Math.random() * 0.2 : Math.min(1.3, s.speed), s.boosting); // スタート前はエンジンをふかす
}

// ---------- メインループ(物理は60Hz固定、描画は30/60fps) ----------
let lastFrame = performance.now(), acc = 0, frameEMA = 33, slowT = 0, fastT = 0;
const IDLE_INPUT = { steer: 0, drift: false, itemReleased: false, itemHolding: false };
function loop(now) {
  requestAnimationFrame(loop);
  const target = (settings.fps60 && !lowPower) || !race ? 60 : 30;
  const interval = 1000 / target;
  if (now - lastFrame < interval - 3) return;
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  if (race) {
    if (paused) return;
    const inp = input.poll();
    acc += dt;
    let first = true;
    while (acc >= STEP) { race.update(STEP, first ? inp : { ...inp, itemReleased: false }); first = false; acc -= STEP; }
    race.pxScale = pointScale();
    race.render(draw, dt);
    updateHud();
  } else if (bg) {
    if (bg.kind === 'attract') {
      // デモ走行はフレームの経過時間ぶんだけ進めて、なめらかに動かす
      let left = dt;
      while (left > 1e-4) { const h = Math.min(left, 1 / 30); bg.obj.update(h, IDLE_INPUT); left -= h; }
      bg.obj.pxScale = pointScale();
      bg.obj.render(draw, dt);
    } else bg.obj.render(draw, dt);
  } else return;

  // 動的解像度 → それでも重ければブルームを切る
  frameEMA = frameEMA * 0.95 + dt * 1000 * 0.05;
  if (settings.quality === 'auto') {
    if (frameEMA > interval * 1.2) { slowT += dt; fastT = 0; } else if (frameEMA < interval * 1.05) { fastT += dt; slowT = 0; }
    if (slowT > 1.5) {
      slowT = 0;
      if (pixelRatio > 0.65) { pixelRatio = Math.max(0.6, pixelRatio - 0.1); resize(); }
      else if (tier > 1) { tier--; pixelRatio = Math.min(TIERS[tier].pr, 1); composer = null; resize(); }
    }
    if (fastT > 6 && pixelRatio < Math.min(TIERS[tier].pr, devicePixelRatio || 1)) { pixelRatio = Math.min(TIERS[tier].pr, pixelRatio + 0.1); fastT = 0; resize(); }
  }
}
requestAnimationFrame(loop);

// ---------- 中断・復帰 ----------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (race && !paused) showPause(); audio.pause(); }
  else if (!race) audio.resume();
});
addEventListener('pagehide', () => { if (race && !paused) showPause(); audio.pause(); });
navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (race && !paused) showPause('オーディオ機器が切り替わったため一時停止しました'); });

// 縦持ちでもそのまま遊べる(画面配置は CSS の縦向きレイアウト、カメラは Race 側で調整)
function checkRotate() {
  document.body.classList.toggle('portrait', innerHeight > innerWidth);
}

// ---------- メニュー ----------
const menu = $('#menu');
let screenName = 'title';
function setMenu(name, html, cls = '') {
  screenName = name;
  menu.className = 'scr-' + name + ' ' + cls;
  menu.innerHTML = html;
  menu.scrollTop = 0;
  const first = menu.querySelector('.nav.sel') || menu.querySelector('.nav');
  if (first && !isTouch) first.focus({ preventScroll: true });
}
const header = (title, back = 'main', color = '') => `
  <header class="mk-head ${color}">
    <button class="mk-back nav" data-go="${back}" aria-label="もどる">◀</button>
    <h2>${title}</h2>
    <div class="me-chip">${portraitImg(profile.character)}<span>${esc(profile.name)}</span></div>
  </header>`;
const portraitImg = id => portraits[id] ? `<img src="${portraits[id]}" alt="">` : `<span class="ph"></span>`;

menu.addEventListener('click', e => {
  const el = e.target.closest('[data-go],[data-act]');
  if (!el) { if (screenName === 'title') { audio.ensure(); audio.se('select'); screens.main(); } return; }
  audio.ensure(); audio.se('select');
  if (el.dataset.go) return screens[el.dataset.go](el.dataset.arg);
  actions[el.dataset.act]?.(el.dataset.arg, el);
});
menu.addEventListener('pointerover', e => { const n = e.target.closest('.nav'); if (n && !isTouch && document.activeElement !== n) n.focus({ preventScroll: true }); });
// キーボード/ゲームパッド風の十字キー操作
addEventListener('keydown', e => {
  if (race || !overlay.classList.contains('hidden')) return;
  if (screenName === 'title' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); return screens.main(); }
  const navs = [...menu.querySelectorAll('.nav')].filter(n => n.offsetParent);
  if (!navs.length) return;
  let i = navs.indexOf(document.activeElement);
  const k = e.code;
  if (['ArrowRight', 'ArrowDown'].includes(k)) i = (i + 1) % navs.length;
  else if (['ArrowLeft', 'ArrowUp'].includes(k)) i = (i - 1 + navs.length) % navs.length;
  else if (k === 'Escape' || k === 'Backspace') { const b = menu.querySelector('.mk-back'); if (b && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); b.click(); } return; }
  else return;
  e.preventDefault();
  navs[i].focus();
  navs[i].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  audio.ensure(); audio.se('roll');
});

let afterCharSelect = null;

const screens = {
  title() {
    setBackground('attract', true);
    startMenuBgm();
    const colors = ['#e8262f', '#3cb93c', '#ffc400', '#1d7cf2'];
    const confetti = Array.from({ length: 26 }, (_, i) => {
      const c = ['#ff4d6d', '#ffd23f', '#3ddc84', '#3a86ff', '#b56cff', '#ff9f1c'][i % 6];
      return `<i style="left:${(i * 37) % 100}%;background:${c};animation-delay:${-(i * 0.53) % 6}s;animation-duration:${4 + (i % 5)}s"></i>`;
    }).join('');
    setMenu('title', `
      <div class="confetti" aria-hidden="true">${confetti}</div>
      <div class="title-wrap">
        <h1 class="big-logo" aria-label="にゃりおカート">
          <span class="bl-top">${[...'にゃりお'].map((ch, i) => `<span style="--c:${colors[i]}">${ch}</span>`).join('')}</span>
          <span class="bl-bottom">カート</span>
        </h1>
        <div class="press-start nav" role="button" tabindex="0" data-go="main">タップしてスタート</div>
        <p class="legal">© にゃりおカート 試作版</p>
      </div>`);
  },

  main() {
    setBackground('attract', true, innerWidth > innerHeight ? 0.26 : 0.3);
    startMenuBgm();
    const cup = store.load('cup', null);
    const d = dailyInfo();
    const pill = (act, cls, icon, title, sub) => `
      <button class="pill-btn nav ${cls}" data-${act.startsWith('go:') ? 'go' : 'act'}="${act.replace('go:', '')}">
        <span class="pi-icon">${icon}</span><span class="pi-text"><b>${title}</b><small>${sub}</small></span>
      </button>`;
    setMenu('main', `
      <div class="mm-panel">
        <div class="mm-logo"><span class="mm-flag">🏁</span>${[...'にゃりお'].map((ch, i) => `<span style="--c:${['#ff3b3b', '#ffb000', '#ffd400', '#ff7a00'][i]}">${ch}</span>`).join('')}<span class="mm-kart">カート</span><span class="mm-star">⭐</span></div>
        <div class="mm-section"><span>シングルプレイ</span></div>
        <div class="mm-list">
          ${pill('go:cupFlow', 'p-gold', '🏆', 'グランプリ', cup ? 'つづきから再開できます' : 'カップ戦・3コース')}
          ${pill('go:timeattack', 'p-green', '⏱️', 'タイムアタック', 'ゴーストと競う')}
          ${pill('quick', 'p-cyan', '🏁', 'VSレース', 'CPU 7台と1レース')}
          ${pill('go:daily', 'p-pink', '📅', 'デイリー', d.cleared ? '本日クリア済み ✅' : `連続 ${d.streak} 日`)}
          ${pill('go:chars', 'p-purple', '🐾', 'キャラクター', 'キャラ・カート・タイヤ')}
          ${pill('go:online', 'p-blue', '🌐', 'オンライン', '準備中')}
        </div>
        <div class="mm-foot">
          <button class="mm-small nav" data-go="settings">⚙️ 設定</button>
          <button class="mm-small nav" data-go="title">◀ タイトル</button>
          <span class="mm-ver">v0.4</span>
        </div>
      </div>
      <div class="mm-hints" aria-hidden="true"><span><i class="ba">A</i>けってい</span><span><i class="bb">B</i>もどる</span></div>
      <div class="mm-player">${portraitImg(profile.character)}<span>${esc(profile.name)}</span></div>`);
  },

  cupFlow() {
    const cup = store.load('cup', null);
    if (cup) {
      showOverlay(`<h2>カップ戦</h2><p class="note">${esc(CUPS.find(c => c.id === cup.cupId)?.name || '')} の第${cup.raceIdx + 1}レースから再開できます。</p>
        <div class="ov-actions"><button class="btn primary" data-ov="resumeCup">▶ つづきから</button><button class="btn" data-ov="newCup">はじめから</button></div>`);
      return;
    }
    afterCharSelect = () => screens.cups();
    screens.chars();
  },

  chars() {
    setBackground('showroom');
    const ch = CHARACTERS.find(c => c.id === profile.character) || CHARACTERS[0];
    const tire = TIRES.find(t => t.id === profile.tire) || TIRES[0];
    const st = (k, max) => Math.max(1, Math.min(max, ch[k] + tire[k]));
    const bar = (label, v, max) => `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${(v / max) * 100}%"></i></div></div>`;
    setMenu('chars', `
      ${header('キャラクター', afterCharSelect ? 'main' : 'main', 'h-blue')}
      <div class="cs-panel">
        <div class="cs-grid">${CHARACTERS.map(c => `
          <button class="cs-tile nav ${c.id === ch.id ? 'sel' : ''}" data-act="pickChar" data-arg="${c.id}" style="--tc:${hex(c.fur)}">
            ${portraitImg(c.id)}<span>${esc(c.name)}</span>
          </button>`).join('')}</div>
        <div class="cs-info">
          <h3>${esc(ch.name)} <small>${esc(ch.animal)}</small></h3>
          <p>${esc(ch.desc)}</p>
          ${bar('スピード', st('speed', 6), 6)}${bar('加速', st('accel', 6), 6)}${bar('曲がり', st('handling', 7), 7)}
          <div class="cs-row"><label>カート</label><div class="swatches">${BODY_COLORS.map(c => `<button class="sw nav ${c === profile.bodyColor ? 'sel' : ''}" style="background:${hex(c)}" data-act="pickColor" data-arg="${c}" aria-label="カートの色"></button>`).join('')}</div></div>
          <div class="cs-row"><label>タイヤ</label><div class="seg">${TIRES.map(t => `<button class="nav ${t.id === profile.tire ? 'on' : ''}" data-act="pickTire" data-arg="${t.id}">${t.name}</button>`).join('')}</div></div>
          <div class="cs-row"><label>なまえ</label><input type="text" id="pname" maxlength="10" value="${esc(profile.name)}"></div>
        </div>
      </div>
      <button class="ok-btn nav" data-act="charOk">決定!</button>`);
    $('#pname').addEventListener('change', e => { profile.name = e.target.value.trim().slice(0, 10) || 'プレイヤー'; store.saveProfile(profile); });
  },

  cups(sel) {
    setBackground('attract');
    const cur = CUPS.find(c => c.id === sel) || CUPS[0];
    setMenu('cups', `
      ${header('カップをえらぶ', 'main', 'h-orange')}
      <div class="cup-layout">
        <div class="cup-grid">${CUPS.map((c, i) => `
          <button class="cup-tile nav cup-${i} ${c.id === cur.id ? 'sel' : ''}" data-go="cups" data-arg="${c.id}">
            <span class="cup-ico">${['🌰', '⭐', '⚡', '👑'][i]}</span><b>${esc(c.name)}</b>
            <em>${trophy(store.load('trophy_' + c.id, null))}</em>
          </button>`).join('')}</div>
        <div class="course-list">
          ${cur.courses.map((c, i) => `<div class="course-row"><canvas class="thumb" data-seed="${c.seed}" data-diff="${c.diff}" data-theme="${c.theme}" width="120" height="84"></canvas><div><small>コース ${i + 1}・${THEMES[c.theme].name}</small><b>${esc(c.name)}</b></div></div>`).join('')}
          <div class="cs-row"><label>CPUの強さ</label>${seg('difficulty', Object.entries(DIFFICULTY).map(([k, v]) => [k, v.name]))}</div>
          <button class="ok-btn inline nav" data-act="startCup" data-arg="${cur.id}">このカップで出発!</button>
        </div>
      </div>`);
    drawThumbs();
  },

  timeattack() {
    setBackground('attract');
    setMenu('ta', `
      ${header('タイムアタック', 'main', 'h-blue')}
      <p class="mk-note">ロケット×3でスタート。自己ベストはゴーストとして保存され、次回いっしょに走ります。</p>
      <div class="course-grid">${ALL_COURSES.map(c => {
        const best = store.load('best_' + c.id, null);
        return `<button class="course-tile nav" data-go="taCourse" data-arg="${c.id}"><canvas class="thumb" data-seed="${c.seed}" data-diff="${c.diff}" data-theme="${c.theme}" width="120" height="84"></canvas><b>${esc(c.name)}</b><small>${best ? '🏁 ' + fmt(best) : '記録なし'}</small></button>`;
      }).join('')}</div>`);
    drawThumbs();
  },

  taCourse(id) {
    const c = ALL_COURSES.find(x => x.id === id);
    const ghost = store.load('ghost_' + id, null);
    setMenu('ta', `
      ${header(esc(c.name), 'timeattack', 'h-blue')}
      <div class="glass">
        <h3>自己ベスト: ${ghost ? fmt(ghost.time) : '記録なし'}</h3>
        <div class="actions">
          <button class="btn primary nav" data-act="startTA" data-arg="${id}">⏱️ スタート${ghost ? '(ゴーストあり)' : ''}</button>
          ${ghost ? `<button class="btn nav" data-act="copyGhost" data-arg="${id}">📤 ゴーストを共有</button>` : ''}
        </div>
      </div>
      <div class="glass">
        <h3>フレンドのゴーストと対決(非同期対戦)</h3>
        <p class="note">フレンドから受け取った共有コードを貼り付けると、そのゴーストと走れます。</p>
        <textarea id="ghostCode" placeholder="PKR1:... で始まるコード"></textarea>
        <div class="actions"><button class="btn nav" data-act="startFriendGhost" data-arg="${id}">👻 ゴーストと対決</button></div>
      </div>`);
  },

  daily() {
    setBackground('attract');
    const d = dailyInfo();
    setMenu('daily', `
      ${header('デイリーチャレンジ', 'main', 'h-green')}
      <div class="glass center">
        <h3>${store.todayKey()} の課題</h3>
        <canvas class="thumb big" data-seed="${d.course.seed}" data-diff="${d.course.diff}" data-theme="${d.course.theme}" width="240" height="160"></canvas>
        <h3>${esc(d.course.name)}</h3>
        <p class="goal">${d.type === 'time' ? `目標タイム ${fmt(d.par)} 以内でゴール<br><small>(ロケット×3を所持、CPUなし)</small>` : '「むずかしい」CPU相手に3位以内でゴール'}</p>
        <p>連続クリア: <b>${d.streak}</b>日 ${d.cleared ? '/ 本日クリア済み ✅' : ''}</p>
        <button class="ok-btn inline nav" data-act="startDaily">挑戦する!</button>
      </div>`);
    drawThumbs();
  },

  online() {
    setBackground('attract');
    setMenu('online', `
      ${header('オンライン対戦', 'main', 'h-purple')}
      <div class="glass">
        <h3>🌐 準備中</h3>
        <p class="note">オンライン対戦(最大8人の自動マッチング、ルームコード/招待リンクでのフレンド対戦)には、サーバー権威型の対戦サーバーが必要です。この試作版はクライアントのみのため、まだ遊べません。切断時はCPUが代わりに走って復帰できる仕組みを、サーバー実装と合わせて組み込む予定です。</p>
        <p class="note">今すぐフレンドと遊ぶなら、通信ほぼ不要の<b>非同期対戦(ゴースト共有)</b>をどうぞ。</p>
        <button class="btn nav" data-go="timeattack">👻 ゴースト対戦へ</button>
      </div>`);
  },

  settings() {
    setBackground('attract');
    setMenu('settings', `
      ${header('設定', 'main', 'h-gray')}
      <div class="settings-cols">
      <div class="glass"><h3>操作</h3>
        <div class="row"><label>操作方式</label>${seg('control', [['buttons', 'ボタン'], ['tilt', '傾き'], ['stick', 'スティック']])}</div>
        <div class="row"><label>左利きモード<small>左右のボタン配置を反転</small></label>${toggle('lefty')}</div>
        <div class="row"><label>ボタンの大きさ</label>${seg('buttonSize', [[0.8, '小'], [1, '中'], [1.25, '大']])}</div>
        <div class="row"><label>ボタンの透明度</label><input type="range" min="0.2" max="0.9" step="0.05" value="${settings.buttonOpacity}" data-range="buttonOpacity"></div>
      </div>
      <div class="glass"><h3>アシスト</h3>
        <div class="row"><label>スマートステア<small>コースアウトしにくくなる</small></label>${toggle('smartSteer')}</div>
        <div class="row"><label>オートドリフト<small>大きく曲がると自動でドリフト</small></label>${toggle('autoDrift')}</div>
        <div class="row"><label>CPUの強さ</label>${seg('difficulty', Object.entries(DIFFICULTY).map(([k, v]) => [k, v.name]))}</div>
      </div>
      <div class="glass"><h3>サウンド・振動</h3>
        <div class="row"><label>BGM</label><input type="range" min="0" max="1" step="0.05" value="${settings.bgm}" data-range="bgm"></div>
        <div class="row"><label>効果音</label><input type="range" min="0" max="1" step="0.05" value="${settings.se}" data-range="se"></div>
        <div class="row"><label>振動<small>対応端末のみ</small></label>${toggle('vibration')}</div>
      </div>
      <div class="glass"><h3>表示・パフォーマンス</h3>
        <div class="row"><label>画質</label>${seg('quality', [['auto', '自動'], ['low', '省電力'], ['high', '最高']])}</div>
        <div class="row"><label>60fpsモード<small>上位端末向け。電池20%以下では30fps</small></label>${toggle('fps60')}</div>
        <div class="row"><label>色覚サポート<small>火花の色を区別しやすく+文字表示</small></label>${toggle('colorAssist')}</div>
      </div>
      <div class="glass"><h3>データ</h3>
        <p class="note">セーブデータはこの端末のブラウザに保存されます(クラウドセーブはストア版で Apple/Google アカウント連携予定)。</p>
        <button class="btn nav" data-act="resetData">🗑 データを初期化</button>
      </div>
      </div>`);
    menu.querySelectorAll('[data-range]').forEach(r => r.addEventListener('input', () => { settings[r.dataset.range] = +r.value; applySettings(); }));
  },
};

function seg(key, opts) {
  return `<div class="seg">${opts.map(([v, l]) => `<button class="nav ${String(settings[key]) === String(v) ? 'on' : ''}" data-act="set" data-arg="${key}:${v}">${l}</button>`).join('')}</div>`;
}
function toggle(key) { return `<button class="toggle nav ${settings[key] ? 'on' : ''}" data-act="toggle" data-arg="${key}" aria-label="切り替え" aria-pressed="${!!settings[key]}"></button>`; }
function trophy(t) { return t === 0 ? '🥇' : t === 1 ? '🥈' : t === 2 ? '🥉' : t != null ? '完走' : ''; }

// コースのミニマップ風サムネイル
function drawThumbs() {
  menu.querySelectorAll('canvas.thumb').forEach(cv => {
    const th = THEMES[cv.dataset.theme];
    const { pts } = generateCenterline(+cv.dataset.seed, +(cv.dataset.diff || 0));
    const c = cv.getContext('2d'), W = cv.width, H = cv.height;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, hex(th.skyTop)); g.addColorStop(1, hex(th.ground));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const sc = Math.min((W - 16) / (maxX - minX), (H - 16) / (maxZ - minZ));
    const ox = (W - (maxX - minX) * sc) / 2, oz = (H - (maxZ - minZ) * sc) / 2;
    c.beginPath();
    pts.forEach(([x, z], i) => { const a = ox + (x - minX) * sc, b = oz + (z - minZ) * sc; i ? c.lineTo(a, b) : c.moveTo(a, b); });
    c.closePath();
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = W / 16; c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = W / 30; c.stroke();
  });
}

function applySettings() {
  store.saveSettings(settings);
  audio.setVolumes(settings.bgm, settings.se);
  input.apply(settings);
  const newTier = settings.quality === 'high' ? 3 : settings.quality === 'low' ? 0 : 2;
  if (newTier !== tier) { tier = newTier; pixelRatio = Math.min(TIERS[tier].pr, devicePixelRatio || 1); composer = null; }
  resize();
}

function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function dailyInfo() {
  const key = store.todayKey();
  const h = hashStr('daily' + key);
  const course = ALL_COURSES[h % ALL_COURSES.length];
  const type = (h >> 8) % 2 ? 'time' : 'rank';
  const rec = store.load('daily', { last: null, streak: 0 });
  const y = new Date(); y.setDate(y.getDate() - 1);
  const streak = rec.last === key || rec.last === store.todayKey(y) ? rec.streak : 0;
  return { key, course, type, par: 104, cleared: rec.last === key, streak, rec };
}

function startMenuBgm() {
  audio.playMusic('menu');
}

const actions = {
  quick() {
    const c = ALL_COURSES[Math.floor(Math.random() * 6)];
    startRace({ mode: 'quick', course: c });
  },
  charOk() {
    const next = afterCharSelect;
    afterCharSelect = null;
    next ? next() : screens.main();
  },
  startCup(id) {
    const cupState = { cupId: id, raceIdx: 0, points: {} };
    store.save('cup', cupState);
    startCupRace(cupState);
  },
  startTA(id) {
    const c = ALL_COURSES.find(x => x.id === id);
    startRace({ mode: 'ta', course: c, ghost: store.load('ghost_' + id, null) });
  },
  async copyGhost(id) {
    const g = store.load('ghost_' + id, null); if (!g) return;
    const code = store.encodeGhost(g);
    try { await navigator.clipboard.writeText(code); alertBox('共有コードをコピーしました', 'フレンドに送ると、あなたのゴーストと対決できます。'); }
    catch { showOverlay(`<h2>共有コード</h2><textarea readonly>${esc(code)}</textarea><button class="btn" data-ov="close">OK</button>`); }
  },
  startFriendGhost(id) {
    const g = store.decodeGhost($('#ghostCode').value);
    if (!g) return alertBox('コードが読み込めません', 'PKR1: で始まる共有コードを貼り付けてください。');
    const c = ALL_COURSES.find(x => x.id === g.course);
    if (!c) return alertBox('コースが見つかりません', '');
    startRace({ mode: 'ghost', course: c, ghost: g });
  },
  startDaily() {
    const d = dailyInfo();
    startRace({ mode: d.type === 'time' ? 'daily-time' : 'daily-rank', course: d.course, daily: d });
  },
  pickChar(id) {
    profile.character = id; store.saveProfile(profile);
    bg?.obj.setKart?.(CHARACTERS.find(c => c.id === id), profile.bodyColor);
    screens.chars();
  },
  pickColor(c) { profile.bodyColor = +c; store.saveProfile(profile); bg?.obj.setKart?.(CHARACTERS.find(x => x.id === profile.character), profile.bodyColor); screens.chars(); },
  pickTire(id) { profile.tire = id; store.saveProfile(profile); screens.chars(); },
  async set(arg) {
    const [k, v] = arg.split(':');
    settings[k] = isNaN(+v) ? v : +v;
    if (k === 'control' && v === 'tilt') {
      const ok = await Input.requestTiltPermission();
      if (!ok) { settings.control = 'buttons'; alertBox('傾き操作が使えません', 'この端末/ブラウザではモーションセンサーを利用できないか、許可されませんでした。'); }
    }
    applySettings();
    const focusArg = arg;
    screenName === 'cups' ? screens.cups(menu.querySelector('.cup-tile.sel')?.dataset.arg) : screens.settings();
    menu.querySelector(`[data-arg="${focusArg}"]`)?.focus({ preventScroll: true });
  },
  toggle(k, el) { settings[k] = !settings[k]; el.classList.toggle('on', settings[k]); el.setAttribute('aria-pressed', settings[k]); applySettings(); },
  resetData() {
    if (!confirm('記録・ゴースト・設定をすべて消去します。よろしいですか?')) return;
    try { Object.keys(localStorage).filter(k => k.startsWith('pkr_')).forEach(k => localStorage.removeItem(k)); } catch {}
    settings = store.loadSettings(); profile = store.loadProfile(); applySettings(); screens.title();
  },
};

// ---------- オーバーレイ ----------
const overlay = $('#overlay');
function showOverlay(html) { overlay.innerHTML = `<div class="panel">${html}</div>`; overlay.classList.remove('hidden'); overlay.querySelector('.btn')?.focus({ preventScroll: true }); }
function hideOverlay() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
function alertBox(title, body) { showOverlay(`<h2>${esc(title)}</h2><p class="note">${esc(body)}</p><button class="btn" data-ov="close">OK</button>`); }
overlay.addEventListener('click', e => {
  const b = e.target.closest('[data-ov]'); if (!b) return;
  audio.ensure(); audio.se('select');
  ({
    close: hideOverlay,
    resume: resumeRace,
    restart: () => { hideOverlay(); const ctx = raceCtx; endRace(); startRace(ctx); },
    quit: () => { hideOverlay(); endRace(); screens.main(); },
    next: () => { hideOverlay(); nextAfterResult(); },
    retry: () => { hideOverlay(); const ctx = raceCtx; endRace(); startRace({ ...ctx, ghost: ctx.mode === 'ta' ? store.load('ghost_' + ctx.course.id, null) : ctx.ghost }); },
    menu: () => { hideOverlay(); endRace(); screens.main(); },
    resumeCup: () => { hideOverlay(); const s = store.load('cup', null); if (s) startCupRace(s); },
    newCup: () => { hideOverlay(); store.save('cup', null); afterCharSelect = () => screens.cups(); screens.chars(); },
  })[b.dataset.ov]?.();
});
addEventListener('keydown', e => {
  if (overlay.classList.contains('hidden')) return;
  const btns = [...overlay.querySelectorAll('.btn')];
  let i = btns.indexOf(document.activeElement);
  if (['ArrowDown', 'ArrowRight'].includes(e.code)) { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
  if (['ArrowUp', 'ArrowLeft'].includes(e.code)) { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
});

function showPause(reason) {
  if (!race || paused) return;
  paused = true; input.reset(); audio.pause();
  showOverlay(`<h2>一時停止</h2>${reason ? `<p class="note">${esc(reason)}</p>` : ''}
    <button class="btn primary" data-ov="resume">▶ 再開</button>
    <button class="btn" data-ov="restart">↻ やり直す</button>
    <button class="btn" data-ov="quit">⌂ メニューへ${raceCtx?.cupState ? '(カップの進行は保存済み)' : ''}</button>`);
}
function resumeRace() {
  hideOverlay(); paused = false; audio.ensure(); audio.resume(); lastFrame = performance.now(); acc = 0;
}
$('#hud .pause').addEventListener('click', () => showPause());
addEventListener('keydown', e => { if (race && !paused && e.code === 'Escape') showPause(); });

// ---------- レース開始/終了 ----------
function startCupRace(cupState) {
  const cup = CUPS.find(c => c.id === cupState.cupId);
  startRace({ mode: 'cup', course: cup.courses[cupState.raceIdx], cup, cupState });
}

async function startRace(ctx) {
  audio.ensure();
  if (settings.control === 'tilt') await Input.requestTiltPermission();
  if (isTouch) {
    try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch {}
  }
  disposeBackground();
  audio.stopMusic();
  raceCtx = ctx;
  const raceSettings = { ...settings };
  if (ctx.mode === 'daily-rank') raceSettings.difficulty = 'hard';
  const solo = ctx.mode === 'ta' || ctx.mode === 'ghost' || ctx.mode === 'daily-time';
  race = new Race({
    course: ctx.course, mode: ctx.mode, settings: raceSettings, profile, ghost: ctx.ghost || null,
    cpuCount: solo ? 0 : 7, laps: 2, envMap, gfx: gfx(),
    hooks: { toast, flash, vibrate, se: n => audio.se(n), countdown, onFinish: onRaceFinish, ink, lights },
  });
  menu.classList.add('hidden');
  hud.root.classList.remove('hidden');
  $('#controls').classList.remove('hidden');
  input.apply(settings); input.reset(); input.enabled = true;
  lights(0);
  paused = false; acc = 0; lastFrame = performance.now(); lastHud = '';
  resize();
  audio.playMusic('race');
  audio.engineStart();
  if (ctx.ghost && ctx.mode === 'ghost') setTimeout(() => toast(`${ctx.ghost.name} のゴーストと対決!`), 200);
  else toast(ctx.course.name);
  if (!settings.tutorialSeen) {
    const steerHint = { buttons: '左下の ◀ ▶ で曲がる', tilt: 'スマホを傾けて曲がる', stick: '左側をなぞって曲がる' }[settings.control];
    hud.tutorial.innerHTML = `アクセルは自動!<br>${steerHint}<br>右側を長押ししながら曲がると<b>ドリフト</b>→離して加速<br>右下のボタンで<b>アイテム</b>(長押しで後ろにガード)<br>2つ目のランプが点いたらドリフトを押し続けて<b>ロケットスタート</b>`;
    hud.tutorial.classList.remove('hidden'); hud.tutorial.style.opacity = 1;
    setTimeout(() => { hud.tutorial.style.opacity = 0; setTimeout(() => hud.tutorial.classList.add('hidden'), 500); }, 6500);
    settings.tutorialSeen = true; store.saveSettings(settings);
  } else hud.tutorial.classList.add('hidden');
}

function endRace() {
  if (race) { race.dispose(); race = null; }
  paused = false;
  audio.stopMusic(); audio.engineStop(); audio.resume();
  hud.root.classList.add('hidden');
  $('#controls').classList.add('hidden');
  ink(false); lights(null);
  menu.classList.remove('hidden');
  input.enabled = false;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function onRaceFinish(res) {
  audio.engineStop();
  const ctx = raceCtx;
  const table = rows => `<table class="res">${rows.map(r => `<tr class="${r.isPlayer ? 'me' : ''}"><td class="r">${r.rank + 1}</td><td class="pi">${portraitImg(r.char.id)}</td><td>${esc(r.name)}</td><td class="t">${fmt(r.time)}</td>${r.pts != null ? `<td class="t">+${r.pts}</td>` : ''}</tr>`).join('')}</table>`;

  if (ctx.mode === 'cup') {
    const st = ctx.cupState;
    res.rows.forEach((r, i) => { r.pts = CUP_POINTS[i] || 0; st.points[r.name] = (st.points[r.name] || 0) + r.pts; });
    st.charOf = st.charOf || {};
    res.rows.forEach(r => (st.charOf[r.name] = r.char.id));
    st.raceIdx++;
    const done = st.raceIdx >= ctx.cup.courses.length;
    store.save('cup', done ? null : st);
    showOverlay(`<h2>${esc(ctx.course.name)} 結果</h2><div class="big-result">${res.playerRank + 1}位</div>${table(res.rows)}
      <div class="ov-actions"><button class="btn primary" data-ov="next">${done ? '総合結果へ' : '次のレースへ ▶'}</button>
      <button class="btn" data-ov="menu">メニューへ(進行は保存済み)</button></div>`);
    return;
  }

  if (ctx.mode === 'ta' || ctx.mode === 'ghost' || ctx.mode === 'daily-time') {
    const t = res.time;
    let extra = '';
    if (ctx.mode !== 'daily-time') {
      const prev = store.load('best_' + ctx.course.id, null);
      if (!prev || t < prev) {
        store.save('best_' + ctx.course.id, t);
        store.save('ghost_' + ctx.course.id, { course: ctx.course.id, time: t, name: profile.name, character: profile.character, bodyColor: profile.bodyColor, frames: res.ghostFrames });
        extra = '<p class="hi">🎉 自己ベスト更新!ゴーストを保存しました</p>';
      } else extra = `<p class="note">自己ベスト ${fmt(prev)}</p>`;
      if (ctx.mode === 'ghost') extra += `<p class="note">${esc(ctx.ghost.name)} のタイム ${fmt(ctx.ghost.time)} → ${t < ctx.ghost.time ? '勝ち!🎉' : '負け…'}</p>`;
    } else extra = dailyResult(t <= ctx.daily.par, `目標 ${fmt(ctx.daily.par)}`);
    showOverlay(`<h2>${esc(ctx.course.name)}</h2><div class="big-result">${fmt(t)}</div>${extra}
      <div class="ov-actions"><button class="btn primary" data-ov="retry">↻ もう一度</button><button class="btn" data-ov="menu">メニューへ</button></div>`);
    return;
  }

  let extra = '';
  if (ctx.mode === 'daily-rank') extra = dailyResult(res.playerRank <= 2, '3位以内');
  showOverlay(`<h2>${esc(ctx.course.name)} 結果</h2><div class="big-result">${res.playerRank + 1}位</div>${extra}${table(res.rows)}
    <div class="ov-actions"><button class="btn primary" data-ov="retry">↻ もう一度</button><button class="btn" data-ov="menu">メニューへ</button></div>`);
}

function dailyResult(ok, goal) {
  if (!ok) return `<p class="note"><b>課題未達成(${goal})。また挑戦しよう!</b></p>`;
  const d = dailyInfo();
  if (!d.cleared) store.save('daily', { last: d.key, streak: d.streak + 1 });
  return `<p class="hi">✅ デイリーチャレンジ達成!連続 ${d.cleared ? d.streak : d.streak + 1} 日</p>`;
}

function nextAfterResult() {
  const ctx = raceCtx;
  const st = ctx.cupState;
  if (st.raceIdx < ctx.cup.courses.length) { endRace(); startCupRace(st); return; }
  const ranking = Object.entries(st.points).sort((a, b) => b[1] - a[1]);
  const myRank = ranking.findIndex(([n]) => n === profile.name);
  const prevT = store.load('trophy_' + ctx.cup.id, null);
  if (prevT == null || myRank < prevT) store.save('trophy_' + ctx.cup.id, myRank);
  showOverlay(`<h2>${esc(ctx.cup.name)} 総合結果</h2><div class="big-result">${trophy(myRank) || ''} ${myRank + 1}位</div>
    <table class="res">${ranking.map(([n, p], i) => `<tr class="${n === profile.name ? 'me' : ''}"><td class="r">${i + 1}</td><td class="pi">${portraitImg(st.charOf?.[n])}</td><td>${esc(n)}</td><td class="t">${p}pt</td></tr>`).join('')}</table>
    <div class="ov-actions"><button class="btn primary" data-ov="menu">メニューへ</button></div>`);
}

// ---------- 起動 ----------
window.__game = { get race() { return race; }, get bg() { return bg; }, renderer, audio, frame(ms = 34) { lastFrame = performance.now() - ms; loop(performance.now()); }, screens }; // デバッグ用
loadFigureAssets().then(() => {
  portraits = renderPortraits(CHARACTERS, buildFigure);
  portraits.kuro = assetUrl('assets/figure/kuro_head.webp'); // にゃん兵衛は写真の顔
}).catch(e => console.warn('figure assets', e)).finally(() => {
  screens.title();
  resize();
  $('#loading').remove();
});
// ブラウザはタップするまで音を出せないので、操作のたびに再生を再試行する
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { audio.ensure(); audio.retryMusic(); });

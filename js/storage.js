// localStorage を安全に読み書きする(プライベートモード等で失敗しても動作継続)

const PREFIX = 'pkr_';

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

export function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* 保存できなくてもゲームは続行 */ }
}

export const DEFAULT_SETTINGS = {
  control: 'buttons',   // buttons | tilt | stick
  lefty: false,
  buttonSize: 1,        // 0.8 / 1 / 1.25
  buttonOpacity: 0.55,
  autoDrift: false,
  smartSteer: false,   // 自動で曲がる補助(初期はオフ)
  difficulty: 'normal',
  bgm: 0.6,
  se: 0.8,
  vibration: true,
  colorAssist: false,
  fps60: false,
  quality: 'auto',      // auto | low | high
  tutorialSeen: false,
};

export const DEFAULT_PROFILE = {
  name: 'プレイヤー',
  character: 'kuro',
  bodyColor: 0xe53935,
  tire: 'std',
};

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS, ...load('settings', {}) };
  // v2: スマートステアの初期値をオフに変更したので、保存済みの設定も一度だけオフにする
  if ((s.version || 1) < 2) { s.smartSteer = false; s.version = 2; save('settings', s); }
  return s;
}
export function saveSettings(s) { save('settings', s); }
export function loadProfile() { return { ...DEFAULT_PROFILE, ...load('profile', {}) }; }
export function saveProfile(p) { save('profile', p); }

// ---- ゴーストの圧縮/共有コード ----
// frames: [[x,z,h], ...] を 10Hz で記録したもの
export function encodeGhost(ghost) {
  const out = [];
  let px = 0, pz = 0, ph = 0;
  for (const [x, z, h] of ghost.frames) {
    const qx = Math.round(x * 10), qz = Math.round(z * 10), qh = Math.round(h * 100);
    out.push((qx - px).toString(36), (qz - pz).toString(36), (qh - ph).toString(36));
    px = qx; pz = qz; ph = qh;
  }
  const payload = [ghost.course, Math.round(ghost.time * 1000), ghost.name, ghost.character, ghost.bodyColor, out.join(',')].join('|');
  return 'PKR1:' + btoa(unescape(encodeURIComponent(payload)));
}

export function decodeGhost(code) {
  try {
    code = code.trim();
    if (!code.startsWith('PKR1:')) return null;
    const payload = decodeURIComponent(escape(atob(code.slice(5))));
    const [course, time, name, character, bodyColor, data] = payload.split('|');
    const nums = data.split(',').map(s => parseInt(s, 36));
    const frames = [];
    let x = 0, z = 0, h = 0;
    for (let i = 0; i + 2 < nums.length; i += 3) {
      x += nums[i]; z += nums[i + 1]; h += nums[i + 2];
      frames.push([x / 10, z / 10, h / 100]);
    }
    return { course, time: +time / 1000, name, character, bodyColor: +bodyColor, frames };
  } catch { return null; }
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

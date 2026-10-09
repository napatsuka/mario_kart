// ゲームデータ定義(すべてオリジナルIP)

// にゃん兵衛(黒ネコ)は写真を3D形状に投影。ほかの動物は同じ体型に手描きの顔とパーツをつける(js/figure.js)
export const CHARACTERS = [
  { id: 'kuro',   name: 'にゃん兵衛', animal: 'ネコ',     fur: 0x24242c, speed: 3, accel: 4, handling: 4, desc: 'ちょっと不機嫌な主人公。バランス型',
    look: { photo: true, fur: '#2d2f33', ears: 'cat', tail: 'cat' } },
  { id: 'kotaro', name: 'コタロウ', animal: 'シバイヌ', fur: 0xe2873a, speed: 4, accel: 3, handling: 3, desc: 'くるんとしっぽの柴犬。スピード派',
    look: { fur: '#e2873a', ears: 'shiba', earInner: '#fff1dc', cheeks: '#fff4e2', muzzle: '#fff4e2', nose: '#1a1a1a', brows: '#fff1dc', blush: '#ff9e9e', belly: '#fff4e2', tail: 'curl' } },
  { id: 'mimi',   name: 'ミミ',     animal: 'ウサギ',   fur: 0xf7f5f2, speed: 2, accel: 5, handling: 5, desc: '長い耳のウサギ。加速と曲がりが得意',
    look: { fur: '#f7f5f2', ears: 'bunny', earInner: '#ffb3c1', eyeColor: '#7a1830', nose: '#ff8fa3', blush: '#ffb3c1', tail: 'puff' } },
  { id: 'sasa',   name: 'ササ',     animal: 'パンダ',   fur: 0xf6f5ef, speed: 5, accel: 2, handling: 2, desc: 'どっしり重量級のパンダ。最高速が自慢',
    look: { fur: '#f6f5ef', ears: 'round', earColor: '#1d1d22', patch: '#1d1d22', nose: '#1d1d22', tail: 'stub', tailColor: '#1d1d22' } },
  { id: 'penta',  name: 'ペンタ',   animal: 'ペンギン', fur: 0x1f2b48, speed: 3, accel: 3, handling: 5, desc: 'すべるように曲がるペンギン。テクニック派',
    look: { fur: '#1f2b48', ears: 'none', face: '#ffffff', beak: '#ffa31a', belly: '#ffffff', blush: '#ffb3c1', tail: 'none' } },
  { id: 'kon',    name: 'コン',     animal: 'キツネ',   fur: 0xef7b2c, speed: 4, accel: 4, handling: 2, desc: 'ずる賢いキツネ。ふさふさしっぽ',
    look: { fur: '#ef7b2c', ears: 'fox', earInner: '#fff1dc', earTip: '#2a1c18', eyes: 'sharp', eyeColor: '#ffb000', cheeks: '#ffffff', muzzle: '#ffffff', nose: '#1a1a1a', belly: '#ffffff', tail: 'fox' } },
  { id: 'kero',   name: 'ケロ',     animal: 'カエル',   fur: 0x63c04a, speed: 2, accel: 4, handling: 4, desc: 'ぴょんと陽気なカエル。粘り強い',
    look: { fur: '#63c04a', ears: 'none', eyes: 'frog', belly: '#daf3a6', blush: '#ff8f9e', tail: 'none' } },
  { id: 'pon',    name: 'ポン',     animal: 'タヌキ',   fur: 0x8a6748, speed: 5, accel: 3, handling: 2, desc: 'のんびり屋のタヌキ。直線番長',
    look: { fur: '#8a6748', ears: 'round', earColor: '#3b2a20', mask: '#3b2a20', muzzle: '#f3e2c6', nose: '#1a1a1a', belly: '#f3e2c6', tail: 'striped', tailColor: '#3b2a20' } },
];

export const BODY_COLORS = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xff6f00, 0x212121, 0xf5f5f5];

export const TIRES = [
  { id: 'std',   name: 'スタンダード', speed: 0,  accel: 0,  handling: 0 },
  { id: 'grip',  name: 'グリップ',     speed: -1, accel: 0,  handling: 2 },
  { id: 'slick', name: 'スリック',     speed: 1,  accel: -1, handling: -1 },
  { id: 'soft',  name: 'ソフト',       speed: -1, accel: 2,  handling: 0 },
];

// base: 道の下にあるもの(ground=地面の盛り土、water=海、lava=溶岩、void=宇宙)。deck=柱で支える橋の道
export const THEMES = {
  meadow:   { name: '草原',   base: 'ground', skyTop: 0x2f7fe0, skyHorizon: 0xbfe6ff, fog: 0xcde9ff, sun: 0xfff2d6, sunI: 3.0, hemiSky: 0xbfe0ff, hemiGround: 0x5a8a3a, ground: 0x5cb33c, ground2: 0x7fcb4f, road: 0x56565f, curbA: 0xe53935, curbB: 0xffffff, wall: 0xf4f4f4, wall2: 0xe53935, mountain: 0x5f9e6e, rock: 0x8a7a66, decor: 'tree', scale: 'major', clouds: true },
  desert:   { name: '砂漠',   base: 'ground', skyTop: 0x3a8ee0, skyHorizon: 0xffe0b0, fog: 0xffe4c0, sun: 0xffe2b0, sunI: 3.2, hemiSky: 0xffe2c0, hemiGround: 0xc79a55, ground: 0xe2b874, ground2: 0xedc98a, road: 0x7a6250, curbA: 0xff8f00, curbB: 0xfff3e0, wall: 0xc98b4f, wall2: 0xfff3e0, mountain: 0xc98b4f, rock: 0xb07a48, decor: 'cactus', scale: 'minor', clouds: false },
  snow:     { name: '雪山',   base: 'ground', skyTop: 0x4f8fd8, skyHorizon: 0xe6f2ff, fog: 0xeaf4ff, sun: 0xffffff, sunI: 2.6, hemiSky: 0xe6f2ff, hemiGround: 0xa9c4dd, ground: 0xf1f6fc, ground2: 0xdde9f5, road: 0x5f6d7d, curbA: 0x1e88e5, curbB: 0xffffff, wall: 0x90caf9, wall2: 0xffffff, mountain: 0x8aa3bd, rock: 0x7d8a99, snowcap: true, decor: 'pine', scale: 'major', clouds: true },
  mountain: { name: '山道',   base: 'ground', skyTop: 0x3c86e0, skyHorizon: 0xd4ecff, fog: 0xd8ecff, sun: 0xfff4e0, sunI: 3.0, hemiSky: 0xd0e6ff, hemiGround: 0x4a6a3a, ground: 0x5f8f4a, ground2: 0x7aa860, road: 0x55555e, curbA: 0xe53935, curbB: 0xffffff, wall: 0xe8e8e8, wall2: 0xe53935, mountain: 0x6f8f9f, rock: 0x8d867c, snowcap: true, decor: 'pine', scale: 'major', clouds: true },
  night:    { name: '夜の街', base: 'ground', deck: true, skyTop: 0x05071a, skyHorizon: 0x2a1f5a, fog: 0x1a1640, sun: 0xaabfff, sunI: 1.6, hemiSky: 0x7a7ad0, hemiGround: 0x101020, ground: 0x15182a, ground2: 0x1d2138, road: 0x56648c, curbA: 0xff2e88, curbB: 0x00e5ff, wall: 0x2a2f55, wall2: 0x00e5ff, mountain: 0x161a36, rock: 0x4a5070, decor: 'building', scale: 'minor', stars: true, lamps: true, night: true },
  beach:    { name: '海',     base: 'water', deck: true, water: 0x1aa3c8, skyTop: 0x1f8fe6, skyHorizon: 0xc6f4ff, fog: 0xc9f2ff, sun: 0xfff6dc, sunI: 3.2, hemiSky: 0xc6f4ff, hemiGround: 0x6fc8d8, ground: 0xf3dca0, ground2: 0xf8e8b8, road: 0x667480, curbA: 0x00bfa5, curbB: 0xffffff, wall: 0xffffff, wall2: 0x00bfa5, mountain: 0x4fa3a0, rock: 0xd8d2c4, decor: 'island', scale: 'major', clouds: true },
  iceberg:  { name: '氷山',   base: 'water', deck: true, water: 0x1f86b8, skyTop: 0x5aa8f0, skyHorizon: 0xe8f8ff, fog: 0xe0f4ff, sun: 0xffffff, sunI: 2.8, hemiSky: 0xe8f8ff, hemiGround: 0x7fc4e0, ground: 0xeaf6ff, ground2: 0xcfeaf8, road: 0x7d93a8, curbA: 0x4fc3f7, curbB: 0xffffff, wall: 0xdff6ff, wall2: 0x4fc3f7, mountain: 0xcfe9f7, rock: 0xbfe4f5, snowcap: true, decor: 'iceberg', scale: 'major', clouds: true, slippery: true },
  volcano:  { name: '火山',   base: 'lava', deck: true, skyTop: 0x2a0d12, skyHorizon: 0xb8452a, fog: 0x6a2a20, sun: 0xffb080, sunI: 1.8, hemiSky: 0xff9a70, hemiGround: 0x2a1010, ground: 0x2a1818, ground2: 0x3a2020, road: 0x58525e, curbA: 0xff3d00, curbB: 0xffc400, wall: 0x3a2a2a, wall2: 0xff6e40, mountain: 0x3a1a18, rock: 0x3a2a28, decor: 'spire', scale: 'minor', lava: true, night: true },
  space:    { name: '宇宙',   base: 'void', deck: true, skyTop: 0x02010a, skyHorizon: 0x2a0f4a, fog: 0x0a0520, sun: 0xffffff, sunI: 1.8, hemiSky: 0x9a8aff, hemiGround: 0x220033, ground: 0x0a0a1a, ground2: 0x1a1030, road: 0x241c58, curbA: 0xff3df2, curbB: 0x3dfcff, wall: 0x2a1f6a, wall2: 0xff3df2, mountain: 0x000000, rock: 0x3a2f8a, decor: 'asteroid', scale: 'minor', stars: true, night: true, space: true, noMountains: true },
};

// 4カップ × 3コース = 12コース(1カップ約6分)。elev=高低差、tunnels=トンネルの数、gimmicks=コースの大掛かりな仕掛け(js/gimmicks.js)
export const CUPS = [
  { id: 'acorn', name: 'どんぐりカップ', courses: [
    { id: 'c1',  name: 'はらっぱヒルズ',     theme: 'meadow',   seed: 11,  elev: 7,  tunnels: 1, gimmicks: ['ferris', 'giantcat'] },
    { id: 'c2',  name: 'サンサンブリッジ',   theme: 'beach',    seed: 23,  elev: 8,  tunnels: 0, gimmicks: ['tide', 'whale'] },
    { id: 'c3',  name: 'さらさら砂丘',       theme: 'desert',   seed: 37,  elev: 9,  tunnels: 1, gimmicks: ['tornado', 'dinos', 'plane'] },
  ]},
  { id: 'star', name: 'ほしぞらカップ', courses: [
    { id: 'c4',  name: 'ネオンハイウェイ',   theme: 'night',    seed: 41,  elev: 12, tunnels: 1, gimmicks: ['train', 'crane', 'bowling'] },
    { id: 'c5',  name: 'ひょうざんクルーズ', theme: 'iceberg',  seed: 59,  elev: 9,  tunnels: 1, gimmicks: ['glacier', 'slider'] },
    { id: 'c6',  name: 'にゃんこ峠',         theme: 'mountain', seed: 67,  elev: 18, tunnels: 2, gimmicks: ['cliff', 'daynight'] },
  ]},
  { id: 'bolt', name: 'いなずまカップ', courses: [
    { id: 'c7',  name: 'マグマブリッジ',     theme: 'volcano',  seed: 73,  elev: 13, tunnels: 1, gimmicks: ['eruption', 'dragon'] },
    { id: 'c8',  name: 'うみかぜ大橋',       theme: 'beach',    seed: 89,  elev: 14, tunnels: 2, gimmicks: ['drawbridge', 'whale', 'tide'] },
    { id: 'c9',  name: 'ゆきやま峠',         theme: 'snow',     seed: 97,  elev: 20, tunnels: 2, gimmicks: ['cliff', 'storm', 'bowling'] },
  ]},
  { id: 'crown', name: 'おうかんカップ', courses: [
    { id: 'c10', name: 'コズミックロード',   theme: 'space',    seed: 103, elev: 26, tunnels: 1, gimmicks: ['gears', 'merry', 'storm'] },
    { id: 'c11', name: 'ふぶきの氷山',       theme: 'iceberg',  seed: 127, elev: 16, tunnels: 2, gimmicks: ['glacier', 'tornado', 'drawbridge'] },
    { id: 'c12', name: 'ほのおの王城',       theme: 'volcano',  seed: 139, elev: 18, tunnels: 2, gimmicks: ['dragon', 'eruption', 'daynight'] },
  ]},
];

// カップの順に難しく(曲がりがきつく、長く、障害物が増える)
CUPS.forEach((c, i) => c.courses.forEach(x => (x.diff = i)));
export const ALL_COURSES = CUPS.flatMap(c => c.courses);

export const ITEMS = {
  boost:     { name: 'ターボ',           icon: '💨', desc: '一瞬で加速' },
  triple:    { name: 'ターボ×3',         icon: '💨', desc: '3回まで加速' },
  missile:   { name: 'おいかけ弾',       icon: '🎯', desc: '前のライバルを追いかける' },
  missile3:  { name: 'おいかけ弾×3',     icon: '🎯', desc: '3回まで撃てる' },
  bomb:      { name: 'うしろ爆弾',       icon: '💣', desc: '後ろへ投げる。長押しで後ろに構えてガード' },
  jelly:     { name: 'ぷるぷるゼリー',   icon: '🟢', desc: '後ろに置くトラップ。長押しで構えてガード' },
  boomerang: { name: 'さかなブーメラン', icon: '🐟', desc: '前に投げると戻ってくる。行きと帰りの両方で当たる' },
  yarn:      { name: 'ころころ毛糸玉',   icon: '🧶', desc: '壁で跳ね返りながら転がる。当たると毛糸が絡まって操作が重くなる' },
  stamp:     { name: 'にくきゅうスタンプ', icon: '🐾', desc: '前方に大きな足跡を落とす。踏むとぺたんと潰れて小さくなる' },
  firework:  { name: 'ねずみ花火',       icon: '🎆', desc: '地面を不規則に走り回り、触れたカートを弾く' },
  ice:       { name: 'こおりアイス',     icon: '🧊', desc: '周りに円形の氷を広げる。通った相手は滑る' },
  mirror:    { name: 'はねかえしミラー', icon: '🪞', desc: '次の攻撃を撃った相手に返す' },
  cushion:   { name: 'ふかふかクッション', icon: '🛏️', desc: '後ろに置く。当たった弾を1回だけ吸収して消す' },
  ink:       { name: 'まっくろスミ',     icon: '🦑', desc: '前を走る全員の視界を真っ黒に' },
  dizzy:     { name: 'くるくるメガネ',   icon: '🤪', desc: '前を走る相手のハンドルが数秒間逆になる' },
  rod:       { name: 'つりざお',         icon: '🎣', desc: '前のカートを釣り上げて自分の後ろに落とす' },
  star:      { name: 'スター',           icon: '⭐', desc: 'しばらく無敵&スピードアップ' },
  mega:      { name: 'ビッグにゃん',     icon: '💪', desc: '巨大化して無敵。ライバルを踏みつぶす' },
  topbomb:   { name: 'トップねらい弾',   icon: '🌀', desc: '1位を追いかけて大爆発' },
  dash:      { name: 'ねこロケット',     icon: '🚀', desc: '自動で猛スピード。ぶつかった相手をはじき飛ばす' },
  lightning: { name: 'カミナリ',         icon: '⚡', desc: '自分以外の全員をスピンさせて小さくする' },
};
// 1回の取得で複数回使えるアイテム
export const ITEM_USES = { triple: 3, missile3: 3 };

// 順位(0=1位 … 1=最下位)に応じた抽選テーブル。下位ほど逆転できる強いアイテムが出る
export function rollItem(rankFrac, rand = Math.random) {
  let t;
  if (rankFrac < 0.15)      t = { jelly: 18, bomb: 14, missile: 14, boost: 12, cushion: 12, mirror: 10, stamp: 10, ice: 10 };
  else if (rankFrac < 0.45) t = { missile: 12, boost: 10, jelly: 6, bomb: 6, triple: 8, missile3: 7, boomerang: 10, yarn: 9, firework: 8, stamp: 6, mirror: 5, ink: 6, topbomb: 5 };
  else if (rankFrac < 0.75) t = { triple: 12, missile3: 10, star: 10, mega: 9, topbomb: 9, ink: 7, dash: 9, rod: 10, dizzy: 9, boomerang: 8, yarn: 7 };
  else                      t = { star: 16, dash: 18, lightning: 12, mega: 13, triple: 9, topbomb: 8, rod: 13, dizzy: 8, ink: 3 };
  const total = Object.values(t).reduce((x, y) => x + y, 0);
  let r = rand() * total;
  for (const [k, w] of Object.entries(t)) { if ((r -= w) < 0) return k; }
  return 'boost';
}

export const CUP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export const DIFFICULTY = {
  easy:   { name: 'かんたん',   ai: 0.84 },
  normal: { name: 'ふつう',     ai: 0.92 },
  hard:   { name: 'むずかしい', ai: 0.99 },
};

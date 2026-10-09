"""キャラクターシート(正面/背面/横)から 3D フィギュアのデータを作る。

- 正面と横のシルエットから、高さごとの断面(超楕円)を求めて胴と頭のロフト形状にする
- 耳先・しっぽの経路も推定する
- 各写真を投影テクスチャとして書き出し、ワールド座標との対応を JSON に保存する

使い方: python tools/build_figure.py tools/kuro_sheet.jpg assets/figure
"""
import sys, os, json
from collections import deque
import numpy as np
from PIL import Image, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
sheet = Image.open(SRC).convert('RGB')
WORLD_H = 3.1  # 耳先から足先までの高さ(ワールド単位)


def remove_bg(img):
    a = np.asarray(img).astype(np.float32) / 255
    mx, mn = a.max(2), a.min(2)
    lum = a @ np.array([0.299, 0.587, 0.114])
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    bgish = (lum > 0.6) & (sat < 0.14)
    h, w = bgish.shape
    seen = np.zeros_like(bgish)
    q = deque((y, x) for y in range(h) for x in (0, w - 1) if bgish[y, x])
    q.extend((y, x) for x in range(w) for y in (0, h - 1) if bgish[y, x])
    for y, x in q: seen[y, x] = True
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and bgish[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    fg = ~seen
    # 最大連結成分
    lab = np.zeros((h, w), np.int32); cur = 0; best = (0, 0)
    for sy in range(h):
        for sx in range(w):
            if fg[sy, sx] and not lab[sy, sx]:
                cur += 1; lab[sy, sx] = cur; q.append((sy, sx)); n = 0
                while q:
                    y, x = q.popleft(); n += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = cur; q.append((ny, nx))
                if n > best[1]: best = (cur, n)
    m = lab == best[0]
    al = Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    out = img.convert('RGBA'); out.putalpha(al)
    return out, np.asarray(al) > 128


def segments(row, gap=5):
    xs = np.where(row)[0]
    if not len(xs): return []
    out, s, p = [], xs[0], xs[0]
    for x in xs[1:]:
        if x > p + gap: out.append((s, p)); s = x
        p = x
    out.append((s, p))
    return out


# 切り出し範囲(シート座標)。足先の下でカットして台座を含めない
BOX = {'front': (120, 45, 480, 506), 'rear': (615, 45, 1010, 506), 'side': (300, 600, 560, 969)}
FEET = {'front': 505, 'rear': 505, 'side': 968}
TOP = {'front': 59, 'rear': 59, 'side': 613}
views = {}
for name, box in BOX.items():
    rgba, mask = remove_bg(sheet.crop(box))
    views[name] = dict(rgba=rgba, mask=mask, box=box, s=WORLD_H / (FEET[name] - TOP[name]))

# 正面: 頭の中心列(しっぽを除いた左右対称の軸)
fm, fb, fs = views['front']['mask'], views['front']['box'], views['front']['s']
# 頭の幅が最大になる行の中心を軸にする
head_rows = range(170 - fb[1], 260 - fb[1])
cf = np.median([(lambda sg: (max(sg, key=lambda t: t[1] - t[0])[0] + max(sg, key=lambda t: t[1] - t[0])[1]) / 2)(segments(fm[y])) for y in head_rows if segments(fm[y])])
sm, sb, ss = views['side']['mask'], views['side']['box'], views['side']['s']
cs = np.median([(lambda sg: (max(sg, key=lambda t: t[1] - t[0])[0] + max(sg, key=lambda t: t[1] - t[0])[1]) / 2)(segments(sm[y])) for y in range(680 - sb[1], 740 - sb[1]) if segments(sm[y])])

def world_y(view, py):
    v = views[view]
    return (FEET[view] - (py + v['box'][1])) * v['s']

def row_for(view, wy):
    v = views[view]
    return int(round(FEET[view] - wy / v['s'] - v['box'][1]))

def body_interval(mask, py, center, maxw=None):
    if py < 0 or py >= mask.shape[0]: return None
    sg = segments(mask[py], gap=3)
    for a, b in sg:
        if a - 2 <= center <= b + 2:
            return a, b
    return None

# 正面のしっぽ(画像の左側)を除外: 軸からの距離が右側の対称位置より大きい部分は捨てる
rows = []
ny = 90
y_top_head = None
for i in range(ny + 1):
    wy = WORLD_H * i / ny
    pf = row_for('front', wy); ps = row_for('side', wy)
    fi = body_interval(fm, pf, cf); si = body_interval(sm, ps, cs)
    if not fi or not si:
        continue
    fl, fr = fi
    # 左右対称に制限(しっぽや片側の出っ張りを除去)
    half = min(cf - fl, fr - cf)
    zl, zr = -(cf + half - cf) * fs, -(cf - half - cf) * fs  # 画像の u は -z
    sl, sr = si
    # 横向き画像はネコが左向き: 画像の左が前(+x)
    xf, xb = -(sl - cs) * ss, -(sr - cs) * ss
    # 横のしっぽ(背中側の細い突起)を除外: 背中側は頭/胴の厚みに合わせて制限
    rows.append(dict(y=round(wy, 4), z0=round(zl, 4), z1=round(zr, 4), x0=round(xb, 4), x1=round(xf, 4)))
    y_top_head = wy

# 耳: 頭頂より上の正面マスクの左右の山
ears = []
top_head_py = row_for('front', y_top_head)
ear_rows = fm[:max(top_head_py, 1)]
for side in (-1, 1):
    cols = np.arange(fm.shape[1])
    sel = (cols < cf) if side < 0 else (cols > cf)
    ys, xs = np.where(ear_rows & sel[None, :])
    if not len(ys): continue
    tip_y = ys.min(); tip_x = xs[ys == tip_y].mean()
    base_xs = xs[ys == ys.max()]
    ears.append(dict(tip=[None, round(world_y('front', tip_y), 4), round(-(tip_x - cf) * fs, 4)],
                     baseZ=[round(-(base_xs.min() - cf) * fs, 4), round(-(base_xs.max() - cf) * fs, 4)],
                     baseY=round(world_y('front', ys.max()), 4)))
# 横から見た耳先の前後位置
sy, sx = np.where(sm[:row_for('side', y_top_head)])
ear_x = round(float(-(sx[sy == sy.min()].mean() - cs) * ss), 4) if len(sy) else 0.0
for e in ears: e['tip'][0] = ear_x

# しっぽ: 横画像で背中側に離れた成分の中心線
tail = []
for i in range(0, ny + 1, 3):
    wy = WORLD_H * i / ny
    ps = row_for('side', wy)
    if ps < 0 or ps >= sm.shape[0]: continue
    sg = segments(sm[ps], gap=3)
    body = body_interval(sm, ps, cs)
    for a, b in sg:
        if body and a > body[1] + 2 and b - a < 60:
            tail.append([round(-((a + b) / 2 - cs) * ss, 4), round(wy, 4), round((b - a) / 2 * ss, 4)])
# 正面画像でしっぽは画像の左側 → +z 側
tail_z = round(float((cf - (fb[0] + 0) - (cf - 30)) * 0), 4)

def strip_tail(view, center, sym=True):
    """しっぽ(胴の外側に出た部分)をテクスチャから消す。耳の行(頭頂より上)はそのまま"""
    v = views[view]
    rgba = np.array(v['rgba']); mask = v['mask']
    top = row_for(view, y_top_head) if view != 'side' else row_for('side', y_top_head)
    for py in range(max(top, 0), mask.shape[0]):
        iv = body_interval(mask, py, center)
        if not iv:
            rgba[py, :, 3] = 0; continue
        l, r = iv
        if sym:
            half = min(center - l, r - center)
            l, r = center - half, center + half
        else:
            back = r - center; front = center - l
            r = center + min(back, max(front, 36) * 1.15)
        lo, hi = int(max(0, l - 2)), int(min(mask.shape[1], r + 3))
        rgba[py, :lo, 3] = 0; rgba[py, hi:, 3] = 0
    v['rgba'] = Image.fromarray(rgba, 'RGBA')

def save(view, img):
    img.save(os.path.join(OUT, f'kuro_{view}.webp'), quality=92, method=6)

meta = dict(height=WORLD_H, rows=rows, ears=ears, tail=tail, proj={})
strip_tail('front', cf)
strip_tail('side', cs, sym=False)
for name in ('front', 'rear', 'side'):
    v = views[name]
    w, h = v['rgba'].size
    s = v['s']
    if name == 'front':
        a0 = -(w - 1 - cf) * s * 1  # 画像右端の a(=-z)…ここでは a = (px - cf) * s として u を求める
        meta['proj'][name] = dict(axis='-z', c=round(float(cf), 3), s=s, w=w, h=h, feet=FEET[name] - v['box'][1])
    elif name == 'side':
        meta['proj'][name] = dict(axis='-x', c=round(float(cs), 3), s=s, w=w, h=h, feet=FEET[name] - v['box'][1])
    else:
        # 背面: 頭の中心を軸にする
        rm = v['mask']
        cr = np.median([(lambda sg: (max(sg, key=lambda t: t[1] - t[0])[0] + max(sg, key=lambda t: t[1] - t[0])[1]) / 2)(segments(rm[y])) for y in head_rows if segments(rm[y])])
        meta['proj'][name] = dict(axis='z', c=round(float(cr), 3), s=s, w=w, h=h, feet=FEET[name] - v['box'][1])
        strip_tail('rear', cr)
    save(name, v['rgba'])

json.dump(meta, open(os.path.join(OUT, 'kuro.json'), 'w'), indent=1)
print('rows', len(rows), 'ears', ears, 'tail pts', len(tail), 'cf', cf, 'cs', cs)

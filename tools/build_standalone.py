"""dev.html と js/*.js、assets/ をまとめて、ダブルクリックで開ける単体の index.html を作る。

ブラウザは file:// から開いたページで、分割された JS モジュールや画像・JSON の読み込みを止める。
そこで各モジュールを1つの <script type="module"> にまとめ、画像とデータは data URL で埋め込む。
three.js は CDN(https)から読むので、初回はインターネット接続が必要。

使い方: python tools/build_standalone.py
"""
import base64, json, os, re, sys
sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'js')

IMPORT_RE = re.compile(r"^import\s+(.+?)\s+from\s+'([^']+)';\s*$")
EXPORT_RE = re.compile(r"^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)")

externals, order, seen = [], [], set()


def load(name):
    """name: './track.js' などの相対パス。依存を先に並べる(深さ優先)"""
    if name in seen: return
    seen.add(name)
    src = open(os.path.join(JS, name[2:]), encoding='utf-8').read()
    out, exports = [], []
    for line in src.split('\n'):
        m = IMPORT_RE.match(line)
        if m:
            what, frm = m.groups()
            if frm.startswith('./'):
                load(frm)
                key = frm[2:-3]
                if what.startswith('* as '):
                    out.append(f"const {what[5:]} = __req('{key}');")
                else:
                    out.append(f"const {what.replace(' as ', ': ')} = __req('{key}');")
            else:
                stmt = line.strip()
                if stmt not in externals: externals.append(stmt)
            continue
        m = EXPORT_RE.match(line)
        if m:
            exports.append(m.group(2))
            line = line[len('export '):]
        out.append(line)
    order.append((name[2:-3], '\n'.join(out), exports))


load('./main.js')

parts = ["const __mods = {}, __cache = {};",
         "const __req = k => (__cache[k] ??= __mods[k]());"]
for key, code, exports in order:
    parts.append(f"// ---- js/{key}.js ----\n__mods['{key}'] = () => {{\n{code}\nreturn {{ {', '.join(exports)} }};\n}};")
parts.append("__req('main');")
bundle = '\n'.join(externals) + '\n' + '\n'.join(parts)

# 画像・データの埋め込み
mime = {'.mp3': 'audio/mpeg', '.webp': 'image/webp', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg'}
assets = {}
adir = os.path.join(ROOT, 'assets')
for dp, _, files in os.walk(adir):
    for f in files:
        full = os.path.join(dp, f)
        rel = os.path.relpath(full, ROOT).replace('\\', '/')
        ext = os.path.splitext(f)[1].lower()
        if ext not in mime: continue
        data = base64.b64encode(open(full, 'rb').read()).decode()
        assets[rel] = f'data:{mime[ext]};base64,{data}'

html = open(os.path.join(ROOT, 'dev.html'), encoding='utf-8').read()
html = re.sub(r'<link rel="manifest"[^>]*>\n?', '', html)  # file:// では読めないので外す
script_tag = '<script type="module" src="js/main.js"></script>'
assert script_tag in html
html = html.replace(script_tag,
    '<script>globalThis.__ASSETS = ' + json.dumps(assets) + ';</script>\n'
    '<script type="module">\n' + bundle.replace('</script', '<\\/script') + '\n</script>')
html = html.replace('<html lang="ja">', '<!-- このファイルは tools/build_standalone.py で dev.html から生成しています。直接編集しないでください -->\n<html lang="ja">', 1)

out = os.path.join(ROOT, 'index.html')
open(out, 'w', encoding='utf-8').write(html)
print(f'index.html を作成しました ({len(html) / 1024:.0f} KB, モジュール {len(order)} 個, 埋め込み {len(assets)} 件)')

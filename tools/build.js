// 1 ファイル版をつくる：CSS と全モジュールを dist/myKingdom.html に埋め込む（サーバーなしで開ける・Artifact として公開できる）。
// 使い方: node tools/build.js [--fragment]
//   --fragment  <html><head><body> の外枠なしで出力（外側で枠をかぶせるホスト向け）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const fragment = process.argv.includes('--fragment');

// main.js から import をたどり、依存される側が先に来る順に並べる
const order = [];
const seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)) visit(resolve(dirname(file), m[1]));
  order.push(file);
}
visit(resolve(root, 'src/main.js'));

// 各モジュールを自分のスコープ（即時関数）に包み、export した名前だけを返す。
// import は、依存先のモジュールの戻り値からの分割代入に置き換える（ファイルをまたいで同じ名前があってもぶつからない）
const modName = (f) => `__m_${relative(root, f).replace(/[^A-Za-z0-9]/g, '_')}`;
const js = order
  .map((f) => {
    let src = readFileSync(f, 'utf8');
    const exported = [...src.matchAll(/^export\s+(?:const|function|class|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    src = src
      .replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\n/gm, (_, names, from) => {
        const list = names
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
          .map((n) => n.replace(/\s+as\s+/, ': '));
        return `const { ${list.join(', ')} } = ${modName(resolve(dirname(f), from))};\n`;
      })
      .replace(/^export\s+(?=(const|function|class|let)\b)/gm, '');
    if (/^import\s/m.test(src)) throw new Error(`${relative(root, f)}: 対応していない import の書き方があります`);
    return `// ── ${relative(root, f)} ──\nconst ${modName(f)} = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();`;
  })
  .join('\n');

const css = readFileSync(resolve(root, 'css/style.css'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const title = html.match(/<title>.*?<\/title>/)[0];
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/\s*<script type="module" src="src\/main.js"><\/script>\s*/, '\n');
const script = `<script type="module">\n${js.replaceAll('</script', '<\\/script')}\n</script>\n`;
const style = `<style>\n${css}</style>\n`;
const out = fragment
  ? `${title}\n${style}${body}${script}`
  : `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n${title}\n${style}</head>\n<body>\n${body}${script}</body>\n</html>\n`;
mkdirSync(resolve(root, 'dist'), { recursive: true });
const file = resolve(root, 'dist', fragment ? 'myKingdom.fragment.html' : 'myKingdom.html');
writeFileSync(file, out);
console.log(`${relative(root, file)} (${order.length} modules, ${Math.round(out.length / 1024)}KB)`);

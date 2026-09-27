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

// import 文を消し、export を外して 1 つのスコープにつなぐ（トップレベルの名前は全モジュールで重ならない前提）
const js = order
  .map((f) => {
    const src = readFileSync(f, 'utf8')
      .replace(/^import\s[^;]*?;\n/gms, '')
      .replace(/^export\s+(?=(const|function|class|let)\b)/gm, '');
    return `// ── ${relative(root, f)} ──\n${src}`;
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

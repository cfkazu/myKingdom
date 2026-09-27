// ブラウザなしでシミュレーションを走らせ、年代記と概要を表示する。
// 使い方: node tools/headless.js [年数] [シード]
import { World } from '../src/world.js';

const years = Number(process.argv[2] ?? 200);
const seed = process.argv[3] ?? 'kingdom';
const quiet = process.argv.includes('-q');
const w = new World({ seed });
const t0 = Date.now();
let shown = 0;
for (let y = 0; y < years; y++) {
  w.step();
  if (!quiet) for (; shown < w.log.length; shown++) console.log(`[${w.log[shown].year}] ${w.plainText(w.log[shown].text)}`);
  const h = w.history.at(-1);
  if (h.year % 25 === 0) {
    const ks = w.aliveKingdoms().map((k) => `${k.name}${w.provincesOf(k).length}`).join(' ');
    console.log(
      `== ${h.year} 貴族 ${h.nobles} 王国 ${h.aliveKingdoms} 戦争 ${h.wars} 王のF ${h.rulerF.toFixed(3)} 王族F ${h.royalF.toFixed(3)} ` +
        `h ${h.freq.hem.toFixed(3)} j ${h.freq.jaw.toFixed(3)} m ${h.freq.mad.toFixed(3)} d ${h.freq.del.toFixed(3)} | ${ks}`,
    );
  }
}
console.log(`${Date.now() - t0}ms, 記録された人数 ${w.people.size}, 家 ${w.dynasties.length}（断絶 ${w.dynasties.filter((d) => d.extinct).length}）`);
for (const k of w.kingdoms) console.log(`${k.name} ${k.alive ? '' : `（${k.endYear}年滅亡）`} ${k.law}/${k.custom} 君主 ${k.rulers.length} 人`);

// 長い歴史の「まとまりすぎ」を測る：いくつものシードで長く回し、王国の数・最大国のシェア・反乱の勝率を集計する。
// 使い方: node tools/metrics.js [シードの数] [年数]
import { World } from '../src/world.js';

const seeds = Number(process.argv[2] ?? 8);
const years = Number(process.argv[3] ?? 800);
const rows = [];
for (let i = 0; i < seeds; i++) {
  const w = new World({ seed: `m${i}` });
  let unified = 0;
  let shareSum = 0;
  let kSum = 0;
  const counts = [];
  for (let y = 0; y < years; y++) {
    w.step();
    const ks = w.aliveKingdoms();
    const big = Math.max(...ks.map((k) => w.provincesOf(k).length)) / w.provinces.length;
    if (ks.length <= 1) unified++;
    shareSum += big;
    kSum += ks.length;
    if ((y + 1) % 100 === 0) counts.push(ks.length);
  }
  // 王朝：王位にあった王朝の一続きの長さ（年）
  const tenures = [];
  for (const k of w.kingdoms) {
    let start = null;
    let dyn = null;
    for (const r of k.rulers) {
      if (r.dynastyId !== dyn) {
        if (dyn != null) tenures.push(r.from - start);
        dyn = r.dynastyId;
        start = r.from;
      }
    }
    if (dyn != null && k.alive) tenures.push(w.year - start);
  }
  const tenure = tenures.reduce((a, b) => a + b, 0) / Math.max(1, tenures.length);
  const longest = Math.max(0, ...tenures);
  const hemRoyal = [...w.people.values()].filter((p) => p.rulerOfEver != null || (p.fatherId != null && w.get(p.fatherId)?.rulerOfEver != null)).filter((p) => p.pheno.hemophilia).length;
  const wars = w.wars.filter((x) => x.ended);
  const rebel = wars.filter((x) => x.kind === 'civil' || x.kind === 'independence');
  const rebelWins = rebel.filter((x) => x.result === 'attacker').length;
  const conquest = wars.filter((x) => x.kind === 'conquest');
  const nobles = w.living.length;
  rows.push({ nobles, tenure, longest, hemRoyal, royalF: w.history.reduce((a, h) => a + h.royalF, 0) / w.history.length, unified: unified / years, share: shareSum / years, k: kSum / years, rebel: rebel.length, rebelWins, conquest: conquest.length, founded: w.kingdoms.length, counts: counts.join(' ') });
  console.log(`m${i}: 王朝の平均 ${Math.round(tenure)} 年（最長 ${longest}）・王家の血友病 ${hemRoyal} 人・王族F ${(w.history.reduce((a, h) => a + h.royalF, 0) / w.history.length).toFixed(3)}  平均王国数 ${(kSum / years).toFixed(1)}  統一されていた年 ${Math.round((100 * unified) / years)}%  最大国の平均シェア ${Math.round((100 * shareSum) / years)}%  反乱 ${rebelWins}/${rebel.length} 勝  征服戦争 ${conquest.length}  生まれた国 ${w.kingdoms.length}  | 100年ごとの王国数 ${counts.join(' ')}`);
}
const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
console.log(`\n平均：王朝 ${Math.round(avg((r) => r.tenure))} 年・王家の血友病 ${avg((r) => r.hemRoyal).toFixed(1)} 人・王族F ${avg((r) => r.royalF).toFixed(3)}・貴族 ${Math.round(avg((r) => r.nobles))} 人・王国数 ${avg((r) => r.k).toFixed(2)}・統一 ${Math.round(100 * avg((r) => r.unified))}%・最大国シェア ${Math.round(100 * avg((r) => r.share))}%・反乱の勝率 ${Math.round((100 * avg((r) => r.rebelWins)) / Math.max(1, avg((r) => r.rebel)))}%`);

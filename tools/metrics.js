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
  const wars = w.wars.filter((x) => x.ended);
  const rebel = wars.filter((x) => x.kind === 'civil' || x.kind === 'independence');
  const rebelWins = rebel.filter((x) => x.result === 'attacker').length;
  const conquest = wars.filter((x) => x.kind === 'conquest');
  rows.push({ unified: unified / years, share: shareSum / years, k: kSum / years, rebel: rebel.length, rebelWins, conquest: conquest.length, founded: w.kingdoms.length, counts: counts.join(' ') });
  console.log(`m${i}: 平均王国数 ${(kSum / years).toFixed(1)}  統一されていた年 ${Math.round((100 * unified) / years)}%  最大国の平均シェア ${Math.round((100 * shareSum) / years)}%  反乱 ${rebelWins}/${rebel.length} 勝  征服戦争 ${conquest.length}  生まれた国 ${w.kingdoms.length}  | 100年ごとの王国数 ${counts.join(' ')}`);
}
const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
console.log(`\n平均：王国数 ${avg((r) => r.k).toFixed(2)}・統一 ${Math.round(100 * avg((r) => r.unified))}%・最大国シェア ${Math.round(100 * avg((r) => r.share))}%・反乱の勝率 ${Math.round((100 * avg((r) => r.rebelWins)) / Math.max(1, avg((r) => r.rebel)))}%`);

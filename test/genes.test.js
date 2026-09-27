import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/rng.js';
import { LOCI, INDEX, makeGamete, fertilize, express, randomGenome, isMaleGenome, genotypeString } from '../src/genes.js';
import { Pedigree } from '../src/pedigree.js';

// 指定した遺伝子型を持つゲノム
function genomeWith(sex, rng, set) {
  const g = randomGenome(sex, rng);
  for (const [key, [a, b]] of Object.entries(set)) {
    g.m[INDEX[key]] = a;
    if (g.p[INDEX[key]] !== null) g.p[INDEX[key]] = b;
  }
  // 致死因子で子が数えられなくならないように
  g.m[INDEX.LET] = 'L';
  g.p[INDEX.LET] = 'L';
  return g;
}

function cross(mom, dad, rng, n = 4000) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fertilize(makeGamete(mom, 'F', rng), makeGamete(dad, 'M', rng)));
  return out;
}

test('男性の X 連鎖座は父由来側が null（Y 染色体）', () => {
  const rng = createRng(1);
  const m = randomGenome('M', rng);
  const f = randomGenome('F', rng);
  assert.equal(isMaleGenome(m), true);
  assert.equal(isMaleGenome(f), false);
  for (const [i, l] of LOCI.entries()) if (l.chr === 'X') assert.equal(m.p[i], null);
});

test('子の性比はおよそ 1:1', () => {
  const rng = createRng(2);
  const kids = cross(randomGenome('F', rng), randomGenome('M', rng), rng);
  const males = kids.filter((k) => k.sex === 'M').length / kids.length;
  assert.ok(Math.abs(males - 0.5) < 0.03, `男子の割合 ${males}`);
  for (const k of kids) assert.equal(isMaleGenome(k.genome), k.sex === 'M');
});

test('髪の色は優劣の序列どおり：金髪 L/r どうしから赤毛が 1/4', () => {
  const rng = createRng(3);
  const mom = genomeWith('F', rng, { HAIR: ['L', 'r'] });
  const dad = genomeWith('M', rng, { HAIR: ['L', 'r'] });
  const kids = cross(mom, dad, rng);
  const red = kids.filter((k) => express(k.genome).hair === 'r').length / kids.length;
  assert.ok(Math.abs(red - 0.25) < 0.03, `赤毛 ${red}`);
  assert.equal(kids.filter((k) => express(k.genome).hair === 'D').length, 0, '金髪の親から黒髪は生まれない');
});

test('血友病は X 連鎖劣性：保因者の母の息子の半分が発症し、娘は発症しない', () => {
  const rng = createRng(4);
  const mom = genomeWith('F', rng, { HEM: ['H', 'h'] });
  const dad = genomeWith('M', rng, { HEM: ['H', null] });
  const kids = cross(mom, dad, rng);
  const sons = kids.filter((k) => k.sex === 'M');
  const daughters = kids.filter((k) => k.sex === 'F');
  const affected = sons.filter((k) => express(k.genome).hemophilia).length / sons.length;
  assert.ok(Math.abs(affected - 0.5) < 0.04, `発症した息子 ${affected}`);
  assert.equal(daughters.filter((k) => express(k.genome).hemophilia).length, 0);
  const carriers = daughters.filter((k) => genotypeString(k.genome, 'HEM') === 'H/h').length / daughters.length;
  assert.ok(Math.abs(carriers - 0.5) < 0.04, `保因者の娘 ${carriers}`);
});

test('受け口の顎（劣性）は容姿を下げる', () => {
  const rng = createRng(5);
  const g = genomeWith('F', rng, { JAW: ['J', 'J'] });
  const before = express(g).beauty;
  g.m[INDEX.JAW] = 'j';
  assert.equal(express(g).jaw, false, '保因者は発症しない');
  g.p[INDEX.JAW] = 'j';
  const ph = express(g);
  assert.equal(ph.jaw, true);
  assert.ok(ph.beauty <= before - 20 || ph.beauty === 0);
});

test('免疫型はヘテロ接合のほうが疫病に強い（超優性）', () => {
  const rng = createRng(6);
  assert.ok(express(genomeWith('M', rng, { HLA: ['A', 'B'] })).resistance > express(genomeWith('M', rng, { HLA: ['A', 'A'] })).resistance);
});

test('連鎖：近い遺伝子座どうしはいっしょに伝わりやすい', () => {
  // 第1染色体の 5cM（肌1）と 12cM（身長1）は近く、5cM と 150cM（野心1）は遠い
  const rng = createRng(7);
  const g = randomGenome('F', rng);
  const [a, b, c] = ['SKI1', 'HEI1', 'AMB1'].map((k) => INDEX[k]);
  g.m[a] = '+'; g.p[a] = '-';
  g.m[b] = '+'; g.p[b] = '-';
  g.m[c] = '+'; g.p[c] = '-';
  let near = 0;
  let far = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const gam = makeGamete(g, 'F', rng).alleles;
    if (gam[a] !== gam[b]) near++;
    if (gam[a] !== gam[c]) far++;
  }
  assert.ok(near / n < 0.12, `近い組の組換え率 ${near / n}`);
  assert.ok(far / n > 0.35, `遠い組の組換え率 ${far / n}`);
});

test('血縁係数：きょうだい婚の子は F=0.25、いとこ婚の子は F=0.0625', () => {
  const ped = new Pedigree();
  let id = 1;
  const add = (fatherId = null, motherId = null) => {
    const r = { id: id++, fatherId, motherId, birthYear: 0, alive: true, F: 0 };
    r.F = ped.kinship(motherId, fatherId);
    ped.add(r);
    return r;
  };
  const gf = add();
  const gm = add();
  const s1 = add(gf.id, gm.id);
  const s2 = add(gf.id, gm.id);
  assert.equal(ped.kinship(s1.id, s2.id), 0.25);
  const sp1 = add();
  const sp2 = add();
  const c1 = add(s1.id, sp1.id);
  const c2 = add(sp2.id, s2.id);
  const cousinsChild = add(c1.id, c2.id);
  assert.equal(cousinsChild.F, 0.0625);
});

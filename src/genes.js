// 人間の遺伝子システム：染色体・遺伝子座・減数分裂（組換え）・突然変異・表現型の発現。
//
// ゲノムは { m: [...], p: [...] } の 2 本（母由来 / 父由来）の配列で、添字は LOCI の並び順。
// 男性の X 連鎖遺伝子座では父由来側（= Y 染色体）が null。

export const INHERITANCE = {
  series: {
    label: '複対立遺伝子（優劣の序列）',
    desc: '3 つ以上の対立遺伝子があり、優劣の順に現れる。髪は 黒 D ＞ 金 L ＞ 赤 r、瞳は 茶 B ＞ 緑 g ＞ 青 u。金髪の両親から黒髪の子は生まれないが、黒髪の両親から金髪や赤毛の子は生まれうる。',
  },
  polygenic: {
    label: '量的形質（ポリジーン）',
    desc: '複数の遺伝子座の「＋」の数を足し合わせ、そこに育ちのばらつきを加えて連続的な値になる。身長・武勇・知略・容姿・カリスマ・野心・慈愛・多産・長寿・肌の色。親より優れた子も劣った子も生まれる（平均への回帰）。',
  },
  xlinked: {
    label: '伴性遺伝（X 連鎖劣性）',
    desc: '血友病と色覚の違いは X 染色体上の劣性遺伝子。男性は X が 1 本なので 1 つで発症し、女性は 2 つそろわないと発症しない（保因者になる）。ヴィクトリア女王の子孫を通じてヨーロッパの王家に広まった血友病と同じしくみ。',
  },
  recessive: {
    label: '常染色体劣性',
    desc: '2 つそろったときだけ現れる。受け口の顎（ハプスブルク家の顎のような）、狂気、4 つの有害因子、致死因子。保因者は健康なまま遺伝子を運ぶので、いとこ婚・叔姪婚のような近親婚が続くと表に出やすくなる（近交弱勢）。',
  },
  overdominant: {
    label: '超優性（ヘテロ接合体優位）',
    desc: '免疫型（HLA）は、2 つの違う型を持つ人ほど疫病に強い。近親婚が続いて同じ型がそろうと、疫病で倒れやすくなる。',
  },
};

export const CHROMOSOMES = [
  { id: 'C1', name: '第1染色体', length: 160 },
  { id: 'C2', name: '第2染色体', length: 140 },
  { id: 'C3', name: '第3染色体', length: 120 },
  { id: 'X', name: 'X染色体', length: 100, sex: true },
];

export const TRAITS = {
  height: { label: '身長', n: 4 },
  strength: { label: '武勇', n: 3 },
  intellect: { label: '知略', n: 4 },
  beauty: { label: '容姿', n: 4 },
  charisma: { label: 'カリスマ', n: 3 },
  ambition: { label: '野心', n: 2 },
  kindness: { label: '慈愛', n: 2 },
  fertility: { label: '多産', n: 2 },
  longevity: { label: '長寿', n: 2 },
  skin: { label: '肌の色', n: 3 },
};

// 量的形質の遺伝子座を染色体に散らばらせる（位置は cM）
const POLY_LAYOUT = {
  height: [['C1', 12], ['C1', 70], ['C2', 40], ['C3', 95]],
  strength: [['C1', 30], ['C2', 88], ['C3', 20]],
  intellect: [['C1', 50], ['C1', 140], ['C2', 60], ['C3', 60]],
  beauty: [['C1', 90], ['C2', 20], ['C2', 120], ['C3', 40]],
  charisma: [['C1', 110], ['C2', 100], ['C3', 110]],
  ambition: [['C1', 150], ['C3', 75]],
  kindness: [['C2', 5], ['C3', 5]],
  fertility: [['C1', 125], ['C2', 75]],
  longevity: [['C2', 135], ['C3', 85]],
  skin: [['C1', 5], ['C2', 50], ['C3', 50]],
};

const polyLoci = [];
for (const [trait, places] of Object.entries(POLY_LAYOUT)) {
  places.forEach(([chr, pos], n) => {
    polyLoci.push({
      key: `${trait.slice(0, 3).toUpperCase()}${n + 1}`,
      chr,
      pos,
      name: `${TRAITS[trait].label}${n + 1}`,
      mode: 'polygenic',
      trait,
      alleles: ['+', '-'],
      freq: [0.5, 0.5],
      labels: { '+': '増', '-': '減' },
    });
  });
}

const rec = (key, chr, pos, name, alleles, freq, labels, effect) => ({
  key,
  chr,
  pos,
  name,
  mode: 'recessive',
  alleles,
  freq,
  labels,
  effect,
  lof: true,
});

export const LOCI = [
  {
    key: 'HAIR',
    chr: 'C1',
    pos: 20,
    name: '髪の色',
    mode: 'series',
    alleles: ['D', 'L', 'r'],
    freq: [0.5, 0.38, 0.12],
    labels: { D: '黒', L: '金', r: '赤' },
  },
  {
    key: 'EYE',
    chr: 'C2',
    pos: 30,
    name: '瞳の色',
    mode: 'series',
    alleles: ['B', 'g', 'u'],
    freq: [0.5, 0.2, 0.3],
    labels: { B: '茶', g: '緑', u: '青' },
  },
  {
    key: 'HLA',
    chr: 'C3',
    pos: 30,
    name: '免疫型',
    mode: 'overdominant',
    alleles: ['A', 'B', 'C'],
    freq: [1 / 3, 1 / 3, 1 / 3],
    labels: { A: 'A型', B: 'B型', C: 'C型' },
  },
  rec('JAW', 'C1', 60, '受け口の顎', ['J', 'j'], [0.82, 0.18], { J: '正常', j: '受け口' }, 'jaw'),
  rec('MAD', 'C2', 110, '狂気', ['M', 'm'], [0.9, 0.1], { M: '正常', m: '狂気' }, 'madness'),
  rec('LET', 'C3', 100, '致死因子', ['L', 'l'], [0.95, 0.05], { L: '正常', l: '致死' }, 'lethal'),
  rec('DEL1', 'C1', 80, '有害因子1', ['D', 'd'], [0.88, 0.12], { D: '正常', d: '有害' }, 'load'),
  rec('DEL2', 'C1', 130, '有害因子2', ['D', 'd'], [0.88, 0.12], { D: '正常', d: '有害' }, 'load'),
  rec('DEL3', 'C2', 80, '有害因子3', ['D', 'd'], [0.88, 0.12], { D: '正常', d: '有害' }, 'load'),
  rec('DEL4', 'C3', 65, '有害因子4', ['D', 'd'], [0.88, 0.12], { D: '正常', d: '有害' }, 'load'),
  {
    key: 'HEM',
    chr: 'X',
    pos: 20,
    name: '血友病',
    mode: 'xlinked',
    alleles: ['H', 'h'],
    freq: [0.96, 0.04],
    labels: { H: '正常', h: '血友病' },
    lof: true,
  },
  {
    key: 'CB',
    chr: 'X',
    pos: 70,
    name: '色覚',
    mode: 'xlinked',
    alleles: ['N', 'c'],
    freq: [0.9, 0.1],
    labels: { N: '一般', c: '色覚の違い' },
  },
  ...polyLoci,
];

export const INDEX = Object.fromEntries(LOCI.map((l, i) => [l.key, i]));
export const LOCUS = Object.fromEntries(LOCI.map((l) => [l.key, l]));

// 染色体ごとの遺伝子座（位置順）
export const CHR_LOCI = Object.fromEntries(
  CHROMOSOMES.map((c) => [
    c.id,
    LOCI.map((l, i) => [l, i])
      .filter(([l]) => l.chr === c.id)
      .sort((a, b) => a[0].pos - b[0].pos)
      .map(([, i]) => i),
  ]),
);

const TRAIT_IDX = Object.fromEntries(
  Object.keys(TRAITS).map((t) => [t, LOCI.map((l, i) => (l.trait === t ? i : -1)).filter((i) => i >= 0)]),
);
const LOAD_IDX = LOCI.map((l, i) => (l.effect === 'load' ? i : -1)).filter((i) => i >= 0);

export const isXLinked = (locus) => locus.chr === 'X';
export const isMaleGenome = (genome) => genome.p[INDEX.HEM] === null;

// 地域ごとの遺伝子の偏り。lat は 0（北）〜 1（南）。北ほど金髪・青い瞳・色白・長身が多い
export function regionalFreqs(lat) {
  return {
    HAIR: [0.25 + 0.6 * lat, 0.6 - 0.5 * lat, 0.15 - 0.1 * lat],
    EYE: [0.2 + 0.65 * lat, 0.2, 0.6 - 0.65 * lat + 0.05],
    skin: 0.15 + 0.7 * lat,
    height: 0.62 - 0.24 * lat,
  };
}

function sampleAllele(locus, rng, region) {
  let freq = locus.freq;
  if (region) {
    if (region[locus.key]) freq = region[locus.key];
    else if (locus.trait && region[locus.trait] != null) freq = [region[locus.trait], 1 - region[locus.trait]];
  }
  return locus.alleles[rng.weightedIndex(freq)];
}

export function randomGenome(sex, rng, region = null) {
  const m = [];
  const p = [];
  for (const locus of LOCI) {
    m.push(sampleAllele(locus, rng, region));
    p.push(sex === 'M' && isXLinked(locus) ? null : sampleAllele(locus, rng, region));
  }
  return { m, p };
}

export function mutate(locus, allele, rng) {
  if (locus.lof) {
    // 機能喪失型：正常→壊れた、は起きやすいが、逆向きはまれ
    if (allele === locus.alleles[0]) return locus.alleles[1];
    return rng.next() < 0.1 ? locus.alleles[0] : allele;
  }
  return rng.pick(locus.alleles.filter((a) => a !== allele));
}

// 減数分裂で配偶子をつくる。各染色体で交叉回数 ~ Poisson(長さ/100cM)、交叉位置は一様。
export function makeGamete(genome, sex, rng, mutationRate = 0) {
  const alleles = new Array(LOCI.length);
  let hasY = false;
  for (const chr of CHROMOSOMES) {
    const idxs = CHR_LOCI[chr.id];
    if (chr.sex && sex === 'M') {
      hasY = rng.next() < 0.5;
      for (const i of idxs) alleles[i] = hasY ? null : genome.m[i];
      continue;
    }
    const n = rng.poisson(chr.length / 100);
    const cross = [];
    for (let k = 0; k < n; k++) cross.push(rng.next() * chr.length);
    cross.sort((a, b) => a - b);
    let strand = rng.next() < 0.5 ? 0 : 1;
    let ci = 0;
    for (const i of idxs) {
      const pos = LOCI[i].pos;
      while (ci < cross.length && cross[ci] < pos) {
        strand ^= 1;
        ci++;
      }
      alleles[i] = strand === 0 ? genome.m[i] : genome.p[i];
    }
  }
  if (mutationRate > 0) {
    for (let i = 0; i < alleles.length; i++) {
      if (alleles[i] !== null && rng.next() < mutationRate) alleles[i] = mutate(LOCI[i], alleles[i], rng);
    }
  }
  return { alleles, hasY };
}

export function fertilize(egg, sperm) {
  return {
    sex: sperm.hasY ? 'M' : 'F',
    genome: { m: egg.alleles.slice(), p: sperm.alleles.slice() },
  };
}

export function allelesAt(genome, key) {
  const i = INDEX[key];
  const out = [genome.m[i]];
  if (genome.p[i] !== null) out.push(genome.p[i]);
  return out;
}

function homRecessive(genome, key) {
  const locus = LOCUS[key];
  return allelesAt(genome, key).every((a) => a === locus.alleles[locus.alleles.length - 1]);
}

function seriesTop(genome, key) {
  const locus = LOCUS[key];
  const al = allelesAt(genome, key);
  return locus.alleles.find((a) => al.includes(a));
}

// 「＋」の割合（0〜1）
export function polyValue(genome, trait) {
  let plus = 0;
  let copies = 0;
  for (const i of TRAIT_IDX[trait]) {
    for (const a of [genome.m[i], genome.p[i]]) {
      if (a === null) continue;
      copies++;
      if (a === '+') plus++;
    }
  }
  return copies ? plus / copies : 0;
}

// 育ち（環境）によるばらつき。生まれたときに一度だけ引いて保存する
export const ENV_KEYS = ['height', 'strength', 'intellect', 'beauty', 'charisma', 'ambition', 'kindness'];
export function randomEnv(rng) {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, rng.normal()]));
}

const clamp100 = (v) => Math.max(0, Math.min(100, v));

export function express(genome, env = {}) {
  const male = isMaleGenome(genome);
  const e = (k) => env[k] ?? 0;
  let load = 0;
  for (const i of LOAD_IDX) if (genome.m[i] === 'd' && genome.p[i] === 'd') load++;
  const jaw = homRecessive(genome, 'JAW');
  const madness = homRecessive(genome, 'MAD');
  const lethal = homRecessive(genome, 'LET');
  const hemophilia = allelesAt(genome, 'HEM').every((a) => a === 'h');
  const colorblind = allelesAt(genome, 'CB').every((a) => a === 'c');
  const hla = allelesAt(genome, 'HLA');
  const resistance = hla[0] !== hla[1] ? 0.85 : 0.55;

  const height = (male ? 158 : 146) + 36 * polyValue(genome, 'height') + 5 * e('height') - 2 * load;
  const strength = clamp100(100 * polyValue(genome, 'strength') + 8 * e('strength') + (male ? 6 : -6) - 6 * load);
  const intellect = clamp100(100 * polyValue(genome, 'intellect') + 9 * e('intellect') - 4 * load);
  const beauty = clamp100(100 * polyValue(genome, 'beauty') + 8 * e('beauty') - (jaw ? 25 : 0) - 6 * load);
  const charisma = clamp100(100 * polyValue(genome, 'charisma') + 8 * e('charisma'));
  const ambition = clamp100(100 * polyValue(genome, 'ambition') + 12 * e('ambition'));
  const kindness = clamp100(100 * polyValue(genome, 'kindness') + 12 * e('kindness'));
  const fertility = (0.6 + 0.8 * polyValue(genome, 'fertility')) * (1 - 0.15 * load);
  const longevity = -10 + 20 * polyValue(genome, 'longevity');
  const vigor = clamp100(100 - 22 * load - (hemophilia ? 15 : 0));

  return {
    hair: seriesTop(genome, 'HAIR'),
    eye: seriesTop(genome, 'EYE'),
    skin: polyValue(genome, 'skin'),
    height,
    strength,
    intellect,
    beauty,
    charisma,
    ambition,
    kindness,
    fertility,
    longevity,
    vigor,
    load,
    jaw,
    madness,
    lethal,
    hemophilia,
    colorblind,
    resistance,
  };
}

export const HAIR_LABEL = { D: '黒髪', L: '金髪', r: '赤毛' };
export const EYE_LABEL = { B: '茶色の瞳', g: '緑の瞳', u: '青い瞳' };

// "D/L" のような表記。優性側を先に、男性の X 連鎖座は "h/Y"
export function genotypeString(genome, key) {
  const locus = LOCUS[key];
  const i = INDEX[key];
  const a = genome.m[i];
  const b = genome.p[i];
  if (b === null) return `${a}/Y`;
  const [x, y] = locus.alleles.indexOf(a) <= locus.alleles.indexOf(b) ? [a, b] : [b, a];
  return `${x}/${y}`;
}

export function isCarrier(genome, key) {
  const locus = LOCUS[key];
  if (!locus.lof && locus.mode !== 'xlinked') return false;
  const al = allelesAt(genome, key);
  return al.length === 2 && al[0] !== al[1];
}

// 遺伝子座ごとの効果の説明
export function locusEffect(key, genome, pheno) {
  const locus = LOCUS[key];
  const al = allelesAt(genome, key);
  const het = al.length === 2 && al[0] !== al[1];
  switch (locus.mode) {
    case 'series':
      return key === 'HAIR' ? HAIR_LABEL[pheno.hair] : EYE_LABEL[pheno.eye];
    case 'overdominant':
      return het ? '疫病に強い（ヘテロ）' : '疫病に弱い（ホモ）';
    case 'xlinked': {
      const hit = al.every((a) => a === locus.alleles[1]);
      return hit ? `${locus.labels[locus.alleles[1]]}（発症）` : het ? '発症しない（保因者）' : '正常';
    }
    case 'recessive': {
      const hit = al.every((a) => a === locus.alleles[1]);
      return hit ? `${locus.labels[locus.alleles[1]]}（発症）` : het ? '健康（保因者）' : '正常';
    }
    case 'polygenic':
      return `＋${al.filter((a) => a === '+').length}`;
    default:
      return '';
  }
}

// 2 人から生まれる子の分布をモンテカルロで予測する
export function predictOffspring(motherGenome, fatherGenome, rng, n = 2000) {
  const out = { n, lethal: 0, hemophiliaM: 0, males: 0, jaw: 0, madness: 0, load: 0, hair: {}, eye: {} };
  for (let k = 0; k < n; k++) {
    const z = fertilize(makeGamete(motherGenome, 'F', rng), makeGamete(fatherGenome, 'M', rng));
    const ph = express(z.genome);
    if (ph.lethal) {
      out.lethal++;
      continue;
    }
    if (z.sex === 'M') {
      out.males++;
      if (ph.hemophilia) out.hemophiliaM++;
    }
    if (ph.jaw) out.jaw++;
    if (ph.madness) out.madness++;
    if (ph.load > 0) out.load++;
    out.hair[ph.hair] = (out.hair[ph.hair] ?? 0) + 1;
    out.eye[ph.eye] = (out.eye[ph.eye] ?? 0) + 1;
  }
  out.born = n - out.lethal;
  return out;
}

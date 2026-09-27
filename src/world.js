// シミュレーション本体：人（王侯貴族）・家・王国・結婚・出生・死・継承・戦争・反乱。1 ステップ = 1 年。
//
// 設計の原則（isolated-sim と同じ）
// - 「この遺伝子は有利」と直接書かない。遺伝子は能力・魅力・健康を通してだけ、結婚・出世・生死に効く。
// - 近親婚そのものに罰はない。弱るのは、劣性の遺伝子がそろったときだけ（近交弱勢は遺伝子型から生じる）。
// - 平民は数（地方の人口）だけで持ち、名前のある人は王侯貴族だけにする。

import { createRng } from './rng.js';
import { makeGamete, fertilize, express, randomGenome, randomEnv, regionalFreqs, allelesAt, INDEX } from './genes.js';
import { Pedigree } from './pedigree.js';
import { CULTURES, givenName, dynastyName, kingdomName, regnalSuffix } from './names.js';
import { generateMap, partition } from './map.js';

export const ADULT = 16;

export const LAWS = {
  agnatic: { label: '男系長子相続', desc: '男子とその男系の子孫だけが継ぐ。女子しかいないと王家は断絶する。' },
  cognatic: { label: '男子優先長子相続', desc: '男子が先、いなければ女子も継ぐ。女王の子は夫の家名を継ぐので、王朝が入れ替わる。' },
  absolute: { label: '絶対長子相続', desc: '男女を問わず、先に生まれた子が継ぐ。' },
  elective: { label: '選挙君主制', desc: '諸侯の当主が投票で王を選ぶ。能力と魅力と血縁がものを言う。' },
};

// 近親婚への考え方。maxPhi 以上の血縁係数の相手とは結婚しない
export const CUSTOMS = {
  strict: { label: '近親婚を禁じる', desc: 'またいとこより近い相手とは結婚しない。', maxPhi: 1 / 40, kinPenalty: 400, bloodBonus: 0 },
  moderate: { label: 'いとこ婚まで', desc: 'いとこまでは許されるが、避けられる。', maxPhi: 0.07, kinPenalty: 250, bloodBonus: 0 },
  royal: { label: '血の純潔を尊ぶ', desc: '王家どうし・一族どうしの結婚を好む。叔父と姪の結婚も許される（ハプスブルク家のように）。', maxPhi: 0.2, kinPenalty: 0, bloodBonus: 160 },
};

const KINGDOM_COLORS = ['#c0392b', '#2e6fbd', '#d4a017', '#2f9e5b', '#8e44ad', '#d35400', '#16a2a0', '#7f8c8d', '#b0406f', '#556b2f', '#a0522d', '#4b5d9e'];
const DYNASTY_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'];

const DEFAULTS = {
  seed: 'kingdom',
  kingdoms: 5,
  provinces: 42,
  startYear: 1000,
  mutationRate: 0.0005,
  plague: true,
  custom: 'mixed', // 'mixed' なら王国ごとにばらばら
  law: 'mixed',
  warLust: 1, // 戦争の起こりやすさ（倍率）
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class World {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.rng = createRng(`${this.o.seed}`);
    this.year = this.o.startYear;
    this.nextId = 1;
    this.ped = new Pedigree();
    this.people = this.ped.records;
    this.living = [];
    this.dynasties = [];
    this.kingdoms = [];
    this.wars = [];
    this.nextWarId = 1;
    this.log = [];
    this.history = [];
    this.truces = new Map();
    this.alliances = new Set();
    this.plague = null;
    this.usedDynasty = new Set();
    this.usedKingdom = new Set();
    this.stats = this._freshStats();
    this.headCache = new Map();
    this.map = generateMap(this.rng, { provinces: this.o.provinces });
    this.provinces = this.map.provinces;
    this._setup();
    this._refreshCaches();
    this._record();
  }

  _freshStats() {
    return { births: 0, stillborn: 0, marriages: 0, battles: 0, deaths: {} };
  }

  // ───────── 基本の問い合わせ ─────────

  get(id) {
    return this.ped.get(id);
  }

  age(p) {
    return (p.alive ? this.year : p.deathYear) - p.birthYear;
  }

  dyn(p) {
    return p && p.dynastyId != null ? this.dynasties[p.dynastyId] : null;
  }

  kingdomOf(p) {
    return p && p.kingdomId != null ? this.kingdoms[p.kingdomId] : null;
  }

  ruler(k) {
    return k && k.rulerId != null ? this.get(k.rulerId) : null;
  }

  aliveKingdoms() {
    return this.kingdoms.filter((k) => k.alive);
  }

  provincesOf(k) {
    return this.provinces.filter((p) => p.ownerId === k.id);
  }

  // 魅力：容姿・カリスマ・健康・若さ・狂気。結婚相手の選びやすさに使う
  charm(p) {
    const ph = p.pheno;
    const a = this.age(p);
    let youth;
    if (p.sex === 'F') youth = a < 16 ? -10 : a <= 26 ? 8 : 8 - (a - 26) * 1.2;
    else youth = a < 16 ? -10 : a <= 35 ? 4 : 4 - (a - 35) * 0.6;
    let v = ph.beauty * 0.45 + ph.charisma * 0.35 + (ph.vigor - 60) * 0.15 + youth + 8;
    if (p.mad) v -= 20;
    return clamp(v, 0, 100);
  }

  martial(p) {
    const ph = p.pheno;
    let v = ph.strength * 0.45 + ph.intellect * 0.3 + ph.charisma * 0.15 + (ph.height - 165) * 0.4 + 5;
    if (p.mad) v -= 10;
    if (ph.hemophilia) v -= 25;
    return clamp(v, 0, 100);
  }

  stewardship(p) {
    const ph = p.pheno;
    let v = ph.intellect * 0.6 + ph.charisma * 0.25 + ph.kindness * 0.15;
    if (p.mad) v *= 0.5;
    return clamp(v, 0, 100);
  }

  isRuler(p) {
    return p.rulerOf != null;
  }

  // p が王家の近親（王本人・王の親・子・きょうだい）なら、その王国
  royalOf(p) {
    if (!p) return null;
    if (this._royalMemo) {
      if (this._royalMemo.has(p.id)) return this._royalMemo.get(p.id);
      this._royalMemo.set(p.id, null);
      const v = this._royalOf(p);
      this._royalMemo.set(p.id, v);
      return v;
    }
    return this._royalOf(p);
  }

  _royalOf(p) {
    if (p.rulerOf != null) return this.kingdoms[p.rulerOf];
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const r = this.ruler(k);
      if (!r || r.dynastyId !== p.dynastyId) continue;
      if (p.fatherId === r.id || p.motherId === r.id || r.fatherId === p.id || r.motherId === p.id) return k;
      if (p.fatherId != null && (p.fatherId === r.fatherId || p.motherId === r.motherId)) return k;
    }
    return null;
  }

  heirOf(k) {
    return k.heirId != null ? this.get(k.heirId) : null;
  }

  // 家の当主：その家の生きている大人のうち、男系・年長を優先
  head(d) {
    const cached = this.headCache.get(d.id);
    if (cached && cached.alive && cached.dynastyId === d.id) return cached;
    let best = null;
    let bestScore = -Infinity;
    for (const p of this.living) {
      if (!p.alive || p.dynastyId !== d.id) continue;
      const a = this.age(p);
      const s = (p.rulerOf != null ? 1000 : 0) + (a >= ADULT ? 200 : 0) + (p.sex === 'M' ? 100 : 0) + Math.min(a, 70);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    this.headCache.set(d.id, best);
    return best;
  }

  // 称号（表示用）
  titleOf(p) {
    if (!p.alive) return p.rulerOfEver != null ? `元${this.kingdoms[p.rulerOfEver].name}${p.sex === 'M' ? '王' : '女王'}` : '';
    if (p.rulerOf != null) return `${this.kingdoms[p.rulerOf].name}${p.sex === 'M' ? '王' : '女王'}`;
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      if (k.heirId === p.id) return `${k.name}の${p.sex === 'M' ? '王太子' : '王太女'}`;
      if (k.regentId === p.id) return `${k.name}の摂政`;
    }
    const sp = p.spouseId != null ? this.get(p.spouseId) : null;
    if (sp && sp.alive && sp.rulerOf != null) return `${this.kingdoms[sp.rulerOf].name}の${p.sex === 'F' ? '王妃' : '王配'}`;
    const rk = this.royalOf(p);
    if (rk) {
      const r = this.ruler(rk);
      if (p.fatherId === r.id || p.motherId === r.id) return `${rk.name}の${p.sex === 'M' ? '王子' : '王女'}`;
      return `${rk.name}の王族`;
    }
    const d = this.dyn(p);
    if (d && this.head(d) === p) return `${d.name}家の当主`;
    if (p.lowborn) return '平民の出';
    return '';
  }

  displayName(p) {
    const base = p.regnal ?? p.name;
    const ep = p.epithet ? `「${p.epithet}」` : '';
    const d = this.dyn(p);
    return `${base}${ep}${d ? `・${d.name}` : ''}`;
  }

  // 年代記の本文に埋め込むリンク。UI で名前に置き換える
  pn(p) {
    return `{p:${p.id}}`;
  }

  kn(k) {
    return `{k:${k.id}}`;
  }

  addLog(kind, text, kingdomIds = []) {
    this.log.push({ year: this.year, kind, text, kingdoms: kingdomIds });
    if (this.log.length > 4000) this.log.splice(0, 1000);
  }

  // 本文のリンクを名前に置き換える（ヘッドレス用）
  plainText(text) {
    return text
      .replace(/\{p:(\d+)\}/g, (_, id) => this.displayName(this.get(Number(id))))
      .replace(/\{k:(\d+)\}/g, (_, id) => this.kingdoms[Number(id)].name);
  }

  // ───────── 人・家・王国をつくる ─────────

  _newPerson({ sex, birthYear, genome, env, motherId = null, fatherId = null, dynastyId = null, kingdomId = null, culture = 0, name = null, lowborn = false }) {
    const pheno = express(genome, env);
    const p = {
      id: this.nextId++,
      name: name ?? givenName(this.rng, culture, sex),
      sex,
      birthYear,
      deathYear: null,
      alive: true,
      genome,
      env,
      pheno,
      motherId,
      fatherId,
      dynastyId,
      kingdomId,
      culture,
      lowborn,
      spouseId: null,
      spouses: [],
      children: [],
      F: this.ped.kinship(motherId, fatherId),
      claims: [],
      cause: null,
      epithet: null,
      regnal: null,
      rulerOf: null,
      rulerOfEver: null,
      mad: false,
      madOnset: pheno.madness ? 18 + this.rng.int(30) : null,
      lastBirthYear: -99,
    };
    this.ped.add(p);
    this.living.push(p);
    if (motherId != null) this.get(motherId).children.push(p.id);
    if (fatherId != null) this.get(fatherId).children.push(p.id);
    return p;
  }

  _founder(sex, age, region, extra) {
    return this._newPerson({ sex, birthYear: this.year - age, genome: randomGenome(sex, this.rng, region), env: randomEnv(this.rng), ...extra });
  }

  _child(mother, father, birthYear, extra = {}) {
    for (let tries = 0; tries < 20; tries++) {
      const z = fertilize(makeGamete(mother.genome, 'F', this.rng, this.o.mutationRate), makeGamete(father.genome, 'M', this.rng, this.o.mutationRate));
      if (extra.sex && z.sex !== extra.sex) continue;
      if (express(z.genome).lethal) continue;
      return this._newPerson({ sex: z.sex, birthYear, genome: z.genome, env: randomEnv(this.rng), motherId: mother.id, fatherId: father.id, ...extra });
    }
    return null;
  }

  _newDynasty(culture, kingdomId, homeProvinceId, founderYear = this.year, parentId = null) {
    const d = {
      id: this.dynasties.length,
      name: dynastyName(this.rng, culture, this.usedDynasty),
      culture,
      color: DYNASTY_COLORS[this.dynasties.length % DYNASTY_COLORS.length],
      kingdomId,
      homeProvinceId,
      prestige: 10,
      foundedYear: founderYear,
      founderId: null,
      extinct: false,
      extinctYear: null,
      everRuled: false,
      parentId,
    };
    this.dynasties.push(d);
    return d;
  }

  _marry(a, b, matrilineal = false) {
    const [h, w] = a.sex === 'M' ? [a, b] : [b, a];
    h.spouseId = w.id;
    w.spouseId = h.id;
    h.spouses.push({ id: w.id, year: this.year, matrilineal });
    w.spouses.push({ id: h.id, year: this.year, matrilineal });
    w.matrilineal = matrilineal;
    h.matrilineal = matrilineal;
  }

  _regionFor(provinceId) {
    return regionalFreqs(this.provinces[provinceId].lat);
  }

  // 家族をつくる（初期化と新しい家の叙爵に使う）
  _family(d, k, homeProvince, headAge, { withParents = false, siblings = 0, culture }) {
    const region = this._regionFor(homeProvince);
    const extra = { dynastyId: d.id, kingdomId: k.id, culture };
    let head;
    const sibs = [];
    if (withParents) {
      const oldAge = headAge + 22 + this.rng.int(10);
      const gf = this._founder('M', oldAge + 3, region, extra);
      const gm = this._founder('F', oldAge, region, { ...extra, dynastyId: null, lowborn: true });
      this._marry(gf, gm);
      d.founderId = gf.id;
      head = this._child(gm, gf, this.year - headAge, { ...extra, sex: 'M' });
      for (let s = 0; s < siblings; s++) {
        const c = this._child(gm, gf, this.year - headAge + 2 + s * 2 + this.rng.int(2), extra);
        if (c) sibs.push(c);
      }
      this._kill(gf, '老衰', true);
      if (this.rng.chance(0.7)) this._kill(gm, '病死', true);
    } else {
      head = this._founder('M', headAge, region, extra);
      d.founderId = head.id;
    }
    // 配偶者と子
    for (const h of [head, ...sibs]) {
      const a = this.age(h);
      if (a < 18) continue;
      const sp = this._founder(h.sex === 'M' ? 'F' : 'M', clamp(a + (h.sex === 'M' ? -3 - this.rng.int(6) : 3), 16, 60), region, {
        kingdomId: k.id,
        culture,
        lowborn: true,
      });
      const [hus, wife] = h.sex === 'M' ? [h, sp] : [sp, h];
      this._marry(hus, wife, h.sex === 'F');
      const wifeAge = this.age(wife);
      const nKids = this.rng.int(Math.min(5, Math.max(1, Math.floor((wifeAge - 16) / 3)) + 1));
      for (let c = 0; c < nKids; c++) {
        const by = this.year - this.rng.int(Math.max(1, wifeAge - 16));
        this._child(wife, hus, by, { dynastyId: hus.dynastyId ?? d.id, kingdomId: k.id, culture });
      }
    }
    return head;
  }

  _setup() {
    const { capitals, owner } = partition(this.rng, this.provinces, this.o.kingdoms);
    const lawKeys = ['agnatic', 'cognatic', 'cognatic', 'absolute', 'elective'];
    const customKeys = ['strict', 'moderate', 'moderate', 'royal'];
    const { W, H } = this.map;
    capitals.forEach((cap, i) => {
      const cp = this.provinces[cap];
      const dx = cp.cx - W / 2;
      const dy = cp.cy - H / 2;
      const culture = Math.abs(dy) * 1.5 > Math.abs(dx) ? (dy < 0 ? 0 : 2) : dx < 0 ? 1 : 3;
      this._newKingdom({
        culture,
        capital: cap,
        law: this.o.law === 'mixed' ? this.rng.pick(lawKeys) : this.o.law,
        custom: this.o.custom === 'mixed' ? this.rng.pick(customKeys) : this.o.custom,
      });
    });
    owner.forEach((kid, pid) => {
      const pr = this.provinces[pid];
      pr.ownerId = kid;
      pr.origin = kid;
      pr.culture = this.kingdoms[kid].culture;
    });
    for (const k of this.kingdoms) {
      const culture = k.culture;
      const provs = this.provincesOf(k);
      // 王家
      const rd = this._newDynasty(culture, k.id, k.capital, this.year - 60 - this.rng.int(120));
      rd.prestige = 60;
      const ruler = this._family(rd, k, k.capital, 28 + this.rng.int(20), { withParents: true, siblings: this.rng.int(3), culture });
      this._crown(k, ruler, 'init');
      // 諸侯の家
      const nHouses = 2 + Math.floor(provs.length / 4);
      for (let h = 0; h < nHouses; h++) {
        const home = this.rng.pick(provs).id;
        const d = this._newDynasty(culture, k.id, home, this.year - this.rng.int(150));
        d.prestige = 15 + this.rng.int(25);
        this._family(d, k, home, 22 + this.rng.int(30), { withParents: this.rng.chance(0.5), siblings: this.rng.int(2), culture });
      }
    }
    this.addLog('event', `${this.year}年、${this.aliveKingdoms().length} つの王国が大陸を分け合っている。`);
  }

  _newKingdom({ culture, capital, law, custom, name = null, origin = null }) {
    const k = {
      id: this.kingdoms.length,
      name: name ?? kingdomName(this.rng, culture, this.usedKingdom),
      culture,
      color: KINGDOM_COLORS[this.kingdoms.length % KINGDOM_COLORS.length],
      capital,
      law,
      custom,
      alive: true,
      foundedYear: this.year,
      endYear: null,
      rulerId: null,
      heirId: null,
      regentId: null,
      rulers: [],
      nameCounts: {},
      exhaustion: 0,
      lastDefeat: -99,
      origin: origin ?? this.kingdoms.length,
    };
    this.kingdoms.push(k);
    return k;
  }

  // ───────── 1 年を進める ─────────

  step() {
    this.year++;
    this.stats = this._freshStats();
    this._refreshCaches();
    this._events();
    this._provinces();
    this._aging();
    this._mortality();
    this._regencies();
    this._intrigue();
    this._marriages();
    this._births();
    this._refreshCaches();
    this._updateAlliances();
    this._warsStep();
    this._declareWars();
    this._revolts();
    this._housekeeping();
    this._record();
  }

  _refreshCaches() {
    this.living = this.living.filter((p) => p.alive);
    this.headCache = new Map();
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const line = this.successionLine(k, 1);
      k.heirId = line.length ? line[0].id : null;
    }
  }

  _events() {
    if (this.plague) {
      this.plague.years--;
      if (this.plague.years <= 0) {
        this.addLog('event', '疫病がおさまった。');
        this.plague = null;
      }
    } else if (this.o.plague && this.rng.chance(1 / 45)) this.startPlague();
  }

  startPlague() {
    this.plague = { years: 2 + this.rng.int(3), severity: 0.04 + this.rng.next() * 0.08 };
    this.addLog('event', '大陸に疫病が広がった。免疫型の違う遺伝子を 2 つ持つ人ほど生き延びやすい。');
  }

  // 神の介入：戦乱の時代・平和の時代（20 年）
  setEra(kind) {
    this.era = { lust: kind === 'war' ? 3 : 0.15, until: this.year + 20, kind };
    this.addLog('event', kind === 'war' ? '戦乱の時代が始まった。王たちは剣をとりたがっている。' : '平和の時代が訪れた。王たちは戦を望まない。');
  }

  warLust() {
    const era = this.era && this.era.until > this.year ? this.era.lust : 1;
    return this.o.warLust * era;
  }

  // 神の介入：血友病の保因者である、魅力的な亡命貴族の娘を送り込む（ヴィクトリア女王の子孫のように）
  sendCarrierPrincess() {
    const ks = this.aliveKingdoms();
    const k = ks.reduce((a, b) => (this.power(a) >= this.power(b) ? a : b));
    const region = this._regionFor(k.capital);
    const d = this._newDynasty(this.rng.int(4), k.id, k.capital);
    d.prestige = 120;
    let girl = null;
    for (let tries = 0; tries < 200 && !girl; tries++) {
      const g = randomGenome('F', this.rng, region);
      g.m[INDEX.HEM] = 'h';
      g.p[INDEX.HEM] = 'H';
      const env = randomEnv(this.rng);
      const ph = express(g, env);
      if (ph.beauty < 65 || ph.lethal || ph.jaw) continue;
      girl = this._newPerson({ sex: 'F', birthYear: this.year - 16, genome: g, env, dynastyId: d.id, kingdomId: k.id, culture: k.culture });
    }
    if (!girl) return null;
    d.founderId = girl.id;
    this.addLog('gene', `亡命した名門 ${d.name}家の娘 ${this.pn(girl)}（16歳）が ${this.kn(k)} の宮廷に現れた。美しく家格も高いが、X 染色体に血友病の遺伝子を 1 つ持つ保因者である。`, [k.id]);
    return girl;
  }

  _provinces() {
    for (const pr of this.provinces) {
      const cap = pr.capacity * (1 - pr.devastation * 0.6);
      pr.pop += pr.pop * 0.03 * (1 - pr.pop / cap);
      if (this.plague) pr.pop *= 1 - this.plague.severity * 0.6;
      pr.pop = Math.max(pr.capacity * 0.05, pr.pop);
      pr.devastation = Math.max(0, pr.devastation - 0.05);
    }
  }

  _aging() {
    for (const p of this.living) {
      if (!p.alive) continue;
      if (p.madOnset != null && !p.mad && this.age(p) >= p.madOnset) {
        p.mad = true;
        if (p.rulerOf != null) this.addLog('gene', `${this.pn(p)} が狂気に陥った。（狂気の遺伝子 m を両親から 1 つずつ受け継いでいた）`, [p.rulerOf]);
      }
    }
  }

  // 1 年の死亡率
  hazard(p) {
    const a = this.age(p);
    const ph = p.pheno;
    let h;
    if (a === 0) h = 0.12;
    else if (a < 5) h = 0.025;
    else if (a < 15) h = 0.007;
    else h = 0.007 + 0.0003 * Math.exp(0.1 * (a - 20 - ph.longevity));
    h *= Math.exp((100 - ph.vigor) / 35);
    if (ph.hemophilia && p.sex === 'M') h += a < 25 ? 0.05 : 0.03;
    if (p.mad) h *= 1.3;
    if (this.plague) h += this.plague.severity * (1 - ph.resistance) * 1.6;
    return h;
  }

  _mortality() {
    for (const p of this.living) {
      if (!p.alive) continue;
      const h = this.hazard(p);
      if (!this.rng.chance(h)) continue;
      const a = this.age(p);
      const ph = p.pheno;
      let cause;
      if (this.plague && this.rng.chance((this.plague.severity * (1 - ph.resistance) * 1.6) / h)) cause = '疫病';
      else if (ph.hemophilia && p.sex === 'M' && this.rng.chance(0.6)) cause = '血友病';
      else if (a < 5) cause = '夭折';
      else if (a >= 62) cause = '老衰';
      else cause = '病死';
      this._kill(p, cause);
    }
  }

  _kill(p, cause, silent = false) {
    if (!p.alive) return;
    p.alive = false;
    p.deathYear = this.year;
    p.cause = cause;
    if (!silent) this.stats.deaths[cause] = (this.stats.deaths[cause] ?? 0) + 1;
    const sp = p.spouseId != null ? this.get(p.spouseId) : null;
    if (sp && sp.spouseId === p.id) sp.spouseId = null;
    if (silent) return;
    if (cause === '血友病' && this.royalOf(p)) {
      const mom = this.get(p.motherId);
      this.addLog('gene', `${this.pn(p)} が血友病で亡くなった（${this.age(p)}歳）。${mom ? `血友病の遺伝子は母 ${this.pn(mom)} から受け継いだ。` : ''}`, [this.royalOf(p).id]);
    }
    for (const k of this.kingdoms) if (k.regentId === p.id) k.regentId = null;
    if (p.rulerOf != null) this._onRulerDeath(this.kingdoms[p.rulerOf], p, cause);
  }

  // ───────── 継承 ─────────

  _sortedChildren(p, law) {
    const kids = p.children.map((id) => this.get(id)).sort((a, b) => a.birthYear - b.birthYear || a.id - b.id);
    if (law === 'agnatic') return kids.filter((c) => c.sex === 'M');
    if (law === 'cognatic') return [...kids.filter((c) => c.sex === 'M'), ...kids.filter((c) => c.sex === 'F')];
    return kids;
  }

  // 継承順位。長子相続の系統を深さ優先でたどり、尽きたら親の代へさかのぼる
  successionLine(k, limit = 8, lawOverride = null, rulerOverride = null) {
    const law = lawOverride ?? k.law;
    const ruler = rulerOverride ?? this.ruler(k);
    if (!ruler) return [];
    if (law === 'elective') return this.electionCandidates(k, ruler).slice(0, limit);
    const out = [];
    const visited = new Set([ruler.id]);
    const dfs = (p, depth) => {
      if (depth > 6) return;
      for (const c of this._sortedChildren(p, law)) {
        if (out.length >= limit) return;
        if (visited.has(c.id)) continue;
        visited.add(c.id);
        if (c.alive) out.push(c);
        dfs(c, depth + 1);
      }
    };
    let cur = ruler;
    for (let gen = 0; gen < 5 && out.length < limit; gen++) {
      dfs(cur, 0);
      const f = cur.fatherId != null ? this.get(cur.fatherId) : null;
      const m = cur.motherId != null ? this.get(cur.motherId) : null;
      // 王家の血が来た側の親へさかのぼる
      let parent = null;
      if (law === 'agnatic') parent = f;
      else if (f && f.dynastyId === ruler.dynastyId) parent = f;
      else if (m && m.dynastyId === ruler.dynastyId) parent = m;
      else parent = f ?? m;
      if (law === 'agnatic' && parent && parent.dynastyId !== ruler.dynastyId) parent = null;
      if (!parent) break;
      visited.add(parent.id);
      cur = parent;
    }
    return out;
  }

  // 選挙の候補：王家の大人と、諸侯の当主。票読みの順
  electionCandidates(k, ruler = null) {
    const cands = new Set();
    for (const p of this.living) {
      if (!p.alive || p.kingdomId !== k.id || this.age(p) < ADULT || p.rulerOf != null) continue;
      if (ruler && p.dynastyId === ruler.dynastyId) cands.add(p);
    }
    for (const d of this.dynasties) {
      if (d.extinct) continue;
      const h = this.head(d);
      if (h && h.alive && h.kingdomId === k.id && this.age(h) >= ADULT && h.rulerOf == null) cands.add(h);
    }
    const electors = this.dynasties
      .map((d) => (d.extinct ? null : this.head(d)))
      .filter((h) => h && h.alive && h.kingdomId === k.id && this.age(h) >= ADULT);
    const list = [...cands];
    const votes = new Map(list.map((c) => [c.id, 0]));
    const base = (c) =>
      this.stewardship(c) * 0.4 + this.martial(c) * 0.3 + this.charm(c) * 0.3 + Math.min(40, (this.dyn(c)?.prestige ?? 0) * 0.1) - Math.max(0, this.age(c) - 50) * 2;
    for (const e of electors) {
      let best = null;
      let bestS = -Infinity;
      for (const c of list) {
        let s = base(c) + 120 * this.ped.kinship(e.id, c.id) + (c === e ? 15 : 0) + (c.dynastyId === e.dynastyId ? 20 : 0);
        s -= c.mad ? 30 : 0;
        if (s > bestS) {
          bestS = s;
          best = c;
        }
      }
      if (best) votes.set(best.id, votes.get(best.id) + 1);
    }
    return list.sort((a, b) => votes.get(b.id) - votes.get(a.id) || base(b) - base(a));
  }

  _onRulerDeath(k, ruler, cause) {
    this._endReign(k, ruler);
    const verb = { 戦死: '戦場で倒れた', 処刑: '処刑された', 暗殺: '暗殺された' }[cause] ?? '崩御した';
    this.addLog('death', `${this.pn(ruler)} が${verb}（${this.age(ruler)}歳・${cause}）。`, [k.id]);
    this._succeed(k, ruler);
  }

  _endReign(k, ruler) {
    ruler.rulerOf = null;
    k.rulerId = null;
    const reign = k.rulers.at(-1);
    if (reign && reign.id === ruler.id) {
      reign.to = this.year;
      reign.provincesEnd = this.provincesOf(k).length;
      ruler.epithet = ruler.epithet ?? this._epithet(ruler, reign);
      reign.epithet = ruler.epithet;
    }
  }

  _epithet(p, reign) {
    const len = this.year - reign.from;
    const gained = (reign.provincesEnd ?? 0) - reign.provincesStart;
    const ph = p.pheno;
    const opts = [];
    if (p.mad) opts.push([100, p.sex === 'M' ? '狂王' : '狂女王']);
    if (reign.warsWon >= 3 && gained >= 3) opts.push([90, p.sex === 'M' ? '大王' : '大女王']);
    if (reign.warsWon >= 2 && gained >= 1) opts.push([70, '征服王']);
    if (gained <= -3) opts.push([65, '失地王']);
    if (ph.hemophilia) opts.push([60, '病弱王']);
    if (ph.intellect >= 82) opts.push([55, '賢王']);
    if (ph.beauty >= 82) opts.push([50, p.sex === 'M' ? '美貌王' : '美貌の女王']);
    if (ph.jaw) opts.push([45, '顎王']);
    if (ph.height >= (p.sex === 'M' ? 188 : 176)) opts.push([40, '長身王']);
    if (ph.kindness >= 82) opts.push([38, '慈悲王']);
    if (ph.kindness <= 15 && ph.ambition >= 70) opts.push([38, '残酷王']);
    if (len <= 1) opts.push([35, '短命王']);
    if (this.age(p) >= 75) opts.push([30, '長命王']);
    if (len >= 45) opts.push([30, '長治王']);
    opts.sort((a, b) => b[0] - a[0]);
    return opts.length ? opts[0][1] : null;
  }

  _succeed(k, dead) {
    let winner = null;
    let how = 'inherit';
    if (k.law === 'elective') {
      winner = this.electionCandidates(k, dead)[0] ?? null;
      how = 'elected';
    } else {
      const line = this.successionLine(k, 6, null, dead);
      for (const cand of line) {
        if (cand.rulerOf != null) {
          const other = this.kingdoms[cand.rulerOf];
          const accept = this.rng.chance(0.35 + this.charm(cand) / 250);
          if (accept) {
            this._union(k, other, cand, dead);
            return;
          }
          if (!cand.claims.includes(k.id)) cand.claims.push(k.id);
          this.addLog('succession', `${this.kn(k)} の諸侯は、継承者である ${this.kn(other)} の君主 ${this.pn(cand)} を拒んだ。${this.pn(cand)} は請求権を主張している。`, [k.id, other.id]);
          continue;
        }
        winner = cand;
        break;
      }
      // 男系相続で女子に移らなかったとき、女系の請求権が残る
      if (k.law === 'agnatic') {
        const alt = this.successionLine(k, 1, 'cognatic', dead)[0];
        if (alt && alt !== winner && !alt.claims.includes(k.id)) alt.claims.push(k.id);
      }
      if (!winner) {
        const d = this.dyn(dead);
        this.addLog('dynasty', `${this.kn(k)} の ${d ? `${d.name}朝` : '王家'} は継承者が絶えた。諸侯が新しい王を選ぶ。`, [k.id]);
        winner = this.electionCandidates(k, null)[0] ?? null;
        how = 'elected';
      }
    }
    if (!winner) winner = this._raiseHouse(k, this.rng.pick(this.provincesOf(k)).id, true);
    this._crown(k, winner, how);
  }

  // 同君連合：継承者がすでに別の王国の君主なら、2 つの王国は 1 人の君主のもとで 1 つになる
  _union(k, into, heir, dead) {
    this.addLog('succession', `同君連合：${this.pn(heir)} が ${this.kn(k)} の王位も継ぎ、${this.kn(k)} は ${this.kn(into)} に統合された。`, [k.id, into.id]);
    this._absorb(k, into);
  }

  _absorb(k, into) {
    for (const pr of this.provinces) if (pr.ownerId === k.id) pr.ownerId = into.id;
    for (const p of this.living) if (p.alive && p.kingdomId === k.id) p.kingdomId = into.id;
    const r = this.ruler(k);
    if (r) this._endReign(k, r);
    this._destroy(k);
  }

  _destroy(k) {
    k.alive = false;
    k.endYear = this.year;
    k.rulerId = null;
    k.heirId = null;
    k.regentId = null;
    for (const w of this.wars) {
      if (w.ended) continue;
      if (w.attackerId === k.id || w.defenderId === k.id) this._endWar(w, 'white', '王国の消滅');
    }
  }

  _crown(k, p, how) {
    const prevReign = k.rulers.at(-1);
    const prevDyn = prevReign ? prevReign.dynastyId : null;
    if (p.kingdomId !== k.id) {
      p.kingdomId = k.id;
      const sp = p.spouseId != null ? this.get(p.spouseId) : null;
      if (sp && sp.alive && sp.rulerOf == null) sp.kingdomId = k.id;
      // 子も新しい宮廷へ移る（よそに嫁いだ娘・婿入りした息子は残る）
      for (const cid of p.children) {
        const c = this.get(cid);
        if (!c.alive || c.rulerOf != null) continue;
        const csp = c.spouseId != null ? this.get(c.spouseId) : null;
        if (csp && csp.alive && (c.sex === 'F' ? !c.matrilineal : c.matrilineal)) continue;
        c.kingdomId = k.id;
        if (csp && csp.alive && csp.rulerOf == null) csp.kingdomId = k.id;
      }
    }
    p.rulerOf = k.id;
    p.rulerOfEver = k.id;
    k.rulerId = p.id;
    p.claims = p.claims.filter((c) => c !== k.id);
    const n = (k.nameCounts[p.name] ?? 0) + 1;
    k.nameCounts[p.name] = n;
    p.regnal = p.name + regnalSuffix(n);
    const d = this.dyn(p);
    if (d) {
      d.everRuled = true;
      d.prestige += 20;
    }
    k.rulers.push({
      id: p.id,
      name: p.regnal,
      dynastyId: p.dynastyId,
      from: this.year,
      to: null,
      how,
      provincesStart: this.provincesOf(k).length,
      provincesEnd: null,
      warsWon: 0,
      warsLost: 0,
      epithet: null,
    });
    if (how !== 'init') {
      const how2 = { inherit: '即位した', elected: '選挙で王に選ばれた', conquest: '征服によって王位に就いた', usurp: '王位を奪った', independence: '独立を勝ち取り王位に就いた', union: '即位した' }[how];
      this.addLog('succession', `${this.pn(p)} が ${this.kn(k)} の${p.sex === 'M' ? '王' : '女王'}として${how2}（${this.age(p)}歳）。`, [k.id]);
      if (d && prevDyn !== d.id) this.addLog('dynasty', `${this.kn(k)} で ${d.name}朝が始まった。`, [k.id]);
    }
    this.headCache?.delete(p.dynastyId);
    k.heirId = null;
    if (this.age(p) < ADULT) this._setRegent(k);
  }

  _setRegent(k) {
    const r = this.ruler(k);
    if (!r) return;
    const mom = r.motherId != null ? this.get(r.motherId) : null;
    let regent = null;
    if (mom && mom.alive && !mom.mad && this.age(mom) >= ADULT && mom.rulerOf == null) regent = mom;
    else {
      let best = -1;
      for (const d of this.dynasties) {
        if (d.extinct) continue;
        const h = this.head(d);
        if (!h || !h.alive || h === r || h.kingdomId !== k.id || h.rulerOf != null || this.age(h) < ADULT) continue;
        const s = this.stewardship(h);
        if (s > best) {
          best = s;
          regent = h;
        }
      }
    }
    k.regentId = regent ? regent.id : null;
    if (regent) this.addLog('succession', `幼い${this.pn(r)} に代わり、${this.pn(regent)} が ${this.kn(k)} の摂政となった。`, [k.id]);
  }

  _regencies() {
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const r = this.ruler(k);
      if (!r) continue;
      if (this.age(r) >= ADULT && k.regentId != null) {
        k.regentId = null;
        this.addLog('succession', `${this.pn(r)} が成人し、親政を始めた。`, [k.id]);
      } else if (this.age(r) < ADULT && k.regentId == null) this._setRegent(k);
    }
  }

  // 野心が強く情けの薄い継承者は、王を暗殺することがある
  _intrigue() {
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const r = this.ruler(k);
      const heir = this.heirOf(k);
      if (!r || !heir || !heir.alive || this.age(heir) < 18 || heir.rulerOf != null) continue;
      if (heir.fatherId === r.id || heir.motherId === r.id) continue; // 親殺しはしない
      const ph = heir.pheno;
      if (ph.ambition < 70 || ph.kindness > 35) continue;
      const p = 0.012 * ((ph.ambition - 60) / 20) * (heir.mad ? 2 : 1);
      if (!this.rng.chance(p)) continue;
      this._kill(r, '暗殺');
      this.addLog('death', `黒幕は継承者 ${this.pn(heir)} だと噂された。`, [k.id]);
    }
  }

  // ───────── 結婚 ─────────

  // s の家から見た、相手 c の結婚相手としての値打ち
  spouseScore(s, c, phi) {
    const sk = this.kingdomOf(s);
    const custom = CUSTOMS[sk ? sk.custom : 'moderate'];
    if (phi >= custom.maxPhi) return -Infinity;
    const sRoyal = this.royalOf(s);
    const cRoyal = this.royalOf(c);
    const sImportant = sRoyal != null || this.isHeirAnywhere(s);
    const wp = sImportant ? 1 : 0.5;
    const wl = sImportant ? 0.55 : 0.95;
    let political = 0;
    if (c.rulerOf != null) political += 45;
    else if (cRoyal) political += 28;
    else if (this.isHeirAnywhere(c)) political += 30;
    const cd = this.dyn(c);
    political += Math.min(30, (cd ? cd.prestige : 0) * 0.12);
    if (c.lowborn) political -= 25;
    if (sRoyal && cRoyal && sRoyal !== cRoyal && !this.allied(sRoyal.id, cRoyal.id)) political += 18;
    let v = wp * political + wl * this.charm(c);
    const ca = this.age(c);
    const sa = this.age(s);
    if (c.sex === 'F') v -= Math.max(0, ca - 27) * (sImportant ? 3 : 1.8);
    v -= Math.max(0, Math.abs(ca - sa) - 10) * 1.2;
    if (c.pheno.hemophilia) v -= 12;
    if (custom.bloodBonus && s.dynastyId != null && s.dynastyId === c.dynastyId) v += 15 + phi * custom.bloodBonus;
    else if (custom.bloodBonus && sRoyal && cRoyal) v += phi * custom.bloodBonus * 0.6;
    v -= phi * custom.kinPenalty;
    return v;
  }

  isHeirAnywhere(p) {
    for (const k of this.kingdoms) if (k.alive && k.heirId === p.id) return k;
    return null;
  }

  atWar(a, b) {
    if (a == null || b == null || a === b) return false;
    return this.wars.some((w) => !w.ended && ((w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a)));
  }

  _marriages() {
    this._royalMemo = new Map();
    try {
      this._marriagesInner();
    } finally {
      this._royalMemo = null;
    }
  }

  _marriagesInner() {
    const men = [];
    const women = [];
    for (const p of this.living) {
      if (!p.alive || p.spouseId != null) continue;
      const a = this.age(p);
      const important = p.rulerOf != null || this.royalOf(p) || this.isHeirAnywhere(p);
      const market = important ? 0.85 : 0.5;
      if (p.sex === 'M' && a >= 16 && a <= 62 && this.rng.chance(market)) men.push(p);
      else if (p.sex === 'F' && a >= 15 && a <= 40 && this.rng.chance(market)) women.push(p);
    }
    const pairs = [];
    for (const m of men) {
      for (const w of women) {
        if (this.atWar(m.kingdomId, w.kingdomId)) continue;
        // 外国との縁組は王族か有力な家だけ
        if (m.kingdomId !== w.kingdomId && !(this.royalOf(m) || this.royalOf(w) || m.rulerOf != null || w.rulerOf != null)) continue;
        if (m.rulerOf != null && w.rulerOf != null && this.rng.chance(0.7)) continue;
        if (m.fatherId != null && (m.fatherId === w.fatherId || m.motherId === w.motherId)) continue;
        const phi = this.ped.kinship(m.id, w.id);
        const sm = this.spouseScore(m, w, phi);
        const sw = this.spouseScore(w, m, phi);
        if (sm === -Infinity || sw === -Infinity) continue;
        pairs.push([Math.min(sm, sw) + this.rng.normal() * 6, m, w]);
      }
    }
    pairs.sort((a, b) => b[0] - a[0]);
    const taken = new Set();
    for (const [score, m, w] of pairs) {
      if (score < 18) break;
      if (taken.has(m.id) || taken.has(w.id)) continue;
      taken.add(m.id);
      taken.add(w.id);
      this._wed(m, w);
    }
    // 貴族どうしで相手が見つからない人は、平民や下級騎士の家から迎える
    for (const p of [...men, ...women]) {
      if (taken.has(p.id) || !p.alive || p.spouseId != null || p.rulerOf != null) continue;
      const a = this.age(p);
      if (a < 21 || (p.sex === 'F' && a > 34)) continue;
      if (!this.rng.chance(this.royalOf(p) ? 0.05 : 0.3)) continue;
      const k = this.kingdomOf(p);
      const home = this.dyn(p)?.homeProvinceId ?? k?.capital ?? 0;
      const sAge = p.sex === 'M' ? clamp(a - 2 - this.rng.int(10), 16, 34) : clamp(a + this.rng.int(8) - 2, 18, 55);
      const sp = this._founder(p.sex === 'M' ? 'F' : 'M', sAge, this._regionFor(home), { kingdomId: p.kingdomId, culture: k ? k.culture : p.culture, lowborn: true });
      this._wed(p.sex === 'M' ? p : sp, p.sex === 'M' ? sp : p, true);
    }
  }

  _wed(m, w, quiet = false) {
    // 妻が継承者か女王で、夫がそうでなければ、子は妻の家名を継ぐ（女系婚）
    const wHeir = w.rulerOf != null || this.isHeirAnywhere(w);
    const mHeir = m.rulerOf != null || this.isHeirAnywhere(m);
    const matrilineal = m.dynastyId !== w.dynastyId && ((wHeir && !mHeir) || (m.lowborn && !w.lowborn));
    this._marry(m, w, matrilineal);
    this.stats.marriages++;
    // 住む国：ふつうは夫の国、女系婚なら妻の国。君主は動かない
    const [mover, stay] = matrilineal ? [m, w] : [w, m];
    if (mover.rulerOf == null) mover.kingdomId = stay.kingdomId;
    const phi = this.ped.kinship(m.id, w.id);
    const mk = this.royalOf(m);
    const wk = this.royalOf(w);
    const close = (p, k) => k && (p.rulerOf != null || [p.fatherId, p.motherId].includes(k.rulerId));
    if (!quiet && (close(m, mk) || close(w, wk) || mHeir || wHeir || (mk && wk && mk !== wk))) {
      const rel = phi >= 0.05 ? `（ふたりは${phi >= 0.11 ? '叔父と姪ほど' : 'いとこほど'}近い血縁：血縁係数 ${phi.toFixed(3)}）` : '';
      const al = mk && wk && mk !== wk ? `${this.kn(mk)} と ${this.kn(wk)} の同盟が結ばれた。` : '';
      this.addLog('marriage', `${this.pn(m)} と ${this.pn(w)} が結婚した${matrilineal ? '（子は妻の家名を継ぐ）' : ''}${rel}。${al}`, [mk?.id, wk?.id].filter((x) => x != null));
    }
  }

  // ───────── 出生 ─────────

  _nobleCap(k) {
    return 14 + this.provincesOf(k).length * 5;
  }

  _births() {
    const counts = new Map();
    for (const p of this.living) if (p.alive) counts.set(p.kingdomId, (counts.get(p.kingdomId) ?? 0) + 1);
    const moms = this.living.filter((p) => p.alive && p.sex === 'F' && p.spouseId != null);
    for (const w of moms) {
      const a = this.age(w);
      if (a < 15 || a > 46 || w.lastBirthYear === this.year) continue;
      const h = this.get(w.spouseId);
      if (!h || !h.alive) continue;
      const af = a < 18 ? 0.6 : a < 30 ? 1 : a < 35 ? 0.8 : a < 40 ? 0.55 : 0.2;
      const k = this.kingdomOf(w);
      const cap = k && k.alive ? clamp((this._nobleCap(k) / Math.max(1, counts.get(k.id) ?? 1)) ** 2, 0.03, 1.3) : 0.3;
      // 君主と継承者の家は子づくりに熱心
      const dynastic = w.rulerOf != null || h.rulerOf != null ? 1.3 : 1;
      const p = 0.42 * w.pheno.fertility * h.pheno.fertility * af * Math.min(1, cap * dynastic) * (w.mad ? 0.7 : 1);
      if (!this.rng.chance(p)) continue;
      this._birth(w, h);
      if (w.alive && this.rng.chance(0.015)) this._birth(w, h, true);
    }
  }

  _birth(w, h, twin = false) {
    w.lastBirthYear = this.year;
    const z = fertilize(makeGamete(w.genome, 'F', this.rng, this.o.mutationRate), makeGamete(h.genome, 'M', this.rng, this.o.mutationRate));
    const env = randomEnv(this.rng);
    const ph = express(z.genome, env);
    if (!twin && this.rng.chance(0.012 + (this.age(w) > 35 ? 0.02 : 0))) {
      this._kill(w, '産褥');
      if (!this.rng.chance(0.6)) return;
    }
    if (ph.lethal) {
      this.stats.stillborn++;
      return;
    }
    const matri = w.matrilineal && w.spouses.at(-1)?.id === h.id;
    const dynastyId = matri ? w.dynastyId ?? h.dynastyId : h.dynastyId ?? w.dynastyId;
    const kingdomId = matri ? w.kingdomId : h.kingdomId;
    const k = kingdomId != null ? this.kingdoms[kingdomId] : null;
    const culture = k ? k.culture : h.culture;
    const c = this._newPerson({
      sex: z.sex,
      birthYear: this.year,
      genome: z.genome,
      env,
      motherId: w.id,
      fatherId: h.id,
      dynastyId,
      kingdomId,
      culture,
      name: this._childName(z.sex, w, h, culture, dynastyId),
    });
    this.stats.births++;
    const rk = this.royalOf(c);
    if (rk && (h.rulerOf != null || w.rulerOf != null)) {
      const F = c.F >= 0.05 ? `近交係数 ${c.F.toFixed(3)}。` : '';
      const traits = [];
      if (ph.jaw) traits.push('受け口の顎');
      if (ph.hemophilia) traits.push('血友病');
      if (ph.load > 0) traits.push('虚弱');
      this.addLog('birth', `${this.kn(rk)} の${c.sex === 'M' ? '王子' : '王女'} ${this.pn(c)} が生まれた。${F}${traits.length ? `生まれつき${traits.join('・')}。` : ''}`, [rk.id]);
    }
  }

  // 名前：祖父母や親、歴代の王にちなむことが多い
  _childName(sex, w, h, culture, dynastyId) {
    // 生きているきょうだいと同じ名前は避ける
    const taken = new Set(w.children.map((id) => this.get(id)).filter((c) => c.alive).map((c) => c.name));
    for (let tries = 0; tries < 6; tries++) {
      const n = this._pickChildName(sex, w, h, culture, dynastyId);
      if (!taken.has(n)) return n;
    }
    return givenName(this.rng, culture, sex);
  }

  _pickChildName(sex, w, h, culture, dynastyId) {
    const r = this.rng.next();
    const pool = [];
    for (const par of [h, w]) {
      for (const gid of [par.fatherId, par.motherId]) {
        const g = gid != null ? this.get(gid) : null;
        if (g && g.sex === sex) pool.push(g.name);
      }
    }
    const parent = sex === 'M' ? h : w;
    if (r < 0.3 && pool.length) return this.rng.pick(pool);
    if (r < 0.45) return parent.name;
    if (r < 0.6) {
      const k = this.kingdoms.find((kk) => kk.alive && this.ruler(kk)?.dynastyId === dynastyId);
      const names = k ? k.rulers.map((x) => this.get(x.id)).filter((x) => x.sex === sex).map((x) => x.name) : [];
      if (names.length) return this.rng.pick(names);
    }
    return givenName(this.rng, culture, sex);
  }

  // ───────── 外交と戦争 ─────────

  allied(a, b) {
    return this.alliances.has(a < b ? `${a}-${b}` : `${b}-${a}`);
  }

  alliesOf(kid) {
    const out = [];
    for (const key of this.alliances) {
      const [a, b] = key.split('-').map(Number);
      if (a === kid) out.push(b);
      else if (b === kid) out.push(a);
    }
    return out;
  }

  // 同盟は、王家の近親どうしの結婚から生まれ、夫婦が生きているあいだ続く
  _updateAlliances() {
    this.alliances = new Set();
    for (const p of this.living) {
      if (!p.alive || p.sex !== 'M' || p.spouseId == null) continue;
      const w = this.get(p.spouseId);
      if (!w || !w.alive) continue;
      const a = this.royalOf(p);
      const b = this.royalOf(w);
      if (a && b && a !== b && a.alive && b.alive) this.alliances.add(a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);
    }
  }

  truce(a, b) {
    const t = this.truces.get(a < b ? `${a}-${b}` : `${b}-${a}`);
    return t != null && t > this.year;
  }

  neighbors(k) {
    const out = new Set();
    for (const pr of this.provinces) {
      if (pr.ownerId !== k.id) continue;
      for (const q of pr.neighbors) {
        const o = this.provinces[q].ownerId;
        if (o !== k.id && o >= 0) out.add(o);
      }
    }
    return [...out].map((id) => this.kingdoms[id]).filter((x) => x.alive);
  }

  // 兵力（千人）
  power(k) {
    let s = 0;
    for (const pr of this.provinces) if (pr.ownerId === k.id) s += pr.pop * 0.025 * (1 - pr.devastation * 0.5);
    const r = this.ruler(k);
    const comp = r ? 0.8 + this.stewardship(r) / 250 : 0.8;
    return s * comp * (k.regentId != null ? 0.85 : 1) * (1 - Math.min(0.5, k.exhaustion));
  }

  commander(k, excludeDynastyId = null) {
    const r = this.ruler(k);
    if (r && this.age(r) >= 18 && this.age(r) <= 65 && !r.pheno.hemophilia && this.martial(r) >= 50) return r;
    let best = null;
    let bestM = -1;
    for (const p of this.living) {
      if (!p.alive || p.kingdomId !== k.id || p.pheno.hemophilia) continue;
      if (excludeDynastyId != null && p.dynastyId === excludeDynastyId) continue;
      const a = this.age(p);
      if (a < 18 || a > 60) continue;
      const m = this.martial(p) - (p.sex === 'F' ? 15 : 0);
      if (m > bestM) {
        bestM = m;
        best = p;
      }
    }
    return best ?? r;
  }

  activeWars(kid) {
    return this.wars.filter((w) => !w.ended && (w.attackerId === kid || w.defenderId === kid));
  }

  _startWar(kind, attacker, defender, extra = {}) {
    const w = {
      id: this.nextWarId++,
      kind,
      attackerId: attacker.id,
      defenderId: defender.id,
      startYear: this.year,
      score: 0,
      battles: [],
      ended: false,
      endYear: null,
      result: null,
      claimantId: null,
      leaderId: null,
      rebelShare: 0,
      provinces: [],
      attackerAllies: [],
      defenderAllies: [],
      ...extra,
    };
    if (kind === 'conquest' || kind === 'claim') {
      w.attackerAllies = this.alliesOf(attacker.id).filter((a) => a !== defender.id && !this.allied(a, defender.id) && this.rng.chance(0.5));
      w.defenderAllies = this.alliesOf(defender.id).filter((a) => a !== attacker.id && !this.allied(a, attacker.id) && !w.attackerAllies.includes(a) && this.rng.chance(0.75));
    }
    this.wars.push(w);
    w.name = this._warName(w);
    return w;
  }

  _warName(w) {
    const a = this.kingdoms[w.attackerId];
    const d = this.kingdoms[w.defenderId];
    if (w.kind === 'claim') return `${d.name}継承戦争`;
    if (w.kind === 'civil') return `${d.name}の内乱（${this.dyn(this.get(w.leaderId))?.name ?? ''}家の反乱）`;
    if (w.kind === 'independence') return `${this.provinces[w.provinces[0]].name}独立戦争`;
    return `${a.name}・${d.name}戦争`;
  }

  _declareWars() {
    for (const k of this.kingdoms) {
      if (!k.alive || k.regentId != null) continue;
      if (this.activeWars(k.id).some((w) => w.attackerId === k.id || w.kind === 'civil' || w.kind === 'independence')) continue;
      const r = this.ruler(k);
      if (!r || this.age(r) < 18) continue;
      const ph = r.pheno;
      const agg = (0.015 + 0.05 * (ph.ambition / 100) - 0.02 * (ph.kindness / 100) + (r.mad ? 0.06 : 0) + (this.martial(r) - 50) / 2000) * this.warLust();
      if (agg <= 0) continue;
      const myPow = this.power(k);
      // 請求権の戦争：王本人・配偶者・子が持つ請求権
      const claimants = [r, ...(r.spouseId != null ? [this.get(r.spouseId)] : []), ...r.children.map((id) => this.get(id))].filter((p) => p && p.alive);
      let declared = false;
      for (const c of claimants) {
        for (const tid of c.claims) {
          const t = this.kingdoms[tid];
          if (!t.alive || t === k || this.allied(k.id, t.id) || this.truce(k.id, t.id) || this.atWar(k.id, t.id)) continue;
          const ratio = myPow / Math.max(1, this.power(t));
          if (this.rng.chance(agg * 2.5 * clamp(ratio, 0.2, 2))) {
            const w = this._startWar('claim', k, t, { claimantId: c.id });
            this.addLog('war', `${this.pn(r)} は ${c === r ? '自らの' : `${this.pn(c)} の`}${this.kn(t)} 王位への請求権を掲げ、宣戦した（${w.name}）。`, [k.id, t.id]);
            declared = true;
            break;
          }
        }
        if (declared) break;
      }
      if (declared) continue;
      // 征服の戦争：隣国のうち、同盟していない弱い国
      const targets = this.neighbors(k).filter((t) => !this.allied(k.id, t.id) && !this.truce(k.id, t.id) && !this.atWar(k.id, t.id));
      if (!targets.length) continue;
      let best = null;
      let bestRatio = 0;
      for (const t of targets) {
        const tp = this.power(t) + this.alliesOf(t.id).reduce((s, a) => s + this.power(this.kingdoms[a]) * 0.4, 0);
        const ratio = myPow / Math.max(1, tp);
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = t;
        }
      }
      if (best && this.rng.chance(agg * clamp(bestRatio - 0.6, 0, 1.6))) {
        const w = this._startWar('conquest', k, best);
        this.addLog('war', `${this.pn(r)} が ${this.kn(best)} に宣戦した（${w.name}）。${this._alliesText(w)}`, [k.id, best.id]);
      }
    }
  }

  _alliesText(w) {
    const t = [];
    if (w.attackerAllies.length) t.push(`${w.attackerAllies.map((a) => this.kn(this.kingdoms[a])).join('・')} が攻め手に加わった。`);
    if (w.defenderAllies.length) t.push(`${w.defenderAllies.map((a) => this.kn(this.kingdoms[a])).join('・')} が同盟に従い守り手に加わった。`);
    return t.join('');
  }

  _sidePower(w, side) {
    const main = this.kingdoms[side === 'A' ? w.attackerId : w.defenderId];
    if (w.kind === 'civil' || w.kind === 'independence') {
      const kp = this.power(this.kingdoms[w.defenderId]);
      if (side === 'A') return kp * w.rebelShare;
      return kp * (1 - w.rebelShare) + w.defenderAllies.reduce((s, a) => s + this.power(this.kingdoms[a]) * 0.4, 0);
    }
    const allies = side === 'A' ? w.attackerAllies : w.defenderAllies;
    return this.power(main) + allies.filter((a) => this.kingdoms[a].alive).reduce((s, a) => s + this.power(this.kingdoms[a]) * 0.5, 0);
  }

  _warsStep() {
    for (const w of this.wars) {
      if (w.ended) continue;
      const A = this.kingdoms[w.attackerId];
      const D = this.kingdoms[w.defenderId];
      if (!A.alive || !D.alive) {
        this._endWar(w, 'white', '王国の消滅');
        continue;
      }
      if (w.kind === 'claim' && !this.get(w.claimantId).alive) {
        this._endWar(w, 'white', '請求者の死');
        continue;
      }
      if ((w.kind === 'civil' || w.kind === 'independence') && !this.get(w.leaderId).alive) {
        this._endWar(w, 'defender', '反乱の指導者の死');
        continue;
      }
      this._battle(w);
      if (w.ended) continue;
      const years = this.year - w.startYear;
      if (w.score >= 100) this._endWar(w, 'attacker');
      else if (w.score <= -100) this._endWar(w, 'defender');
      else if (years >= 7) this._endWar(w, w.score > 30 ? 'attacker' : w.score < -30 ? 'defender' : 'white');
    }
    for (const k of this.kingdoms) k.exhaustion = Math.max(0, k.exhaustion * 0.85 - 0.01);
  }

  _battle(w) {
    const A = this.kingdoms[w.attackerId];
    const D = this.kingdoms[w.defenderId];
    const civil = w.kind === 'civil' || w.kind === 'independence';
    const cA = civil ? this.get(w.leaderId) : this.commander(A);
    const cD = this.commander(D, civil ? cA?.dynastyId : null);
    const pA = this._sidePower(w, 'A');
    const pD = this._sidePower(w, 'D');
    const mA = cA ? this.martial(cA) : 30;
    const mD = cD ? this.martial(cD) : 30;
    const sA = pA * (0.5 + mA / 100) * Math.exp(0.35 * this.rng.normal());
    const sD = pD * (0.5 + mD / 100) * Math.exp(0.35 * this.rng.normal()) * 1.1;
    const aWins = sA > sD;
    const margin = Math.abs(sA - sD) / Math.max(sA, sD, 1e-9);
    w.score += (aWins ? 1 : -1) * (15 + 45 * margin);
    // 戦場になる地方：守り手の地方のうち攻め手に接するところ
    const field = this._frontProvince(w) ?? this.provincesOf(D)[0];
    if (field) {
      field.pop *= 1 - 0.04 - 0.05 * margin;
      field.devastation = Math.min(1, field.devastation + 0.25);
    }
    const loser = aWins ? D : A;
    const winner = aWins ? A : D;
    loser.exhaustion += 0.08 + 0.1 * margin;
    winner.exhaustion += 0.04;
    this.stats.battles++;
    const battle = { year: this.year, name: `${field ? field.name : ''}の戦い`, field: field ? field.id : null, attackerWon: aWins, cA: cA?.id, cD: cD?.id, margin };
    w.battles.push(battle);
    const dead = [];
    const risk = (p, base) => {
      if (!p || !p.alive) return;
      const r = base * (p.pheno.hemophilia ? 4 : 1) * (1.3 - this.martial(p) / 200);
      if (this.rng.chance(r)) dead.push(p);
    };
    risk(aWins ? cD : cA, 0.07 + 0.12 * margin);
    risk(aWins ? cA : cD, 0.025);
    // 騎士として戦う貴族の男たち
    for (const p of this.living) {
      if (!p.alive || p.sex !== 'M' || p.rulerOf != null || p === cA || p === cD) continue;
      const a = this.age(p);
      if (a < 18 || a > 50) continue;
      const onA = civil ? p.dynastyId === this.get(w.leaderId).dynastyId : p.kingdomId === A.id;
      const onD = !onA && p.kingdomId === D.id;
      if (!onA && !onD) continue;
      const lost = (onA && !aWins) || (onD && aWins);
      risk(p, lost ? 0.02 + 0.03 * margin : 0.008);
    }
    if (margin > 0.35 || dead.some((p) => p === cA || p === cD || p.rulerOf != null)) {
      const wc = aWins ? cA : cD;
      this.addLog('war', `${battle.name}：${wc ? `${this.pn(wc)} 率いる` : ''}${aWins ? (civil ? '反乱軍' : this.kn(A)) : this.kn(D)} 軍が大勝した。`, [A.id, D.id]);
    }
    for (const p of dead) {
      const wasRuler = p.rulerOf != null;
      if (!wasRuler && (p === cA || p === cD || this.royalOf(p))) this.addLog('death', `${this.pn(p)} が${battle.name}で戦死した（${this.age(p)}歳）。`, [A.id, D.id]);
      this._kill(p, '戦死');
      if (w.ended) return;
    }
  }

  _frontProvince(w) {
    const D = this.kingdoms[w.defenderId];
    if (w.kind === 'independence') return this.provinces[this.rng.pick(w.provinces)];
    const cands = [];
    for (const pr of this.provinces) {
      if (pr.ownerId !== D.id) continue;
      if (w.kind === 'civil') cands.push(pr);
      else for (const q of pr.neighbors) if (this.provinces[q].ownerId === w.attackerId) cands.push(pr);
    }
    return cands.length ? this.rng.pick(cands) : null;
  }

  _endWar(w, result, reason = '') {
    if (w.ended) return;
    w.ended = true;
    w.endYear = this.year;
    w.result = result;
    const A = this.kingdoms[w.attackerId];
    const D = this.kingdoms[w.defenderId];
    const key = A.id < D.id ? `${A.id}-${D.id}` : `${D.id}-${A.id}`;
    this.truces.set(key, this.year + 10);
    const reignOf = (k) => {
      const r = k.rulers.at(-1);
      return r && r.to == null ? r : null;
    };
    if (result !== 'white' && (w.kind === 'conquest' || w.kind === 'claim')) {
      const win = result === 'attacker' ? A : D;
      const lose = result === 'attacker' ? D : A;
      if (win.alive && reignOf(win)) reignOf(win).warsWon++;
      if (lose.alive && reignOf(lose)) reignOf(lose).warsLost++;
      lose.lastDefeat = this.year;
      const wr = this.ruler(win);
      if (wr && this.dyn(wr)) this.dyn(wr).prestige += 25;
    }
    if (!A.alive || !D.alive) {
      if (reason) this.addLog('war', `${w.name}は${reason}により終わった。`, [A.id, D.id]);
      return;
    }
    const why = reason ? `（${reason}）` : '';
    if (w.kind === 'conquest') {
      if (result === 'attacker') {
        const n = 1 + Math.floor(Math.max(0, w.score) / 70);
        const taken = this._cede(D, A, n);
        this.addLog('war', `${w.name}は ${this.kn(A)} の勝利に終わり、${taken.map((p) => p.name).join('・')} を得た。${why}`, [A.id, D.id]);
        if (!this.provincesOf(D).length) this._fall(D, A);
      } else if (result === 'defender') {
        const taken = this.rng.chance(0.4) ? this._cede(A, D, 1) : [];
        this.addLog('war', `${w.name}は ${this.kn(D)} が守り抜いた。${taken.length ? `${taken[0].name} が ${this.kn(D)} のものになった。` : ''}${why}`, [A.id, D.id]);
        if (!this.provincesOf(A).length) this._fall(A, D);
      } else this.addLog('war', `${w.name}は痛み分けに終わった。${why}`, [A.id, D.id]);
    } else if (w.kind === 'claim') {
      const c = this.get(w.claimantId);
      if (result === 'attacker') {
        const old = this.ruler(D);
        if (old) {
          this._endReign(D, old);
          if (!old.claims.includes(D.id)) old.claims.push(D.id);
          this.addLog('war', `${w.name}は ${this.kn(A)} の勝利に終わり、${this.pn(old)} は王位を追われた。`, [A.id, D.id]);
        }
        if (c.rulerOf != null) {
          this.addLog('succession', `${this.pn(c)} が ${this.kn(D)} の王位も手にし、${this.kn(D)} は ${this.kn(this.kingdoms[c.rulerOf])} に統合された。`, [A.id, D.id]);
          this._absorb(D, this.kingdoms[c.rulerOf]);
        } else this._crown(D, c, 'conquest');
      } else this.addLog('war', `${w.name}は ${result === 'defender' ? `${this.kn(D)} の勝利` : '痛み分け'}に終わり、${this.pn(c)} の請求はかなわなかった。${why}`, [A.id, D.id]);
    } else if (w.kind === 'civil') {
      const leader = this.get(w.leaderId);
      const old = this.ruler(D);
      if (result === 'attacker') {
        if (old) {
          this._endReign(D, old);
          if (this.rng.chance(0.5)) {
            this.addLog('war', `反乱軍が勝ち、${this.pn(old)} は処刑された。`, [D.id]);
            this._kill(old, '処刑');
          } else {
            if (!old.claims.includes(D.id)) old.claims.push(D.id);
            this.addLog('war', `反乱軍が勝ち、${this.pn(old)} は幽閉された。`, [D.id]);
          }
        }
        if (leader.alive) this._crown(D, leader, 'usurp');
        else if (!this.ruler(D)) this._succeed(D, old ?? leader);
      } else {
        if (leader.alive) {
          this.addLog('war', `${w.name}は鎮圧され、${this.pn(leader)} は処刑された。${why}`, [D.id]);
          this._kill(leader, '処刑');
        } else this.addLog('war', `${w.name}は鎮圧された。${why}`, [D.id]);
        const d = this.dyn(leader);
        if (d) d.prestige *= 0.5;
      }
    } else if (w.kind === 'independence') {
      const leader = this.get(w.leaderId);
      const provs = w.provinces.filter((id) => this.provinces[id].ownerId === D.id);
      if (result === 'attacker' && provs.length && leader.alive) {
        const origin = this.provinces[provs[0]].origin;
        const old = this.kingdoms[origin];
        const revive = old && !old.alive;
        const nk = this._newKingdom({
          culture: this.provinces[provs[0]].culture,
          capital: provs[0],
          law: revive ? old.law : D.law,
          custom: revive ? old.custom : D.custom,
          name: revive ? old.name : null,
          origin,
        });
        for (const id of provs) this.provinces[id].ownerId = nk.id;
        for (const p of this.living) if (p.alive && p.dynastyId === leader.dynastyId && p.rulerOf == null) p.kingdomId = nk.id;
        const dd = this.dyn(leader);
        if (dd) dd.homeProvinceId = provs[0];
        this._crown(nk, leader, 'independence');
        this.addLog('war', `${w.name}は反乱軍の勝利に終わり、${this.kn(nk)} が${revive ? '再興' : '建国'}された。`, [D.id, nk.id]);
      } else {
        if (leader.alive) {
          this.addLog('war', `${w.name}は鎮圧され、${this.pn(leader)} は処刑された。${why}`, [D.id]);
          this._kill(leader, '処刑');
        } else this.addLog('war', `${w.name}は鎮圧された。${why}`, [D.id]);
      }
    }
  }

  // loser の地方を n 個、winner に割譲する（winner に接する地方から）
  _cede(loser, winner, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const cands = this.provinces.filter((pr) => pr.ownerId === loser.id && [...pr.neighbors].some((q) => this.provinces[q].ownerId === winner.id));
      if (!cands.length) break;
      cands.sort((a, b) => (a.id === loser.capital ? 1 : 0) - (b.id === loser.capital ? 1 : 0) || b.pop - a.pop);
      const pr = cands[0];
      this._transfer(pr, winner);
      out.push(pr);
    }
    return out;
  }

  _transfer(pr, to) {
    const from = this.kingdoms[pr.ownerId];
    pr.ownerId = to.id;
    // その地方を本拠とする諸侯の家は、新しい王に仕える
    for (const d of this.dynasties) {
      if (d.extinct || d.homeProvinceId !== pr.id) continue;
      if (from && this.ruler(from)?.dynastyId === d.id) continue;
      for (const p of this.living) if (p.alive && p.dynastyId === d.id && p.rulerOf == null && p.kingdomId === from?.id) p.kingdomId = to.id;
    }
    if (from && from.capital === pr.id) {
      const rest = this.provincesOf(from);
      if (rest.length) from.capital = rest.sort((a, b) => b.pop - a.pop)[0].id;
    }
  }

  _fall(k, by) {
    const r = this.ruler(k);
    if (r) {
      this._endReign(k, r);
      if (!r.claims.includes(k.id)) r.claims.push(k.id);
    }
    for (const p of this.living) if (p.alive && p.kingdomId === k.id) p.kingdomId = by.id;
    this.addLog('dynasty', `${this.kn(k)} は ${this.kn(by)} に滅ぼされた。`, [k.id, by.id]);
    this._destroy(k);
  }

  // ───────── 反乱 ─────────

  weakness(k) {
    const r = this.ruler(k);
    let w = 1;
    if (k.regentId != null) w += 1.5;
    if (!r) return w + 2;
    if (r.mad) w += 2;
    if (this.stewardship(r) < 35) w += 0.8;
    if (this.year - k.lastDefeat < 6) w += 1;
    if (r.sex === 'F' && k.law === 'agnatic') w += 0.5;
    w += Math.min(1.5, k.exhaustion * 2);
    // 広すぎる国はまとまりにくい
    w += Math.max(0, (this.provincesOf(k).length - 10) / 6);
    return w;
  }

  _revolts() {
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      if (this.activeWars(k.id).some((w) => w.kind === 'civil' || w.kind === 'independence')) continue;
      const r = this.ruler(k);
      if (!r) continue;
      const weak = this.weakness(k);
      const rulingPrestige = this.dyn(r)?.prestige ?? 10;
      // 簒奪：野心的な諸侯、または請求権を持つ者
      let started = false;
      for (const p of this.living) {
        if (!p.alive || p.kingdomId !== k.id || p.rulerOf != null || this.age(p) < 20) continue;
        const d = this.dyn(p);
        const isHead = d && this.head(d) === p && d.id !== r.dynastyId;
        const hasClaim = p.claims.includes(k.id);
        if (!isHead && !hasClaim) continue;
        const amb = p.pheno.ambition;
        if (amb < 55) continue;
        const dp = d ? d.prestige : 5;
        const prob = 0.0012 * weak * ((amb / 60) ** 2) * (1 + dp / (rulingPrestige + 1)) * (hasClaim ? 3 : 1);
        if (!this.rng.chance(prob)) continue;
        const share = clamp(0.28 + 0.35 * (dp / (dp + rulingPrestige)) + 0.03 * weak + (hasClaim ? 0.1 : 0), 0.2, 0.65);
        const w = this._startWar('civil', k, k, { leaderId: p.id, rebelShare: share });
        this.addLog('war', `${this.pn(p)} が ${this.pn(r)} に反旗をひるがえした${hasClaim ? '（王位への請求権を掲げて）' : ''}（${w.name}）。`, [k.id]);
        started = true;
        break;
      }
      if (started) continue;
      // 独立：ほかの国に由来する地方がまとまっていれば、独立をめざす
      const groups = new Map();
      for (const pr of this.provinces) {
        if (pr.ownerId !== k.id || pr.origin === k.origin) continue;
        const o = this.kingdoms[pr.origin];
        if (o && o.alive) continue;
        if (!groups.has(pr.origin)) groups.set(pr.origin, []);
        groups.get(pr.origin).push(pr.id);
      }
      // 首都から遠い有力な諸侯は、自分の地方ごと独立をめざす
      const provs = this.provincesOf(k);
      if (provs.length >= 8) {
        const cap = this.provinces[k.capital];
        for (const d of this.dynasties) {
          if (d.extinct || d.id === r.dynastyId) continue;
          const home = this.provinces[d.homeProvinceId];
          if (!home || home.ownerId !== k.id || home.id === k.capital) continue;
          const dist = Math.hypot(home.cx - cap.cx, home.cy - cap.cy);
          if (dist < 18) continue;
          const h = this.head(d);
          if (!h || !h.alive || h.kingdomId !== k.id || this.age(h) < 20 || h.pheno.ambition < 50) continue;
          if (!this.rng.chance(0.0008 * weak * (provs.length / 8) * (dist / 18))) continue;
          const ids = [home.id, ...[...home.neighbors].filter((q) => this.provinces[q].ownerId === k.id && q !== k.capital)];
          if (!groups.has(-1 - d.id)) groups.set(-1 - d.id, ids);
          groups.get(-1 - d.id).forced = h;
          break;
        }
      }
      for (const [, ids] of groups) {
        if (ids.length < 2 && !ids.forced) continue;
        const prob = ids.forced ? 1 : 0.005 * weak * (ids.length / 3);
        if (!this.rng.chance(prob)) continue;
        const kPow = this.provincesOf(k).reduce((s, p) => s + p.pop, 0);
        const gPow = ids.reduce((s, id) => s + this.provinces[id].pop, 0);
        let leader = ids.forced ?? null;
        if (!leader) for (const d of this.dynasties) {
          if (d.extinct || !ids.includes(d.homeProvinceId) || d.id === r.dynastyId) continue;
          const h = this.head(d);
          if (h && h.alive && this.age(h) >= 20 && h.rulerOf == null) leader = h;
        }
        if (!leader) leader = this._raiseHouse(k, ids[0], false);
        if (!leader) continue;
        const w = this._startWar('independence', k, k, { leaderId: leader.id, provinces: ids, rebelShare: clamp(0.25 + 0.9 * (gPow / kPow) + 0.03 * weak, 0.2, 0.7) });
        this.addLog('war', `${ids.map((id) => this.provinces[id].name).join('・')} の人々が ${this.pn(leader)} を担いで独立を求め、蜂起した（${w.name}）。`, [k.id]);
        break;
      }
    }
  }

  // 新しい貴族の家を興す（地方の騎士の家）
  _raiseHouse(k, provinceId, quiet) {
    const pr = this.provinces[provinceId];
    const culture = pr.culture;
    const d = this._newDynasty(culture, k.id, provinceId);
    d.prestige = 8;
    const head = this._family(d, k, provinceId, 22 + this.rng.int(18), { culture });
    if (!quiet) this.addLog('dynasty', `${pr.name} の騎士 ${this.pn(head)} が貴族に列せられ、${d.name}家を興した。`, [k.id]);
    return head;
  }

  // ───────── 後片づけと記録 ─────────

  _housekeeping() {
    this.living = this.living.filter((p) => p.alive);
    const livingByDyn = new Map();
    for (const p of this.living) if (p.dynastyId != null) livingByDyn.set(p.dynastyId, (livingByDyn.get(p.dynastyId) ?? 0) + 1);
    for (const d of this.dynasties) {
      if (d.extinct) continue;
      d.prestige *= 0.985;
      if (this.kingdoms.some((k) => k.alive && this.ruler(k)?.dynastyId === d.id)) d.prestige += 4;
      if (!livingByDyn.get(d.id)) {
        d.extinct = true;
        d.extinctYear = this.year;
        if (d.everRuled || d.prestige > 40) this.addLog('dynasty', `${d.name}家が断絶した（${this.year - d.foundedYear}年続いた）。`);
      }
    }
    // 諸侯の家が少なくなった国では、新しい家が興る
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      const provs = this.provincesOf(k);
      const houses = this.dynasties.filter((d) => !d.extinct && this.head(d)?.kingdomId === k.id).length;
      if (houses < 2 + provs.length / 4 && this.rng.chance(0.12)) this._raiseHouse(k, this.rng.pick(provs).id, false);
    }
    this.ped.prune(this.year - 160);
  }

  alleleFreq(key, allele, people) {
    let n = 0;
    let c = 0;
    for (const p of people) {
      for (const a of allelesAt(p.genome, key)) {
        c++;
        if (a === allele) n++;
      }
    }
    return c ? n / c : 0;
  }

  _record() {
    const ppl = this.living.filter((p) => p.alive);
    const rulers = this.kingdoms.filter((k) => k.alive).map((k) => this.ruler(k)).filter(Boolean);
    const mean = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0);
    const royals = ppl.filter((p) => this.royalOf(p));
    this.history.push({
      year: this.year,
      nobles: ppl.length,
      kingdoms: Object.fromEntries(this.kingdoms.filter((k) => k.alive).map((k) => [k.id, { provinces: this.provincesOf(k).length, power: this.power(k) }])),
      aliveKingdoms: this.kingdoms.filter((k) => k.alive).length,
      wars: this.wars.filter((w) => !w.ended).length,
      rulerF: mean(rulers, (r) => r.F),
      royalF: mean(royals, (r) => r.F),
      nobleF: mean(ppl, (p) => p.F),
      freq: {
        hem: this.alleleFreq('HEM', 'h', ppl),
        jaw: this.alleleFreq('JAW', 'j', ppl),
        mad: this.alleleFreq('MAD', 'm', ppl),
        del: ['DEL1', 'DEL2', 'DEL3', 'DEL4'].reduce((s, k) => s + this.alleleFreq(k, 'd', ppl), 0) / 4,
      },
      traits: {
        beauty: mean(ppl, (p) => p.pheno.beauty),
        intellect: mean(ppl, (p) => p.pheno.intellect),
        strength: mean(ppl, (p) => p.pheno.strength),
        charisma: mean(ppl, (p) => p.pheno.charisma),
      },
      ...this.stats,
    });
    if (this.history.length > 2000) this.history.shift();
  }
}

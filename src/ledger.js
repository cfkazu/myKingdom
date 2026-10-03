// 因縁の帳簿と墓碑銘：家どうしの恨みを子孫に引き継ぎ、人の生涯を一文に刻む。World にメソッドとして組み込む。
//
// - 処刑・幽閉・王位の簒奪・国の滅亡・戦死・領地の没収を「どの家がどの家に何をしたか」として記録する。
//   恨みは家に残り、何代たっても忠誠を下げ、反乱や宣戦の理由になる。仇の家に勝てば恨みは晴れ、こんどは相手が恨む。
// - 婚姻は恨みを和らげる。
// - 主な出来事（即位・戦・幽閉・狂気・復讐）を人ごとに記録し、亡くなると一文の墓碑銘をつくる。

const ADULT = 16;

// 恨みの種類：重さ（w）と、年代記の言い回し
const WHAT = {
  exec: { w: 3, short: '処刑', text: (r) => `${r} を処刑された` },
  depose: { w: 3, short: '王位簒奪', text: (r) => `${r} から王位を奪われた` },
  fall: { w: 3, short: '滅亡', text: (r, g) => `${g.place}を滅ぼされた` },
  prison: { w: 2, short: '幽閉', text: (r) => `${r} を幽閉された` },
  battle: { w: 2, short: '戦死', text: (r) => `${r} を戦で討たれた` },
  revoke: { w: 2, short: '没収', text: (r, g) => `${g.place}伯領を取り上げられた` },
  secede: { w: 1, short: '独立', text: (r, g) => `${g.place}を独立で奪われた` },
  cede: { w: 1, short: '割譲', text: (r, g) => `${g.place}を奪われた` },
};

const KIN = [null, ['父', '母'], ['祖父', '祖母'], ['曾祖父', '曾祖母'], ['高祖父', '高祖母']];

export const LedgerMixin = {
  // ───────── 因縁の帳簿 ─────────

  // victimDyn の家が、againstDyn の家を恨む
  _grudge(victimDyn, againstDyn, what, victim = null, extra = {}) {
    if (!victimDyn || !againstDyn || victimDyn === againstDyn || victimDyn.extinct) return;
    const g = { against: againstDyn.id, what, year: this.year, victimId: victim ? victim.id : null, w: WHAT[what].w, ease: 1, avenged: null, ...extra };
    if (what === 'battle' && victim && victim.rulerOf == null) g.w = 1;
    victimDyn.grudges = victimDyn.grudges ?? [];
    victimDyn.grudges.push(g);
    // 晴れた恨み・薄れた恨みから捨てる
    if (victimDyn.grudges.length > 16) {
      const i = victimDyn.grudges.findIndex((x) => x.avenged != null || this.grudgeStrength(x) < 1);
      victimDyn.grudges.splice(i >= 0 ? i : 0, 1);
    }
  },

  // 恨みの強さ（忠誠をどれだけ下げるか）。重い恨みは、晴らすまで消えない
  grudgeStrength(g) {
    if (g.avenged != null) return 0;
    const age = this.year - g.year;
    const f = age < 20 ? 1 : g.w >= 3 ? Math.max(0.4, 1 - (age - 20) / 150) : Math.max(0, 1 - (age - 20) / (50 * g.w));
    return g.w * 10 * f * g.ease;
  },

  // d が againstId の家に持っている、生きている恨み（強い順）
  grudgesOf(d, againstId = null) {
    return (d.grudges ?? []).filter((g) => (againstId == null || g.against === againstId) && this.grudgeStrength(g) >= 1).sort((a, b) => this.grudgeStrength(b) - this.grudgeStrength(a) || a.year - b.year);
  },

  grudgeAgainst(d, againstId) {
    return Math.min(30, this.grudgesOf(d, againstId).reduce((s, g) => s + this.grudgeStrength(g), 0));
  },

  // いまの当主から見た、恨みのもとになった人の続柄
  _kinWord(d, victimId) {
    const h = d && !d.extinct ? this.head(d) : null;
    const v = this.get(victimId);
    if (!v) return '';
    if (h && h.id === v.id) return '当主';
    if (h) {
      let gen = [h];
      for (let depth = 1; depth <= 8 && gen.length; depth++) {
        const next = [];
        for (const p of gen) for (const id of [p.fatherId, p.motherId]) if (id != null && this.get(id)) next.push(this.get(id));
        if (next.some((p) => p.id === v.id)) return depth < KIN.length ? KIN[depth][v.sex === 'M' ? 0 : 1] : `${depth}代前の先祖`;
        gen = next;
      }
    }
    return v.dynastyId === d.id ? '一族の' : '縁者の';
  },

  // 「117 年前に曾祖父 ○○ を処刑された」
  grudgeText(d, g) {
    const r = g.victimId != null ? `${this._kinWord(d, g.victimId)} ${this.pn(this.get(g.victimId))}` : '';
    const age = this.year - g.year;
    return `${age >= 2 ? `${age} 年前に` : '先ごろ'}${WHAT[g.what].text(r, g)}`;
  },

  grudgeShort(g) {
    return `因縁（${this.year - g.year}年前の${WHAT[g.what].short}）`;
  },

  // 恨む家のうち、いちばん強い恨みを持つ家と、その恨み
  _topGrudge(dyns, againstId) {
    let best = null;
    for (const d of dyns) {
      if (!d) continue;
      const g = this.grudgesOf(d, againstId)[0];
      if (g && (!best || this.grudgeStrength(g) > this.grudgeStrength(best.g))) best = { d, g };
    }
    return best;
  },

  // 年代記の一文：「○○家は、117 年前に曾祖父 ○○ を処刑された恨みを忘れていない。」
  _grudgeNote(dyns, against) {
    if (!against) return '';
    const t = this._topGrudge(dyns, against.id);
    if (!t || this.grudgeStrength(t.g) < 5) return '';
    return `${t.d.name}家は、${this.grudgeText(t.d, t.g)}恨みを忘れていない。`;
  },

  // av の家が target の家に勝った：恨みを晴らす
  _avenge(av, target, kingdomIds = []) {
    if (!av || !target || av === target) return;
    const gs = this.grudgesOf(av, target.id);
    if (!gs.length) return;
    const top = gs.reduce((a, b) => (b.year < a.year && b.w >= a.w ? b : a));
    const text = this.grudgeText(av, top);
    const age = this.year - top.year;
    for (const g of gs) g.avenged = this.year;
    if (this.grudgeStrength({ ...top, avenged: null }) < 5 && top.w < 3) return;
    av.prestige += 10;
    const h = this.head(av);
    if (h) this._deed(h, 'avenge', `${target.name}家への${age}年来の恨みを晴らす`, { years: age });
    this.addLog('dynasty', `⚔ ${av.name}家は、${text}恨みを晴らした。`, kingdomIds);
  },

  // 二つの家のあいだの因縁を一文で（縁談カード用）。なければ null
  feudBetween(a, b) {
    if (!a || !b || a === b) return null;
    const x = this.grudgesOf(a, b.id)[0];
    const y = this.grudgesOf(b, a.id)[0];
    if (!x && !y) return null;
    const out = [];
    if (x) out.push(`${a.name}家は ${b.name}家を恨んでいる（${this.grudgeText(a, x)}）`);
    if (y) out.push(`${b.name}家は ${a.name}家を恨んでいる（${this.grudgeText(b, y)}）`);
    return out.join('。');
  },

  // 家 d を恨んでいる家と、その恨み
  grudgesAgainst(d) {
    const out = [];
    for (const o of this.dynasties) {
      if (o === d || o.extinct || !o.grudges) continue;
      const g = this.grudgesOf(o, d.id)[0];
      if (g) out.push({ d: o, g });
    }
    return out.sort((a, b) => this.grudgeStrength(b.g) - this.grudgeStrength(a.g));
  },

  // 婚姻は、両家の恨みを和らげる
  _reconcile(a, b) {
    if (!a || !b || a === b || (!a.grudges && !b.grudges)) return false;
    let felt = 0;
    for (const [x, y] of [[a, b], [b, a]])
      for (const g of this.grudgesOf(x, y.id)) {
        felt = Math.max(felt, this.grudgeStrength(g));
        g.ease *= 0.6;
      }
    // 年代記に書くのは、まだ深い恨みが和らいだときだけ
    return felt >= 12;
  },

  // ───────── 生涯と墓碑銘 ─────────

  _deed(p, kind, text, extra = {}) {
    if (!p) return;
    p.deeds = p.deeds ?? [];
    p.deeds.push({ year: this.year, kind, text, ...extra });
    if (p.deeds.length > 14) p.deeds.splice(1, 1);
  },

  // 家の当主の交代を記録する
  _ledgerTick() {
    for (const d of this.dynasties) {
      if (d.extinct) continue;
      const h = this.head(d);
      if (!h || h.id === d.headId) continue;
      const prev = d.headId != null ? this.get(d.headId) : null;
      if (prev) prev.headYears = this.year - (d.headSince ?? this.year);
      d.headId = h.id;
      d.headSince = this.year;
      d.heads = d.heads ?? [];
      d.heads.push(h.id);
      if (d.heads.length > 40) d.heads.shift();
      h.wasHead = h.wasHead ?? d.id;
      if (prev) this._deed(h, 'head', `${d.name}家の当主となる`);
      if (prev && this.player && !this.player.over && d.id === this.player.dynastyId) {
        // 捏造した請求権は、新しい当主に引き継ぐ
        // 捏造した請求権は 2 代で薄れる（当主が 2 回代わると消える）
        d.fabClaims = (d.fabClaims ?? []).map((x) => (typeof x === 'number' ? { id: x, gens: 2 } : x)).map((x) => ({ ...x, gens: x.gens - 1 })).filter((x) => x.gens > 0);
        for (const x of d.fabClaims) if (this.kingdoms[x.id]?.alive && !h.claims.includes(x.id) && h.rulerOf !== x.id) h.claims.push(x.id);
        this._newsHeadChange(prev, h, d);
      }
    }
  },

  // 墓碑銘をつくる
  _epitaph(p) {
    const age = this.age(p);
    const reign = p.rulerOfEver != null ? this.kingdoms[p.rulerOfEver].rulers.findLast((r) => r.id === p.id) : null;
    const deeds = p.deeds ?? [];
    const has = (k) => deeds.find((x) => x.kind === k);
    const cl = [];
    const add = (prio, text) => cl.push([prio, cl.length, text]);
    if (reign) {
      const ca = reign.from - p.birthYear;
      const verb = { inherit: '即位し', union: '即位し', elected: '選挙で王に選ばれ', conquest: '戦で王位を得て', usurp: '王位を奪い', independence: '独立を勝ち取って王となり', init: '王位にあって' }[reign.how];
      add(reign.how === 'init' ? 20 : ca < ADULT ? 70 : 50, reign.how === 'init' ? verb : `${ca}歳で${verb}`);
      if (has('regency')) add(age < ADULT + 1 && !has('adult') ? 80 : 30, age < ADULT + 1 && !has('adult') ? '一度も親政を見ず' : '摂政のもとで育ち');
      const gained = (reign.provincesEnd ?? this.provincesOf(this.kingdoms[p.rulerOfEver]).length) - reign.provincesStart;
      if (reign.warsWon >= 2) add(60 + reign.warsWon, `${reign.warsWon}度の戦に勝ち`);
      else if (reign.warsLost >= 2) add(58, `${reign.warsLost}度の戦に敗れ`);
      if (gained >= 3) add(62, `国を${gained}地方広げ`);
      else if (gained <= -3) add(62, `${-gained}つの地方を失い`);
    } else if (p.headYears >= 5) {
      const d = this.dynasties[p.wasHead] ?? this.dyn(p);
      add(40, `${p.headYears}年にわたり${d ? `${d.name}家` : '家'}を率い`);
    }
    const rebel = has('rebel');
    if (rebel) add(75, `${rebel.war}を起こし`);
    if (has('battle') && !reign) add(45, `${has('battle').place}で勝ち`);
    const m = deeds.find((x) => x.kind === 'match' && x.tag);
    if (m) add(48, `${m.tag}${m.name}と結ばれ`);
    if (has('grant')) add(52, `${has('grant').place}伯領を賜り`);
    if (has('revoked')) add(72, `${has('revoked').place}伯領を王に奪われ`);
    if (has('goal')) add(82, `「${has('goal').label}」を成し遂げ`);
    if (has('avenge')) add(85, `${has('avenge').years}年来の恨みを晴らし`);
    if (has('deposed')) add(88, '王位を追われ');
    if (has('fallen')) add(89, '国を滅ぼされ');
    if (has('prison')) add(86, '幽閉の身となり');
    if (has('exile')) add(84, '国を追われ');
    if (p.mad || has('mad')) add(90, '狂気に陥り');
    if (p.pheno.hemophilia && p.cause !== '血友病' && age >= ADULT) add(55, '血友病を抱えながら');
    const kids = p.children.length;
    if (kids === 0 && age >= 30) add(35, '子を残さず');
    else if (kids >= 7) add(35, `${kids}人の子に恵まれ`);
    const death =
      {
        老衰: `${age}歳で天寿を全うした`,
        戦死: `${p.diedAt ?? '戦場'}で討ち死にした`,
        処刑: '処刑台に消えた',
        暗殺: '暗殺に斃れた',
        血友病: '血友病で逝った',
        疫病: '疫病に倒れた',
        産褥: '産褥で世を去った',
        狂死: '狂気のうちに世を去った',
      }[p.cause] ?? `${age}歳で世を去った`;
    const body = [...cl.sort((a, b) => b[0] - a[0]).slice(0, 3).sort((a, b) => a[1] - b[1]).map((c) => c[2]), death].join('、');
    return body;
  },

  // 亡くなったときに墓碑銘を刻む。王・当主・あなたの家の大人だけ
  _engrave(p) {
    if (p.epitaph) return p.epitaph;
    const hd = p.wasHead != null ? this.dynasties[p.wasHead] : null;
    if (hd && hd.headId === p.id) p.headYears = this.year - (hd.headSince ?? this.year);
    const mine = this.player && !this.player.over && p.dynastyId === this.player.dynastyId && this.age(p) >= ADULT;
    if (p.rulerOfEver == null && p.wasHead == null && !mine && !(p.deeds ?? []).length) return null;
    p.epitaph = this._epitaph(p);
    return p.epitaph;
  },

  epitaphHead(p) {
    return `${p.regnal ?? p.name}${p.epithet ? `「${p.epithet}」` : ''}`;
  },
};

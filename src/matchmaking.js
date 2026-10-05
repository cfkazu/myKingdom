// 縁談に色をつける：候補ごとの「縁」（持参金・王位の血・恋仲・和解…）、高嶺の花、よその家からの申し込み、夫婦仲。
// World にメソッドとして組み込む。
//
// - 縁は候補の身の上から決まり、選ぶと効く（家格・請求権・恨みの和解・夫婦仲など）。
// - 高嶺の花（ふつうは断ってくる格上の相手）も候補にまじる。贈り物（家格）を積めば必ず受けてくれる。
// - よその家から申し込みが来る。王家の申し込みを断ると、王の機嫌をそこねる。
// - 結婚したふたりには夫婦仲がある。仲睦まじいと子に恵まれ、冷え切ると不義が起きやすい。

const TRAIT_FAME = [
  ['beauty', '美貌', '容姿'],
  ['intellect', '才女', '知略'],
  ['strength', '剛勇', '体の強さ'],
  ['charisma', '人望', 'カリスマ'],
];

export const MatchMixin = {
  // 候補 c の縁（p から見て）。love は恋仲の相手かどうか
  marriageHooks(p, c, love = false) {
    const hooks = [];
    const my = this.dyn(p);
    const cd = this.dyn(c);
    if ((p.friendIds ?? []).includes(c.id) || (c.friendIds ?? []).includes(p.id)) hooks.push({ key: 'friend', icon: '🤝', text: `幼なじみ：同じ宮廷でともに育った。夫婦仲が良くなりやすい` });
    if (love) hooks.push({ key: 'love', icon: '💕', text: `${c.name}は${p.name}を慕っている。夫婦仲が良くなり、子に恵まれやすい` });
    // 王位の血：よその国の君主の子・君主本人・請求権を持つ人
    const ck = c.rulerOf != null ? this.kingdoms[c.rulerOf] : this.kingdoms.find((k) => k.alive && k.rulerId != null && (c.fatherId === k.rulerId || c.motherId === k.rulerId));
    const claimK = ck && ck.id !== p.kingdomId ? ck : c.claims.map((id) => this.kingdoms[id]).find((k) => k && k.alive && k.id !== p.kingdomId);
    if (claimK) hooks.push({ key: 'claim', icon: '👑', kingdomId: claimK.id, text: `生まれる子は ${claimK.name} の王位への請求権を持つ` });
    // 持参金：格上の家から
    if (cd && my && !c.lowborn && cd.prestige >= my.prestige + 40) {
      const n = Math.round(Math.min(25, (cd.prestige - my.prestige) * 0.12 + 5));
      hooks.push({ key: 'dowry', icon: '💰', amount: n, text: `持参金：家格 +${n}` });
    }
    // 和解：恨みのある家と
    if (cd && my && this.feudBetween?.(my, cd)) hooks.push({ key: 'feud', icon: '🕊', text: `${cd.name}家との因縁を、この縁組で大きく和らげられる` });
    // 跡取り：家が絶えかけていて、所領を持つ家の当主の子。その家が絶えれば、所領は子の家に渡る
    if (cd && my && cd.id !== my.id && !c.lowborn) {
      const lands = this.countiesOf(cd.id);
      const alive = this.living.filter((x) => x.alive && x.dynastyId === cd.id).length;
      const head = this.head(cd);
      if (lands.length && alive <= 3 && head && (c === head || c.fatherId === head.id || c.motherId === head.id))
        hooks.push({ key: 'heiress', icon: '📜', text: `跡取り：${cd.name}家は絶えかけている（存命 ${alive} 人）。絶えれば ${lands.map((p) => p.name).join('・')}伯領は、子の家（あなたの家）が継ぐ` });
    }
    // 主君の王家と
    const liege = my ? this.kingdoms[my.kingdomId] : null;
    const lr = liege && liege.alive ? this.ruler(liege) : null;
    if (lr && !this.playerKingdom() && lr.dynastyId !== my.id && cd && cd.id === lr.dynastyId) hooks.push({ key: 'liege', icon: '🏰', text: '主君の王家との縁組：王への忠誠が上がる' });
    // 子宝の実績：前の結婚で子をもうけた人
    const kids = c.children.length;
    if (c.spouses.length && kids >= 2) hooks.push({ key: 'proven', icon: '👶', text: `前の結婚で ${kids} 人の子をもうけた（子宝の実績）` });
    // 評判
    for (const [t, label, name] of TRAIT_FAME) {
      if (c.pheno[t] >= 80) {
        hooks.push({ key: 'fame', icon: '✨', value: c.pheno[t], text: `${c.sex === 'F' && t === 'intellect' ? label : t === 'intellect' ? '俊英' : label}の誉れ（${name} ${Math.round(c.pheno[t])}）` });
        break;
      }
    }
    if (c.gentry) hooks.push({ key: 'gentry', icon: '🌱', text: '騎士の家の出：家格は低いが、新しい血を入れられる' });
    return hooks;
  },

  // 高嶺の花：王・王族・継承者や、ずっと格上の家の人。贈り物（家格）を積めば必ず受けてくれる。0 ならふつうの相手
  courtCost(p, c, theirs = 50) {
    const my = this.dyn(p);
    const cd = this.dyn(c);
    if (!cd || c.gentry || c.lowborn) return 0;
    const gap = cd.prestige - (my?.prestige ?? 0);
    const myRoyal = this.royalOf(p) != null || p.rulerOf != null;
    let cost = 0;
    if (c.rulerOf != null) cost += 20;
    else if (this.isHeirAnywhere(c)) cost += 15;
    else if (this.royalOf(c) && !myRoyal) cost += 10;
    if (gap >= 40) cost += Math.min(25, Math.round(gap * 0.12));
    if (theirs < 12) cost += Math.ceil((12 - theirs) * 1.2) + 5;
    return cost ? Math.max(8, cost) : 0;
  },

  // 入婿に出さない男：君主・王位継承者・継承順位 3 位まで・家の当主とその長男（理由を返す。出すなら null）
  matriRefusal(c) {
    if (!c || c.lowborn || c.gentry) return null;
    if (c.rulerOf != null) return '君主';
    if (this.isHeirAnywhere(c)) return '王位継承者';
    const rk = this.royalOf(c);
    if (rk && rk.alive && rk.rulerId != null && this.successionLine(rk, 3).includes(c)) return `${rk.name}の継承順位 3 位以内`;
    const cd = this.dyn(c);
    const h = cd && !cd.extinct ? this.head(cd) : null;
    if (!h) return null;
    if (h === c) return `${cd.name}家の当主`;
    if (c.sex === 'M' && [c.fatherId, c.motherId].includes(h.id)) {
      const sons = h.children.map((id) => this.get(id)).filter((x) => x && x.alive && x.sex === 'M' && x.dynastyId === cd.id).sort((a, b) => a.birthYear - b.birthYear || a.id - b.id);
      if (sons[0] === c) return `${cd.name}家の跡取り（長男）`;
    }
    return null;
  },

  // 入婿に迎える贈り物（家格）：息子を出す側は、こちらがずっと格上でなければ渋る
  matriCost(p, c) {
    const cd = this.dyn(c);
    if (!cd || c.gentry || c.lowborn || c.dynastyId === p.dynastyId) return 0;
    const gap = cd.prestige - (this.dyn(p)?.prestige ?? 0) + 30;
    let cost = gap > 0 ? 8 + Math.round(gap * 0.3) : 0;
    if (this.royalOf(c)) cost += 10;
    return Math.min(50, cost);
  },

  // この縁談で入婿に迎える贈り物：向こうからの申し込みなら半分（縁を望んで来ているので、息子を出す渋りは小さい）
  matriPrice(d, p, c) {
    const n = this.matriCost(p, c);
    return d?.proposal ? Math.ceil(n / 2) : n;
  },

  // 縁談の決断をつくる
  _marriageDecision(p, { proposal = null } = {}) {
    let offers;
    if (proposal) {
      offers = [proposal];
    } else {
      const cands = this.marriageCandidates(p);
      // 幼なじみは、ふさわしい相手なら候補にまじる
      for (const id of p.friendIds ?? []) {
        const c = this.get(id);
        if (!c || !c.alive || c.spouseId != null || c.sex === p.sex || cands.some((o) => o.c === c)) continue;
        const ca = this.age(c);
        if (c.sex === 'F' ? ca < 15 || ca > 40 : ca < 16 || ca > 62) continue;
        const phi = this.ped.kinship(p.id, c.id);
        const mine = this.spouseScore(p, c, phi);
        if (mine === -Infinity) continue;
        cands.push({ c, mine, theirs: this.spouseScore(c, p, phi), phi });
      }
      // 恋仲：上位でない候補のひとりが、こちらを慕っていることがある
      // 恋仲は、年の離れすぎていない相手だけ
      const near = (o) => Math.abs(this.age(o.c) - this.age(p)) <= 12;
      const loveIdx = cands.length >= 3 && this.rng.chance(0.6) ? 2 + this.rng.int(cands.length - 2) : -1;
      if (loveIdx >= 0 && !near(cands[loveIdx])) cands.loveOff = true;
      offers = cands.map((o, i) => {
        const hooks = this.marriageHooks(p, o.c, i === loveIdx && !cands.loveOff);
        return { id: o.c.id, hooks, cost: this.courtCost(p, o.c, o.theirs) };
      });
      // 高嶺の花：ふつうは断ってくる格上の相手。贈り物（家格）を積めば、必ず受けてくれる
      const reach = this.marriageCandidates(p, 6, { reach: true }).filter((o) => (this.dyn(o.c)?.prestige ?? 0) > (this.dyn(p)?.prestige ?? 0) || o.c.rulerOf != null || this.royalOf(o.c));
      for (const o of reach.slice(0, 2)) offers.unshift({ id: o.c.id, hooks: this.marriageHooks(p, o.c), cost: this.courtCost(p, o.c, o.theirs), reach: true });
      // 高嶺の花は 1 枚に 2 人まで（いちばん格上の相手）。ほかはふつうに受けてくれる
      const pricey = offers.filter((o) => o.cost).sort((a, b) => b.cost - a.cost);
      for (const o of pricey.slice(2)) if (!o.reach) o.cost = 0;
      // 贈り物を積む相手は、持参金は出さない
      for (const o of offers) if (o.cost) o.hooks = o.hooks.filter((h) => h.key !== 'dowry');
      // 持参金を出すのは、いちばん裕福な家だけ。縁は 1 人 2 つまで
      const rich = offers.filter((o) => o.hooks.some((h) => h.key === 'dowry')).sort((a, b) => b.hooks.find((h) => h.key === 'dowry').amount - a.hooks.find((h) => h.key === 'dowry').amount);
      for (const o of rich.slice(1)) o.hooks = o.hooks.filter((h) => h.key !== 'dowry');
      // 評判の縁も、いちばん目立つ 1 人だけ
      const famed = offers.filter((o) => o.hooks.some((h) => h.key === 'fame')).sort((a, b) => b.hooks.find((h) => h.key === 'fame').value - a.hooks.find((h) => h.key === 'fame').value);
      for (const o of famed.slice(1)) o.hooks = o.hooks.filter((h) => h.key !== 'fame');
      // 大事な縁から 2 つまで
      const PRI = ['heiress', 'claim', 'friend', 'love', 'feud', 'dowry', 'liege', 'proven', 'fame', 'gentry'];
      for (const o of offers) o.hooks = o.hooks.sort((a, b) => PRI.indexOf(a.key) - PRI.indexOf(b.key)).slice(0, 2);
    }
    this._decision({ type: 'marriage', personId: p.id, candidateIds: offers.map((o) => o.id), offers, proposal: !!proposal });
  },

  // よその家からの申し込み：こちらを高く買っている家から
  _marriageProposals() {
    if (!this.player || this.player.over) return;
    for (const p of this.living) {
      if (!p.alive || p.spouseId != null || !this.isCore(p) || p.imprisoned || p.cloistered) continue;
      const a = this.age(p);
      if (a < 16 || a > 45) continue;
      if (this.player.decisions.some((d) => d.type === 'marriage' && d.personId === p.id)) continue;
      // 申し込みは一生に 2 回まで。こちらの縁談と同じ間隔で数える
      if ((p.proposals ?? 0) >= 2 || !this.rng.chance(0.15) || !this._matchDue(p)) continue;
      if (this._proposalFor(p)) {
        this._countAsk(p);
        return;
      }
    }
  },

  _proposalFor(p) {
    {
      // 申し込みはよその家から来る（自分の家の人は除く）
      const cands = this.marriageCandidates(p, 8).filter((o) => !o.c.gentry && this.dyn(o.c) && o.c.dynastyId !== p.dynastyId);
      if (!cands.length) return false;
      // 先方がいちばん乗り気な相手
      const o = cands.sort((x, y) => y.theirs - x.theirs)[0];
      p.proposals = (p.proposals ?? 0) + 1;
      const hooks = this.marriageHooks(p, o.c, Math.abs(this.age(o.c) - this.age(p)) <= 12 && this.rng.chance(0.25));
      // 申し込みには、たいてい手土産がつく
      if (!hooks.some((h) => h.key === 'dowry') && o.c.dynastyId !== p.dynastyId) {
        const n = 4 + this.rng.int(8);
        hooks.unshift({ key: 'dowry', icon: '💰', amount: n, text: `申し込みの手土産：家格 +${n}` });
      }
      this._marriageDecision(p, { proposal: { id: o.c.id, hooks: hooks.slice(0, 3), cost: 0, from: this.dyn(o.c).id } });
      return true;
    }
  },

  // 縁談を決める。高嶺の花は家格を払う
  _resolveMarriage(d, p, c, matri) {
    const offer = (d.offers ?? []).find((o) => o.id === c.id);
    const hooks = offer?.hooks ?? [];
    const my = this.dyn(p);
    // 同じ家どうしの縁組は、入婿にしなくても子は家名を継ぐ
    if (c.dynastyId === p.dynastyId) matri = false;
    if (matri && this.matriRefusal(c)) {
      this.player.decisions.unshift(d);
      return `${c.name}は${this.matriRefusal(c)}なので、入婿には来ません。`;
    }
    // 入婿は、入婿の贈り物（高嶺の花の贈り物とは別）
    const cost = matri ? this.matriPrice(d, p, c) : (offer?.cost ?? 0);
    if (cost > 0) {
      if (!my || my.prestige < cost) {
        // 決断はそのまま残して、選び直せるようにする
        this.player.decisions.unshift(d);
        return `家格が足りません（${cost} 要る・いま ${Math.round(my?.prestige ?? 0)}）。`;
      }
      my.prestige -= cost;
    }
    const love = hooks.some((h) => h.key === 'love' || h.key === 'friend');
    // 自分で選んだ縁組は、家の方針より選んだ形を優先する
    this._explicitMatch = true;
    this._wed(p.sex === 'M' ? p : c, p.sex === 'M' ? c : p, false, matri, love);
    this._explicitMatch = false;
    const notes = [];
    for (const h of hooks) {
      // 入婿にするなら、手土産・持参金は取り下げられる（相手の家の条件を断って、こちらの条件に変えるので）
      if (h.key === 'dowry' && my && !matri) {
        my.prestige += h.amount;
        notes.push(`家格 +${h.amount}`);
      }
      if (h.key === 'claim') {
        c.bloodClaims = [...new Set([...(c.bloodClaims ?? []), h.kingdomId])];
        notes.push(`子は${this.kingdoms[h.kingdomId].name}の請求権を持つ`);
      }
      if (h.key === 'feud') {
        const cd = this.dyn(c);
        for (const [x, y] of [[my, cd], [cd, my]]) for (const g of this.grudgesOf(x, y.id)) g.ease *= 0.3;
        notes.push('因縁が和らいだ');
      }
    }
    // 目立つ縁組は生涯に残す
    const royal = this.royalOf(c);
    const tag = c.rulerOf != null ? `${this.kingdoms[c.rulerOf].name}の${c.sex === 'M' ? '王' : '女王'}` : royal && [c.fatherId, c.motherId].includes(royal.rulerId) ? `${royal.name}の${c.sex === 'M' ? '王子' : '王女'}` : offer?.cost ? `高嶺の花` : love ? '想い人' : null;
    if (tag) {
      this._deed(p, 'match', `${tag} ${c.name}と結ばれる`, { tag, name: c.name });
      this._deed(c, 'match', `${p.name}と結ばれる`, { tag: null, name: p.name });
    }
    const bond = p.bond?.kind;
    if (bond === 'love') notes.push(`ふたりは仲睦まじい（${p.bond.why}）`);
    if (bond === 'cold') notes.push(`ふたりの仲は冷ややか（${p.bond.why}）`);
    if (cost) notes.unshift(`${matri ? '入婿の贈り物' : '贈り物'}に家格 −${cost}`);
    matri = matri || (p.sex === 'F' && p.matrilineal && c.dynastyId !== p.dynastyId);
    return `${matri ? `${c.name}を入婿に迎えた` : `${p.name}と${c.name}の縁談がまとまった`}。${notes.join('・')}`;
  },

  // 申し込みを断る：主君の王家なら王の機嫌をそこねる
  _declineProposal(d, p) {
    const c = this.get(d.candidateIds[0]);
    const cd = c ? this.dyn(c) : null;
    const my = this.dyn(p);
    const liege = my ? this.kingdoms[my.kingdomId] : null;
    if (cd && liege && liege.alive && this.ruler(liege)?.dynastyId === cd.id && my.id !== cd.id) {
      this._remember(my, -10, '王家の縁談を断った', liege);
      return `${cd.name}家の申し込みを断った。王は面白くなさそうだ。`;
    }
    return cd ? `${cd.name}家の申し込みを断った。` : null;
  },

  // 夫婦仲：魅力・慈愛・年の差と、めぐりあわせで決まる。理由も残す
  _bond(h, w, love = false) {
    const luck = (this.rng.next() - 0.5) * 2;
    const parts = [
      [(this.charm(h) + this.charm(w) - 100) / 80, 'ふたりとも魅力的', 'ふたりとも魅力に乏しい'],
      [(h.pheno.kindness + w.pheno.kindness - 100) / 120, 'ふたりとも情け深い', '情の薄い者どうし'],
      [-Math.max(0, Math.abs(this.age(h) - this.age(w)) - 8) / 15, '', `年の差が ${Math.abs(this.age(h) - this.age(w))} 歳`],
      [h.mad || w.mad ? -1 : 0, '', '狂気'],
      [love ? 2 : 0, 'もともと慕い合っていた', ''],
      [luck, '気が合った', 'そりが合わなかった'],
    ];
    const v = parts.reduce((s, [x]) => s + x, 0);
    const kind = v > 0.9 ? 'love' : v < -0.7 ? 'cold' : null;
    // 結果にいちばん効いた理由
    const why = kind ? parts.filter(([x]) => (kind === 'love' ? x > 0.15 : x < -0.15)).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 2).map((x) => (kind === 'love' ? x[1] : x[2])).filter(Boolean).join('・') : '';
    h.bond = { with: w.id, kind, why };
    w.bond = { with: h.id, kind, why };
  },

  // 夫婦仲は年とともに少しずつ変わる（冷えた仲も、時がたてば和らぐことがある）
  _bondDrift() {
    for (const w of this.living) {
      if (!w.alive || w.sex !== 'F' || w.spouseId == null || !w.bond || w.bond.with !== w.spouseId) continue;
      const h = this.get(w.spouseId);
      let next;
      if (w.bond.kind === 'cold' && this.rng.chance(0.04)) next = { kind: null, why: '時がたって和らいだ' };
      else if (w.bond.kind == null && this.rng.chance(0.015)) next = this.rng.chance(0.5) ? { kind: 'love', why: '連れ添ううちに情が深まった' } : { kind: 'cold', why: '心が離れていった' };
      else if (w.bond.kind === 'love' && (w.mad || h.mad) && this.rng.chance(0.1)) next = { kind: 'cold', why: '狂気が仲を裂いた' };
      if (!next) continue;
      Object.assign(w.bond, next);
      if (h.bond) Object.assign(h.bond, next);
    }
  },

  // 夫婦仲が子づくりに効く割合
  bondFertility(w) {
    const k = w.bond && w.bond.with === w.spouseId ? w.bond.kind : null;
    return k === 'love' ? 1.25 : k === 'cold' ? 0.7 : 1;
  },

  bondLabel(p) {
    const b = p.bond && p.bond.with === p.spouseId ? p.bond : null;
    const why = b?.why ? `（${b.why}）` : '';
    return b?.kind === 'love' ? `💕 仲睦まじい${why}：子に恵まれやすい` : b?.kind === 'cold' ? `❄ 冷え切っている${why}：子ができにくく、不義が起きやすい。時がたてば和らぐこともある` : '';
  },
};

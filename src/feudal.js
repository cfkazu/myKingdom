// 封建制：伯爵領（地方）・公爵領・王国の三階層。World にメソッドとして組み込む。
//
// - 伯爵領はどこかの家が持つ（province.holder = 家の id）。holder が null の地方は「王領」で、そのとき王位にある者のもの。
//   家の土地は当主が治め、当主が死ねば次の当主へ、家が絶えれば王領に戻る。
// - 公爵領の伯爵領の過半を持つ家は、その公爵（〇〇公）になる。
// - 諸侯の家は、王への忠誠（opinion）を持つ。忠誠は血縁・婚姻・王の魅力と力量・恩賞・没収・処刑の記憶などで決まり、
//   忠誠が低いと兵を出し渋り、不満な家どうしが派閥をつくって反乱を起こす。
// - 王は直轄できる王領の数に限りがあり（統治の力しだい）、余った土地は恩賞として諸侯に与える。

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const FACTION_LABEL = { usurp: '簒奪派', claimant: '擁立派', independence: '独立派' };

export const FeudalMixin = {
  // ───────── 土地と称号 ─────────

  // 王領か（王位にある家のものか）
  isDemesne(pr) {
    if (pr.holder == null) return true;
    const r = this.ruler(this.kingdoms[pr.ownerId]);
    return !!r && r.dynastyId === pr.holder;
  },

  // その伯爵領を実際に治めている人（王領なら王、諸侯の土地なら家の当主）
  holderPerson(pr) {
    if (this.isDemesne(pr)) return this.ruler(this.kingdoms[pr.ownerId]);
    const d = this.dynasties[pr.holder];
    return d ? this.head(d) : null;
  },

  countiesOf(dynId, kid = null) {
    return this.provinces.filter((pr) => pr.holder === dynId && (kid == null || pr.ownerId === kid));
  },

  demesneOf(k) {
    return this.provinces.filter((pr) => pr.ownerId === k.id && this.isDemesne(pr));
  },

  // 首都は、その国の王の土地でなければならない。失ったら王領から選び直し、王領がなければいちばん大きな伯爵領を取り上げる
  _ensureCapital(k) {
    const cap = this.provinces[k.capital];
    if (cap && cap.ownerId === k.id && this.isDemesne(cap)) return;
    const own = this.provinces.filter((pr) => pr.ownerId === k.id);
    if (!own.length) return;
    const dem = own.filter((pr) => this.isDemesne(pr)).sort((a, b) => b.pop - a.pop);
    if (dem.length) {
      k.capital = dem[0].id;
      return;
    }
    const pick = own.sort((a, b) => b.pop - a.pop)[0];
    const lost = pick.holder != null ? this.dynasties[pick.holder] : null;
    if (lost && !lost.extinct) this._remember(lost, -30, '居城を王に奪われた', k);
    pick.holder = null;
    k.capital = pick.id;
  },

  // いまの王家が、この国の王位に続けて就いている年数
  dynastyYears(k) {
    const r = this.ruler(k);
    if (!r) return 0;
    let since = this.year;
    for (let i = k.rulers.length - 1; i >= 0 && k.rulers[i].dynastyId === r.dynastyId; i--) since = k.rulers[i].from;
    return this.year - since;
  },

  demesneLimit(k) {
    const r = this.ruler(k);
    // 官僚を雇うと、直轄できる王領が増える
    return 2 + Math.floor((r ? this.stewardship(r) : 30) / 22) + (k.officials ?? 0);
  },

  // その国の諸侯の家（その国に伯爵領を持つ、王家以外の家）
  vassals(k) {
    const r = this.ruler(k);
    const ids = new Set();
    for (const pr of this.provinces) if (pr.ownerId === k.id && pr.holder != null && pr.holder !== r?.dynastyId) ids.add(pr.holder);
    return [...ids].map((id) => this.dynasties[id]).filter((d) => !d.extinct);
  },

  // 公爵領の持ち主を決め直す：伯爵領の過半（2 つ以上）を持つ家。王領が過半なら王が兼ねる
  _updateDuchies() {
    for (const du of this.duchies) {
      const count = new Map();
      for (const pid of du.provinces) {
        const pr = this.provinces[pid];
        const key = this.isDemesne(pr) ? `k${pr.ownerId}` : `d${pr.holder}`;
        count.set(key, (count.get(key) ?? 0) + 1);
      }
      let best = null;
      let bestN = 0;
      for (const [key, n] of count) if (n > bestN) [best, bestN] = [key, n];
      const need = Math.max(2, Math.ceil(du.provinces.length / 2));
      const holder = bestN >= need ? best : null;
      if (holder !== du.holder) {
        if (holder && holder.startsWith('d') && this.year > this.o.startYear) {
          const d = this.dynasties[Number(holder.slice(1))];
          const h = this.head(d);
          if (h) this.addLog('dynasty', `${this.pn(h)} の${d.name}家が ${du.name}公領 の過半を治め、${du.name}公となった。`, [this.provinces[du.provinces[0]].ownerId]);
        }
        du.holder = holder;
      }
    }
  },

  duchyHolderDyn(du) {
    return du.holder && du.holder.startsWith('d') ? Number(du.holder.slice(1)) : null;
  },

  // 家の爵位（表示用）
  houseTitle(d) {
    const duchies = this.duchies.filter((du) => this.duchyHolderDyn(du) === d.id);
    if (duchies.length) return `${duchies.map((du) => du.name).join('・')}公`;
    const cs = this.countiesOf(d.id);
    if (cs.length) return `${cs[0].name}伯`;
    return null;
  },

  houseRank(d) {
    if (this.duchies.some((du) => this.duchyHolderDyn(du) === d.id)) return 'duke';
    return this.countiesOf(d.id).length ? 'count' : 'landless';
  },

  // ───────── 忠誠 ─────────

  _remember(d, value, why, k) {
    const r = k ? this.ruler(k) : null;
    d.memory = d.memory ?? [];
    d.memory.push({ v: value, why, year: this.year, rulerDyn: r ? r.dynastyId : null });
    if (d.memory.length > 12) d.memory.shift();
  },

  // 家 d の当主の、王国 k の王への忠誠（-100〜100）と、その内訳
  opinionOf(d, k) {
    const r = this.ruler(k);
    const h = this.head(d);
    const parts = [];
    if (!r || !h) return { value: 0, parts };
    const add = (v, why) => {
      if (Math.abs(v) >= 1) parts.push([Math.round(v), why]);
    };
    add(10, '基本');
    if (this.dynastyYears(k) < 10) add(-10, '新しい王朝');
    const phi = this.ped.kinship(h.id, r.id);
    add(Math.min(30, 120 * phi), '王との血縁');
    const royalKin = [r.id, ...r.children, r.fatherId, r.motherId].filter((x) => x != null);
    if (this.living.some((p) => p.alive && p.dynastyId === d.id && p.spouseId != null && royalKin.includes(p.spouseId))) add(15, '王家との婚姻');
    add((r.pheno.charisma - 50) * 0.25, '王のカリスマ');
    add((this.stewardship(r) - 50) * 0.15, '王の統治');
    add(-(h.pheno.ambition - 50) * 0.45, '当主の野心');
    if (r.mad) add(-18, '狂王');
    if (k.regentId != null) add(-10, '摂政の政治');
    if (r.sex === 'F' && k.law === 'agnatic') add(-12, '女王への反発');
    if (this.year - k.lastDefeat < 6) add(-10, '最近の敗戦');
    if (r.pheno.kindness < 25) add(-8, '王の冷酷さ');
    const held = this.countiesOf(d.id, k.id);
    if (held.length >= 3) add(-(held.length - 2) * 5, '大きすぎる所領');
    const seat = this.provinces[d.homeProvinceId];
    const cap = this.provinces[k.capital];
    if (seat && cap) {
      const dist = Math.hypot(seat.cx - cap.cx, seat.cy - cap.cy);
      if (dist > 18) add(-(dist - 18) * 0.7, '遠い王');
    }
    if (held.some((pr) => pr.origin !== k.origin && !this.kingdoms[pr.origin]?.alive)) add(-12, `かつての${this.kingdoms[held.find((pr) => pr.origin !== k.origin).origin].name}の民`);
    for (const m of d.memory ?? []) {
      if (m.rulerDyn !== r.dynastyId) continue;
      const left = 1 - (this.year - m.year) / 25;
      if (left > 0) add(m.v * left, m.why);
    }
    // 因縁：王家への恨みは、何代たっても消えない
    const gs = this.grudgesOf(d, r.dynastyId);
    if (gs.length) add(-this.grudgeAgainst(d, r.dynastyId), this.grudgeShort(gs[0]));
    const value = clamp(parts.reduce((s, [v]) => s + v, 0), -100, 100);
    return { value, parts };
  },

  // 忠誠に応じた、兵を出す割合
  levyFactor(d) {
    return clamp(0.55 + (d.opinion ?? 0) / 110, 0.1, 1.05);
  },

  // 首都から遠い土地ほど、王の目が届かず兵が集まりにくい
  reach(pr, k) {
    const cap = this.provinces[k.capital];
    const dist = cap ? Math.hypot(pr.cx - cap.cx, pr.cy - cap.cy) : 0;
    return clamp(1.15 - dist / 50, 0.45, 1);
  },

  countyLevy(pr) {
    // 城を築いた地方は、兵が 30% 増える
    return pr.pop * 0.025 * (1 - pr.devastation * 0.5) * (pr.castle ? 1.3 : 1);
  },

  // 王国の兵力（千人）。王領はそのまま、諸侯の土地は忠誠に応じて。exclude の家の土地は数えない（反乱中など）
  power(k, exclude = null) {
    let s = 0;
    for (const pr of this.provinces) {
      if (pr.ownerId !== k.id) continue;
      if (exclude && pr.holder != null && exclude.has(pr.holder)) continue;
      const base = this.countyLevy(pr) * this.reach(pr, k);
      s += this.isDemesne(pr) ? base * 1.15 : base * this.levyFactor(this.dynasties[pr.holder]);
    }
    const r = this.ruler(k);
    const comp = r ? 0.8 + this.stewardship(r) / 250 : 0.8;
    return s * comp * (k.regentId != null ? 0.85 : 1) * (1 - Math.min(0.5, k.exhaustion));
  },

  // 絶えた家 d の血を引く人：最後の当主の子、ついでその家の人を親に持つ人。ほかの国の王家の人は除く
  _bloodHeir(d) {
    let best = null;
    let bestS = -Infinity;
    for (const p of this.living) {
      if (!p.alive || p.dynastyId == null || p.dynastyId === d.id || this.age(p) < 1) continue;
      const pd = this.dyn(p);
      if (!pd || pd.extinct) continue;
      const par = [this.get(p.fatherId), this.get(p.motherId)].find((x) => x && x.dynastyId === d.id);
      if (!par) continue;
      if (this.kingdoms.some((k) => k.alive && k.rulerId != null && this.ruler(k).dynastyId === pd.id && k.id !== this.provinces[d.homeProvinceId]?.ownerId)) continue;
      const s = (par.id === d.headId ? 100 : 0) + Math.min(this.age(p), 60);
      if (s > bestS) {
        bestS = s;
        best = p;
      }
    }
    return best;
  },

  // ───────── 毎年の封建のしごと ─────────

  _feudal() {
    // 絶えた家の土地は、その家の血を引く人（嫁いだ娘の子など）の家が継ぐ。いなければ王領に戻る
    const heirs = new Map();
    for (const pr of this.provinces) {
      if (pr.holder == null) continue;
      const d = this.dynasties[pr.holder];
      if (!d.extinct) continue;
      if (!heirs.has(d.id)) heirs.set(d.id, this._bloodHeir(d));
      const h = heirs.get(d.id);
      const k = this.kingdoms[pr.ownerId];
      const hd = h ? this.dyn(h) : null;
      if (hd && this.ruler(k)?.dynastyId === hd.id) pr.holder = null;
      else pr.holder = hd ? hd.id : null;
      if (hd) {
        this.addLog('dynasty', `${d.name}家が絶え、${pr.name}伯領は血を引く ${this.pn(h)}（${hd.name}家）が継いだ。`, [pr.ownerId]);
        if (this.player && !this.player.over && hd.id === this.player.dynastyId)
          this._news?.({ icon: '📜', title: `${pr.name}伯領 を相続した`, body: `${d.name}家が絶え、その血を引く ${this.pn(h)} があなたの家に${pr.name}伯領をもたらした。`, why: '家が絶えると、その所領は血を引く人（嫁いだ娘の子など）の家が継ぎます。跡取り娘との縁組は、所領を増やす道です。', means: `所領：${this.countiesOf(hd.id).map((p) => p.name).join('・')}。`, flashKind: 'gain', pids: [pr.id] });
      } else if (d.prestige > 30) this.addLog('dynasty', `${d.name}家が絶え、${pr.name}伯領は王領に戻った。`, [pr.ownerId]);
    }
    for (const k of this.kingdoms) if (k.alive) this._ensureCapital(k);
    this._updateDuchies();
    this._seats();
    // 忠誠
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      for (const d of this.vassals(k)) d.opinion = this.opinionOf(d, k).value;
    }
    for (const k of this.kingdoms) if (k.alive) this._grantsAndRevocations(k);
  },

  // 家の居城と、仕える国を決め直す。人々はそこに住む
  _seats() {
    const ruling = new Map();
    for (const k of this.kingdoms) if (k.alive && k.rulerId != null) ruling.set(this.ruler(k).dynastyId, k);
    for (const d of this.dynasties) {
      if (d.extinct) continue;
      const rk = ruling.get(d.id);
      if (rk) {
        d.homeProvinceId = rk.capital;
        d.kingdomId = rk.id;
        continue;
      }
      const held = this.countiesOf(d.id);
      if (held.length) {
        if (!held.some((pr) => pr.id === d.homeProvinceId)) d.homeProvinceId = held.sort((a, b) => b.pop - a.pop)[0].id;
        d.kingdomId = this.provinces[d.homeProvinceId].ownerId;
      } else {
        // 土地のない家は、仕える国の宮廷（首都）に住む
        let k = this.kingdoms[d.kingdomId];
        if (!k || !k.alive) {
          const h = this.head(d);
          k = h ? this.kingdomOf(h) : null;
        }
        if (k && k.alive) {
          d.kingdomId = k.id;
          d.homeProvinceId = k.capital;
        }
      }
    }
    // 人々の住む国：家に従う。配偶者の家に入った人は配偶者に従う
    const follows = (p) => (p.sex === 'F' ? !p.matrilineal : p.matrilineal);
    for (const p of this.living) {
      if (!p.alive || p.rulerOf != null) continue;
      const sp = p.spouseId != null ? this.get(p.spouseId) : null;
      if (sp && sp.alive && follows(p)) continue;
      const d = this.dyn(p);
      if (d && this.kingdoms[d.kingdomId]?.alive) p.kingdomId = d.kingdomId;
    }
    for (const p of this.living) {
      if (!p.alive || p.rulerOf != null) continue;
      const sp = p.spouseId != null ? this.get(p.spouseId) : null;
      if (sp && sp.alive && follows(p)) p.kingdomId = sp.kingdomId;
    }
  },

  // 王領が多すぎれば恩賞として与え、専横な王は不満な家から土地を取り上げる
  _grantsAndRevocations(k) {
    const r = this.ruler(k);
    if (!r || this.age(r) < 16) return;
    const demesne = this.demesneOf(k);
    const limit = this.demesneLimit(k);
    // プレイヤーの国：恩賞は自分で決め、没収も自分で行う
    if (k === this.playerKingdom()) {
      // 恩賞の相談は 5 年に一度まで（毎年は聞かない）
      if (demesne.length > limit && (k.keepUntil ?? 0) <= this.year && this.year - (k.grantAsked ?? -99) >= 5) {
        k.grantAsked = this.year;
        const cap = this.provinces[k.capital];
        const give = demesne.filter((pr) => pr.id !== k.capital).sort((a, b) => Math.hypot(b.cx - cap.cx, b.cy - cap.cy) - Math.hypot(a.cx - cap.cx, a.cy - cap.cy))[0];
        if (give) this._playerGrantDecision(k, give);
      }
      return;
    }
    if (demesne.length > limit) {
      const cap = this.provinces[k.capital];
      const give = demesne.filter((pr) => pr.id !== k.capital).sort((a, b) => Math.hypot(b.cx - cap.cx, b.cy - cap.cy) - Math.hypot(a.cx - cap.cx, a.cy - cap.cy))[0];
      if (give) this._grant(k, give, null);
      return;
    }
    // 没収：野心が強く情けの薄い王が、忠誠の低い家から
    const ph = r.pheno;
    if (demesne.length < limit && ph.ambition > 60 && ph.kindness < 40 && k.regentId == null) {
      const target = this.vassals(k)
        // 反乱をともに勝った同志の家は、20 年は取り上げない
        .filter((d) => (d.opinion ?? 0) < -30 && !((d.pardonUntil ?? 0) > this.year))
        .sort((a, b) => (a.opinion ?? 0) - (b.opinion ?? 0))[0];
      if (target && this.rng.chance(0.08)) {
        const pr = this.countiesOf(target.id, k.id).sort((a, b) => b.pop - a.pop)[0];
        pr.holder = null;
        this._remember(target, -50, '領地の没収', k);
        this._grudge(target, this.dyn(r), 'revoke', null, { place: pr.name });
        if (this.head(target)) this._deed(this.head(target), 'revoked', `${pr.name}伯領を王に取り上げられる`, { place: pr.name });
        this._newsRevoked(target, pr, `${this.pn(r)} が、忠誠の低いあなたの家から取り上げた。`);
        for (const d of this.vassals(k)) if (d !== target) this._remember(d, -8, '王の専横', k);
        const h = this.head(target);
        this.addLog('dynasty', `${this.pn(r)} は ${h ? this.pn(h) : `${target.name}家`} から ${pr.name}伯領 を取り上げた。諸侯は王の専横を恐れている。`, [k.id]);
      }
    }
  },

  // 恩賞：伯爵領を家に与える。to が null なら、ふさわしい家を王が選ぶ（いなければ新しい家を興す）
  _grant(k, pr, to, why = '恩賞', { knight = false } = {}) {
    const r = this.ruler(k);
    if (!to) {
      const cands = this.dynasties.filter((d) => !d.extinct && d.kingdomId === k.id && d.id !== r?.dynastyId && this.head(d) && this.age(this.head(d)) >= 16);
      let best = null;
      let bestS = -Infinity;
      for (const d of cands) {
        const h = this.head(d);
        const n = this.countiesOf(d.id).length;
        const rebel = (d.memory ?? []).some((m) => /反乱/.test(m.why) && this.year - m.year < 40) || d.rebelYear > this.year - 40;
        // 同じ公爵領にすでに土地を持つ家は、まとめて持たせる（公爵が育つ）
        const sameDuchy = this.countiesOf(d.id).some((c) => c.duchyId === pr.duchyId) ? 28 : 0;
        // 王に献上した家は、恩賞で選ばれやすい
        // 献上した家には、次の恩賞を必ず与える
        const favor = (d.favorUntil ?? 0) > this.year ? 400 : 0;
        const s = favor + sameDuchy + (rebel ? -80 : 0) + (n === 0 ? 30 : -n * 12) + (d.opinion ?? 0) * 0.4 + Math.min(20, d.prestige * 0.25) + 60 * this.ped.kinship(h.id, r?.id) + this.martial(h) * 0.15 + this.rng.next() * 15;
        if (s > bestS) {
          bestS = s;
          best = d;
        }
      }
      if (knight || !best || (bestS < 0 && this.rng.chance(0.5))) {
        const head = this._raiseHouse(k, pr.id, true);
        best = this.dyn(head);
        pr.holder = best.id;
        best.homeProvinceId = pr.id;
        this.addLog('dynasty', `${r ? this.pn(r) : this.kn(k)} は ${pr.name} の騎士 ${this.pn(head)} を貴族に取り立て、${pr.name}伯とした（${best.name}家）。`, [k.id]);
        return best;
      }
      to = best;
    }
    pr.holder = to.id;
    if ((to.favorUntil ?? 0) > this.year) to.favorUntil = null;
    this._remember(to, 30, why, k);
    const h = this.head(to);
    if (h && r) this.addLog('dynasty', `${this.pn(r)} は ${why}として ${pr.name}伯領 を ${this.pn(h)}（${to.name}家）に与えた。`, [k.id]);
    this._newsGrant(to, pr, why, k);
    if (h) this._deed(h, 'grant', `${pr.name}伯領を賜る`, { place: pr.name });
    return to;
  },

  // ───────── 派閥と反乱 ─────────

  _factions() {
    for (const k of this.kingdoms) {
      if (!k.alive) continue;
      k.factions = [];
      const r = this.ruler(k);
      if (!r) continue;
      const internal = this.activeWars(k.id).some((w) => w.kind === 'civil' || w.kind === 'independence');
      const cap = this.provinces[k.capital];
      // 請求者（国の中にいれば優先）
      const claimants = this.living.filter((p) => p.alive && p.rulerOf == null && this.age(p) >= 16 && p.claims.includes(k.id));
      claimants.sort((a, b) => (b.kingdomId === k.id) - (a.kingdomId === k.id) || this.charm(b) - this.charm(a));
      const groups = { usurp: [], claimant: [], independence: [] };
      for (const d of this.vassals(k)) {
        // プレイヤーの家は、誘いに応じたときだけ派閥に入る
        const pj = this.player && !this.player.over && d.id === this.player.dynastyId ? this.player.joined : undefined;
        if (pj !== undefined) {
          if (pj && pj.kingdomId === k.id) groups[pj.kind].push(d);
          continue;
        }
        const o = d.opinion ?? 0;
        if (o > -10) continue;
        const h = this.head(d);
        if (!h || this.age(h) < 18) continue;
        const held = this.countiesOf(d.id, k.id);
        const far = held.some((pr) => Math.hypot(pr.cx - cap.cx, pr.cy - cap.cy) > 16);
        const foreign = held.some((pr) => pr.origin !== k.origin);
        const kind =
          claimants.length && this.ped.kinship(h.id, claimants[0].id) > 0.03
            ? 'claimant'
            : (this.houseRank(d) === 'duke' || held.length >= 2) && (far || foreign)
              ? 'independence'
              : h.pheno.ambition > 58
                ? 'usurp'
                : claimants.length
                  ? 'claimant'
                  : far || foreign
                    ? 'independence'
                    : null;
        if (kind) groups[kind].push(d);
      }
      const others = this.power(k);
      for (const [kind, members] of Object.entries(groups)) {
        if (!members.length) continue;
        members.sort((a, b) => this.countiesOf(b.id, k.id).length * 10 + b.prestige * 0.1 - (this.countiesOf(a.id, k.id).length * 10 + a.prestige * 0.1));
        const leader = kind === 'claimant' ? claimants[0] : this.head(members[0]);
        if (!leader) continue;
        const ex = new Set(members.map((d) => d.id));
        let str = 0;
        for (const pr of this.provinces) if (pr.ownerId === k.id && ex.has(pr.holder)) str += this.countyLevy(pr);
        const ratio = str / Math.max(1, this.power(k, ex));
        k.factions.push({ kind, leaderId: leader.id, members: members.map((d) => d.id), ratio });
        if (internal) continue;
        // 十分に強くなったら、反乱を起こす
        const weak = this.weakness(k);
        // 王位を奪う・すげ替える反乱は、独立よりずっと強くならないと起きない
        // 正統性：長く続いた王家ほど、王位そのものを狙う反乱は起きにくい（独立には効かない）
        const legit = 1 + Math.min(0.8, this.dynastyYears(k) / 120);
        const need = kind === 'independence' ? 0.45 : (kind === 'claimant' ? 0.7 : 0.8) * legit;
        if (ratio < need / Math.sqrt(weak)) continue;
        if (!this.rng.chance(kind === 'claimant' ? 0.3 : 0.2)) continue;
        this._rebel(k, kind, leader, members, others);
        break;
      }
    }
  },

  _rebel(k, kind, leader, members) {
    const r = this.ruler(k);
    // ほかの不満な諸侯も、この機に加わることがある
    for (const d of this.vassals(k)) {
      if (members.includes(d) || (d.opinion ?? 0) >= -5) continue;
      if (this.player && d.id === this.player.dynastyId && !(this.player.joined && this.player.joined.kingdomId === k.id)) continue;
      if (this.rng.chance(0.3)) members.push(d);
    }
    const ids = members.map((d) => d.id);
    const provinces = this.provinces.filter((pr) => pr.ownerId === k.id && ids.includes(pr.holder)).map((pr) => pr.id);
    const names = members.map((d) => `${d.name}家`).join('・');
    const why = this._grudgeNote(members, this.dyn(r));
    if (kind === 'independence') {
      const w = this._startWar('independence', k, k, { leaderId: leader.id, members: ids, provinces, faction: kind });
      this._deed(leader, 'rebel', `${w.name}を率いる`, { war: w.name });
      this.addLog('war', `${names} が独立を求めて ${this.pn(r)} に反旗をひるがえした。盟主は ${this.pn(leader)}（${w.name}）。${why}`, [k.id]);
    } else {
      const w = this._startWar('civil', k, k, { leaderId: kind === 'claimant' ? this.head(members[0]).id : leader.id, claimantId: kind === 'claimant' ? leader.id : null, members: ids, provinces, faction: kind });
      const goal = kind === 'claimant' ? `${this.pn(leader)} を王位に就けようと` : `${this.pn(leader)} を王にしようと`;
      this._deed(this.get(w.leaderId), 'rebel', `${w.name}を率いる`, { war: w.name });
      this.addLog('war', `${names} が ${goal}、${this.pn(r)} に反旗をひるがえした（${w.name}）。${why}`, [k.id]);
    }
  },
};

export function setupFeudal(world) {
  // 王国ごとに、王領（首都のまわり）と諸侯の家の所領を配る
  for (const k of world.kingdoms) {
    const provs = world.provincesOf(k);
    const cap = world.provinces[k.capital];
    provs.sort((a, b) => Math.hypot(a.cx - cap.cx, a.cy - cap.cy) - Math.hypot(b.cx - cap.cx, b.cy - cap.cy));
    const nDemesne = Math.min(provs.length, 2 + world.rng.int(2));
    for (const pr of provs.slice(0, nDemesne)) pr.holder = null;
    const rest = provs.slice(nDemesne);
    // 公爵領ごとに、ときどき 1 つの家がまとめて持つ（公爵）
    const byDuchy = new Map();
    for (const pr of rest) {
      if (!byDuchy.has(pr.duchyId)) byDuchy.set(pr.duchyId, []);
      byDuchy.get(pr.duchyId).push(pr);
    }
    for (const [, list] of byDuchy) {
      let i = 0;
      while (i < list.length) {
        const take = list.length - i >= 2 && world.rng.chance(0.4) ? Math.min(list.length - i, 2 + world.rng.int(2)) : 1;
        const group = list.slice(i, i + take);
        i += take;
        const home = group[0];
        const d = world._newDynasty(k.culture, k.id, home.id, world.year - world.rng.int(150));
        d.prestige = 10 + take * 8 + world.rng.int(20);
        for (const pr of group) pr.holder = d.id;
        world._family(d, k, home.id, 22 + world.rng.int(30), { withParents: world.rng.chance(0.5), siblings: world.rng.int(2), culture: k.culture });
      }
    }
  }
}

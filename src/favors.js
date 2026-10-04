// 家格の使い道：家格は身分に応じて少しずつ入り、年 2.5% ずつ目減りする。貯めるより使うもの。World にメソッドとして組み込む。
//
// - 祝宴を開く（王）：諸侯みなの忠誠が上がる
// - 王に献上する（諸侯）：15 年のうちに王が伯爵領を与えるときは、必ずあなたの家に来る
// - 伯爵領を買い取る（王・諸侯）：同じ国のほかの家から伯爵領を買う（相手が 2 つ以上持っていれば）
// - 請求権を捏造する（王）：隣国の王位への請求権をつくり、継承戦争を起こせるようにする

export const FEAST_COST = 20;
export const TRIBUTE_COST = 15;

export const FavorsMixin = {
  _spend(n) {
    const my = this.playerDynasty();
    if (!my || my.prestige < n) return false;
    my.prestige -= n;
    return true;
  },

  feast() {
    const k = this.playerKingdom();
    if (!k) return null;
    if (k.feastYear != null && this.year - k.feastYear < 5) return '祝宴は 5 年に 1 度までです。';
    if (!this._spend(FEAST_COST)) return `家格が足りません（${FEAST_COST} 要る）。`;
    k.feastYear = this.year;
    for (const v of this.vassals(k)) this._remember(v, 15, '王の祝宴', k);
    this.addLog('event', `${this.pn(this.ruler(k))} は都で盛大な祝宴を開き、諸侯をもてなした。`, [k.id]);
    return `祝宴を開いた（家格 −${FEAST_COST}）。諸侯みなの忠誠が上がる。`;
  },

  tribute() {
    const k = this.playerLiege();
    const my = this.playerDynasty();
    if (!k || !my) return null;
    if ((my.favorUntil ?? 0) > this.year) return 'いまは王のおぼえがめでたい。献上はまだ要りません。';
    if (!this._spend(TRIBUTE_COST)) return `家格が足りません（${TRIBUTE_COST} 要る）。`;
    my.favorUntil = this.year + 15;
    this.addLog('event', `${my.name}家は ${this.pn(this.ruler(k))} に献上品を贈った。`, [k.id]);
    return `王に献上した（家格 −${TRIBUTE_COST}）。15 年のうちに王が伯爵領を与えるときは、必ずあなたの家に来る（王領が上限を超えたとき・戦で奪ったときなど）。`;
  },

  // 公爵になるのに要る伯爵領の数（その公爵領の過半、2 つ以上）
  duchyNeed(du) {
    return Math.max(2, Math.ceil(du.provinces.length / 2));
  },

  // 買い取れる伯爵領：同じ国の、ほかの家が 2 つ以上持つ伯爵領（本拠は割高）。諸侯は王領も割高で買える
  buyableCounties() {
    const my = this.playerDynasty();
    const k = this.playerKingdom() ?? this.playerLiege();
    if (!my || !k) return [];
    const king = this.playerKingdom();
    const ruler = this.ruler(k);
    const mine = new Set(this.provinces.filter((p) => p.holder === my.id || (king && p.ownerId === k.id && this.isDemesne(p))).map((p) => p.id));
    const rebels = new Set(this.wars.filter((w) => !w.ended && w.defenderId === k.id).flatMap((w) => w.members ?? []));
    const crown = !king && ruler && this.demesneOf(k).length >= 2;
    const overLimit = king ? this.demesneOf(k).length + 1 > this.demesneLimit(k) : false;
    return this.provinces
      .filter((pr) => pr.ownerId === k.id && pr.holder !== my.id && !(pr.holder != null && rebels.has(pr.holder)))
      .filter((pr) => {
        if (pr.holder == null) return crown && pr.id !== k.capital;
        const d = this.dynasties[pr.holder];
        return d && !d.extinct && this.countiesOf(d.id, k.id).length >= 2;
      })
      .map((pr) => {
        const d = pr.holder != null ? this.dynasties[pr.holder] : this.dyn(ruler);
        const home = pr.holder != null && d.homeProvinceId === pr.id;
        const du = this.duchies[pr.duchyId];
        const have = du.provinces.filter((id) => this.provinces[id].holder === my.id).length;
        const left = this.duchyNeed(du) - (have + 1);
        const isDuke = this.duchyHolderDyn(du) === my.id;
        return {
          pr,
          d,
          du,
          home,
          crown: pr.holder == null,
          near: [...pr.neighbors].some((q) => mine.has(q)),
          // 公爵への道：これを買えば公爵になる（left ≤ 0）／あと left つ
          dukeLeft: king || isDuke ? null : left,
          overLimit,
          price: Math.round(this.countyPrice(pr) * (pr.holder == null ? 1.5 : home ? 1.4 : 1)),
        };
      })
      .sort((a, b) => (a.dukeLeft ?? 99) - (b.dukeLeft ?? 99) || Number(b.near) - Number(a.near) || a.price - b.price)
      .slice(0, 8);
  },

  countyPrice(pr) {
    return Math.round(30 + Math.min(30, (pr.pop / Math.max(1, pr.area)) * 6));
  },

  buyCounty(prId) {
    const o = this.buyableCounties().find((x) => x.pr.id === prId);
    if (!o) return 'その伯爵領は買い取れません。';
    if (!this._spend(o.price)) return `家格が足りません（${o.price} 要る）。`;
    const my = this.playerDynasty();
    const k = this.kingdoms[o.pr.ownerId];
    o.d.prestige += o.price * 0.5;
    const king = this.playerKingdom();
    o.pr.holder = king ? null : my.id;
    // 本拠を売った家は、ほかの伯爵領に移る
    if (o.home) o.d.homeProvinceId = this.countiesOf(o.d.id, k.id)[0]?.id ?? o.d.homeProvinceId;
    if (king) this._remember(o.d, 5, '王の買い上げ', k);
    else if (!my.homeProvinceId || this.provinces[my.homeProvinceId].holder !== my.id) my.homeProvinceId = o.pr.id;
    this._updateDuchies();
    this.addLog('dynasty', `${my.name}家は ${o.crown ? '王から' : `${o.d.name}家から`} ${o.pr.name}伯領 を買い取った。`, [k.id]);
    const duke = !king && this.duchyHolderDyn(o.du) === my.id;
    return `${o.pr.name}伯領を買い取った（家格 −${o.price}）。${king ? (o.overLimit ? '王領が上限を超えたので、恩賞で諸侯に与えることになるかもしれない。' : '王領になった。') : duke ? `${o.du.name}公になった！` : ''}`;
  },

  // 官僚を雇う（王だけ）：直轄できる王領が 1 つ増える（3 人まで）
  officialPrice() {
    const k = this.playerKingdom();
    return k ? 40 + (k.officials ?? 0) * 20 : 0;
  },

  hireOfficial() {
    const k = this.playerKingdom();
    if (!k) return null;
    if ((k.officials ?? 0) >= 3) return '官僚はもう 3 人います。';
    const price = this.officialPrice();
    if (!this._spend(price)) return `家格が足りません（${price} 要る）。`;
    k.officials = (k.officials ?? 0) + 1;
    this.addLog('event', `${this.pn(this.ruler(k))} は書記官と徴税吏を召し抱えた。`, [k.id]);
    return `官僚を雇った（家格 −${price}）。直轄できる王領が ${this.demesneLimit(k)} に増えた。`;
  },

  // 城を築ける王領（王だけ）：その地方の兵が 30% 増える
  castleTargets() {
    const k = this.playerKingdom();
    if (!k) return [];
    return this.demesneOf(k)
      .filter((pr) => !pr.castle)
      .map((pr) => ({ pr, price: 30, border: [...pr.neighbors].some((q) => this.provinces[q].ownerId !== k.id && this.provinces[q].ownerId >= 0) }))
      .sort((a, b) => Number(b.border) - Number(a.border) || b.pr.pop - a.pr.pop)
      .slice(0, 5);
  },

  buildCastle(prId) {
    const o = this.castleTargets().find((x) => x.pr.id === prId);
    if (!o) return null;
    if (!this._spend(o.price)) return `家格が足りません（${o.price} 要る）。`;
    o.pr.castle = true;
    this.addLog('event', `${this.pn(this.ruler(this.playerKingdom()))} は ${o.pr.name} に城を築いた。`, [o.pr.ownerId]);
    return `${o.pr.name}に城を築いた（家格 −${o.price}）。この地方の兵が ${this.countyLevy(o.pr).toFixed(1)}千になった（+30%）。`;
  },

  // いまの家格で買える、いちばんよい伯爵領（帯で知らせる）
  affordableBuy() {
    const my = this.playerDynasty();
    if (!my) return null;
    return this.buyableCounties().find((o) => o.price <= my.prestige && !o.overLimit) ?? null;
  },

  // 請求権を捏造できる隣国
  fabricateTargets() {
    const k = this.playerKingdom();
    const h = this.playerHead();
    if (!k || !h) return [];
    return this.neighbors(k)
      .filter((t) => t.alive && !h.claims.includes(t.id))
      // 値段は相手の大きさ＋自国の大きさ（大国ほど、周りの目が厳しく高くつく）
      .map((t) => ({ t, price: 40 + this.provincesOf(t).length * 5 + this.provincesOf(k).length * 3, truce: this.truceLeft(k.id, t.id) }));
  },

  // 休戦の残り年数（0 なら休戦していない）
  truceLeft(a, b) {
    const t = this.truces.get(a < b ? `${a}-${b}` : `${b}-${a}`);
    return t != null && t > this.year ? t - this.year : 0;
  },

  fabricate(kid) {
    const o = this.fabricateTargets().find((x) => x.t.id === kid);
    if (!o) return null;
    if (!this._spend(o.price)) return `家格が足りません（${o.price} 要る）。`;
    const h = this.playerHead();
    h.claims.push(kid);
    // 捏造した請求権は家の財産：当主が代わっても引き継ぐ（2 代まで）
    const my = this.playerDynasty();
    // 2 代のあいだ（当主が 2 回代わるまで）残る
    my.fabClaims = [...(my.fabClaims ?? []).filter((x) => x.id !== kid), { id: kid, gens: 2 }];
    this.addLog('war', `${this.pn(h)} の書記官たちが、${this.kn(o.t)} の王位への古い請求権を「見つけ出した」。`, [o.t.id]);
    return `${o.t.name}の王位への請求権を得た（家格 −${o.price}）。王国タブから継承戦争を起こせます。勝てば ${o.t.name}の王位が手に入る。`;
  },
};

// 家格の使い道：家格は身分に応じて少しずつ入り、年 2.5% ずつ目減りする。貯めるより使うもの。World にメソッドとして組み込む。
//
// - 祝宴を開く（王）：諸侯みなの忠誠が上がる
// - 王に献上する（諸侯）：15 年のあいだ、王の恩賞で伯爵領を賜りやすくなる
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
    return `王に献上した（家格 −${TRIBUTE_COST}）。15 年のあいだ、恩賞の伯爵領を賜りやすくなる。`;
  },

  // 買い取れる伯爵領：同じ国の、ほかの家が持つ伯爵領（相手が 2 つ以上持ち、本拠ではないもの）
  buyableCounties() {
    const my = this.playerDynasty();
    const k = this.playerKingdom() ?? this.playerLiege();
    if (!my || !k) return [];
    const mine = new Set(this.provinces.filter((p) => p.holder === my.id || (this.playerKingdom() && p.ownerId === k.id && this.isDemesne(p))).map((p) => p.id));
    const rebels = new Set(this.wars.filter((w) => !w.ended && w.defenderId === k.id).flatMap((w) => w.members ?? []));
    const king = this.playerKingdom();
    const ruler = this.ruler(k);
    // 諸侯は、王の王領（首都以外・王領が 2 つ以上あるとき）も割高で買える
    const crown = !king && ruler && this.demesneOf(k).length >= 2;
    return this.provinces
      .filter((pr) => pr.ownerId === k.id && pr.holder !== my.id && !(pr.holder != null && rebels.has(pr.holder)))
      .filter((pr) => {
        if (pr.holder == null) return crown && pr.id !== k.capital;
        const d = this.dynasties[pr.holder];
        return d && !d.extinct && this.countiesOf(d.id, k.id).length >= 2 && d.homeProvinceId !== pr.id;
      })
      .map((pr) => ({ pr, d: pr.holder != null ? this.dynasties[pr.holder] : this.dyn(ruler), crown: pr.holder == null, near: [...pr.neighbors].some((q) => mine.has(q)), price: Math.round(this.countyPrice(pr) * (pr.holder == null ? 1.5 : 1)) }))
      .sort((a, b) => Number(b.near) - Number(a.near) || a.price - b.price)
      .slice(0, 6);
  },

  countyPrice(pr) {
    return Math.round(30 + Math.min(30, pr.pop / Math.max(1, pr.area) * 6));
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
    if (king) this._remember(o.d, 5, '王の買い上げ', k);
    this.addLog('dynasty', `${my.name}家は ${o.d.name}家から ${o.pr.name}伯領 を買い取った。`, [k.id]);
    return `${o.pr.name}伯領を買い取った（家格 −${o.price}）。${king ? '王領になった。' : ''}`;
  },

  // 請求権を捏造できる隣国
  fabricateTargets() {
    const k = this.playerKingdom();
    const h = this.playerHead();
    if (!k || !h) return [];
    return this.neighbors(k)
      .filter((t) => t.alive && !h.claims.includes(t.id))
      .map((t) => ({ t, price: 40 + this.provincesOf(t).length * 5 }));
  },

  fabricate(kid) {
    const o = this.fabricateTargets().find((x) => x.t.id === kid);
    if (!o) return null;
    if (!this._spend(o.price)) return `家格が足りません（${o.price} 要る）。`;
    const h = this.playerHead();
    h.claims.push(kid);
    this.addLog('war', `${this.pn(h)} の書記官たちが、${this.kn(o.t)} の王位への古い請求権を「見つけ出した」。`, [o.t.id]);
    return `${o.t.name}の王位への請求権を得た（家格 −${o.price}）。王国タブから継承戦争を起こせます。勝てば ${o.t.name}の王位が手に入る。`;
  },
};

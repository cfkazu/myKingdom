// 内乱への対処：あなたの国で反乱が起きたとき、打てる手。World にメソッドとして組み込む。
//
// 王なら：
// - 傭兵を雇う（家格を払い、3 年のあいだ兵力 +35%）
// - 反乱軍の家を切り崩す（恩赦と恩賞を約束して、一家ずつ反乱から抜けさせる）
// - 譲歩して和睦する（王領を盟主の家に与えて終わらせる。独立戦争なら独立を認める）
// - 決戦を挑む（今年もう一度会戦する。勝てば早く終わり、負ければ早く負ける）
// 諸侯なら：王に兵を出す（勝てば没収地を賜りやすい）・様子を見る・反乱に加わる・（反乱側なら）降伏して許しを請う

export const MERC_COST = 15;
export const CONCEDE_COST = 20;

export const RebellionMixin = {
  // あなたの国の内乱（あなたが王でも諸侯でも）
  realmRebellions() {
    const realm = this._myRealm?.();
    if (!realm) return [];
    return this.wars.filter((w) => !w.ended && (w.kind === 'civil' || w.kind === 'independence') && w.defenderId === realm.id);
  },

  // 戦況：兵力の比（反乱軍 ÷ 王）、戦況（+100 で反乱軍の勝ち、−100 で王の勝ち）、残り年数
  rebelStatus(w) {
    const pA = this._sidePower(w, 'A');
    const pD = this._sidePower(w, 'D');
    const members = (w.members ?? []).map((id) => this.dynasties[id]).filter((d) => d && !d.extinct);
    return {
      ratio: pA / Math.max(1, pD),
      rebels: pA,
      king: pD,
      score: w.score,
      yearsLeft: Math.max(0, 7 - (this.year - w.startYear)),
      members: members.map((d) => ({ d, counties: this.countiesOf(d.id, w.defenderId).length, cost: this.peelCost(w, d), leader: this.get(w.leaderId)?.dynastyId === d.id })),
      mercs: w.mercs != null && this.year <= w.mercs,
    };
  },

  peelCost(w, d) {
    return 5 + this.countiesOf(d.id, w.defenderId).length * 4 + Math.max(0, -(d.opinion ?? 0)) * 0.1;
  },

  // ───────── 王の手 ─────────

  rebAction(warId, action, arg = null) {
    const w = this.wars.find((x) => x.id === warId);
    if (!w || w.ended) return '内乱はもう終わっています。';
    const k = this.kingdoms[w.defenderId];
    const my = this.playerDynasty();
    const king = this.playerKingdom()?.id === k.id;
    const pay = (n) => {
      if (my.prestige < n) return false;
      my.prestige -= n;
      return true;
    };
    if (king && action === 'mercs') {
      if (w.mercs != null && this.year <= w.mercs) return '傭兵はもう雇っています。';
      if (!pay(MERC_COST)) return `家格が足りません（${MERC_COST} 要る）。`;
      w.mercs = this.year + 2;
      this.addLog('war', `${this.pn(this.ruler(k))} は傭兵団を雇い、${w.name}に投じた。`, [k.id]);
      return `傭兵を雇った（家格 −${MERC_COST}）。3 年のあいだ王の兵力が 35% 増える。`;
    }
    if (king && action === 'peel') {
      const d = this.dynasties[arg];
      if (!d || !(w.members ?? []).includes(d.id)) return null;
      if (this.get(w.leaderId)?.dynastyId === d.id) return '盟主の家は切り崩せません。';
      const cost = Math.round(this.peelCost(w, d));
      if (!pay(cost)) return `家格が足りません（${cost} 要る）。`;
      w.members = w.members.filter((id) => id !== d.id);
      w.provinces = w.provinces.filter((pid) => this.provinces[pid].holder !== d.id);
      this._remember(d, 45, '王の恩赦', k);
      // 恩赦した家には、しばらく「不満な諸侯」の出来事を出さない
      this.player.eventCooldown = this.player.eventCooldown ?? {};
      this.player.eventCooldown.appease = this.year;
      this.addLog('war', `${d.name}家は ${this.pn(this.ruler(k))} の恩赦を受け入れ、${w.name}から手を引いた。`, [k.id]);
      if (!w.members.length) this._endWar(w, 'defender', '反乱軍が切り崩された');
      return `${d.name}家が反乱から抜けた（家格 −${cost}）。`;
    }
    if (king && action === 'concede') {
      if (!pay(CONCEDE_COST)) return `家格が足りません（${CONCEDE_COST} 要る）。`;
      if (w.kind === 'independence') {
        this._endWar(w, 'attacker', '王が独立を認めた');
        return '独立を認めた。地方は離れたが、戦は終わった。';
      }
      const ld = this.dyn(this.get(w.leaderId));
      const pr = this.demesneOf(k).filter((p) => p.id !== k.capital).sort((a, b) => b.pop - a.pop)[0];
      if (pr && ld) this._grant(k, pr, ld, '和睦の条件');
      for (const id of w.members ?? []) this._remember(this.dynasties[id], 15, '王の譲歩', k);
      this._endWar(w, 'white', '王が譲歩した');
      return `譲歩して和睦した（家格 −${CONCEDE_COST}${pr ? `、${pr.name}伯領を${ld.name}家に与えた` : ''}）。`;
    }
    if (king && action === 'battle') {
      if (w.pitched === this.year) return '今年はもう決戦を挑みました。';
      w.pitched = this.year;
      const before = w.score;
      this._battle(w);
      if (!w.ended) {
        if (w.score >= 100) this._endWar(w, 'attacker');
        else if (w.score <= -100) this._endWar(w, 'defender');
      }
      const won = w.score < before;
      return w.ended ? '決戦で勝負がついた。' : won ? `決戦に勝った（戦況 ${Math.round(before)} → ${Math.round(w.score)}）。` : `決戦に敗れた（戦況 ${Math.round(before)} → ${Math.round(w.score)}）。`;
    }
    // ───────── 諸侯の手 ─────────
    if (!king && action === 'support') {
      w.loyalists = [...new Set([...(w.loyalists ?? []), my.id])];
      this._remember(my, 10, '内乱で王に味方した', k);
      return '王に兵を出した。王が勝てば、反乱した家の没収地を賜りやすい。';
    }
    if (!king && action === 'join') {
      if ((w.members ?? []).includes(my.id)) return null;
      w.members = [...(w.members ?? []), my.id];
      w.provinces = [...new Set([...w.provinces, ...this.countiesOf(my.id, k.id).map((p) => p.id)])];
      this.player.joined = { kingdomId: k.id, kind: w.claimantId != null ? 'claimant' : w.kind === 'independence' ? 'independence' : 'usurp' };
      this.addLog('war', `${my.name}家が${w.name}に加わった。`, [k.id]);
      return `${w.name}に加わった。勝てば望みがかない、負ければ罰を受ける。`;
    }
    if (!king && action === 'surrender') {
      if (!(w.members ?? []).includes(my.id)) return null;
      if (this.get(w.leaderId)?.dynastyId === my.id) return '盟主の家は降伏できません（戦に負けるまで続きます）。';
      w.members = w.members.filter((id) => id !== my.id);
      w.provinces = w.provinces.filter((pid) => this.provinces[pid].holder !== my.id);
      this.player.joined = null;
      my.prestige *= 0.8;
      this._remember(my, -5, '反乱から降った', k);
      this.addLog('war', `${my.name}家は${w.name}から降り、王に許しを請うた。`, [k.id]);
      return '降伏して許しを請うた（家格 −20%）。罰は免れた。';
    }
    return null;
  },

  // 反乱が始まったときのカード
  _rebellionDecision(w) {
    if (!this.player || this.player.over || this._quietNews) return false;
    const k = this.kingdoms[w.defenderId];
    if (!this._isMine(k)) return false;
    const my = this.playerDynasty();
    const role = this.playerKingdom()?.id === k.id ? 'king' : (w.members ?? []).includes(my.id) ? 'rebel' : 'vassal';
    this._decision({ type: 'rebellion', warId: w.id, role });
    return true;
  },
};

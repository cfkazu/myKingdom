// 他国との戦争：宣戦前の見込み、戦争中に打てる手、同盟の破棄。World にメソッドとして組み込む。
//
// - 宣戦の前に、相手の同盟国が加勢しそうか、包囲網ができそうかと、それを含めた兵力の見込みを見せる。
// - 戦争中は、傭兵を雇う・決戦を挑む・和平を申し入れる・勝ちを認めさせる・降伏する、を選べる。
// - 同盟は王家どうしの婚姻から生まれるが、破棄もできる（家格が下がり、諸侯も眉をひそめる。30 年は結び直せない）。

import { MERC_COST } from './rebellion.js';

export const BREAK_COST = 10;

export const WarfareMixin = {
  // 宣戦したらどうなりそうか
  warPreview(k, t, kind = 'conquest') {
    const pk = (x) => this.power(this.kingdoms[x]);
    const mine = this.alliesOf(k.id).filter((a) => a !== t.id && !this.allied(a, t.id) && this.kingdoms[a].alive);
    const theirs = this.alliesOf(t.id).filter((a) => a !== k.id && !this.allied(a, k.id) && this.kingdoms[a].alive);
    const coalition = kind === 'conquest' && this.provincesOf(k).length > this.provinces.length * 0.33;
    const coal = coalition ? this.aliveKingdoms().filter((o) => o !== k && o !== t && !this.allied(o.id, k.id) && !theirs.includes(o.id)).map((o) => o.id) : [];
    // 同盟国は兵の半分で加勢する。加わる見込みは、こちらの同盟国 5 割・相手の同盟国 7.5 割・包囲網 6 割
    const my = this.power(k) + mine.reduce((s, a) => s + pk(a) * 0.5 * 0.5, 0);
    const their = this.power(t) + theirs.reduce((s, a) => s + pk(a) * 0.5 * 0.75, 0) + coal.reduce((s, a) => s + pk(a) * 0.5 * 0.6, 0);
    const ratio = my / Math.max(1, their);
    return {
      ratio,
      plain: this.power(k) / Math.max(1, this.power(t)),
      myAllies: mine.map((a) => this.kingdoms[a]),
      theirAllies: theirs.map((a) => this.kingdoms[a]),
      coalition: coal.map((a) => this.kingdoms[a]),
      verdict: ratio >= 1.3 ? '有利' : ratio >= 0.85 ? '互角' : '不利',
    };
  },

  // あなたの国の、他国との戦争
  externalWars() {
    const k = this.playerKingdom();
    if (!k) return [];
    return this.wars.filter((w) => !w.ended && (w.kind === 'conquest' || w.kind === 'claim') && (w.attackerId === k.id || w.defenderId === k.id || w.attackerAllies.includes(k.id) || w.defenderAllies.includes(k.id)));
  },

  // あなたの側から見た戦況
  warView(w) {
    const k = this.playerKingdom();
    const side = w.attackerId === k.id || w.attackerAllies.includes(k.id) ? 'A' : 'D';
    const main = w.attackerId === k.id || w.defenderId === k.id;
    const my = this._sidePower(w, side);
    const their = this._sidePower(w, side === 'A' ? 'D' : 'A');
    const enemy = this.kingdoms[side === 'A' ? w.defenderId : w.attackerId];
    return { side, main, enemy, ratio: my / Math.max(1, their), my, their, score: side === 'A' ? w.score : -w.score, yearsLeft: Math.max(0, 7 - (this.year - w.startYear)), mercs: w.mercs != null && this.year <= w.mercs && w.mercSide === side };
  },

  warAction(warId, action) {
    const w = this.wars.find((x) => x.id === warId);
    const k = this.playerKingdom();
    if (!w || w.ended || !k) return '戦争はもう終わっています。';
    const v = this.warView(w);
    const my = this.playerDynasty();
    const pay = (n) => {
      if (my.prestige < n) return false;
      my.prestige -= n;
      return true;
    };
    const win = v.side === 'A' ? 'attacker' : 'defender';
    const lose = v.side === 'A' ? 'defender' : 'attacker';
    if (action === 'mercs') {
      if (v.mercs) return '傭兵はもう雇っています。';
      if (!pay(MERC_COST)) return `家格が足りません（${MERC_COST} 要る）。`;
      w.mercs = this.year + 2;
      w.mercSide = v.side;
      this.addLog('war', `${this.pn(this.ruler(k))} は傭兵団を雇い、${w.name}に投じた。`, [k.id]);
      return `傭兵を雇った（家格 −${MERC_COST}）。3 年のあいだ兵力が 35% 増える。`;
    }
    if (action === 'battle') {
      if (w.pitched === this.year) return '今年はもう決戦を挑みました。';
      w.pitched = this.year;
      const before = v.score;
      this._battle(w);
      if (!w.ended) {
        if (w.score >= 100) this._endWar(w, 'attacker');
        else if (w.score <= -100) this._endWar(w, 'defender');
      }
      const after = this.warView(w).score;
      return w.ended ? '決戦で勝負がついた。' : `決戦に${after > before ? '勝った' : '敗れた'}（戦況 ${Math.round(before)} → ${Math.round(after)}）。`;
    }
    if (!v.main) return '加勢している戦争は、自分では終わらせられません。';
    if (action === 'peace') {
      // 白紙和平：戦況が −20 より良ければ、相手は受ける。悪ければ、賠償（家格）を払えば受ける
      const cost = v.score >= -20 ? 0 : Math.round(-v.score * 0.3);
      if (cost && !pay(cost)) return `相手は賠償（家格 ${cost}）なしでは和平を受けません。`;
      this._endWar(w, 'white', cost ? `和平（賠償 家格 ${cost}）` : '和平');
      return `和平が結ばれた${cost ? `（賠償 家格 −${cost}）` : ''}。10 年の休戦になる。`;
    }
    if (action === 'demand') {
      if (v.score < 50) return '戦況が +50 を超えるまで、相手は負けを認めません。';
      this._endWar(w, win, '相手が負けを認めた');
      return '相手は負けを認めた。';
    }
    if (action === 'surrender') {
      this._endWar(w, lose, '降伏');
      return '降伏した。';
    }
    return null;
  },

  // 同盟の破棄
  breakAlliance(otherId) {
    const k = this.playerKingdom();
    const o = this.kingdoms[otherId];
    if (!k || !o || !this.allied(k.id, o.id)) return null;
    const my = this.playerDynasty();
    if (my.prestige < BREAK_COST) return `家格が足りません（${BREAK_COST} 要る）。`;
    my.prestige -= BREAK_COST;
    const key = k.id < o.id ? `${k.id}-${o.id}` : `${o.id}-${k.id}`;
    this.brokenAlliances = this.brokenAlliances ?? new Map();
    this.brokenAlliances.set(key, this.year + 30);
    this.alliances.delete(key);
    for (const v of this.vassals(k)) this._remember(v, -4, '同盟を破った', k);
    this.addLog('war', `${this.pn(this.ruler(k))} は ${this.kn(o)} との同盟を破棄した。`, [k.id, o.id]);
    return `${o.name}との同盟を破棄した（家格 −${BREAK_COST}）。30 年は結び直せない。`;
  },

  // 攻められたときのカード
  _warDecision(w) {
    if (!this.player || this.player.over || this._quietNews) return false;
    const k = this.playerKingdom();
    if (!k || w.defenderId !== k.id) return false;
    this._decision({ type: 'war', warId: w.id });
    return true;
  },
};

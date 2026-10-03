// 家の野望：身分を上げていく段階的な目標と、最後の成績（★）。World にメソッドとして組み込む。
//
// 遊びはじめの身分から見て、まだ果たしていない野望だけを並べる（伯爵家なら「伯爵領を 3 つ」→「公爵」→「王位」…）。
// 果たすたびに家格 +25。★の数は、果たした野望と、成し遂げた血の目標の数。

const AMBITIONS = [
  { key: 'counts3', icon: '🏰', label: '伯爵領を 3 つ持つ', hint: '恩賞を賜る・伯爵領を買い取る・縁組で継ぐ' },
  { key: 'duke', icon: '🛡', label: '公爵になる', hint: '一つの公爵領の伯爵領の過半を持つと公爵になる' },
  { key: 'crown', icon: '👑', label: '王位を得る', hint: '反乱で奪う・請求権で継承戦争・王家との縁組で継ぐ' },
  { key: 'realm15', icon: '🗺', label: '15 地方の王国を治める', hint: '宣戦して国境の地方を奪う・継承戦争で国ごと取る' },
  { key: 'half', icon: '🌍', label: '大陸の半分を治める', hint: '大きすぎる国には包囲網ができる' },
  { key: 'y50', icon: '⏳', label: '家を 50 年保つ', hint: '跡継ぎを絶やさない' },
  { key: 'y100', icon: '⏳', label: '家を 100 年保つ', hint: '跡継ぎを絶やさない' },
  { key: 'y200', icon: '⏳', label: '家を 200 年保つ', hint: '跡継ぎを絶やさない' },
];

export const AmbitionsMixin = {
  _ambitionMet(key) {
    const d = this.playerDynasty();
    const pk = this.playerKingdom();
    const yrs = this.year - this.player.startYear;
    switch (key) {
      case 'counts3':
        return !!pk || this.countiesOf(d.id).length >= 3;
      case 'duke':
        return !!pk || this.houseRank(d) === 'duke';
      case 'crown':
        return !!pk;
      case 'realm15':
        return !!pk && this.provincesOf(pk).length >= 15;
      case 'half':
        return !!pk && this.provincesOf(pk).length >= this.provinces.length / 2;
      case 'y50':
        return yrs >= 50;
      case 'y100':
        return yrs >= 100;
      case 'y200':
        return yrs >= 200;
    }
    return false;
  },

  // いまの進み具合（帯に出す）
  ambitionProgress(key) {
    const d = this.playerDynasty();
    const pk = this.playerKingdom();
    const yrs = this.year - this.player.startYear;
    switch (key) {
      case 'counts3':
        return `伯爵領 ${this.countiesOf(d.id).length}/3`;
      case 'duke': {
        // いちばん近い公爵領：持っている伯爵領の数 / 過半に要る数
        let best = null;
        for (const du of this.duchies) {
          const mine = du.provinces.filter((id) => this.provinces[id].holder === d.id).length;
          const need = this.duchyNeed(du);
          if (mine && (!best || mine / need > best.mine / best.need)) best = { du, mine, need };
        }
        return best ? `${best.du.name}公領 ${best.mine}/${best.need}（王国タブの「伯爵領を買い取る」に、公爵へ近い順に並ぶ）` : '公爵領の伯爵領を集める';
      }
      case 'crown':
        return '';
      case 'realm15':
        return pk ? `${this.provincesOf(pk).length}/15 地方` : '';
      case 'half':
        return pk ? `${this.provincesOf(pk).length}/${Math.ceil(this.provinces.length / 2)} 地方` : '';
      default:
        return `${yrs}/${{ y50: 50, y100: 100, y200: 200 }[key]} 年`;
    }
  },

  _initAmbitions() {
    this.player.ambitions = AMBITIONS.filter((a) => !this._ambitionMet(a.key)).map((a) => ({ key: a.key, icon: a.icon, label: a.label, hint: a.hint, done: null }));
  },

  _ambitionTick() {
    if (!this.player || this.player.over || !this.player.ambitions) return;
    const d = this.playerDynasty();
    for (const a of this.player.ambitions) {
      if (a.done != null || !this._ambitionMet(a.key)) continue;
      a.done = this.year;
      d.prestige += 25;
      this.addLog('dynasty', `🏆 ${d.name}家は野望「${a.label}」を果たした（${this.year - this.player.startYear} 年目）。家格 +25。`);
      // 時間を止めて祝う
      this._decision({ type: 'celebrate', key: a.key, icon: a.icon, label: a.label, years: this.year - this.player.startYear, milestone: a.key.startsWith('y') });
    }
  },

  nextAmbition() {
    return (this.player?.ambitions ?? []).find((a) => a.done == null && !a.key.startsWith('y')) ?? (this.player?.ambitions ?? []).find((a) => a.done == null);
  },

  // 成績：★ ＝ 果たした野望 ＋ 成し遂げた血の目標
  score() {
    const amb = this.player?.ambitions ?? [];
    const done = amb.filter((a) => a.done != null).length;
    const goals = (this.player?.achievements ?? []).length;
    return { stars: done + goals, done, total: amb.length, goals };
  },
};

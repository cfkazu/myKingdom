// 血筋を育てる：家の目標・素質（遺伝子だけで決まる値）・保因者の鑑定。World にメソッドとして組み込む。
//
// - 遊んでいる家は、目標（遺伝病の遺伝子を消す・能力の血を固める・金髪の家にする）を選んで、何世代もかけて目指す。
// - 「素質」は、量的形質の遺伝子の「＋」の数。見た目の能力（育ち込み）とちがい、子に伝わるのはこちら。
// - よその家の人の遺伝子（保因者かどうか・素質）は、家格を払って鑑定するまでわからない。自分の家の人は家の記録でわかる。

import { LOCI, allelesAt, isCarrier } from './genes.js';

export const APTITUDES = [
  { trait: 'intellect', label: '知略' },
  { trait: 'strength', label: '武勇' },
  { trait: 'beauty', label: '容姿' },
  { trait: 'charisma', label: 'カリスマ' },
];

export const EXAMINE_COST = 5;
const HOLD_YEARS = 5;

// 目標の種類。value は家の生きている人についての今の値、done は達成の条件
export const GOALS = {
  hem: { label: '血友病を家から消す', icon: '🩸', kind: 'purge', key: 'HEM', allele: 'h', what: '血友病の遺伝子を持つ人' },
  jaw: { label: '受け口の遺伝子を消す', icon: '🦷', kind: 'purge', key: 'JAW', allele: 'j', what: '受け口の遺伝子を持つ人' },
  mad: { label: '狂気の遺伝子を消す', icon: '🌀', kind: 'purge', key: 'MAD', allele: 'm', what: '狂気の遺伝子を持つ人' },
  intellect: { label: '知略の血を固める', icon: '📜', kind: 'fix', trait: 'intellect' },
  strength: { label: '武勇の血を固める', icon: '⚔️', kind: 'fix', trait: 'strength' },
  beauty: { label: '美貌の血を固める', icon: '🌹', kind: 'fix', trait: 'beauty' },
  charisma: { label: 'カリスマの血を固める', icon: '👑', kind: 'fix', trait: 'charisma' },
  blond: { label: '金髪の家にする', icon: '🌾', kind: 'hair', hair: 'L' },
};

export const GoalsMixin = {
  // 素質：その形質の遺伝子の「＋」の数（男性の X 連鎖座はないので数えない）
  aptitude(p, trait) {
    let plus = 0;
    let copies = 0;
    if (!p.genome) return { plus: 0, copies: 0, value: 0 };
    for (const l of LOCI) {
      if (l.trait !== trait) continue;
      for (const a of allelesAt(p.genome, l.key)) {
        copies++;
        if (a === '+') plus++;
      }
    }
    return { plus, copies, value: copies ? plus / copies : 0 };
  },

  // プレイヤーがこの人の遺伝子を知っているか
  knowsGenes(p) {
    if (!this.player || this.player.over || !p) return true;
    if (p.dynastyId === this.player.dynastyId) return true;
    return this.player.examined?.has(p.id) ?? false;
  },

  examine(p) {
    if (!this.player || this.knowsGenes(p)) return true;
    const d = this.playerDynasty();
    if (!d || d.prestige < EXAMINE_COST) return false;
    d.prestige -= EXAMINE_COST;
    this.player.examined = this.player.examined ?? new Set();
    this.player.examined.add(p.id);
    return true;
  },

  carriers(p) {
    if (!p.genome) return [];
    return ['HEM', 'JAW', 'MAD', 'DEL1', 'DEL2', 'DEL3', 'DEL4', 'LET'].filter((k) => isCarrier(p.genome, k));
  },

  // ───────── 家の目標 ─────────

  // 目標を測る人：当主と、その子・孫（プレイヤーが縁談を決められる血筋）
  _houseMembers() {
    const d = this.playerDynasty();
    const h = d && !d.extinct ? this.head(d) : null;
    if (!h || !h.genome) return [];
    const out = [h];
    for (const cid of h.children) {
      const c = this.get(cid);
      if (c.alive && c.genome) out.push(c);
      for (const gid of c.children) {
        const g = this.get(gid);
        if (g.alive && g.genome && g.dynastyId === d.id) out.push(g);
      }
    }
    return out;
  },

  // 目標の今の値（0〜1 か、人数）
  goalValue(key) {
    const g = GOALS[key];
    const ms = this._houseMembers();
    if (!ms.length) return 0;
    if (g.kind === 'purge') return ms.filter((p) => allelesAt(p.genome, g.key).includes(g.allele)).length;
    if (g.kind === 'fix') return ms.reduce((s, p) => s + this.aptitude(p, g.trait).value, 0) / ms.length;
    return ms.filter((p) => p.pheno.hair === g.hair).length / ms.length;
  },

  // 選べる目標と、その達成ライン
  goalOptions() {
    const out = [];
    for (const [key, g] of Object.entries(GOALS)) {
      const v = this.goalValue(key);
      if (g.kind === 'purge') {
        if (v === 0) continue;
        out.push({ key, label: g.label, icon: g.icon, now: `いま当主の血筋の ${v} 人がこの遺伝子を持っている`, target: 0, desc: `当主と子・孫から、この遺伝子を持つ人がいなくなり、${HOLD_YEARS} 年続けば達成` });
      } else if (g.kind === 'fix') {
        const target = Math.min(0.85, Math.max(0.55, Math.round((v + 0.12) * 20) / 20));
        if (v >= target) continue;
        out.push({ key, label: g.label, icon: g.icon, now: `いま当主の血筋の平均の素質 ${Math.round(v * 100)}%`, target, desc: `当主と子・孫の平均の素質（＋の割合）を ${Math.round(target * 100)}% まで上げ、${HOLD_YEARS} 年保てば達成` });
      } else {
        const target = Math.min(0.9, Math.max(0.6, Math.round((v + 0.3) * 10) / 10));
        if (v >= target) continue;
        out.push({ key, label: g.label, icon: g.icon, now: `いま当主の血筋の金髪は ${Math.round(v * 100)}%`, target, desc: `当主と子・孫の ${Math.round(target * 100)}% を金髪にし、${HOLD_YEARS} 年保てば達成` });
      }
    }
    return out;
  },

  _goalDecision() {
    if (!this.player || this.player.over || this.player.decisions.some((d) => d.type === 'goal')) return;
    const opts = this.goalOptions();
    if (!opts.length) return;
    this._decision({ type: 'goal', options: opts });
  },

  setGoal(key, target) {
    this.player.goal = key ? { key, target, since: this.year, heldSince: null } : null;
  },

  // 縁談の候補 c と結ばれたら、家の目標にどう効きそうか（pred は子の予測）
  goalForecast(p, c, pred = null) {
    const goal = this.player?.goal;
    if (!goal) return null;
    const g = GOALS[goal.key];
    if (!this.knowsGenes(c)) return { text: `鑑定すると「${g.label}」への見込みがわかる`, good: null };
    if (g.kind === 'fix') {
      const exp = (this.aptitude(p, g.trait).value + this.aptitude(c, g.trait).value) / 2;
      const now = this.goalValue(goal.key);
      return { text: `子の素質の見込み ≈ ${Math.round(exp * 100)}%（いま家の平均 ${Math.round(now * 100)}%・目標 ${Math.round(goal.target * 100)}%）`, good: exp > now + 0.01 ? true : exp < now - 0.01 ? false : null };
    }
    if (g.kind === 'purge') {
      const t = (x) => {
        const as = allelesAt(x.genome, g.key);
        return as.length ? as.filter((a) => a === g.allele).length / as.length : 0;
      };
      const prob = 1 - (1 - t(p)) * (1 - t(c));
      return { text: `子が${g.what.replace('を持つ人', '')}を受け継ぐ確率 ≈ ${Math.round(prob * 100)}%`, good: prob < 0.3 };
    }
    if (pred && pred.born) {
      const prob = (pred.hair?.[g.hair] ?? 0) / pred.born;
      return { text: `子が金髪になる確率 ≈ ${Math.round(prob * 100)}%`, good: prob >= 0.5 };
    }
    return null;
  },

  goalProgress() {
    const goal = this.player?.goal;
    if (!goal) return null;
    const g = GOALS[goal.key];
    const v = this.goalValue(goal.key);
    const met = this._houseMembers().length > 0 && (g.kind === 'purge' ? v === 0 : v >= goal.target);
    let text;
    if (g.kind === 'purge') text = `当主の血筋で${g.what}：あと ${v} 人`;
    else if (g.kind === 'fix') text = `当主の血筋の平均の素質 ${Math.round(v * 100)}% → 目標 ${Math.round(goal.target * 100)}%`;
    else text = `金髪 ${Math.round(v * 100)}% → 目標 ${Math.round(goal.target * 100)}%`;
    const ratio = g.kind === 'purge' ? null : Math.max(0, Math.min(1, v / goal.target));
    return { ...g, key: goal.key, value: v, met, text, ratio, held: goal.heldSince != null ? this.year - goal.heldSince : 0, hold: HOLD_YEARS };
  },

  _goalTick() {
    if (!this.player || this.player.over) return;
    const goal = this.player.goal;
    if (!goal) return;
    const pr = this.goalProgress();
    if (!pr.met) {
      goal.heldSince = null;
      return;
    }
    if (goal.heldSince == null) goal.heldSince = this.year;
    if (this.year - goal.heldSince < HOLD_YEARS) return;
    const d = this.playerDynasty();
    this.player.achievements = this.player.achievements ?? [];
    this.player.achievements.push({ key: goal.key, label: GOALS[goal.key].label, icon: GOALS[goal.key].icon, year: this.year, years: this.year - goal.since });
    d.prestige += 30;
    const hh = this.head(d);
    if (hh) this._deed(hh, 'goal', `家の目標「${GOALS[goal.key].label}」を成し遂げる`, { label: GOALS[goal.key].label });
    this.addLog('gene', `🎯 ${d.name}家は「${GOALS[goal.key].label}」を成し遂げた（${this.year - goal.since} 年かけて）。家格 +30。`);
    this.player.goal = null;
    this._goalDecision();
  },
};

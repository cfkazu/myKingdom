// プレイヤーの家：一つの家を選び、その当主として決断する。World にメソッドとして組み込む。
//
// - 当主・その子・きょうだい・孫の縁談は、プレイヤーが候補から選ぶ（AI は選ばない）
// - 家の子が 6 歳になったら、教育の方針を選ぶ（育ちの値が変わり、能力が変わる）
// - 王なら、余った王領を誰に与えるかを選び、宣戦・継承戦争・没収を自分で行う。AI は代わりに宣戦しない
// - 諸侯なら、不満な派閥に誘われたときに加わるかを選び、自分から反旗をひるがえせる
// - 家が絶えたらおしまい

import { express, predictOffspring } from './genes.js';
import { createRng } from './rng.js';
import { isSetAside } from './events.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const EDUCATION = {
  martial: { label: '武芸', desc: '剣と馬と戦の指揮を学ぶ。体の強さが伸びる', env: { strength: 1.3 } },
  learning: { label: '学問', desc: '書物と算術と法を学ぶ。知略が伸びる', env: { intellect: 1.3 } },
  diplomacy: { label: '社交', desc: '宮廷の作法と話術を学ぶ。カリスマが伸び、容姿も磨かれる', env: { charisma: 1.1, beauty: 0.5 } },
  piety: { label: '信仰', desc: '修道院で祈りと慈善を学ぶ。慈愛が伸び、野心は抑えられる', env: { kindness: 1.3, ambition: -0.7 } },
};

export const PlayerMixin = {
  setPlayer(dynId) {
    if (dynId == null) {
      this.player = null;
      return;
    }
    const d = this.dynasties[dynId];
    this.player = { dynastyId: dynId, startYear: this.year, decisions: [], nextId: 1, asked: new Map(), joined: null, over: false, peak: this.houseStanding(d), examined: new Set(), achievements: [], goal: null };
    const h = this.head(d);
    this.addLog('event', `あなたは ${d.name}家の当主 ${h ? this.pn(h) : ''} として歴史に加わった。`, h && h.kingdomId != null ? [h.kingdomId] : []);
    this._initAmbitions();
    this._goalDecision();
  },

  isPlayerHouse(p) {
    return !!this.player && !this.player.over && !!p && p.dynastyId === this.player.dynastyId;
  },

  playerDynasty() {
    return this.player ? this.dynasties[this.player.dynastyId] : null;
  },

  playerHead() {
    const d = this.playerDynasty();
    return d && !d.extinct ? this.head(d) : null;
  },

  playerKingdom() {
    const d = this.playerDynasty();
    if (!d || this.player.over) return null;
    return this.kingdoms.find((k) => k.alive && k.rulerId != null && this.ruler(k).dynastyId === d.id) ?? null;
  },

  // 家の格：王 > 公爵 > 伯爵 > 無領
  houseStanding(d) {
    if (!d || d.extinct) return { rank: 0, label: '断絶' };
    if (this.kingdoms.some((k) => k.alive && this.ruler(k)?.dynastyId === d.id)) return { rank: 3, label: '王家' };
    const r = this.houseRank(d);
    return r === 'duke' ? { rank: 2, label: '公爵家' } : r === 'count' ? { rank: 1, label: '伯爵家' } : { rank: 0, label: '無領の家' };
  },

  // プレイヤーが縁談と教育を決める人：当主と、当主の子（ほかの一族は家の者にまかせる）
  playerControls(p) {
    if (!this.isPlayerHouse(p)) return false;
    const h = this.playerHead();
    if (!h) return false;
    return p === h || p.fatherId === h.id || p.motherId === h.id;
  },

  // カードで縁談・養育先を聞く人：当主・跡継ぎ・当主の上の子 3 人（と、「縁談を探す」を押した人）。
  // ほかの子は家の者にまかせる（人物欄の「縁談を探す」でいつでも自分で選べる）
  isCore(p) {
    if (!this.playerControls(p)) return false;
    const h = this.playerHead();
    if (p === h || p.seekManual) return true;
    const d = this.playerDynasty();
    if (this.houseHeir(d) === p) return true;
    const kids = h.children.map((id) => this.get(id)).filter((c) => c.alive && c.dynastyId === d.id && !c.passedOver && !c.cloistered && !c.imprisoned).sort((a, b) => a.birthYear - b.birthYear || a.id - b.id);
    return kids.slice(0, 3).includes(p);
  },

  _decision(d) {
    d.id = this.player.nextId++;
    d.year = this.year;
    this.player.decisions.push(d);
    return d;
  },

  pendingDecisions() {
    return this.player ? this.player.decisions : [];
  },

  _askedRecently(key, years) {
    const y = this.player.asked.get(key);
    return y != null && this.year - y < years;
  },

  // ───────── 縁談 ─────────

  // その人に来ている縁談の候補（相手の家が受けてくれる人だけ）
  // reach なら、ふつうは断ってくる格上の相手（高嶺の花）を探す
  marriageCandidates(p, limit = 5, { reach = false } = {}) {
    const out = [];
    for (const c of this.living) {
      if (!c.alive || c.sex === p.sex || c.spouseId != null || c === p || c.imprisoned || c.cloistered) continue;
      const ca = this.age(c);
      if (c.sex === 'F' ? ca < 15 || ca > 40 : ca < 16 || ca > 62) continue;
      if (this.isPlayerHouse(c) && this.playerControls(c)) continue;
      if (this.atWar(p.kingdomId, c.kingdomId)) continue;
      // プレイヤーは国の外にも縁談を探せる（同じ国の相手は少し選ばれやすい）
      if (p.fatherId != null && (p.fatherId === c.fatherId || p.motherId === c.motherId)) continue;
      const phi = this.ped.kinship(p.id, c.id);
      const mine = this.spouseScore(p, c, phi);
      const theirs = this.spouseScore(c, p, phi);
      if (mine === -Infinity || (reach ? theirs >= 12 || theirs < -25 : theirs < 12)) continue;
      out.push({ c, mine, theirs, phi });
    }
    out.sort((a, b) => b.mine - a.mine);
    // 似た人ばかりにならないよう、上位から、同じ家は 2 人まで
    const perHouse = new Map();
    const picked = [];
    for (const o of out) {
      const n = perHouse.get(o.c.dynastyId) ?? 0;
      if (n >= 2) continue;
      perHouse.set(o.c.dynastyId, n + 1);
      picked.push(o);
      if (picked.length >= limit) break;
    }
    if (reach) return picked;
    // 候補が少ないときは、騎士（郷士）の家の子を紹介してもらう
    const k = this.kingdomOf(p);
    const home = this.homeProvince(p) ?? k?.capital ?? 0;
    const a = this.age(p);
    for (let i = picked.length; i < Math.min(limit, 4); i++) {
      const sex = p.sex === 'M' ? 'F' : 'M';
      const cAge = sex === 'F' ? clamp(Math.min(a, 30) - this.rng.int(6), 16, 30) : clamp(a + this.rng.int(8) - 2, 18, 45);
      const c = this._founder(sex, cAge, this._regionFor(home), { kingdomId: p.kingdomId, culture: k ? k.culture : p.culture, lowborn: true });
      c.gentry = true;
      const phi = 0;
      picked.push({ c, mine: this.spouseScore(p, c, phi), theirs: 50, phi });
    }
    return picked;
  },

  // 縁談の予測（子の遺伝病の確率など）。UI 用
  matchPreview(a, b) {
    const [mom, dad] = a.sex === 'F' ? [a, b] : [b, a];
    if (!mom.genome || !dad.genome) return null;
    return predictOffspring(mom.genome, dad.genome, createRng(`${mom.id}x${dad.id}`), 500);
  },

  _playerMarriages(market) {
    for (const p of market) {
      if (!this.isCore(p) || p.spouseId != null || p.imprisoned || p.cloistered) continue;
      const a = this.age(p);
      if (a < 16) continue;
      if (this.player.decisions.some((d) => d.type === 'marriage' && d.personId === p.id)) continue;
      if (!this._matchDue(p)) continue;
      this._countAsk(p);
      // ときには、こちらから探す前に先方から申し込みが来る
      if ((p.proposals ?? 0) < 2 && this.rng.chance(0.3) && this._proposalFor(p)) continue;
      this._marriageDecision(p);
    }
  },

  // 縁談を出すかどうか：適齢期に 1 回、見送ったら 5 年後にもう 1 回。それも見送ったら、求められるまで出さない
  _matchDue(p) {
    if (p.noMatch) return false;
    // 結婚するたびに数え直す（先立たれたら、また 2 回まで）
    if (p.mAsksFor !== p.spouses.length) {
      p.mAsksFor = p.spouses.length;
      p.mAsks = 0;
    }
    // 跡継ぎのいる 45 歳以上の人が配偶者を亡くしても、自動では再婚の話を出さない
    if (p.spouses.length && this.age(p) >= 45 && p.children.some((id) => this.get(id).alive && this.get(id).dynastyId === p.dynastyId)) {
      p.noMatch = 'widow';
      return false;
    }
    if ((p.mAsks ?? 0) >= 2) {
      p.noMatch = 'declined';
      return false;
    }
    return !this._askedRecently(`m${p.id}`, 5);
  },

  _countAsk(p) {
    this.player.asked.set(`m${p.id}`, this.year);
    p.mAsks = (p.mAsks ?? 0) + 1;
  },

  // 人物欄の「縁談を探す」：いつでも縁談を出す
  seekMatch(p) {
    if (!this.playerControls(p) || p.spouseId != null || this.age(p) < 16 || p.imprisoned || p.cloistered) return false;
    if (this.player.decisions.some((d) => d.type === 'marriage' && d.personId === p.id)) return true;
    p.noMatch = null;
    p.seekManual = true;
    p.mAsks = 0;
    p.mAsksFor = p.spouses.length;
    this._countAsk(p);
    this._marriageDecision(p);
    return true;
  },

  // ───────── 教育 ─────────

  _playerEducation() {
    const d = this.playerDynasty();
    for (const p of this.living) {
      if (!p.alive || p.dynastyId !== d.id || this.age(p) !== 6 || p.education || isSetAside(p)) continue;
      if (!this.playerControls(p)) continue;
      this._decision({ type: 'education', personId: p.id });
    }
  },

  _educate(p, key) {
    const e = EDUCATION[key];
    p.education = key;
    for (const [k, v] of Object.entries(e.env)) p.env[k] = (p.env[k] ?? 0) + v;
    p.pheno = express(p.genome, p.env);
  },

  // ───────── 決断 ─────────

  decide(id, choice) {
    const i = this.player.decisions.findIndex((d) => d.id === id);
    if (i < 0) return null;
    const d = this.player.decisions[i];
    this.player.decisions.splice(i, 1);
    if (d.type === 'event') return this._resolveEvent(d, choice);
    if (d.type === 'news') return null;
    if (d.type === 'rebellion' || d.type === 'war') return null;
    if (d.type === 'goal') {
      const o = d.options.find((x) => x.key === choice);
      this.setGoal(o ? o.key : null, o ? o.target : null);
      return o ? `🎯 家の目標：${o.label}` : null;
    }
    if (d.type === 'marriage') {
      const p = this.get(d.personId);
      if (!p.alive || p.spouseId != null) return null;
      if (choice === 'never') {
        p.noMatch = 'declined';
        return `${p.name}の縁談は、しばらく探さない。人物欄の「縁談を探す」でいつでも探せます。`;
      }
      if (choice === 'later') return d.proposal ? this._declineProposal(d, p) : (p.mAsks ?? 0) >= 2 ? `${p.name}の縁談は見送った。次は人物欄の「縁談を探す」から。` : `${p.name}の縁談は見送った。5 年後にまた話が来ます。`;
      if (choice === 'lowborn') {
        const k = this.kingdomOf(p);
        const home = this.homeProvince(p) ?? k?.capital ?? 0;
        const a = this.age(p);
        const sAge = p.sex === 'M' ? clamp(a - 2 - this.rng.int(8), 16, 34) : clamp(a + this.rng.int(6), 18, 55);
        const sp = this._founder(p.sex === 'M' ? 'F' : 'M', sAge, this._regionFor(home), { kingdomId: p.kingdomId, culture: k ? k.culture : p.culture, lowborn: true });
        this._wed(p.sex === 'M' ? p : sp, p.sex === 'M' ? sp : p);
        return `${p.name}は平民の出の${sp.name}と結ばれた。`;
      }
      const matri = String(choice).startsWith('matri:');
      const c = this.get(Number(String(choice).replace('matri:', '')));
      if (!c || !c.alive || c.spouseId != null) {
        // ほかの候補から選び直せるように、縁談をもう一度出す
        this._marriageDecision(p);
        return `${c ? c.name : '相手'}はもう別の縁談がまとまっていた。ほかの候補から選び直せます。`;
      }
      return this._resolveMarriage(d, p, c, matri);
    }
    if (d.type === 'foster') {
      const p = this.get(d.personId);
      if (!p.alive) return null;
      // 「跡継ぎ以外は、これから家で育てる」
      if (choice === 'autohome') this.player.fosterAuto = true;
      const o = d.options.find((x) => x.key === choice) ?? d.options.find((x) => x.key === 'home') ?? d.options[0];
      this._setFoster(p, o);
      const t = o.tutorId != null ? this.get(o.tutorId) : null;
      return `${p.name}は${o.key === 'cloister' ? '修道院で' : o.key === 'home' ? '家で' : `${t.name}のもとで`}育つことになった。16 歳で成人したら報せが届きます。`;
    }
    if (d.type === 'education') {
      const p = this.get(d.personId);
      if (!p.alive) return null;
      this._educate(p, choice);
      return `${p.name}は${EDUCATION[choice].label}を学ぶことになった。`;
    }
    if (d.type === 'grant') {
      const k = this.kingdoms[d.kingdomId];
      const pr = this.provinces[d.provinceId];
      if (!k.alive || pr.ownerId !== k.id || !this.isDemesne(pr)) return null;
      if (choice === 'keep' && d.byHand) return null;
      if (choice === 'keep') {
        k.keepUntil = this.year + 5;
        for (const v of this.vassals(k)) this._remember(v, -4, '王が土地を手放さない', k);
        return `${pr.name}伯領は王領にとどめた。諸侯は少し不満げだ。`;
      }
      if (choice === 'knight') {
        this._grant(k, pr, null, '恩賞', { knight: true });
        return null;
      }
      this._grant(k, pr, this.dynasties[Number(choice)]);
      return null;
    }
    if (d.type === 'faction') {
      if (choice === 'join') {
        this.player.joined = { kingdomId: d.kingdomId, kind: d.kind };
        return `${d.label}に加わった。派閥が十分に強くなれば、反乱が始まる。`;
      }
      if (choice === 'wait') {
        this.player.asked.set(`f${d.kingdomId}`, this.year - 5);
        return '返事を保留した。3 年ほどしたら、また誘いが来る。';
      }
      this.player.joined = null;
      this.player.asked.set(`f${d.kingdomId}`, this.year);
      return '誘いを断った。王への忠誠は変わらない。';
    }
    return null;
  },

  // ───────── 王としての行い ─────────

  _playerGrantDecision(k, pr, byHand = false) {
    if (this.player.decisions.some((d) => d.type === 'grant' && d.kingdomId === k.id)) return;
    const r = this.ruler(k);
    const cands = this.dynasties
      .filter((d) => !d.extinct && d.kingdomId === k.id && d.id !== r.dynastyId && this.head(d) && this.age(this.head(d)) >= 16)
      .map((d) => ({ d, n: this.countiesOf(d.id).length, same: this.countiesOf(d.id).some((c) => c.duchyId === pr.duchyId) }))
      .sort((a, b) => (b.d.opinion ?? 0) - (a.d.opinion ?? 0))
      .slice(0, 6);
    this._decision({ type: 'grant', kingdomId: k.id, provinceId: pr.id, candidateDynIds: cands.map((o) => o.d.id), byHand });
  },

  // 宣戦できる相手（隣国と、請求権のある国）
  warTargets(k) {
    const r = this.ruler(k);
    const out = [];
    for (const t of this.neighbors(k)) {
      // 同盟国にも宣戦できる（同盟を破ることになり、諸侯が怒る）
      if (this.truce(k.id, t.id) || this.atWar(k.id, t.id)) continue;
      out.push({ t, kind: 'conquest', claimant: null, ratio: this.power(k) / Math.max(1, this.power(t)) });
    }
    const claimants = [r, ...(r.spouseId != null ? [this.get(r.spouseId)] : []), ...r.children.map((id) => this.get(id))].filter((p) => p && p.alive);
    for (const c of claimants) {
      for (const tid of c.claims) {
        const t = this.kingdoms[tid];
        if (!t.alive || t === k || this.atWar(k.id, t.id) || this.truce(k.id, t.id)) continue;
        out.push({ t, kind: 'claim', claimant: c, ratio: this.power(k) / Math.max(1, this.power(t)) });
      }
    }
    return out;
  },

  playerDeclareWar(targetId, claimantId = null) {
    const k = this.playerKingdom();
    const t = this.kingdoms[targetId];
    if (!k || !t || !t.alive || this.atWar(k.id, t.id)) return null;
    const r = this.ruler(k);
    const kind = claimantId != null ? 'claim' : 'conquest';
    const w = this._startWar(kind, k, t, claimantId != null ? { claimantId } : {});
    if (this.allied(k.id, t.id)) {
      for (const v of this.vassals(k)) this._remember(v, -10, '同盟国を裏切った', k);
      const key = k.id < t.id ? `${k.id}-${t.id}` : `${t.id}-${k.id}`;
      this.brokenAlliances = this.brokenAlliances ?? new Map();
      this.brokenAlliances.set(key, this.year + 30);
      this.alliances.delete(key);
    }
    const c = claimantId != null ? this.get(claimantId) : null;
    this.addLog('war', `${this.pn(r)} は ${c ? `${c === r ? '自らの' : `${this.pn(c)} の`}請求権を掲げて ` : ''}${this.kn(t)} に宣戦した（${w.name}）。${this._alliesText(w)}`, [k.id, t.id]);
    return w;
  },

  playerRevoke(dynId) {
    const k = this.playerKingdom();
    const d = this.dynasties[dynId];
    if (!k || !d) return null;
    const pr = this.countiesOf(d.id, k.id).sort((a, b) => b.pop - a.pop)[0];
    if (!pr) return null;
    pr.holder = null;
    this._remember(d, -50, '領地の没収', k);
    this._grudge(d, this.playerDynasty(), 'revoke', null, { place: pr.name });
    for (const v of this.vassals(k)) if (v !== d) this._remember(v, -8, '王の専横', k);
    const h = this.head(d);
    this.addLog('dynasty', `${this.pn(this.ruler(k))} は ${h ? this.pn(h) : `${d.name}家`} から ${pr.name}伯領 を取り上げた。`, [k.id]);
    return pr;
  },

  // ───────── 諸侯としての行い ─────────

  // 主君の国（プレイヤーの家が諸侯として仕えている国）
  playerLiege() {
    const d = this.playerDynasty();
    if (!d || this.playerKingdom()) return null;
    const k = this.kingdoms[d.kingdomId];
    return k && k.alive ? k : null;
  },

  // 反乱の勝ち目：味方になりそうな家（忠誠の低い家）を含めた兵力の比
  rebelOdds(k) {
    const d = this.playerDynasty();
    const allies = this.vassals(k).filter((v) => v !== d && (v.opinion ?? 0) < -5);
    const ex = new Set([d.id, ...allies.map((v) => v.id)]);
    let mine = 0;
    let likely = 0;
    for (const pr of this.provinces) {
      if (pr.ownerId !== k.id) continue;
      if (pr.holder === d.id) mine += this.countyLevy(pr);
      else if (ex.has(pr.holder)) likely += this.countyLevy(pr) * 0.3;
    }
    for (const v of this.vassals(k)) if ((v.opinion ?? 0) < -15) ex.add(v.id);
    const king = this.power(k, ex);
    return { mine: mine * 1.2 + 2, likely, king, ratio: (mine * 1.2 + 2 + likely) / Math.max(1, king), allies: allies.length };
  },

  playerRebel(kind) {
    const k = this.playerLiege();
    const d = this.playerDynasty();
    const h = this.playerHead();
    if (!k || !h || this.activeWars(k.id).some((w) => w.kind === 'civil' || w.kind === 'independence')) return null;
    if (!this.countiesOf(d.id, k.id).length) return null;
    // 自分で起こした反乱は、報せにしない
    this._quietNews = true;
    this._rebel(k, kind, h, [d]);
    this._quietNews = false;
    this.player.joined = null;
    return true;
  },

  // ───────── 毎年 ─────────

  _playerTick() {
    if (!this.player || this.player.over) return;
    const d = this.playerDynasty();
    if (d.extinct || !this.head(d)) {
      this.player.over = true;
      this.player.decisions = [];
      this._decision({ type: 'end', years: this.year - this.player.startYear, peak: this.player.peak.label });
      this.addLog('dynasty', `あなたの ${d.name}家 は絶えた（${this.year - this.player.startYear} 年のあいだ歴史を刻んだ）。`);
      return;
    }
    const st = this.houseStanding(d);
    if (st.rank > this.player.peak.rank) this.player.peak = st;
    this._playerFostering();
    this._marriageProposals();
    // 不満な派閥への誘い
    const liege = this.playerLiege();
    if (liege && !this.player.joined && !this._askedRecently(`f${liege.id}`, 8)) {
      const f = (liege.factions ?? []).find((x) => x.kind !== 'claimant' || this.get(x.leaderId)?.dynastyId !== d.id);
      if (f && (d.opinion ?? 0) < 0 && this.countiesOf(d.id, liege.id).length) {
        const labels = { usurp: '王位を奪おうとする派閥', claimant: '請求者を王に就けようとする派閥', independence: '独立をめざす派閥' };
        this.player.asked.set(`f${liege.id}`, this.year);
        this._decision({ type: 'faction', kingdomId: liege.id, kind: f.kind, leaderId: f.leaderId, memberIds: f.members, label: labels[f.kind] });
      }
    }
  },
};

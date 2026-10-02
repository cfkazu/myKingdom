// 養育先：跡継ぎを 6 歳でどこに預けて育てるかを選ぶ。World にメソッドとして組み込む。
//
// - 後見人は実在の人。子は後見人の得意から学び、性格（慈愛・野心）も後見人に似る。
// - 王の宮廷に出せば王の機嫌がよくなり、王子・王女と幼なじみになる（のちの縁談で縁になる）。
// - 因縁のある家に預ければ、恨みが和らぐ。修道院は野心を抑える。
// - 16 歳で成人し、「生まれ（素質）」と「育ち」がそれぞれどれだけ効いたかを報せで見せる。
// - 跡継ぎ以外の子は、家で育てる（カードは出さない）。

import { express } from './genes.js';

const SCALE = { strength: 8, intellect: 9, beauty: 8, charisma: 8, ambition: 12, kindness: 12 };
export const TRAIT_LABEL = { strength: '体の強さ', intellect: '知略', beauty: '容姿', charisma: 'カリスマ', ambition: '野心', kindness: '慈愛' };
const SKILLS = ['strength', 'intellect', 'charisma'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const FosterMixin = {
  // 後見人から学べる量（env の単位）。得意な人ほど多く、苦手な人からは少し悪くなる
  _learn(tutor, traits, weight = 1) {
    const g = {};
    for (const [t, w] of traits) g[t] = (g[t] ?? 0) + clamp((tutor.pheno[t] - 45) / 30, -0.3, 1.6) * w * weight;
    // 性格は後見人に似る
    g.kindness = (g.kindness ?? 0) + clamp((tutor.pheno.kindness - 50) / 40, -1, 1) * weight;
    g.ambition = (g.ambition ?? 0) + clamp((tutor.pheno.ambition - 50) / 40, -1, 1) * weight;
    return g;
  },

  // 能力の見込み（点数）。UI と報せ用
  fosterPoints(gains) {
    return Object.entries(gains)
      .map(([t, v]) => [t, Math.round(v * SCALE[t])])
      .filter(([, v]) => Math.abs(v) >= 2);
  },

  // 後見人にふさわしい大人：よその家の、25〜65 歳の正気の人から、score がいちばん高い人
  _bestAdult(filter, score) {
    let best = null;
    let bestS = -Infinity;
    for (const h of this.living) {
      const d = this.dyn(h);
      if (!d || !h.alive || h.mad || h.imprisoned || h.cloistered || this.age(h) < 25 || this.age(h) > 65 || !filter(h, d)) continue;
      const s = score(h);
      if (s > bestS) {
        bestS = s;
        best = h;
      }
    }
    return best;
  },

  // 選べる養育先
  fosterOptions(child) {
    const my = this.dyn(child);
    const head = this.head(my);
    const pk = this.playerKingdom();
    const realm = pk ?? this.playerLiege();
    const opts = [];
    const missing = [];
    const used = new Set();
    const best2 = (t) => [...SKILLS].sort((a, b) => t.pheno[b] - t.pheno[a]).slice(0, 2);
    // 1. 家で育てる：当主（当主が親なら、もう一方の親でもよい）
    const home = head && head !== child ? head : this.get(child.fatherId) ?? this.get(child.motherId);
    if (home && home.alive) {
      used.add(home.id);
      const [a, b] = best2(home);
      opts.push({ key: 'home', icon: '🏠', label: '家で育てる', tutorId: home.id, gains: this._learn(home, [[a, 0.8], [b, 0.4]], 0.8), side: '家を離れないので、何も失わない。教えは当主の得意しだい' });
    }
    const other = (h, d) => d.id !== my.id && !used.has(h.id) && (!realm || h.kingdomId === realm.id || d.kingdomId === realm.id);
    // 2. 名将に預ける
    const general = this._bestAdult(other, (h) => this.martial(h));
    if (general && this.martial(general) >= 62) {
      used.add(general.id);
      opts.push({ key: 'general', icon: '⚔️', label: '名将に預ける', tutorId: general.id, gains: this._learn(general, [['strength', 1], ['intellect', 0.35], ['charisma', 0.35]]), side: `体と戦の指揮（知略・カリスマ）を鍛える。${this.dyn(general).name}家と縁ができ、後見人の気性もうつる` });
    } else missing.push('名将（指揮 62 以上の人が国にいない）');
    // 3. 賢者に預ける
    const sage = this._bestAdult(other, (h) => h.pheno.intellect + this.stewardship(h) * 0.3);
    if (sage && sage.pheno.intellect < 68) missing.push('賢者（知略 68 以上の人が国にいない）');
    if (sage && sage.pheno.intellect >= 68) {
      used.add(sage.id);
      opts.push({ key: 'sage', icon: '📜', label: '賢者に預ける', tutorId: sage.id, gains: this._learn(sage, [['intellect', 1.1], ['charisma', 0.3]]), side: `${this.dyn(sage).name}家と縁ができる。後見人の気性もうつる` });
    }
    // 4. 王の宮廷へ：諸侯なら主君の宮廷に小姓として、王なら隣国の宮廷へ
    const liege = this.playerLiege();
    let court = liege ? this.ruler(liege) : null;
    if (!court && pk) {
      const ks = this.neighbors(pk).filter((k) => k.alive && !this.atWar(k.id, pk.id) && this.ruler(k) && !this.ruler(k).mad);
      ks.sort((a, b) => Number(this.allied(b.id, pk.id)) - Number(this.allied(a.id, pk.id)) || this.provincesOf(b).length - this.provincesOf(a).length);
      court = ks.length ? this.ruler(ks[0]) : null;
    }
    if (!court) missing.push(pk ? '隣国の宮廷（戦をしていない隣国がない）' : '王の宮廷（主君がいない）');
    if (court && !used.has(court.id) && court.dynastyId !== my.id) {
      const k = this.kingdoms[court.rulerOf];
      const kids = this.living.filter((p) => p.alive && p.dynastyId === court.dynastyId && Math.abs(this.age(p) - this.age(child)) <= 4 && p !== child);
      opts.push({
        key: 'court',
        icon: '👑',
        label: liege ? '王の宮廷に小姓として出す' : `${k.name}の宮廷に預ける`,
        tutorId: court.id,
        kingdomId: k.id,
        gains: this._learn(court, [['charisma', 1], ['beauty', 0.4]], 0.9),
        friendIds: kids.map((p) => p.id),
        side: `${liege ? '王の機嫌がよくなる（忠誠 +12）。' : `${k.name}の王家と親しくなる。`}${kids.length ? `${kids.map((p) => p.name).slice(0, 3).join('・')}と幼なじみになり、のちの縁談で縁になる` : '同じ年ごろの王子・王女はいない'}`,
      });
    }
    // 5. 因縁のある家に預けて、和解をはかる
    if (this.grudgesAgainst) {
      const foes = [...this.grudgesOf(my).map((g) => this.dynasties[g.against]), ...this.grudgesAgainst(my).map((x) => x.d)];
      const foe = foes.find((d) => d && !d.extinct && this.head(d) && !used.has(this.head(d).id) && this.age(this.head(d)) >= 25);
      if (foe) {
        const t = this.head(foe);
        const [a] = best2(t);
        opts.push({ key: 'feud', icon: '🕊', label: `因縁の${foe.name}家に預ける`, tutorId: t.id, dynId: foe.id, gains: this._learn(t, [[a, 0.8]]), side: `両家の因縁が大きく和らぐ。ただし仇の家で育つ子の気性は読めない` });
      }
    }
    // 6. 修道院
    opts.push({ key: 'cloister', icon: '⛪', label: '修道院で学ばせる', tutorId: null, gains: { kindness: 1.2, intellect: 0.6, ambition: -0.9 }, side: '情け深く欲の少ない子になる。ただし 2 割ほどは、16 歳でそのまま修道院に残ると言い出す（継承と縁談から外れる）' });
    opts.missing = missing;
    return opts;
  },

  // 跡継ぎは 6 歳でカード、ほかの子は家で育てる
  _playerFostering() {
    const d = this.playerDynasty();
    const heir = this.houseHeir(d);
    for (const p of this.living) {
      if (!p.alive || p.dynastyId !== d.id || this.age(p) !== 6 || p.foster || p.education) continue;
      if (!this.playerControls(p) || p.imprisoned || p.cloistered) continue;
      // 当主の子と跡継ぎの子は、養育先を選ぶ（ほかの一族は家で育てる）
      const main = this._mainLine(p, d, heir);
      const child = [p.fatherId, p.motherId].includes(this.head(d)?.id);
      if (!p.passedOver && (main || (child && this.isCore(p) && !this.player.fosterAuto))) {
        const opts = this.fosterOptions(p);
        this._decision({ type: 'foster', personId: p.id, main, options: opts.map((o) => ({ ...o, heir: true })), missing: opts.missing });
      }
      else {
        const home = this.fosterOptions(p).find((o) => o.key === 'home');
        if (home) this._setFoster(p, home);
      }
    }
  },

  // 家の本筋の子：跡継ぎ本人、当主の長子、跡継ぎの長子
  _mainLine(p, d, heir) {
    if (p === heir) return true;
    const eldest = (par) => (par ? par.children.map((id) => this.get(id)).filter((c) => c.alive && c.dynastyId === d.id && !c.passedOver).sort((a, b) => a.birthYear - b.birthYear || a.id - b.id)[0] : null);
    return eldest(this.head(d)) === p || eldest(heir) === p;
  },

  _setFoster(p, o) {
    p.foster = { heir: !!o.heir, key: o.key, label: o.label, tutorId: o.tutorId, kingdomId: o.kingdomId ?? null, year: this.year, gains: o.gains, friendIds: o.friendIds ?? [], before: { ...p.pheno } };
    const my = this.dyn(p);
    if (o.key === 'court' && o.kingdomId != null) {
      const k = this.kingdoms[o.kingdomId];
      if (this.playerLiege()?.id === k.id) this._remember(my, 12, '子を王の宮廷に出した', k);
      p.friendIds = [...new Set([...(p.friendIds ?? []), ...(o.friendIds ?? [])])];
      for (const id of o.friendIds ?? []) {
        const f = this.get(id);
        f.friendIds = [...new Set([...(f.friendIds ?? []), p.id])];
      }
    }
    if (o.key === 'feud' && o.dynId != null) {
      const foe = this.dynasties[o.dynId];
      for (const [x, y] of [[my, foe], [foe, my]]) for (const g of this.grudgesOf(x, y.id)) g.ease *= 0.4;
    }
    if (o.tutorId != null && o.key !== 'home') this._deed(p, 'foster', `${o.label.replace(/に(預ける|出す)|で学ばせる/, '')}（${this.get(o.tutorId).name}）のもとで育つ`);
    if (o.key === 'cloister') this._deed(p, 'foster', '修道院で育つ');
  },

  // 16 歳で成人：育ちを能力に足し、報せで見せる
  _fosterTick() {
    for (const p of this.living) {
      const f = p.foster;
      if (!p.alive || !f || f.done || this.age(p) < 16) continue;
      f.done = true;
      const tutor = f.tutorId != null ? this.get(f.tutorId) : null;
      // 後見人が子の 12 歳より前に亡くなると、学びは半ば
      let w = 0.75 + this.rng.next() * 0.5;
      let note = '';
      if (tutor && !tutor.alive && tutor.deathYear < p.birthYear + 12) {
        w *= 0.5;
        note = `後見人 ${this.pn(tutor)} が ${tutor.deathYear} 年に亡くなり、学びは半ばで終わった。`;
      }
      const before = { ...p.pheno };
      for (const [t, v] of Object.entries(f.gains)) p.env[t] = (p.env[t] ?? 0) + v * w;
      p.pheno = express(p.genome, p.env);
      p.education = f.key;
      // 修道院で育った子は、そのまま残ると言い出すことがある
      let stayed = false;
      if (f.key === 'cloister' && this.rng.chance(0.2)) {
        stayed = true;
        p.cloistered = true;
        this.headCache?.delete(p.dynastyId);
        for (const k of this.kingdoms) if (k.heirId === p.id) k.heirId = null;
        this._deed(p, 'cloister', '修道院に残り、信仰に生きると決める');
      }
      // 家で育てた子の成人は、跡継ぎのときだけ知らせる
      if (!this.isPlayerHouse(p) || (f.key === 'home' && this.houseHeir(this.dyn(p)) !== p && !stayed)) continue;
      const lines = Object.keys(f.gains)
        .map((t) => [t, Math.round(p.pheno[t] - before[t])])
        .filter(([, v]) => Math.abs(v) >= 2)
        .map(([t, v]) => {
          const apt = t === 'ambition' || t === 'kindness' ? null : this.aptitude(p, t);
          return `${TRAIT_LABEL[t]} ${Math.round(p.pheno[t])}（育ちで ${v > 0 ? '+' : ''}${v}${apt ? `・生まれの素質 ＋${apt.plus}/${apt.copies}` : ''}）`;
        });
      // 幼なじみのうち、縁談で有望な人（王・継承者・魅力の高い人）を 2 人まで
      const friends = (p.friendIds ?? [])
        .map((id) => this.get(id))
        .filter((x) => x && x.alive && x.spouseId == null && x.sex !== p.sex)
        .sort((a, b) => (b.rulerOf != null) - (a.rulerOf != null) || !!this.isHeirAnywhere(b) - !!this.isHeirAnywhere(a) || this.charm(b) - this.charm(a))
        .slice(0, 2);
      const after = [];
      if (stayed) after.push(`${p.name}は修道院に残り、信仰に生きると決めた。継承と縁談から外れる。`);
      if (f.key === 'feud' && tutor) {
        const fd = this.dyn(tutor);
        const my = this.dyn(p);
        const left = fd && my ? Math.round(Math.max(this.grudgeAgainst(my, fd.id), this.grudgeAgainst(fd, my.id))) : 0;
        after.push(left < 1 ? `${fd?.name ?? ''}家との因縁は、もう消えた。` : `${fd?.name ?? ''}家との因縁は和らいだ（恨みの強さ ${left}）。`);
      }
      if (friends.length) after.push(`幼なじみ：${friends.map((x) => `${x.name}（${x.rulerOf != null ? '君主' : this.isHeirAnywhere(x) ? '継承者' : `魅力 ${Math.round(this.charm(x))}`}）`).join('・')}。縁談の候補に出れば「幼なじみ」の縁がつく。`);
      const isHeir = this.houseHeir(this.dyn(p)) === p;
      this._news({
        icon: '🎓',
        title: `${p.name}が成人した（${f.label.replace(/^(.*?)(に預ける|に出す|で学ばせる|で育てる)$/, '$1')}${tutor && f.key !== 'cloister' ? `・後見 ${tutor.name}` : ''}）`,
        body: `${lines.join('、') || '目立った変化はなかった'}。${note}`,
        why: '能力は、生まれ持った遺伝子（素質）に、育ちが上乗せされたものです。子に伝わるのは素質のほうだけ。',
        means: `${after.join('')}${isHeir ? '跡継ぎとしての器が決まりました。' : ''}` || '家の一員として、縁談の年ごろを迎えました。',
        pids: [],
      });
    }
  },
};

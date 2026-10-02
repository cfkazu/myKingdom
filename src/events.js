// プレイヤーの家に起きるイベント。選択肢つきの決断カードとして出す。World にメソッドとして組み込む。
//
// どのイベントも、すでにある仕組み（遺伝子・継承・忠誠・請求権・暗殺）につながる。
// 継承から外された人（passedOver）・幽閉された人（imprisoned）・修道院に入った人（cloistered）は、
// 継承順位・当主選び・縁談から外れる。

import { express, predictOffspring, HAIR_LABEL, EYE_LABEL } from './genes.js';
import { createRng } from './rng.js';

// 継承と縁談から外れている人か
export const isSetAside = (p) => !!(p && (p.passedOver || p.imprisoned || p.cloistered));

export const EventsMixin = {
  // その家の次の当主（王家なら王国の継承者）
  houseHeir(d) {
    const k = this.kingdoms.find((kk) => kk.alive && kk.rulerId != null && this.ruler(kk).dynastyId === d.id);
    if (k) return this.heirOf(k);
    const head = this.head(d);
    let best = null;
    let bestS = -Infinity;
    for (const p of this.living) {
      if (!p.alive || p === head || p.dynastyId !== d.id || isSetAside(p)) continue;
      const a = this.age(p);
      const s = (head && (p.fatherId === head.id || p.motherId === head.id) ? 300 : 0) + (p.sex === 'M' ? 100 : 0) + Math.min(a, 70);
      if (s > bestS) {
        bestS = s;
        best = p;
      }
    }
    return best;
  },

  _event(key, subjectId, title, text, options, extra = {}) {
    this.player.eventCooldown = this.player.eventCooldown ?? {};
    this.player.eventCooldown[key] = this.year;
    this._decision({ type: 'event', key, personId: subjectId, title, text, options, ...extra });
  },

  _cool(key, years) {
    const y = this.player.eventCooldown?.[key];
    return y == null || this.year - y >= years;
  },

  // 毎年、起こりうるイベントを一つだけ選んで出す
  _playerEvents() {
    if (!this.player || this.player.over || this.player.decisions.some((d) => d.type === 'event')) return;
    const d = this.playerDynasty();
    const head = this.playerHead();
    if (!d || !head) return;
    const cands = [];
    const heir = this.houseHeir(d);
    const k = this.playerKingdom();

    // 1. 血友病の跡継ぎ
    if (heir && heir.pheno.hemophilia && heir.sex === 'M' && this.age(heir) >= 3 && !heir.hemoAsked) cands.push(() => this._evHemophilia(d, heir));
    // 2. 狂気の兆し（当主以外の近親）
    const mad = this.living.find((p) => p.alive && p.dynastyId === d.id && p.mad && p !== head && !p.imprisoned && !p.madAsked && this.age(p) >= 16);
    if (mad) cands.push(() => this._evMadness(d, mad));
    // 3. 野心的な弟（当主の子かきょうだいで、跡継ぎでない）
    const plotter = this.living.find(
      (p) =>
        p.alive &&
        p.dynastyId === d.id &&
        p !== head &&
        p !== heir &&
        !isSetAside(p) &&
        this.age(p) >= 18 &&
        p.pheno.ambition > 65 &&
        p.pheno.kindness < 45 &&
        (p.fatherId === head.id || p.motherId === head.id || (head.fatherId != null && p.fatherId === head.fatherId)),
    );
    if (plotter && this._cool('plot', 10)) cands.push(() => this._evPlot(d, plotter, heir));
    // 4. 不満な諸侯の懐柔（王のとき）
    if (k && this._cool('appease', 7)) {
      const angry = this.vassals(k).filter((v) => (v.opinion ?? 0) < -15 && this.head(v)).sort((a, b) => (a.opinion ?? 0) - (b.opinion ?? 0))[0];
      if (angry) cands.push(() => this._evAppease(k, angry));
    }
    // 5. 不義の子の噂（当主の子で 3〜8 歳）
    const doubt = this.living.find((p) => p.alive && p.fatherId === head.id && this.age(p) >= 3 && this.age(p) <= 8 && !p.rumorAsked && (p.trueFatherId != null || this.rng.chance(0.06)));
    if (doubt && this._cool('rumor', 10)) cands.push(() => this._evRumor(d, doubt, head));
    // 6. 当主の最期
    if (this.age(head) >= 58 && !head.lastWords && heir && this.rng.chance(0.2)) cands.push(() => this._evLastWords(d, head, heir));

    if (!cands.length || !this.rng.chance(0.4)) return;
    this.rng.pick(cands)();
  },

  // ───────── 1. 血友病の跡継ぎ ─────────

  _evHemophilia(d, heir) {
    heir.hemoAsked = true;
    const mom = this.get(heir.motherId);
    this._event(
      'hemo',
      heir.id,
      '血友病の跡継ぎ',
      `跡継ぎの ${this.pn(heir)}（${this.age(heir)}歳）が、転んだ傷の血がいつまでも止まらない。血友病だ。母 ${mom ? this.pn(mom) : ''} から受け継いだ X 染色体の遺伝子による。若くして亡くなりやすく、戦にも出られない。`,
      [
        { id: 'keep', label: 'このまま跡継ぎにする', desc: '血筋の順を守る。長く生きられないかもしれない' },
        { id: 'pass', label: '次の子を跡継ぎに立てる', desc: `${heir.name}は継承から外れる（王国なら請求権は残る）` },
        { id: 'cloister', label: '修道院へ入れる', desc: '静かに暮らせる。継承からも縁談からも外れる' },
      ],
    );
  },

  // ───────── 2. 狂気の兆し ─────────

  _evMadness(d, p) {
    p.madAsked = true;
    this._event(
      'mad',
      p.id,
      '狂気の兆し',
      `${this.pn(p)}（${this.age(p)}歳）が、夜ごと誰もいない回廊に向かって叫ぶようになった。狂気の遺伝子 m を両親から 1 つずつ受け継いでいたのだ。`,
      [
        { id: 'imprison', label: '塔に幽閉する', desc: '宮廷は静かになる。継承と縁談から外れ、その親族は少し恨む' },
        { id: 'doctor', label: '名医に診せる', desc: '家格を少し使う。4 回に 1 回ほど落ち着く' },
        { id: 'ignore', label: 'そのままにする', desc: '何も起きないかもしれない。騒ぎを起こせば家の名に傷がつく' },
      ],
    );
  },

  // ───────── 3. 野心的な弟 ─────────

  _evPlot(d, p, heir) {
    const head = this.playerHead();
    const target = heir && heir !== p ? heir : head;
    this._event(
      'plot',
      p.id,
      '野心的な身内',
      `${this.pn(p)}（${this.age(p)}歳・野心 ${Math.round(p.pheno.ambition)}）が、夜更けに見知らぬ者と会っているという。${this.pn(target)} の命を狙っているとの噂だ。`,
      [
        { id: 'confront', label: '問いただす', desc: '半々で、悔い改めるか、国を出奔して恨みを抱く' },
        { id: 'exile', label: '国外へ追い出す', desc: '身の安全は守れる。ただし王国なら王位への請求権を持って出ていく' },
        { id: 'ignore', label: '噂にすぎないと放っておく', desc: '何も起きないことも多い。起きれば取り返しがつかない' },
      ],
      { targetId: target.id },
    );
  },

  // ───────── 4. 不満な諸侯の懐柔 ─────────

  _evAppease(k, v) {
    const h = this.head(v);
    const demesne = this.demesneOf(k).filter((pr) => pr.id !== k.capital);
    const head = this.playerHead();
    const kids = head.children.map((id) => this.get(id)).filter((c) => c.alive && c.spouseId == null && !isSetAside(c) && this.age(c) >= 14);
    const opts = [];
    if (demesne.length) opts.push({ id: 'land', label: `${demesne[0].name}伯領を与える`, desc: '忠誠が大きく上がる。王領は減る' });
    if (kids.length) opts.push({ id: 'marry', label: `${kids[0].name}を${v.name}家に嫁がせる約束をする`, desc: '縁組で結ばれ、忠誠が上がる（相手がいれば結婚する）' });
    opts.push({ id: 'threaten', label: '兵を見せて脅す', desc: `王の指揮 ${Math.round(this.martial(head))}。強ければ黙らせられるが、弱ければかえって怒らせる` });
    opts.push({ id: 'nothing', label: '何もしない', desc: '派閥が育つかもしれない' });
    this._event(
      'appease',
      h.id,
      '不満な諸侯',
      `${this.pn(h)}（${v.name}家・${this.houseTitle(v) ?? ''}）の王への忠誠が ${Math.round(v.opinion ?? 0)} まで下がり、ほかの不満な家と連絡を取り合っているらしい。`,
      opts,
      { dynId: v.id, kingdomId: k.id },
    );
  },

  // ───────── 5. 不義の子の噂 ─────────

  // 子の髪と瞳が、表向きの両親から生まれうるか
  couldBeChildOf(child, mom, dad) {
    if (!mom?.genome || !dad?.genome) return { hair: true, eye: true };
    const pr = predictOffspring(mom.genome, dad.genome, createRng(`${mom.id}-${dad.id}-check`), 600);
    return { hair: (pr.hair[child.pheno.hair] ?? 0) > 0, eye: (pr.eye[child.pheno.eye] ?? 0) > 0 };
  },

  _evRumor(d, child, head) {
    child.rumorAsked = true;
    const mom = this.get(child.motherId);
    const ok = this.couldBeChildOf(child, mom, head);
    const clue = !ok.hair || !ok.eye
      ? `侍医は首をかしげた。${child.name}の${!ok.hair ? HAIR_LABEL[child.pheno.hair] : ''}${!ok.hair && !ok.eye ? 'と' : ''}${!ok.eye ? EYE_LABEL[child.pheno.eye] : ''}は、あなた（${HAIR_LABEL[head.pheno.hair]}・${EYE_LABEL[head.pheno.eye]}）と${mom ? mom.name : '母'}（${mom ? `${HAIR_LABEL[mom.pheno.hair]}・${EYE_LABEL[mom.pheno.eye]}` : '？'}）の子には現れないはずだという。`
      : `侍医は言う。「${child.name}の${HAIR_LABEL[child.pheno.hair]}と${EYE_LABEL[child.pheno.eye]}は、お二人の子に現れうるものです」。見た目だけでは何とも言えない。`;
    this._event(
      'rumor',
      child.id,
      '不義の子の噂',
      `宮廷で、${this.pn(child)}（${this.age(child)}歳）はあなたの子ではない、という噂が広がっている。${clue}`,
      [
        { id: 'accept', label: 'わが子として認める', desc: '噂は立ち消えになる' },
        { id: 'investigate', label: '真相を調べさせる', desc: '本当なら継承から外す。噂が嘘なら、妻の家は喜ぶ' },
        { id: 'disown', label: '継承から外す', desc: '疑わしきは外す。妻の家はひどく恨む' },
      ],
      { clueHair: ok.hair, clueEye: ok.eye },
    );
  },

  // ───────── 6. 当主の最期 ─────────

  _evLastWords(d, head, heir) {
    head.lastWords = true;
    head.frail = true;
    // 最期を告げたら、1〜3 年のうちに本当に亡くなる
    head.doomYear = this.year + 1 + this.rng.int(3);
    const parent = head.sex === 'M' ? '父' : '母';
    this._event(
      'last',
      head.id,
      '当主の最期',
      this.rng.pick([
        `${this.pn(head)}（${this.age(head)}歳）は病の床で死期を悟り、跡継ぎの ${this.pn(heir)} を枕元に呼んだ。何を遺すか。`,
        `狩りの帰りに倒れた ${this.pn(head)}（${this.age(head)}歳）は、もう馬に乗れないと悟った。${this.pn(heir)} の手を取り、最後の言葉を探している。`,
        `${this.pn(head)}（${this.age(head)}歳）の咳が止まらない。侍医は首を振った。${this.pn(heir)} は${parent}の言葉を待っている。`,
        `冬の夜、${this.pn(head)}（${this.age(head)}歳）は家の古い肖像画の前に ${this.pn(heir)} を呼び、自分の時が尽きつつあると告げた。`,
      ]),
      [
        { id: 'rule', label: '政の心得を授ける', desc: `${heir.name}の知略とカリスマが少し伸びる` },
        { id: 'war', label: '武の心得を授ける', desc: `${heir.name}の体の強さが少し伸びる` },
        { id: 'pride', label: '家の誇りを語り継ぐ', desc: '家格が上がる' },
      ],
      { heirId: heir.id },
    );
  },

  // ───────── 選んだ結果 ─────────

  _resolveEvent(d, choice) {
    const p = this.get(d.personId);
    const house = this.playerDynasty();
    const k = this.playerKingdom();
    const log = (text) => this.addLog('event', text, [this.kingdomOf(p)?.id].filter((x) => x != null));
    const setAside = (x, how) => {
      x[how] = true;
      if (k && !x.claims.includes(k.id) && how === 'passedOver') x.claims.push(k.id);
      this.headCache.delete(x.dynastyId);
      for (const kk of this.kingdoms) if (kk.heirId === x.id) kk.heirId = null;
    };
    switch (d.key) {
      case 'hemo':
        if (choice === 'pass') {
          setAside(p, 'passedOver');
          log(`${this.pn(p)} は血友病のため跡継ぎから外された。`);
          return `${p.name}は跡継ぎから外れた。`;
        }
        if (choice === 'cloister') {
          setAside(p, 'cloistered');
          log(`${this.pn(p)} は血友病のため修道院に入った。`);
          return `${p.name}は修道院に入った。`;
        }
        return `${p.name}を跡継ぎのままにした。`;
      case 'mad':
        if (choice === 'imprison') {
          setAside(p, 'imprisoned');
          this._deed(p, 'prison', '狂気のため塔に幽閉される');
          const sp = p.spouseId != null ? this.get(p.spouseId) : null;
          const spd = sp ? this.dyn(sp) : null;
          if (spd && spd !== house && k) this._remember(spd, -15, '身内の幽閉', k);
          log(`狂気に陥った ${this.pn(p)} は塔に幽閉された。`);
          return `${p.name}を塔に幽閉した。`;
        }
        if (choice === 'doctor') {
          house.prestige = Math.max(0, house.prestige - 8);
          if (this.rng.chance(0.25)) {
            p.mad = false;
            p.madOnset = null;
            log(`名医の手当てで、${this.pn(p)} の狂気は落ち着いた。`);
            return `${p.name}は落ち着きを取り戻した！`;
          }
          return '名医にも手の施しようがなかった。';
        }
        if (this.rng.chance(0.5)) {
          house.prestige = Math.max(0, house.prestige - 15);
          log(`狂気の ${this.pn(p)} が宴の席で剣を抜き、${house.name}家の名は地に落ちた。`);
          return `${p.name}が宴で騒ぎを起こし、家格が下がった。`;
        }
        return 'いまのところ、大きな騒ぎは起きていない。';
      case 'plot': {
        const target = this.get(d.targetId);
        const flee = () => {
          const others = this.aliveKingdoms().filter((kk) => kk.id !== p.kingdomId);
          if (others.length) p.kingdomId = this.rng.pick(others).id;
          if (k && !p.claims.includes(k.id)) p.claims.push(k.id);
          setAside(p, 'passedOver');
        };
        if (choice === 'confront') {
          if (this.rng.chance(0.5)) {
            p.env.ambition = (p.env.ambition ?? 0) - 1;
            p.pheno = express(p.genome, p.env);
            return `${p.name}は涙ながらに悔い改めた。`;
          }
          flee();
          log(`問いただされた ${this.pn(p)} は国を出奔した。${k ? '王位への請求権を主張している。' : ''}`);
          return `${p.name}は出奔した。`;
        }
        if (choice === 'exile') {
          flee();
          this._deed(p, 'exile', '国外へ追放される');
          log(`${this.pn(p)} は国外へ追放された。`);
          return `${p.name}を国外へ追い出した。`;
        }
        if (target && target.alive && this.rng.chance(0.35)) {
          this.addLog('death', `${this.pn(target)} が急死した。黒幕は ${this.pn(p)} だと噂された。`, [this.kingdomOf(target)?.id].filter((x) => x != null));
          this._kill(target, '暗殺');
          return `${target.name}が暗殺された……`;
        }
        return '噂は噂のまま消えた。';
      }
      case 'appease': {
        const v = this.dynasties[d.dynId];
        const kk = this.kingdoms[d.kingdomId];
        if (!kk.alive || v.extinct) return null;
        if (choice === 'land') {
          const pr = this.demesneOf(kk).find((x) => x.id !== kk.capital);
          if (pr) this._grant(kk, pr, v, '懐柔の恩賞');
          return null;
        }
        if (choice === 'marry') {
          const head = this.playerHead();
          const kid = head.children.map((id) => this.get(id)).find((c) => c.alive && c.spouseId == null && !isSetAside(c) && this.age(c) >= 14);
          this._remember(v, 25, '王家との縁組', kk);
          const partner = kid ? this.living.find((x) => x.alive && x.dynastyId === v.id && x.sex !== kid.sex && x.spouseId == null && !isSetAside(x) && this.age(x) >= 16 && this.age(x) <= 45) : null;
          if (kid && partner && this.age(kid) >= 16) {
            this._wed(kid.sex === 'M' ? kid : partner, kid.sex === 'M' ? partner : kid);
            return `${kid.name}と${partner.name}が結婚した。`;
          }
          return `${v.name}家と縁組の約束を交わした。`;
        }
        if (choice === 'threaten') {
          const head = this.playerHead();
          if (this.rng.chance(this.martial(head) / 100)) {
            this._remember(v, 12, '王の威圧', kk);
            return `${v.name}家は王の兵を見て震え上がった。`;
          }
          this._remember(v, -20, '侮辱', kk);
          return `${v.name}家は脅しをはねつけ、かえって怒りを募らせた。`;
        }
        return null;
      }
      case 'rumor': {
        const mom = this.get(p.motherId);
        const md = mom ? this.dyn(mom) : null;
        const kk = k ?? this.kingdoms[house.kingdomId];
        const angry = (v) => {
          if (md && md !== house && kk?.alive) this._remember(md, v, '娘への疑い', kk);
        };
        if (choice === 'accept') return `${p.name}をわが子と認めた。`;
        if (choice === 'investigate') {
          if (p.trueFatherId != null) {
            const tf = this.get(p.trueFatherId);
            setAside(p, 'passedOver');
            log(`調べの末、${this.pn(p)} の本当の父は ${tf ? this.pn(tf) : '宮廷の男'} だとわかった。${p.name}は継承から外された。`);
            return `噂は本当だった。本当の父は${tf ? tf.name : '宮廷の男'}。`;
          }
          angry(10);
          return '噂は根も葉もない嘘だった。妻の家はあなたの公正さを喜んだ。';
        }
        setAside(p, 'passedOver');
        angry(-25);
        log(`${this.pn(p)} は不義の子と疑われ、継承から外された。`);
        return `${p.name}を継承から外した。${p.trueFatherId != null ? '' : ''}`;
      }
      case 'last': {
        const heir = this.get(d.heirId);
        if (choice === 'pride') {
          house.prestige += 25;
          return `${house.name}家の誇りが語り継がれた（家格 +25）。`;
        }
        if (!heir || !heir.alive) return null;
        if (choice === 'rule') {
          heir.env.intellect = (heir.env.intellect ?? 0) + 0.6;
          heir.env.charisma = (heir.env.charisma ?? 0) + 0.5;
        } else heir.env.strength = (heir.env.strength ?? 0) + 0.8;
        heir.pheno = express(heir.genome, heir.env);
        return `${heir.name}は${p.sex === 'M' ? '父' : '母'}の言葉を胸に刻んだ。`;
      }
      default:
        return null;
    }
  },
};

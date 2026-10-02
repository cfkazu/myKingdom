// 報せ：あなたの国と家に関わる大きな出来事（宣戦・内乱・領土の増減・王の交代）を、
// 「何が起きたか・なぜ・あなたにとって何か」とともにカードで知らせる。World にメソッドとして組み込む。
// 同じ年の報せは 1 枚にまとめる。

export const NewsMixin = {
  // あなたの家が属する国（王ならその国、諸侯なら主君の国）
  _myRealm() {
    if (!this.player || this.player.over) return null;
    return this.playerKingdom() ?? this.playerLiege();
  },

  _isMine(k) {
    const m = this._myRealm();
    return !!m && !!k && m.id === k.id;
  },

  _news(item) {
    if (!this.player || this.player.over) return;
    this._newsBuf = this._newsBuf ?? [];
    // 同じ見出しが重なったら、地方をまとめる
    const same = this._newsBuf.find((x) => x.key && x.key === item.key);
    if (same) {
      same.pids = [...new Set([...(same.pids ?? []), ...(item.pids ?? [])])];
      if (item.merge) same.body = item.merge(same.pids);
      return;
    }
    this._newsBuf.push(item);
  },

  _flushNews() {
    const buf = this._newsBuf;
    this._newsBuf = [];
    if (!buf || !buf.length || !this.player || this.player.over) return;
    const items = buf.map(({ merge, ...x }) => x);
    const open = this.player.decisions.find((d) => d.type === 'news');
    if (open) open.items.push(...items);
    else this._decision({ type: 'news', items });
  },

  // あなたの国の戦の始まり
  _newsWarStart(w) {
    const A = this.kingdoms[w.attackerId];
    const D = this.kingdoms[w.defenderId];
    const pd = this.playerDynasty();
    const mineRebel = (w.members ?? []).includes(pd?.id);
    const king = this.playerKingdom();
    if (w.kind === 'civil' || w.kind === 'independence') {
      if (!this._isMine(D)) return;
      // あなたが自分で起こした反乱も同じ（派閥に加わっていて始まった反乱は知らせる）
      if (this._quietNews) return;
      // 打てる手のあるカードで知らせる
      if (this._rebellionDecision(w)) return;
      const names = (w.members ?? []).map((id) => `${this.dynasties[id].name}家`).join('・');
      const goal = w.kind === 'independence' ? '国から独立すること' : w.claimantId != null ? `${this.pn(this.get(w.claimantId))} を王に就けること` : `盟主 ${this.pn(this.get(w.leaderId))} が王になること`;
      const means = mineRebel
        ? 'あなたの家は反乱軍です。勝てば望みがかない、負ければ当主は処刑か幽閉、所領は没収されます。'
        : king
          ? 'あなたが鎮めなければなりません。反乱に加わった家の伯爵領の兵は、敵に回ります。勝てば首謀者を罰し、負ければ王位や領土を失います。'
          : 'あなたの家は王の側です。王が負ければ、新しい王（王朝）や新しい国が生まれます。';
      this._news({
        icon: '🔥',
        title: `${w.kind === 'independence' ? '独立戦争' : '内乱'}が起きた：${w.name}`,
        body: `${names} が反旗をひるがえした。狙いは${goal}。${this._grudgeNote?.((w.members ?? []).map((id) => this.dynasties[id]), this.dyn(this.ruler(D))) ?? ''}`,
        why: '忠誠の低い諸侯が派閥をつくり、その兵力が王に迫ると反乱が起きます。王が幼い・狂っている・負け戦のあとは起きやすくなります。',
        means,
        pids: w.provinces ?? [],
      });
      return;
    }
    if (!this._isMine(A) && !this._isMine(D)) return;
    // こちらから攻めた戦は知らせない（王なら自分で決めた戦、諸侯なら主君が始めた戦。結果は領土の報せで届く）
    if (this._isMine(A)) return;
    const mine = this._isMine(A) ? A : D;
    const other = mine === A ? D : A;
    const ratio = this.power(mine) / Math.max(1, this.power(other));
    const attacked = mine === D;
    // 王として攻められたら、打てる手のあるカードで知らせる
    if (attacked && this._warDecision(w)) return;
    this._news({
      icon: '⚔️',
      title: attacked ? `${other.name}が攻めてきた：${w.name}` : `戦が始まった：${w.name}`,
      body: attacked
        ? `${this.kn(other)} の ${this.pn(this.ruler(other))} が${w.kind === 'claim' ? ` ${this.pn(this.get(w.claimantId))} の王位の請求権を掲げて` : ''}宣戦した。兵力の比は こちら ${ratio.toFixed(1)} 対 1。`
        : `${this.kn(mine)} は ${this.kn(other)} に宣戦した。兵力の比は こちら ${ratio.toFixed(1)} 対 1。`,
      why: w.kind === 'claim' ? '王位の請求権を持つ人がいると、その国に継承戦争を仕掛けられます。' : '野心的な王は、弱く見える隣国を攻めます。',
      means:
        w.kind === 'claim' && attacked
          ? '負ければ王が追われ、請求者が王になります。'
          : attacked
            ? '負ければ国境の地方を割譲します。地方を全部失えば国が滅びます。'
            : '勝てば国境の地方を得ます。',
      pids: [],
    });
  },

  // あなたの国の戦の終わり
  _newsWarEnd(w, result) {
    const A = this.kingdoms[w.attackerId];
    const D = this.kingdoms[w.defenderId];
    if (!this._isMine(A) && !this._isMine(D)) return;
    const civil = w.kind === 'civil' || w.kind === 'independence';
    const pd = this.playerDynasty();
    const mineRebel = (w.members ?? []).includes(pd?.id);
    let won;
    if (civil) won = mineRebel ? result === 'attacker' : result !== 'attacker';
    else won = (this._isMine(A) && result === 'attacker') || (this._isMine(D) && result === 'defender');
    // こちらから攻めて勝った・痛み分けた戦は、領土の報せだけで足りる
    if (!civil && this._isMine(A) && result !== 'defender') return;
    this._news({
      icon: result === 'white' ? '🤝' : won ? '🏆' : '💀',
      title: `${w.name}が終わった：${result === 'white' ? '痛み分け' : won ? 'あなたの側の勝ち' : 'あなたの側の負け'}`,
      body: `${w.startYear}年から${this.year - w.startYear}年続いた戦。会戦は ${w.battles.length} 回。`,
      why: '戦は会戦の勝ち負けの積み重ね（戦況）と、両国の疲れで決着します。',
      means: civil ? (won ? (mineRebel ? '反乱は成功しました。' : '反乱は鎮められました。') : mineRebel ? '反乱は失敗しました。' : '王が負けました。') : '領土の動きは、下の報せを見てください。',
      pids: [],
    });
  },

  // 地方の持ち主が変わった
  _newsTransfer(pr, from, to, holder) {
    const pd = this.playerDynasty();
    if (holder != null && pd && holder === pd.id) {
      this._news({ flashKind: 'lost', icon: '🏚', title: `あなたの家の ${pr.name}伯領 を失った`, body: `${pr.name} は ${this.kn(to)} に割譲され、新しい王の王領になった。`, why: '戦に負けた国は、国境の地方を勝った国に割譲します。そこを治めていた家は土地を失います。', means: '所領が減ると兵も家の力も減ります。王への恨みも少し残ります。', pids: [pr.id] });
      return;
    }
    if (this._isMine(from)) {
      this._news({
        key: `lost${from.id}-${to.id}`,
        icon: '🗺️',
        title: `${this.kingdoms[from.id].name}は領土を失った`,
        body: `${pr.name} が ${this.kn(to)} のものになった。`,
        merge: (pids) => `${pids.map((id) => this.provinces[id].name).join('・')} が ${this.kn(to)} のものになった。`,
        why: '負け戦の割譲、または国の滅亡で、地方は勝った国に移ります。',
        means: this._myLandsNote(),
        flashKind: 'lost',
        pids: [pr.id],
      });
    } else if (this._isMine(to)) {
      this._news({
        key: `gain${to.id}-${from?.id}`,
        icon: '🗺️',
        title: `${this.kingdoms[to.id].name}は領土を得た`,
        body: `${pr.name} を ${from ? this.kn(from) : 'よそ'} から得た。`,
        merge: (pids) => `${pids.map((id) => this.provinces[id].name).join('・')} を ${from ? this.kn(from) : 'よそ'} から得た。`,
        why: '勝ち戦の割譲です。',
        means: `奪った地方はまず王領になり、恩賞として諸侯に与えられることもあります。${this._myLandsNote()}`,
        flashKind: 'gain',
        pids: [pr.id],
      });
    }
  },

  // 「あなたには」に添える、自分の領地のいま
  _myLandsNote() {
    const pd = this.playerDynasty();
    if (!pd) return '';
    const pk = this.playerKingdom();
    if (pk) return `国は ${this.provincesOf(pk).length} 地方、うち王領は ${this.demesneOf(pk).length}。`;
    const cs = this.countiesOf(pd.id);
    return cs.length ? `あなたの家の所領（${cs.map((pr) => pr.name).join('・')}）は無事です。国の兵力は減ります。` : 'あなたの家は所領を持っていません。';
  },

  // あなたの家が恩賞で伯爵領を得た（王がほかの家のとき）
  _newsGrant(to, pr, why, k) {
    const pd = this.playerDynasty();
    if (!pd || to.id !== pd.id || this.playerKingdom()?.id === k.id) return;
    this._news({ icon: '🎁', title: `${pr.name}伯領 を賜った`, body: `${this.pn(this.ruler(k))} が、${why}としてあなたの家に ${pr.name}伯領 を与えた。`, why: '王は、上限を超えた王領や戦で奪った土地を、手柄のあった家・土地の少ない家・忠実な家に与えます。', means: `所領が増え、兵と家の力が増えます。王への忠誠も上がります（+30）。いまの所領：${this.countiesOf(pd.id).map((p) => p.name).join('・')}。`, flashKind: 'gain', pids: [pr.id] });
  },

  // あなたの家の当主が代わった
  _newsHeadChange(prev, h, d) {
    const rel = [h.fatherId, h.motherId].includes(prev.id) ? (prev.sex === 'M' ? '父' : '母') : h.fatherId != null && h.fatherId === prev.fatherId ? 'きょうだい' : [prev.fatherId, prev.motherId].includes(h.id) ? '親' : '一族';
    const lands = this.countiesOf(d.id);
    const pk = this.playerKingdom();
    const age = this.age(h);
    this._news({
      icon: '🕯',
      title: `当主が代わった：${h.regnal ?? h.name}（${age}歳）`,
      body: `${this.pn(prev)} が${prev.alive ? '退き' : `${prev.deathYear}年に世を去り（${prev.cause}）`}、${rel}にあたる ${this.pn(h)} が${d.name}家を継いだ。${prev.epitaph ? `墓碑には「${prev.epitaph}」と刻まれた。` : ''}`,
      why: pk ? '王家の当主は、王国の継承法に従って王位とともに継がれます。' : '当主は、家の生きている大人のうち、男系・年長の人が優先されます。継承から外した人は継ぎません。',
      means: `${age < 16 ? 'まだ幼く、成人まではほかの人が政を行います。' : ''}これからは ${h.name} として決断します。${pk ? `${pk.name}は ${this.provincesOf(pk).length} 地方、王領 ${this.demesneOf(pk).length}。` : lands.length ? `所領（${lands.map((p) => p.name).join('・')}）はそのまま引き継がれます。` : ''}`,
      flashKind: 'mine',
      pids: pk ? this.demesneOf(pk).map((p) => p.id) : lands.map((p) => p.id),
    });
  },

  // あなたの家が所領を没収された
  _newsRevoked(d, pr, why) {
    const pd = this.playerDynasty();
    if (!pd || d.id !== pd.id) return;
    this._news({ icon: '⛓', title: `${pr.name}伯領 を王に取り上げられた`, body: why, why: '野心的で冷酷な王は、忠誠の低い家から土地を取り上げます。反乱に負けた盟主の家は所領を没収されます。', means: `この恨みは家に残り、王家への忠誠を長く下げます。残る所領：${this.countiesOf(pd.id).filter((p) => p !== pr).map((p) => p.name).join('・') || 'なし'}。`, flashKind: 'lost', pids: [pr.id] });
  },

  // あなたの国の王が替わった（王朝が替わったとき）
  _newsNewKing(k, p, how) {
    if (!this._isMine(k) && !this.isPlayerHouse(p)) return;
    if (this.isPlayerHouse(p)) {
      this._news({ icon: '👑', title: `あなたの家が ${k.name} の王位に就いた`, body: `${this.pn(p)} が王になった。`, why: { usurp: '反乱に勝って王位を奪いました。', conquest: '継承戦争に勝ちました。', independence: '独立を勝ち取りました。', elected: '諸侯の選挙で選ばれました。' }[how] ?? '継承によるものです。', means: 'これからは王として、恩賞・宣戦・没収を自分で決めます。諸侯の忠誠に気をつけて。', pids: [k.capital] });
      return;
    }
    this._news({ icon: '👑', title: `${k.name}に新しい王朝`, body: `${this.pn(p)}（${this.dyn(p)?.name ?? ''}家）が王になった。`, why: { usurp: '反乱軍が勝ち、王位を奪いました。', conquest: '継承戦争で、請求者が王位を得ました。', elected: '諸侯の選挙で、別の家の人が選ばれました。' }[how] ?? '前の王家の継承者が絶えました。', means: '新しい王朝はしばらく諸侯の忠誠が低く（−10）、反乱が起きやすくなります。', pids: [k.capital] });
  },

  _newsFall(k, by) {
    if (this._isMine(by)) {
      this._news({ icon: '🏆', title: `${k.name}を滅ぼした`, body: `${this.kn(k)} の最後の地方を奪い、国は滅んだ。`, why: '地方をすべて失った国は滅びます。', means: '滅んだ国の王家は請求権を持ち、いつか取り戻しに来るかもしれません。その地方の民は、しばらくあなたの国に馴染みません（独立の派閥ができやすい）。', pids: [] });
      return;
    }
    if (!this._isMine(k)) return;
    this._news({ icon: '🏳', title: `${k.name}は滅んだ`, body: `最後の地方を ${this.kn(by)} に奪われた。`, why: '戦に負け続けて地方をすべて失うと、国は滅びます。', means: 'あなたの家はこれから勝った国に仕えます。滅んだ国の王家は請求権を持ち、いつか再興を狙えます。', pids: [] });
  },

  _newsSecede(D, nk, provs) {
    if (!this._isMine(D)) return;
    this._news({ icon: '🏴', title: `${D.name}から地方が離れた`, body: `${provs.map((id) => this.provinces[id].name).join('・')} が独立し、${this.kn(nk)} になった。`, why: '独立をめざす派閥が反乱に勝ちました。首都から遠い大貴族や、滅んだ国の地方が独立しやすい。', means: '国の兵力が減り、隣に新しい国ができました。', pids: provs });
  },
};

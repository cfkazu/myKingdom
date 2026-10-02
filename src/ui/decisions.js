// 決断のカード：プレイヤーの家に決断が来たら、時間を止めて選択肢を出す。
// あわせて、はじめに遊ぶ家を選ぶ画面もここで描く。

import { EDUCATION } from '../player.js';
import { APTITUDES, EXAMINE_COST, GOALS } from '../goals.js';
import { TRAIT_LABEL } from '../fostering.js';
import { rebellionHTML, rebellionTitle } from './rebellionView.js';
import { LOCUS } from '../genes.js';
import { HAIR_LABEL, EYE_LABEL } from '../genes.js';
import { kinshipLabel } from '../pedigree.js';
import { portraitSVG } from './portrait.js';
import { esc, personLink, kingdomLink, richText } from './util.js';

const pct = (x, n) => `${Math.round((100 * x) / Math.max(1, n))}%`;

export class DecisionPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-choice]');
      if (b) app.decide(Number(b.dataset.id), b.dataset.choice);
      const fl = e.target.closest('[data-flash]');
      if (fl) app.flashProvinces(fl.dataset.flash.split(',').filter(Boolean).map(Number), fl.dataset.flashKind);
      const more = e.target.closest('[data-more]');
      if (more) {
        this.showAll = this.showAll ?? new Set();
        this.showAll.add(Number(more.dataset.more));
        this.render();
      }
      const ex = e.target.closest('[data-examine]');
      if (ex) app.examine(Number(ex.dataset.examine));
      const pick = e.target.closest('[data-play]');
      if (pick) app.startPlaying(pick.dataset.play === 'watch' ? null : Number(pick.dataset.play));
    });
  }

  render() {
    const w = this.app.world;
    if (this.app.choosing) {
      this.el.hidden = false;
      this.el.innerHTML = this._chooser(w);
      return;
    }
    const d = w.pendingDecisions()[0];
    if (!d) {
      this.el.hidden = true;
      this.el.innerHTML = '';
      return;
    }
    this.el.hidden = false;
    const more = w.pendingDecisions().length - 1;
    const body = { goal: () => this._goal(w, d), event: () => this._event(w, d), marriage: () => this._marriage(w, d), education: () => this._education(w, d), foster: () => this._foster(w, d), grant: () => this._grant(w, d), faction: () => this._faction(w, d), end: () => this._end(w, d), news: () => this._newsCard(w, d), rebellion: () => this._rebellion(w, d) }[d.type]();
    const label = { rebellion: '🔥 内乱', news: '📣 報せ', goal: '🎯 目標', event: '📜 出来事', marriage: '💍 縁談', education: '📚 教育', foster: '🏡 養育先', grant: '🏰 恩賞', faction: '🗡️ 派閥', end: '✝️ 終わり' };
    const queue = w
      .pendingDecisions()
      .slice(1)
      .map((x) => `<span class="badge">${label[x.type]}${x.personId != null ? `：${esc(w.get(x.personId).name)}` : ''}</span>`)
      .join('');
    this.el.innerHTML = `${body}${more > 0 ? `<p class="small muted queue">このあと待っている決断（${more}）：${queue}</p>` : ''}`;
  }

  // ───────── 内乱 ─────────

  _rebellion(w, d) {
    const war = w.wars.find((x) => x.id === d.warId);
    if (!war || war.ended) {
      return `<div class="decision"><div class="eyebrow">🔥 内乱</div><h2>この内乱はもう終わりました</h2><p class="choices"><button type="button" class="primary" data-id="${d.id}" data-choice="ok">閉じる</button></p></div>`;
    }
    const role = w.playerKingdom()?.id === war.defenderId ? 'king' : (war.members ?? []).includes(w.player.dynastyId) ? 'rebel' : 'vassal';
    if (!d.flashed) {
      d.flashed = true;
      if (war.provinces.length) this.app.flashProvinces(war.provinces, 'news');
    }
    const lead = { king: 'あなたの国で反乱が起きました。何もしなくても戦は毎年の会戦で進みますが、手を打てば有利にできます。', vassal: '主君の国で反乱が起きました。あなたの家はどちらにつきますか？', rebel: 'あなたの家が加わった派閥が、ついに反旗をひるがえしました。' }[role];
    return `<div class="decision">
      <div class="eyebrow">🔥 ${esc(war.name)}</div><h2>${rebellionTitle(w, war)}</h2>
      <p>${lead}${w._grudgeNote ? ` ${richText(w, w._grudgeNote((war.members ?? []).map((id) => w.dynasties[id]), w.dyn(w.ruler(w.kingdoms[war.defenderId]))))}` : ''}</p>
      ${rebellionHTML(w, war, role)}
      <p class="small muted">あとからでも、王国タブの「内乱への対処」で同じ手を打てます。反乱軍の領地は地図で赤い斜線になります。</p>
      <p class="choices"><button type="button" data-id="${d.id}" data-choice="ok">${role === 'vassal' ? '様子を見る（閉じる）' : '閉じる'}</button></p>
    </div>`;
  }

  // ───────── 報せ ─────────

  _newsCard(w, d) {
    // はじめて出たとき、関わる地方を地図で光らせる
    if (!d.flashed) {
      d.flashed = true;
      const all = d.items.flatMap((x) => x.pids ?? []);
      const kinds = new Set(d.items.filter((x) => (x.pids ?? []).length).map((x) => x.flashKind ?? 'news'));
      if (all.length) this.app.flashProvinces(all, kinds.size === 1 ? [...kinds][0] : 'news');
    }
    const items = d.items
      .map(
        (x) => `<div class="news-item">
        <h3>${x.icon} ${richText(w, x.title)}</h3>
        <p>${richText(w, x.body)}</p>
        <dl class="kv small"><dt>なぜ</dt><dd>${richText(w, x.why)}</dd><dt>あなたには</dt><dd>${richText(w, x.means)}</dd></dl>
        ${(x.pids ?? []).length ? `<button type="button" class="small" data-flash="${x.pids.join(',')}" data-flash-kind="${x.flashKind ?? 'news'}">🗺️ 地図で見る（${x.pids.map((id) => esc(w.provinces[id].name)).join('・')}）</button>` : ''}
      </div>`,
      )
      .join('');
    return `<div class="decision news">
      <div class="eyebrow">📣 ${d.year}年の報せ</div><h2>あなたの国と家に、大きな出来事がありました</h2>
      ${items}
      <p class="choices"><button type="button" class="primary" data-id="${d.id}" data-choice="ok">わかった</button></p>
    </div>`;
  }

  // ───────── はじめに家を選ぶ ─────────

  _chooser(w) {
    const royal = w.aliveKingdoms().map((k) => ({ d: w.dyn(w.ruler(k)), k, label: `${k.name}の王家` }));
    const lords = w.dynasties
      .filter((d) => !d.extinct && !royal.some((r) => r.d === d) && w.countiesOf(d.id).length)
      .sort((a, b) => w.countiesOf(b.id).length - w.countiesOf(a.id).length || b.prestige - a.prestige)
      .slice(0, 8)
      .map((d) => ({ d, k: w.kingdoms[d.kingdomId], label: w.houseTitle(d) ?? '' }));
    const row = ({ d, k, label }, tip) => {
      const h = w.head(d);
      return `<button type="button" class="house-pick" data-play="${d.id}">
        ${h ? portraitSVG(w, h, 44) : ''}
        <span><b><span class="kdot" style="background:${d.color}"></span>${esc(d.name)}家</b> <span class="small muted">${esc(label)}${k ? `・${esc(k.name)}` : ''}</span>
        <span class="small">${h ? `当主 ${esc(h.regnal ?? h.name)}（${w.age(h)}歳）・${k && w.ruler(k)?.dynastyId === d.id ? `王国 ${w.provincesOf(k).length} 地方（うち王領 ${w.demesneOf(k).length}）` : `所領 ${w.countiesOf(d.id).length}`}` : ''}</span>
        <span class="small muted">${tip}</span></span></button>`;
    };
    return `<div class="decision">
      <h2>どの家で遊びますか？</h2>
      <p class="small">選んだ家の当主があなたです。縁談・跡継ぎの教育・恩賞・宣戦・反乱を自分で決めます。当主が亡くなれば跡継ぎが引き継ぎ、家が絶えればおしまい。</p>
      <h3>王家（むずかしさ：ふつう）</h3>
      <div class="house-list">${royal.map((r) => row(r, '国を守り、諸侯をまとめ、隣国を攻める')).join('')}</div>
      <h3>諸侯の家（むずかしさ：歯ごたえあり）</h3>
      <div class="house-list">${lords.map((r) => row(r, '縁談と反乱で、王位をめざす')).join('')}</div>
      <p><button type="button" data-play="watch">眺めるだけにする</button></p>
    </div>`;
  }

  // ───────── 縁談 ─────────

  _marriage(w, d) {
    const p = w.get(d.personId);
    const cands = d.candidateIds.map((id) => w.get(id)).filter((c) => c && c.alive && c.spouseId == null);
    const cards = cands.map((c, idx) => {
      const phi = w.ped.kinship(p.id, c.id);
      const pr = w.matchPreview(p, c);
      const cd = w.dyn(c);
      const offer = (d.offers ?? []).find((o) => o.id === c.id);
      const hooks = offer?.hooks ?? [];
      // 縁の「和解」と同じことを言うので、因縁の行は縁がないときだけ
      const feud = hooks.some((h) => h.key === 'feud') ? null : w.feudBetween(w.dyn(p), cd);
      const cost = offer?.cost ?? 0;
      const prestige = w.playerDynasty()?.prestige ?? 0;
      const ck = w.kingdomOf(c);
      const royal = w.royalOf(c);
      // よその家の人の遺伝子は、鑑定するまでわからない
      const known = w.knowsGenes(c);
      const risks = pr && known
        ? [pr.hemophiliaM ? `息子の血友病 ${pct(pr.hemophiliaM, pr.males)}` : null, pr.jaw ? `受け口 ${pct(pr.jaw, pr.born)}` : null, pr.madness ? `狂気 ${pct(pr.madness, pr.born)}` : null, pr.load ? `虚弱 ${pct(pr.load, pr.born)}` : null, pr.lethal ? `死産 ${pct(pr.lethal, pr.n)}` : null].filter(Boolean)
        : [];
      const visible = [c.pheno.hemophilia ? '血友病' : null, c.pheno.jaw ? '受け口' : null, c.mad ? '狂気' : null, c.pheno.load ? '虚弱' : null].filter(Boolean);
      const apt = APTITUDES.map((a) => {
        const v = w.aptitude(c, a.trait);
        return `${a.label} ＋${v.plus}/${v.copies}`;
      }).join('・');
      const carr = w.carriers(c).map((k) => LOCUS[k].name);
      const genesLine = known
        ? `<div class="small apt">🧬 素質：${apt}${carr.length ? `・<span class="bad">保因者：${esc(carr.join('・'))}</span>` : '・隠れた病の遺伝子なし'}</div>`
        : `<div class="small apt muted">🧬 素質と隠れた遺伝子は、まだわかりません <button type="button" class="small" data-examine="${c.id}" title="家格 ${EXAMINE_COST} を払って、侍医にこの人の血筋を調べさせる">🔍 鑑定する（家格 −${EXAMINE_COST}）</button></div>`;
      // 入婿：女性の当主・娘の相手に、家を継がない男性を迎えるとき
      const canMatri = !cost && p.sex === 'F' && c.rulerOf == null && !w.isHeirAnywhere(c) && (w.dyn(c)?.prestige ?? 0) <= (w.dyn(p)?.prestige ?? 0) + 5;
      const perks = [];
      if (c.rulerOf != null) perks.push(`${w.kingdoms[c.rulerOf].name}の君主`);
      else if (royal) perks.push(`${royal.name}の王族（同盟）`);
      if (c.gentry) perks.push('騎士の家の出（家格は低いが、新しい血を入れられる）');
      if (w.isHeirAnywhere(c)) perks.push('王位継承者');
      if (cd && w.houseTitle(cd)) perks.push(w.houseTitle(cd));
      return `<div class="cand${hooks.some((h) => h.key === 'love') ? ' cand-love' : ''}${cost ? ' cand-reach' : ''}"${idx >= 3 && !cost && !hooks.some((h) => h.key === 'love' || h.key === 'friend') && !this.showAll?.has(d.id) ? ' hidden' : ''}>
        ${portraitSVG(w, c, 64)}
        <div class="cand-body">
          ${cost ? `<div class="small reach">🌹 高嶺の花：ふつうなら断ってくる格上の相手。贈り物（家格 −${cost}）を積めば受けてくれる</div>` : ''}
          ${hooks.length ? `<div class="hooks">${hooks.map((h) => `<span class="hook hook-${h.key}">${h.icon} ${esc(h.text)}</span>`).join('')}</div>` : ''}
          <div><b>${personLink(w, c)}</b> <span class="small muted">${w.age(c)}歳${ck ? `・${esc(ck.name)}` : ''}</span></div>
          <div class="small">${ck && ck.id !== p.kingdomId ? `<span class="muted">外国（${esc(ck.name)}）・</span>` : ''}${perks.length ? `<span class="good">${esc(perks.join('・'))}</span>・` : ''}魅力 ${Math.round(w.charm(c))}・知略 ${Math.round(c.pheno.intellect)}・${HAIR_LABEL[c.pheno.hair]}・${EYE_LABEL[c.pheno.eye]}</div>
          <div class="small">${phi > 0.001 ? `<span class="${phi >= 0.05 ? 'bad' : ''}">血縁：${kinshipLabel(phi)}（子の近交係数 ${phi.toFixed(3)}）</span>` : '血縁なし'}${
            known
              ? risks.length
                ? `・<span class="bad">子の心配：${risks.join('、')}</span>`
                : '・子が遺伝病を発症する心配はほぼない'
              : visible.length
                ? `・<span class="bad">本人が${visible.join('・')}</span>`
                : '・<span class="muted">子の遺伝病：わからない</span>'
          }</div>
          ${genesLine}
          ${feud ? `<div class="small feud">⚔ 因縁：${richText(w, feud)}。縁組すれば恨みは和らぐ。</div>` : ''}
        </div>
        <div class="cand-btns">${cost ? `<button type="button" class="primary" data-id="${d.id}" data-choice="${c.id}"${prestige < cost ? ' disabled title="家格が足りない"' : ''}>口説く（家格 −${cost}）</button>${prestige < cost ? `<span class="small bad odds">あと ${Math.ceil(cost - prestige)} 足りない</span>` : ''}` : `<button type="button" class="primary" data-id="${d.id}" data-choice="${c.id}">${d.proposal ? '申し込みを受ける' : 'この人と'}</button>`}${canMatri ? `<button type="button" class="small" data-id="${d.id}" data-choice="matri:${c.id}" title="夫が家に入り、子は${esc(w.dyn(p)?.name ?? '')}家の名を継ぐ">入婿に迎える</button><span class="small muted matri-note">子は${esc(w.dyn(p)?.name ?? '')}家を継ぐ</span>` : ''}</div>
      </div>`;
    });
    // 同じ時期の縁談は、まとめて順に選ぶ
    const queue = w.pendingDecisions().filter((x) => x.type === 'marriage');
    const steps = queue.length > 1 ? `<div class="match-steps small">💍 縁談 ${queue.indexOf(d) + 1}/${queue.length}：${queue.map((x) => `<span class="${x === d ? 'cur' : ''}">${esc(w.get(x.personId).name)}</span>`).join(' → ')}</div>` : '';
    const who = p === w.playerHead() ? '当主であるあなた' : `${esc(p.name)}（${w.age(p)}歳・${p.sex === 'M' ? '男' : '女'}）`;
    return `<div class="decision">
      ${steps}<div class="decision-head">${portraitSVG(w, p, 56)}<div><div class="eyebrow">💍 ${d.proposal ? '縁談の申し込み' : '縁談'}</div><h2>${d.proposal ? `${esc(w.dyn(w.get(d.candidateIds[0]))?.name ?? '')}家から、${who}に縁談の申し込みが来ました` : `${who}の結婚相手を選んでください`}</h2>
      <p class="small muted">相手の家が受けてくれそうな候補です。見た目の能力は育ちも込み。子に伝わるのは🧬素質のほうです。よその家の人の素質と隠れた病の遺伝子は、鑑定するまでわかりません（いまの家格 ${Math.round(w.playerDynasty()?.prestige ?? 0)}）。</p>${this._goalHint(w)}</div></div>
      <div class="cands">${cards.join('') || '<p class="small">ふさわしい相手が見つかりません。</p>'}</div>
      ${cards.filter((c) => c.includes(' hidden>')).length ? `<p><button type="button" class="small" data-more="${d.id}">ほかの候補も見る（あと ${cards.filter((c) => c.includes(' hidden>')).length} 人）</button></p>` : ''}
      <p class="choices">${d.proposal ? `<button type="button" data-id="${d.id}" data-choice="later">お断りする</button>` : `<button type="button" data-id="${d.id}" data-choice="lowborn">平民の出の相手を迎える</button><button type="button" data-id="${d.id}" data-choice="later">${(p.mAsks ?? 0) >= 2 ? '見送る（次は人物欄の「縁談を探す」から）' : '今は見送る（5 年後にまた）'}</button><button type="button" class="small" data-id="${d.id}" data-choice="never" title="この人には、人物欄の「縁談を探す」を押すまで縁談を出しません">もう縁談は探さない</button>`}</p>
    </div>`;
  }

  // ───────── 養育先 ─────────

  _foster(w, d) {
    const p = w.get(d.personId);
    const apt = APTITUDES.map((a) => {
      const v = w.aptitude(p, a.trait);
      return `${a.label} ＋${v.plus}/${v.copies}`;
    }).join('・');
    const pts = (g) =>
      w
        .fosterPoints(g)
        .map(([t, v]) => `<span class="${v > 0 ? (t === 'ambition' ? '' : 'good') : t === 'ambition' ? 'good' : 'bad'}">${TRAIT_LABEL[t]} ${v > 0 ? '+' : '−'}${Math.abs(v)}</span>`)
        .join('・');
    const opts = d.options
      .map((o) => {
        const t = o.tutorId != null ? w.get(o.tutorId) : null;
        const td = t ? w.dyn(t) : null;
        return `<button type="button" class="opt foster-opt" data-id="${d.id}" data-choice="${o.key}">
          <span class="foster-head">${t ? portraitSVG(w, t, 40) : ''}<span><b>${o.icon} ${esc(o.label)}</b>${t ? `<span class="small">後見人：${esc(t.regnal ?? t.name)}${td ? `（${esc(td.name)}家）` : ''}・${w.age(t)}歳<br>指揮 ${Math.round(w.martial(t))}・知略 ${Math.round(t.pheno.intellect)}・カリスマ ${Math.round(t.pheno.charisma)}・慈愛 ${Math.round(t.pheno.kindness)}・野心 ${Math.round(t.pheno.ambition)}</span>` : ''}</span></span>
          <span class="small">育ちの見込み：${pts(o.gains) || 'ほとんど変わらない'}</span>
          <span class="small muted">${esc(o.side)}</span></button>`;
      })
      .join('');
    return `<div class="decision">
      <div class="decision-head">${portraitSVG(w, p, 56)}<div><div class="eyebrow">🏡 養育先</div><h2>${w.houseHeir(w.playerDynasty()) === p ? "跡継ぎの " : ""}${esc(p.name)}（6歳）を、どこで育てますか？</h2>
      <p class="small muted">子は後見人の得意から学び、気性も後見人に似ます。16 歳で成人すると、育ちの結果が報せで届きます。子に伝わるのは生まれ持った素質（${esc(apt)}）のほうで、育ちは伝わりません。</p>${this._goalHint(w)}</div></div>
      <div class="opts">${opts}</div>
      ${(d.missing ?? []).length ? `<p class="small muted">いまは選べない養育先：${esc(d.missing.join('、'))}</p>` : ''}
      ${!d.main ? `<p class="choices"><button type="button" class="small" data-id="${d.id}" data-choice="autohome" title="跡継ぎと、当主・跡継ぎの長子だけカードを出し、ほかの子は家で育てます">この子は家で育て、これから跡継ぎ以外は自動で家で育てる</button></p>` : ''}
    </div>`;
  }

  // ───────── 教育 ─────────

  _education(w, d) {
    const p = w.get(d.personId);
    const opts = Object.entries(EDUCATION)
      .map(([key, e]) => {
        const gain = Object.entries(e.env)
          .map(([k, v]) => `${{ strength: '体の強さ', intellect: '知略', charisma: 'カリスマ', beauty: '容姿', kindness: '慈愛', ambition: '野心' }[k]} ${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * (k === 'kindness' || k === 'ambition' ? 12 : k === 'intellect' ? 9 : 8))}`)
          .join('・');
        return `<button type="button" class="opt" data-id="${d.id}" data-choice="${key}"><b>${e.label}</b><span class="small">${e.desc}</span><span class="small good">${gain} くらい</span></button>`;
      })
      .join('');
    const heir = [...w.kingdoms].some((k) => k.heirId === p.id);
    return `<div class="decision">
      <div class="decision-head">${portraitSVG(w, p, 56)}<div><div class="eyebrow">📚 教育</div><h2>${esc(p.name)}（6歳）に何を学ばせますか？</h2>
      <p class="small muted">${heir ? '王位の継承者です。' : ''}生まれ持った遺伝子に、育ちが上乗せされます。いまの素質：知略 ${Math.round(p.pheno.intellect)}・体の強さ ${Math.round(p.pheno.strength)}・カリスマ ${Math.round(p.pheno.charisma)}・慈愛 ${Math.round(p.pheno.kindness)}</p></div></div>
      <div class="opts">${opts}</div>
    </div>`;
  }

  // ───────── 恩賞 ─────────

  _grant(w, d) {
    const k = w.kingdoms[d.kingdomId];
    const pr = w.provinces[d.provinceId];
    const rows = d.candidateDynIds
      .map((id) => w.dynasties[id])
      .filter((v) => !v.extinct)
      .map((v) => {
        const h = w.head(v);
        const o = Math.round(v.opinion ?? 0);
        const same = w.countiesOf(v.id).some((c) => c.duchyId === pr.duchyId);
        return `<div class="cand">${h ? portraitSVG(w, h, 48) : ''}<div class="cand-body"><div><b>${esc(v.name)}家</b> <span class="small muted">${h ? esc(h.name) : ''}・${esc(w.houseTitle(v) ?? '無領')}</span></div>
          <div class="small">忠誠 <span class="opinion ${o >= 10 ? 'pos' : o <= -10 ? 'neg' : ''}">${o > 0 ? '+' : ''}${o}</span>・所領 ${w.countiesOf(v.id).length}${same ? '・<span class="bad">同じ公爵領に土地がある（公爵になるかも）</span>' : ''}</div></div>
          <button type="button" class="primary" data-id="${d.id}" data-choice="${v.id}">与える</button></div>`;
      })
      .join('');
    return `<div class="decision">
      <div class="eyebrow">🏰 恩賞</div><h2>${d.byHand ? `${esc(pr.name)}伯領を誰に与えますか？` : `${kingdomLink(k)}の王領が多すぎます。${esc(pr.name)}伯領を誰に与えますか？`}</h2>
      <p class="small muted">王が直轄できるのは ${w.demesneLimit(k)} つまで（統治の力しだい）。土地を与えた家の忠誠は上がりますが、大きくなりすぎた家は危険です。</p>
      <div class="cands">${rows}</div>
      <p class="choices"><button type="button" data-id="${d.id}" data-choice="knight">騎士を取り立てて新しい伯爵家にする</button><button type="button" data-id="${d.id}" data-choice="keep">${d.byHand ? 'やめる' : '手放さない（諸侯は少し不満）'}</button></p>
    </div>`;
  }

  // ───────── 派閥の誘い ─────────

  _faction(w, d) {
    const k = w.kingdoms[d.kingdomId];
    const leader = w.get(d.leaderId);
    const members = d.memberIds.map((id) => w.dynasties[id]).filter(Boolean);
    const odds = w.rebelOdds(k);
    return `<div class="decision">
      <div class="eyebrow">🗡️ 派閥の誘い</div><h2>${kingdomLink(k)}の不満な諸侯から、${esc(d.label)}に誘われました</h2>
      <p>盟主は ${personLink(w, leader)}。加わっている家：${members.map((m) => esc(m.name)).join('・')}家。</p>
      <p class="small muted">加わると、派閥が十分に強くなったときに反乱が始まり、あなたの家も戦います。勝てば見返りがありますが、負ければ盟主の家は所領を失い、同志も罰を受けます。いまの反乱軍と王の兵力の比：およそ ${Math.round(odds.ratio * 100)}%</p>
      <p class="choices"><button type="button" class="primary" data-id="${d.id}" data-choice="join">加わる</button><button type="button" data-id="${d.id}" data-choice="wait">保留する（3 年後にまた）</button><button type="button" data-id="${d.id}" data-choice="decline">断る</button></p>
      <p class="small muted">断っても罰はありません（8 年ほどは誘われなくなります）。加わったあとも、派閥が立ち上がるまでは何も起きません。</p>
    </div>`;
  }

  // ───────── イベント ─────────

  _event(w, d) {
    const p = w.get(d.personId);
    const icon = { hemo: '🩸', mad: '🌀', plot: '🗡️', appease: '🤝', rumor: '👂', last: '🕯️' }[d.key] ?? '📜';
    return `<div class="decision">
      <div class="decision-head">${p ? portraitSVG(w, p, 64) : ''}<div><div class="eyebrow">${icon} ${esc(d.title)}</div>
      <p class="event-text">${richText(w, d.text)}</p></div></div>
      <div class="opts">${d.options.map((o) => `<button type="button" class="opt" data-id="${d.id}" data-choice="${o.id}"><b>${esc(o.label)}</b><span class="small">${esc(o.desc)}</span></button>`).join('')}</div>
    </div>`;
  }

  _goalHint(w) {
    const g = w.goalProgress();
    return g ? `<p class="small goal-hint">🎯 いまの目標：${esc(g.label)}（${esc(g.text)}）</p>` : '';
  }

  _goal(w, d) {
    const done = w.player.achievements ?? [];
    return `<div class="decision">
      <div class="eyebrow">🎯 家の目標</div><h2>この家の血筋を、何世代かけてどう育てますか？</h2>
      <p class="small muted">縁談の相手の素質と隠れた遺伝子（鑑定でわかる）を見て、目標に近づく相手を選びましょう。達成すると家格 +30。${done.length ? `これまでの達成：${done.map((a) => `${a.icon}${esc(a.label)}（${a.year}年）`).join('、')}` : ''}</p>
      <div class="opts">${d.options.map((o) => `<button type="button" class="opt" data-id="${d.id}" data-choice="${o.key}"><b>${o.icon} ${esc(o.label)}</b><span class="small">${esc(o.now)}</span><span class="small muted">${esc(o.desc)}</span></button>`).join('')}</div>
      <p class="choices"><button type="button" data-id="${d.id}" data-choice="none">目標を決めずに遊ぶ</button></p>
    </div>`;
  }

  // あなたが率いた当主たちの墓碑銘
  _tombs(w, dyn) {
    const heads = (dyn.heads ?? []).map((id) => w.get(id)).filter((p) => p && !p.alive && p.epitaph && p.deathYear >= w.player.startYear);
    if (!heads.length) return '';
    return `<h3>🪦 歴代の当主の墓碑銘</h3><ul class="tombs">${heads.map((p) => `<li><b>${personLink(w, p, { short: true })}${p.epithet ? `「${esc(p.epithet)}」` : ''}</b>（${p.birthYear}〜${p.deathYear}）<div class="small">${richText(w, p.epitaph)}。</div></li>`).join('')}</ul>`;
  }

  _end(w, d) {
    const dyn = w.dynasties[w.player.dynastyId];
    const rulers = w.kingdoms.flatMap((k) => k.rulers.filter((r) => r.dynastyId === dyn.id && r.from >= w.player.startYear).map((r) => `${r.name}${r.epithet ? `「${r.epithet}」` : ''}（${k.name}）`));
    const ach = w.player.achievements ?? [];
    return `<div class="decision">
      <div class="eyebrow">✝️ 終わり</div><h2>${esc(dyn.name)}家は ${w.year} 年に絶えました</h2>
      <p>${d.years} 年のあいだ、歴史を刻みました。最も栄えたときは<b>${esc(d.peak)}</b>でした。</p>
      <dl class="kv">
        <dt>出した君主</dt><dd>${rulers.length ? esc(rulers.join('・')) : 'なし'}</dd>
        <dt>成し遂げた目標</dt><dd>${ach.length ? ach.map((a) => `${a.icon}${esc(a.label)}（${a.year}年）`).join('、') : 'なし'}</dd>
        <dt>最後の家格</dt><dd>${Math.round(dyn.prestige)}</dd>
      </dl>
      ${this._tombs(w, dyn)}
      <p class="choices"><button type="button" class="primary" data-id="${d.id}" data-choice="another">別の家で続ける</button><button type="button" data-id="${d.id}" data-choice="ok">このまま歴史を眺める</button></p>
    </div>`;
  }
}

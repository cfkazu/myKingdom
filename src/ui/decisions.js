// 決断のカード：プレイヤーの家に決断が来たら、時間を止めて選択肢を出す。
// あわせて、はじめに遊ぶ家を選ぶ画面もここで描く。

import { EDUCATION } from '../player.js';
import { HAIR_LABEL, EYE_LABEL } from '../genes.js';
import { kinshipLabel } from '../pedigree.js';
import { portraitSVG } from './portrait.js';
import { esc, personLink, kingdomLink } from './util.js';

const pct = (x, n) => `${Math.round((100 * x) / Math.max(1, n))}%`;

export class DecisionPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-choice]');
      if (b) app.decide(Number(b.dataset.id), b.dataset.choice);
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
    const body = { marriage: () => this._marriage(w, d), education: () => this._education(w, d), grant: () => this._grant(w, d), faction: () => this._faction(w, d), end: () => this._end(w, d) }[d.type]();
    this.el.innerHTML = `${body}${more > 0 ? `<p class="small muted">ほかに ${more} 件の決断が待っています。</p>` : ''}`;
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
    const cards = cands.map((c) => {
      const phi = w.ped.kinship(p.id, c.id);
      const pr = w.matchPreview(p, c);
      const cd = w.dyn(c);
      const ck = w.kingdomOf(c);
      const royal = w.royalOf(c);
      const risks = pr
        ? [pr.hemophiliaM ? `息子の血友病 ${pct(pr.hemophiliaM, pr.males)}` : null, pr.jaw ? `受け口 ${pct(pr.jaw, pr.born)}` : null, pr.madness ? `狂気 ${pct(pr.madness, pr.born)}` : null, pr.load ? `虚弱 ${pct(pr.load, pr.born)}` : null, pr.lethal ? `死産 ${pct(pr.lethal, pr.n)}` : null].filter(Boolean)
        : [];
      const perks = [];
      if (c.rulerOf != null) perks.push(`${w.kingdoms[c.rulerOf].name}の君主`);
      else if (royal) perks.push(`${royal.name}の王族（同盟）`);
      if (c.gentry) perks.push('騎士の家の出（家格は低いが、新しい血を入れられる）');
      if (w.isHeirAnywhere(c)) perks.push('王位継承者');
      if (cd && w.houseTitle(cd)) perks.push(w.houseTitle(cd));
      return `<div class="cand">
        ${portraitSVG(w, c, 64)}
        <div class="cand-body">
          <div><b>${personLink(w, c)}</b> <span class="small muted">${w.age(c)}歳${ck ? `・${esc(ck.name)}` : ''}</span></div>
          <div class="small">${ck && ck.id !== p.kingdomId ? `<span class="muted">外国（${esc(ck.name)}）・</span>` : ''}${perks.length ? `<span class="good">${esc(perks.join('・'))}</span>・` : ''}魅力 ${Math.round(w.charm(c))}・知略 ${Math.round(c.pheno.intellect)}・${HAIR_LABEL[c.pheno.hair]}・${EYE_LABEL[c.pheno.eye]}</div>
          <div class="small">${phi > 0.001 ? `<span class="${phi >= 0.05 ? 'bad' : ''}">血縁：${kinshipLabel(phi)}（子の近交係数 ${phi.toFixed(3)}）</span>` : '血縁なし'}${risks.length ? `・<span class="bad">子の心配：${risks.join('、')}</span>` : '・子の遺伝病の心配はほぼない'}</div>
        </div>
        <button type="button" class="primary" data-id="${d.id}" data-choice="${c.id}">この人と</button>
      </div>`;
    });
    const who = p === w.playerHead() ? '当主であるあなた' : `${esc(p.name)}（${w.age(p)}歳・${p.sex === 'M' ? '男' : '女'}）`;
    return `<div class="decision">
      <div class="decision-head">${portraitSVG(w, p, 56)}<div><div class="eyebrow">💍 縁談</div><h2>${who}の結婚相手を選んでください</h2>
      <p class="small muted">相手の家が受けてくれそうな候補です。魅力と家格、同盟、そして生まれる子の遺伝子も考えましょう。</p></div></div>
      <div class="cands">${cards.join('') || '<p class="small">ふさわしい相手が見つかりません。</p>'}</div>
      <p class="choices"><button type="button" data-id="${d.id}" data-choice="lowborn">平民の出の相手を迎える</button><button type="button" data-id="${d.id}" data-choice="later">今は見送る（数年後にまた）</button></p>
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
      <div class="eyebrow">🏰 恩賞</div><h2>${kingdomLink(k)}の王領が多すぎます。${esc(pr.name)}伯領を誰に与えますか？</h2>
      <p class="small muted">王が直轄できるのは ${w.demesneLimit(k)} つまで（統治の力しだい）。土地を与えた家の忠誠は上がりますが、大きくなりすぎた家は危険です。</p>
      <div class="cands">${rows}</div>
      <p class="choices"><button type="button" data-id="${d.id}" data-choice="knight">騎士を取り立てて新しい伯爵家にする</button><button type="button" data-id="${d.id}" data-choice="keep">手放さない（諸侯は少し不満）</button></p>
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
      <p class="choices"><button type="button" class="primary" data-id="${d.id}" data-choice="join">加わる</button><button type="button" data-id="${d.id}" data-choice="decline">断る</button></p>
    </div>`;
  }

  _end(w, d) {
    return `<div class="decision">
      <div class="eyebrow">✝️ 終わり</div><h2>あなたの家は絶えました</h2>
      <p>${d.years} 年のあいだ、歴史を刻みました。最も栄えたときは<b>${esc(d.peak)}</b>でした。</p>
      <p class="choices"><button type="button" class="primary" data-id="${d.id}" data-choice="ok">このまま歴史を眺める</button></p>
    </div>`;
  }
}

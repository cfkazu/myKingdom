// 人物パネル：肖像・称号・能力・遺伝子・家族。📌 で固定した人との「縁談」の相性と子の予測。

import { LOCI, TRAITS, genotypeString, locusEffect, isCarrier, predictOffspring, HAIR_LABEL, EYE_LABEL, allelesAt } from '../genes.js';
import { createRng } from '../rng.js';
import { kinshipLabel } from '../pedigree.js';
import { portraitSVG } from './portrait.js';
import { APTITUDES, EXAMINE_COST } from '../goals.js';
import { esc, personLink, kingdomLink, lifeSpan } from './util.js';

const bar = (label, v, cls = '', hint = '') => `<span title="${hint}">${label}</span><div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div><span class="v">${Math.round(v)}</span>`;

export class PersonPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'pin') app.pin(Number(b.dataset.id));
      if (b.dataset.act === 'unpin') app.pin(null);
      if (b.dataset.act === 'tree') app.showTab('family');
      if (b.dataset.act === 'follow') app.follow(Number(b.dataset.id));
      if (b.dataset.act === 'examine') app.examine(Number(b.dataset.id));
    });
  }

  render() {
    const w = this.app.world;
    const p = this.app.selectedPerson != null ? w.get(this.app.selectedPerson) : null;
    if (!p) {
      this.el.innerHTML = `<p class="muted">年代記の名前か、王国タブの君主をクリックすると、その人の姿・遺伝子・家族が見られます。</p>`;
      return;
    }
    const ph = p.pheno;
    const d = w.dyn(p);
    const k = w.kingdomOf(p);
    const title = w.titleOf(p);
    const badges = [];
    if (ph.hemophilia) badges.push('<span class="badge bad">血友病</span>');
    if (ph.jaw) badges.push('<span class="badge bad">受け口の顎</span>');
    if (p.mad) badges.push('<span class="badge bad">狂気</span>');
    else if (ph.madness) badges.push('<span class="badge gene" title="まだ発症していない">狂気の素質（未発症）</span>');
    if (ph.load > 0) badges.push(`<span class="badge bad">虚弱（有害因子 ${ph.load} つ）</span>`);
    if (ph.colorblind) badges.push('<span class="badge">色覚の違い</span>');
    if (ph.resistance > 0.8) badges.push('<span class="badge good">疫病に強い</span>');
    if (ph.intellect >= 80) badges.push('<span class="badge good">天才</span>');
    if (ph.beauty >= 80) badges.push('<span class="badge good">美貌</span>');
    if (ph.strength >= 80) badges.push('<span class="badge good">剛勇</span>');
    if (ph.charisma >= 80) badges.push('<span class="badge good">カリスマ</span>');
    if (p.F >= 0.05) badges.push(`<span class="badge gene">近親婚の子（F=${p.F.toFixed(3)}）</span>`);
    const carriers = !p.genome || !w.knowsGenes(p) ? [] : ['HEM', 'JAW', 'MAD', 'LET', 'DEL1', 'DEL2', 'DEL3', 'DEL4'].filter((key) => isCarrier(p.genome, key));
    if (carriers.length) badges.push(`<span class="badge gene" title="本人は健康だが子に伝えうる">保因者：${carriers.map((key) => LOCI.find((l) => l.key === key).name).join('・')}</span>`);

    const father = w.get(p.fatherId);
    const mother = w.get(p.motherId);
    const spouses = p.spouses.map((s) => `${personLink(w, w.get(s.id))}（${s.year}年${s.matrilineal ? '・女系婚' : ''}）`);
    const kids = p.children.map((id) => w.get(id)).map((c) => personLink(w, c, { short: true }));
    const claims = p.claims.map((id) => kingdomLink(w.kingdoms[id]));
    const reign = p.rulerOfEver != null ? w.kingdoms[p.rulerOfEver].rulers.find((r) => r.id === p.id) : null;

    const pinned = this.app.pinned != null ? w.get(this.app.pinned) : null;
    const open = this.el.querySelector('details')?.open ?? false;
    let banner = '';
    if (!p.alive) {
      const succ = p.rulerOfEver != null ? w.ruler(w.kingdoms[p.rulerOfEver]) : null;
      banner = `<div class="dead-banner">この人は ${p.deathYear} 年に亡くなりました（${esc(p.cause)}）。${succ ? `いまの${esc(w.kingdoms[p.rulerOfEver].name)}の君主は ${personLink(w, succ)}。` : ''}</div>`;
    }
    this.el.innerHTML = `${banner}
      <div class="person-head">
        ${portraitSVG(w, p)}
        <div>
          <p class="person-name">${esc(w.displayName(p))}</p>
          ${title ? `<div class="person-title">${esc(title)}</div>` : ''}
          <div class="person-meta">${p.sex === 'M' ? '男性' : '女性'}・${lifeSpan(w, p)}</div>
          <div class="person-meta">${d ? `<a class="plink" data-did="${d.id}">${esc(d.name)}家</a>` : '平民の出'}${k ? `・${kingdomLink(k)}在住` : ''}</div>
          <div class="person-meta">${HAIR_LABEL[ph.hair]}・${EYE_LABEL[ph.eye]}・身長 ${Math.round(ph.height)}cm</div>
          <div class="badges">${badges.join('')}</div>
        </div>
      </div>
      <div class="bars">
        ${bar('魅力', w.charm(p), 'skill', '容姿・カリスマ・健康・若さ。高いほど良い縁談がまとまりやすい')}
        ${bar('指揮', w.martial(p), 'skill', '体の強さ・知略・カリスマ・身長から。高いほど戦に勝ちやすく、戦死しにくい')}
        ${bar('統治', w.stewardship(p), 'skill', '知略・カリスマ・慈愛から。王なら兵が集まり、直轄できる土地が増え、諸侯の忠誠も上がる')}
        ${bar('容姿', ph.beauty, '', '遺伝子（4 座）と育ち。魅力のもと。受け口の顎や虚弱で下がる')}
        ${bar('知略', ph.intellect, '', '遺伝子（4 座）と育ち。統治と指揮のもと')}
        ${bar('体の強さ', ph.strength, '', '遺伝子（3 座）と育ち。指揮のもと')}
        ${bar('カリスマ', ph.charisma, '', '遺伝子（3 座）と育ち。魅力・統治・諸侯の忠誠に効く')}
        ${bar('野心', ph.ambition, '', '高い王は戦争を起こし、高い諸侯は反乱を起こし、高い継承者は王を暗殺することも')}
        ${bar('慈愛', ph.kindness, '', '高い王は戦争を好まず、低い王は諸侯から土地を取り上げることがある')}
      </div>
      <h3>家族</h3>
      <dl class="kv">
        <dt>父</dt><dd>${personLink(w, father)}</dd>
        <dt>母</dt><dd>${personLink(w, mother)}</dd>
        <dt>配偶者</dt><dd>${spouses.length ? spouses.join('<br>') : '<span class="muted">なし</span>'}</dd>
        <dt>子（${kids.length}）</dt><dd class="chips">${kids.length ? kids.join('') : '<span class="muted">なし</span>'}</dd>
        ${claims.length ? `<dt>請求権</dt><dd>${claims.join('・')}</dd>` : ''}
        ${this._fiefs(w, p)}
        ${reign ? `<dt>治世</dt><dd>${reign.from}〜${reign.to ?? ''}年（${{ inherit: '世襲', elected: '選挙', conquest: '征服', usurp: '簒奪', independence: '独立', init: '世襲' }[reign.how]}）${reign.warsWon || reign.warsLost ? `・戦勝 ${reign.warsWon} / 敗戦 ${reign.warsLost}` : ''}</dd>` : ''}
        <dt>多産さ</dt><dd>${ph.fertility.toFixed(2)} 倍</dd>
        <dt>寿命の素質</dt><dd>${ph.longevity >= 0 ? '+' : ''}${ph.longevity.toFixed(0)} 年</dd>
      </dl>
      <p><button type="button" data-act="tree">🌳 家系図を見る</button>
      ${w.dyn(p) && this.app.followDynasty !== p.dynastyId ? `<button type="button" data-act="follow" data-id="${p.dynastyId}" title="この家の当主を追いかけます。当主が亡くなると次の当主に切り替わり、年代記もこの家の出来事に絞れます">📌 ${esc(w.dyn(p).name)}家を追う</button>` : ''}
      ${pinned && pinned.id === p.id ? '<button type="button" data-act="unpin">💍 縁談占いをやめる</button>' : `<button type="button" data-act="pin" data-id="${p.id}" title="この人を固定してから別の人を選ぶと、ふたりの縁談の相性と子の予測が見られます">💍 この人の縁談を占う</button>`}</p>
      ${this._match(w, pinned, p)}
      ${this._aptitude(w, p)}
      ${
        p.genome && w.knowsGenes(p)
          ? `<details>
        <summary>🧬 遺伝子をくわしく見る（${LOCI.length} 個の遺伝子）</summary>
        ${this._genotype(p)}
      </details>`
          : p.genome
            ? ''
            : '<p class="small muted">遠い昔の人なので、遺伝子型の記録は残っていません（姿と能力の記録だけが残る）。</p>'
      }
    `;
    if (open && this.el.querySelector('details')) this.el.querySelector('details').open = true;
  }

  // 当主なら、持っている爵位・所領と、王への忠誠
  _fiefs(w, p) {
    const d = w.dyn(p);
    if (!p.alive || !d || w.head(d) !== p || p.rulerOf != null) return '';
    const counties = w.countiesOf(d.id);
    const duchies = w.duchies.filter((du) => w.duchyHolderDyn(du) === d.id);
    const k = w.kingdoms[d.kingdomId];
    const liege = k && k.alive ? w.ruler(k) : null;
    const o = Math.round(d.opinion ?? 0);
    const parts = k && k.alive ? w.opinionOf(d, k).parts : [];
    return `<dt>所領</dt><dd>${counties.length ? `${duchies.map((du) => `${esc(du.name)}公領`).concat(counties.map((pr) => `${esc(pr.name)}伯領`)).join('・')}` : '<span class="muted">なし（宮廷に仕える無領の家）</span>'}</dd>
      ${liege ? `<dt>主君</dt><dd>${personLink(w, liege)}</dd>
      <dt>忠誠</dt><dd><span class="opinion ${o >= 10 ? 'pos' : o <= -10 ? 'neg' : ''}">${o > 0 ? '+' : ''}${o}</span><div class="small muted">${parts.map(([v, t]) => `${esc(t)} ${v > 0 ? '+' : ''}${v}`).join('、')}</div></dd>` : ''}`;
  }

  // 素質：子に伝わる遺伝子の「＋」の数。よその家の人は鑑定するまでわからない
  _aptitude(w, p) {
    if (!p.genome) return '';
    if (!w.knowsGenes(p)) {
      return `<div class="apt-box small"><b>🧬 素質</b>：よその家の人の遺伝子は、鑑定するまでわかりません。<button type="button" data-act="examine" data-id="${p.id}">🔍 鑑定する（家格 −${EXAMINE_COST}）</button></div>`;
    }
    const rows = APTITUDES.map((a) => {
      const v = w.aptitude(p, a.trait);
      return `<span>${a.label}</span><div class="bar apt-bar"><i style="width:${Math.round(v.value * 100)}%"></i></div><span class="v">＋${v.plus}/${v.copies}</span>`;
    }).join('');
    const carr = w.carriers(p).map((k) => LOCI.find((l) => l.key === k).name);
    return `<h3>🧬 素質（子に伝わる遺伝子）</h3><div class="bars">${rows}</div>
      <p class="small muted">上の能力は育ちも込みの見た目の値。子に伝わるのは、この「＋」の数です。${carr.length ? `<span class="bad">保因者：${esc(carr.join('・'))}</span>` : '隠れた病の遺伝子はない。'}</p>`;
  }

  _match(w, a, b) {
    if (!a || a.id === b.id || !a.genome || !b.genome) return '';
    if (a.sex === b.sex) return `<div class="pinbox">💍 ${personLink(w, a)} の縁談を占っています。異性を選ぶと、ふたりの相性と生まれる子の予測が出ます。</div>`;
    const [mom, dad] = a.sex === 'F' ? [a, b] : [b, a];
    const phi = w.ped.kinship(a.id, b.id);
    if (!w.knowsGenes(a) || !w.knowsGenes(b)) return `<div class="pinbox">💍 ${personLink(w, a)} × ${personLink(w, b)}：よその家の人の遺伝子は、鑑定するまでわかりません。人物の「🔍 鑑定する」で調べると、生まれる子の予測が出ます。</div>`;
    const pred = predictOffspring(mom.genome, dad.genome, createRng(`${mom.id}x${dad.id}`), 1500);
    const pct = (x, n = pred.born) => `${Math.round((100 * x) / Math.max(1, n))}%`;
    const sa = w.spouseScore(a, b, phi);
    const sb = w.spouseScore(b, a, phi);
    const view = (s) => (s === -Infinity ? '禁じられた近親' : Math.round(s));
    const hair = Object.entries(pred.hair).map(([h, n]) => `${HAIR_LABEL[h]} ${pct(n)}`).join('・');
    const eye = Object.entries(pred.eye).map(([e, n]) => `${EYE_LABEL[e]} ${pct(n)}`).join('・');
    return `<div class="pinbox">
      <b>💍 縁談：${personLink(w, a)} × ${personLink(w, b)}</b>
      <div class="row"><span>血縁</span><span>${kinshipLabel(phi)}（血縁係数 ${phi.toFixed(3)}＝子の近交係数）</span></div>
      <div class="row"><span>${esc(a.name)}側の評価</span><span>${view(sa)}</span></div>
      <div class="row"><span>${esc(b.name)}側の評価</span><span>${view(sb)}</span></div>
      <div class="small muted">評価は魅力・家格・同盟の値打ち・年齢・血縁から計算され、ふたりの低い方が 18 を超えると縁談がまとまりやすい。</div>
      <h3>子の予測（${pred.n} 回の減数分裂シミュレーション）</h3>
      <div class="row"><span>流産・死産（致死因子）</span><span>${pct(pred.lethal, pred.n)}</span></div>
      <div class="row"><span>息子が血友病</span><span>${pct(pred.hemophiliaM, pred.males)}</span></div>
      <div class="row"><span>受け口の顎</span><span>${pct(pred.jaw)}</span></div>
      <div class="row"><span>狂気の素質</span><span>${pct(pred.madness)}</span></div>
      <div class="row"><span>虚弱（有害因子のホモ）</span><span>${pct(pred.load)}</span></div>
      <div class="small">${hair}<br>${eye}</div>
    </div>`;
  }

  _genotype(p) {
    const ph = p.pheno;
    const rows = LOCI.filter((l) => l.mode !== 'polygenic').map(
      (l) => `<tr><td>${esc(l.name)}</td><td>${l.chr}・${l.pos}cM</td><td><code>${genotypeString(p.genome, l.key)}</code></td><td>${esc(locusEffect(l.key, p.genome, ph))}</td></tr>`,
    );
    const poly = Object.entries(TRAITS).map(([t, info]) => {
      const loci = LOCI.filter((l) => l.trait === t);
      let plus = 0;
      let n = 0;
      for (const l of loci) for (const a of allelesAt(p.genome, l.key)) {
        n++;
        if (a === '+') plus++;
      }
      return `<tr><td>${info.label}</td><td>${loci.length} 座</td><td><code>${loci.map((l) => genotypeString(p.genome, l.key).replace('/', '')).join(' ')}</code></td><td>＋${plus}/${n}</td></tr>`;
    });
    return `<table class="geno"><thead><tr><th>遺伝子</th><th>位置</th><th>型</th><th>効果</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      <h3>量的形質（ポリジーン）</h3>
      <table class="geno"><thead><tr><th>形質</th><th>座</th><th>型</th><th>＋の数</th></tr></thead><tbody>${poly.join('')}</tbody></table>
      <p class="small muted">能力値は「＋」の割合に、育ち（環境）のばらつきを足したもの。</p>`;
  }
}

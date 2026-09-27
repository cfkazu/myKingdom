// 人物パネル：肖像・称号・能力・遺伝子・家族。📌 で固定した人との「縁談」の相性と子の予測。

import { LOCI, TRAITS, genotypeString, locusEffect, isCarrier, predictOffspring, HAIR_LABEL, EYE_LABEL, allelesAt } from '../genes.js';
import { createRng } from '../rng.js';
import { kinshipLabel } from '../pedigree.js';
import { portraitSVG } from './portrait.js';
import { esc, personLink, kingdomLink, lifeSpan } from './util.js';

const bar = (label, v, cls = '') => `<span>${label}</span><div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div><span class="v">${Math.round(v)}</span>`;

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
    const carriers = !p.genome ? [] : ['HEM', 'JAW', 'MAD', 'LET', 'DEL1', 'DEL2', 'DEL3', 'DEL4'].filter((key) => isCarrier(p.genome, key));
    if (carriers.length) badges.push(`<span class="badge gene" title="本人は健康だが子に伝えうる">保因者：${carriers.map((key) => LOCI.find((l) => l.key === key).name).join('・')}</span>`);

    const father = w.get(p.fatherId);
    const mother = w.get(p.motherId);
    const spouses = p.spouses.map((s) => `${personLink(w, w.get(s.id))}（${s.year}年${s.matrilineal ? '・女系婚' : ''}）`);
    const kids = p.children.map((id) => w.get(id)).map((c) => personLink(w, c, { short: true }));
    const claims = p.claims.map((id) => kingdomLink(w.kingdoms[id]));
    const reign = p.rulerOfEver != null ? w.kingdoms[p.rulerOfEver].rulers.find((r) => r.id === p.id) : null;

    const pinned = this.app.pinned != null ? w.get(this.app.pinned) : null;
    const open = this.el.querySelector('details')?.open ?? false;
    this.el.innerHTML = `
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
        ${bar('魅力', w.charm(p), 'skill')}
        ${bar('武勇（将）', w.martial(p), 'skill')}
        ${bar('統治', w.stewardship(p), 'skill')}
        ${bar('容姿', ph.beauty)}
        ${bar('知略', ph.intellect)}
        ${bar('武勇（体）', ph.strength)}
        ${bar('カリスマ', ph.charisma)}
        ${bar('野心', ph.ambition)}
        ${bar('慈愛', ph.kindness)}
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
      ${pinned && pinned.id === p.id ? '<button type="button" data-act="unpin">📌 固定を外す</button>' : `<button type="button" data-act="pin" data-id="${p.id}" title="この人を固定してから別の人を選ぶと、ふたりの縁談の相性と子の予測が見られます">📌 縁談の相手として固定</button>`}</p>
      ${this._match(w, pinned, p)}
      ${
        p.genome
          ? `<details>
        <summary>遺伝子型（${LOCI.length} 座）</summary>
        ${this._genotype(p)}
      </details>`
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

  _match(w, a, b) {
    if (!a || a.id === b.id || !a.genome || !b.genome) return '';
    if (a.sex === b.sex) return `<div class="pinbox">📌 ${personLink(w, a)} を固定中。異性を選ぶと縁談の相性が見られます。</div>`;
    const [mom, dad] = a.sex === 'F' ? [a, b] : [b, a];
    const phi = w.ped.kinship(a.id, b.id);
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

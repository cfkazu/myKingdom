// 家系図：本人から曾祖父母まで（4 世代）と、配偶者・子。
// 同じ祖先が何度も現れる（近親婚のしるし＝祖先の重複）ときは、同じ色の枠で囲む。

import { esc, personLink } from './util.js';

const DUP_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324'];

export class FamilyTree {
  constructor(el, app) {
    this.el = el;
    this.app = app;
  }

  render() {
    const w = this.app.world;
    const p = this.app.selectedPerson != null ? w.get(this.app.selectedPerson) : null;
    if (!p) {
      this.el.innerHTML = '<p class="muted">人物を選ぶと家系図が出ます。</p>';
      return;
    }
    // 世代ごとの祖先（なければ null）
    const gens = [[p]];
    for (let g = 1; g < 4; g++) {
      const prev = gens[g - 1];
      const cur = [];
      for (const x of prev) {
        cur.push(x ? w.get(x.fatherId) ?? null : null);
        cur.push(x ? w.get(x.motherId) ?? null : null);
      }
      gens.push(cur);
    }
    const count = new Map();
    for (const g of gens.slice(1)) for (const x of g) if (x) count.set(x.id, (count.get(x.id) ?? 0) + 1);
    const dupColor = new Map();
    for (const [id, n] of count) if (n > 1) dupColor.set(id, DUP_COLORS[dupColor.size % DUP_COLORS.length]);

    const node = (x, self = false) => {
      if (!x) return '<div class="tnode empty"><div class="n">不明</div></div>';
      const d = w.dyn(x);
      const dup = dupColor.get(x.id);
      const title = x.rulerOfEver != null ? `👑 ${w.kingdoms[x.rulerOfEver].name}` : d ? `${d.name}家` : '平民の出';
      return `<div class="tnode${self ? ' self' : ''}${dup ? ' dup' : ''}" data-pid="${x.id}" style="--dyn:${d ? d.color : 'var(--border)'};${dup ? `--dupc:${dup}` : ''}" title="${esc(w.displayName(x))}">
        <div class="n">${esc(x.regnal ?? x.name)}${x.alive ? '' : '†'}</div>
        <div class="s">${esc(title)}・${x.birthYear}${x.alive ? '' : `〜${x.deathYear}`}</div>
      </div>`;
    };
    const heads = ['本人', '父母', '祖父母', '曾祖父母'];
    const cols = gens.map((g, i) => `<div><h4 class="tree-h">${heads[i]}</h4><div class="tree-col">${g.map((x) => node(x, i === 0)).join('')}</div></div>`);
    const kids = p.children.map((id) => w.get(id));
    const dupNote = dupColor.size
      ? `<p class="small">同じ色の枠の人は、家系図に何度も現れる祖先です（${dupColor.size} 人）。近親婚で祖先の数が減ることを「祖先の重複」といいます。この人の近交係数 F = ${p.F.toFixed(3)}。</p>`
      : `<p class="small muted">曾祖父母までに重複する祖先はいません。近交係数 F = ${p.F.toFixed(3)}。</p>`;
    this.el.innerHTML = `
      <h2>${personLink(w, p)} の家系図</h2>
      <div class="tree">${cols.join('')}</div>
      ${dupNote}
      <h3>配偶者</h3>
      <div class="kids">${p.spouses.map((s) => node(w.get(s.id))).join('') || '<span class="muted small">なし</span>'}</div>
      <h3>子（${kids.length}）</h3>
      <div class="kids">${kids.map((c) => node(c)).join('') || '<span class="muted small">なし</span>'}</div>
      ${this._grandkids(w, kids)}
    `;
  }

  _grandkids(w, kids) {
    const gk = kids.flatMap((c) => c.children.map((id) => w.get(id)));
    if (!gk.length) return '';
    return `<h3>孫（${gk.length}）</h3><div class="chips small">${gk.map((g) => personLink(w, g, { short: true })).join('')}</div>`;
  }
}

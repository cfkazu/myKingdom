// 宮廷：選んだ王国の王家の人々を肖像で並べる（王・配偶者・継承者・王子女・きょうだい）。

import { portraitSVG } from './portrait.js';
import { esc, kingdomLink } from './util.js';

export class Court {
  constructor(el, app) {
    this.el = el;
    this.app = app;
  }

  kingdom() {
    const w = this.app.world;
    const sel = this.app.selectedKingdom != null ? w.kingdoms[this.app.selectedKingdom] : null;
    if (sel && sel.alive) return sel;
    const p = this.app.selectedPerson != null ? w.get(this.app.selectedPerson) : null;
    const pk = p && p.alive ? w.kingdomOf(p) : null;
    if (pk && pk.alive) return pk;
    return w.aliveKingdoms().reduce((a, b) => (w.provincesOf(a).length >= w.provincesOf(b).length ? a : b));
  }

  render() {
    const w = this.app.world;
    const k = this.kingdom();
    const r = w.ruler(k);
    if (!r) {
      this.el.innerHTML = '';
      return;
    }
    const people = [];
    const add = (p, role) => {
      if (p && p.alive && !people.some((x) => x.p === p)) people.push({ p, role });
    };
    add(r, r.sex === 'M' ? '王' : '女王');
    const sp = r.spouseId != null ? w.get(r.spouseId) : null;
    add(sp, sp ? (sp.sex === 'F' ? '王妃' : '王配') : '');
    const heir = w.heirOf(k);
    if (heir) add(heir, heir.sex === 'M' ? '王太子' : '王太女');
    if (k.regentId != null) add(w.get(k.regentId), '摂政');
    for (const id of r.children) {
      const c = w.get(id);
      add(c, c.sex === 'M' ? '王子' : '王女');
    }
    for (const id of [r.fatherId, r.motherId]) add(w.get(id), id === r.fatherId ? '王の父' : '王の母');
    const par = w.get(r.fatherId) ?? w.get(r.motherId);
    if (par) for (const id of par.children) {
      const s = w.get(id);
      if (s !== r) add(s, s.sex === 'M' ? '王弟・王兄' : '王妹・王姉');
    }
    for (const id of r.children) {
      const c = w.get(id);
      for (const gid of c.children) add(w.get(gid), '王孫');
    }
    const shown = people.slice(0, 12);
    const sel = this.app.selectedPerson;
    this.el.innerHTML = `
      <div class="court-head"><h2>${kingdomLink(k)}の宮廷</h2><span class="small muted">${shown.length} 人・${esc(w.dyn(r)?.name ?? '')}朝</span></div>
      <div class="court-row">
        ${shown
          .map(
            ({ p, role }) => `<button type="button" class="courtier${p.id === sel ? ' sel' : ''}${p === r ? ' ruler' : ''}" data-pid="${p.id}">
              ${portraitSVG(w, p, p === r ? 72 : 58)}
              <span class="c-role">${esc(role)}</span>
              <span class="c-name">${esc(p.regnal ?? p.name)}</span>
              <span class="c-age">${w.age(p)}歳${p.pheno.hemophilia ? '・血友病' : ''}${p.mad ? '・狂気' : ''}</span>
            </button>`,
          )
          .join('')}
      </div>`;
  }
}

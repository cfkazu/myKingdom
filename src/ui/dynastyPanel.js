// 家パネル：家の一覧（家格順）と、選んだ家の人々・君主・遺伝の傾向。

import { isCarrier } from '../genes.js';
import { esc, personLink, kingdomLink, richText } from './util.js';

export class DynastyPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-follow]');
      if (b) app.follow(Number(b.dataset.follow));
      const pl = e.target.closest('[data-playhouse]');
      if (pl) app.startPlaying(Number(pl.dataset.playhouse));
    });
  }

  render() {
    const w = this.app.world;
    const living = new Map();
    for (const p of w.living) if (p.alive && p.dynastyId != null) living.set(p.dynastyId, (living.get(p.dynastyId) ?? 0) + 1);
    const reigns = new Map();
    for (const k of w.kingdoms) for (const r of k.rulers) reigns.set(r.dynastyId, (reigns.get(r.dynastyId) ?? 0) + 1);
    const list = [...w.dynasties].sort((a, b) => Number(a.extinct) - Number(b.extinct) || b.prestige - a.prestige);
    const sel = this.app.selectedDynasty != null ? w.dynasties[this.app.selectedDynasty] : null;
    const rows = list
      .slice(0, 60)
      .map((d) => {
        const h = d.extinct ? null : w.head(d);
        const ruling = w.aliveKingdoms().filter((k) => w.ruler(k)?.dynastyId === d.id);
        const title = !d.extinct && !ruling.length ? w.houseTitle(d) : null;
        return `<tr class="click${d.extinct ? ' dead' : ''}" data-did="${d.id}"><td><span class="kdot" style="background:${d.color}"></span>${esc(d.name)}家${ruling.length ? ` 👑${ruling.map((k) => esc(k.name)).join('・')}` : ''}${title ? `<div class="small muted">${esc(title)}</div>` : ''}</td>
        <td class="num">${Math.round(d.prestige)}</td><td class="num">${living.get(d.id) ?? 0}</td><td class="num">${reigns.get(d.id) ?? 0}</td>
        <td class="small">${d.foundedYear}〜${d.extinct ? d.extinctYear : ''}${h ? `<br>当主 ${esc(h.name)}` : ''}</td></tr>`;
      })
      .join('');
    this.el.innerHTML = `
      ${sel ? this._detail(w, sel) : '<p class="small muted">家をクリックすると、その家の人々と遺伝の傾向が出ます。</p>'}
      <h3>家の一覧（家格の順）</h3>
      <table class="list"><thead><tr><th>家</th><th class="num" title="家の名声。王位にある・戦に勝つ・王家と縁組すると上がり、年とともに少しずつ下がる。縁談の値打ちや反乱の強さに効く">家格</th><th class="num">存命</th><th class="num">君主</th><th>年代</th></tr></thead><tbody>${rows}</tbody></table>
    `;
  }

  // 因縁の帳簿：この家が恨む家・この家を恨む家・晴らした恨み
  _ledger(w, d) {
    const held = w.grudgesOf(d);
    const seen = new Set();
    const mine = held.filter((g) => !seen.has(g.against) && seen.add(g.against));
    const against = d.extinct ? [] : w.grudgesAgainst(d);
    const done = (d.grudges ?? []).filter((g) => g.avenged != null).slice(-4);
    if (!mine.length && !against.length && !done.length) return '';
    const bar = (g) => `<span class="feud-bar" title="恨みの強さ ${Math.round(w.grudgeStrength(g))}"><i style="width:${Math.min(100, (w.grudgeStrength(g) / 30) * 100)}%"></i></span>`;
    const li = (who, text, g) => `<li>${bar(g)}<b>${esc(who.name)}家</b>：${richText(w, text)}</li>`;
    return `<h3>⚔ 因縁の帳簿</h3>
      ${mine.length ? `<div class="small">この家が恨む家</div><ul class="ledger small">${mine.map((g) => li(w.dynasties[g.against], w.grudgeText(d, g), g)).join('')}</ul>` : ''}
      ${against.length ? `<div class="small">この家を恨む家</div><ul class="ledger small">${against.slice(0, 6).map((x) => li(x.d, w.grudgeText(x.d, x.g), x.g)).join('')}</ul>` : ''}
      ${done.length ? `<ul class="ledger small muted">${done.map((g) => `<li>✔ ${g.avenged}年、${esc(w.dynasties[g.against].name)}家への恨み（${g.year}年）を晴らした</li>`).join('')}</ul>` : ''}
      <p class="small muted">処刑・幽閉・王位の簒奪・国の滅亡・戦死・領地の没収は、家の恨みとして子孫に残ります。恨む王家には忠誠が下がり、反乱や宣戦の理由になります。仇に勝てば晴れ、縁組すれば和らぎます。</p>`;
  }

  // 家の墓所：歴代の当主の墓碑銘
  _tombs(w, d) {
    const heads = (d.heads ?? []).map((id) => w.get(id)).filter((p) => p && !p.alive && p.epitaph).slice(-8).reverse();
    if (!heads.length) return '';
    return `<h3>🪦 家の墓所</h3><ul class="tombs small">${heads.map((p) => `<li>${personLink(w, p, { short: true })}${p.epithet ? `「${esc(p.epithet)}」` : ''} <span class="muted">${p.birthYear}〜${p.deathYear}</span><div>${richText(w, p.epitaph)}。</div></li>`).join('')}</ul>`;
  }

  _detail(w, d) {
    const members = w.living.filter((p) => p.alive && p.dynastyId === d.id).sort((a, b) => a.birthYear - b.birthYear);
    const rulers = w.kingdoms.flatMap((k) => k.rulers.filter((r) => r.dynastyId === d.id).map((r) => ({ ...r, k })));
    const n = members.length || 1;
    const meanF = members.reduce((s, p) => s + p.F, 0) / n;
    const count = (f) => members.filter(f).length;
    const home = w.provinces[d.homeProvinceId];
    const parent = d.parentId != null ? w.dynasties[d.parentId] : null;
    return `
      <h2><span class="kdot" style="background:${d.color}"></span>${esc(d.name)}家 <span class="small muted">${d.foundedYear}年〜${d.extinct ? `${d.extinctYear}年（断絶）` : ''}</span></h2>
      <p>${!d.extinct && this.app.followDynasty !== d.id ? `<button type="button" data-follow="${d.id}">📌 この家を追う</button>` : ''}${!d.extinct && this.app.world.player?.dynastyId !== d.id ? ` <button type="button" data-playhouse="${d.id}">👑 この家で遊ぶ</button>` : ''}</p>
      <dl class="kv">
        <dt>本拠</dt><dd>${home ? esc(home.name) : '—'}${home && home.ownerId >= 0 ? `（${kingdomLink(w.kingdoms[home.ownerId])}）` : ''}</dd>
        ${parent ? `<dt>本家</dt><dd>${esc(parent.name)}家</dd>` : ''}
        <dt>家格</dt><dd>${Math.round(d.prestige)}</dd>
        <dt>爵位</dt><dd>${esc(w.houseTitle(d) ?? (d.extinct ? '—' : '無領'))}</dd>
        ${w.countiesOf(d.id).length ? `<dt>所領</dt><dd>${w.countiesOf(d.id).map((pr) => `${esc(pr.name)}伯領`).join('・')}</dd>` : ''}
        <dt>存命</dt><dd>${members.length} 人・平均の近交係数 ${meanF.toFixed(3)}</dd>
        ${members.length ? `<dt>遺伝の傾向</dt><dd class="small">血友病の保因者・患者 ${count((p) => p.genome && (isCarrier(p.genome, 'HEM') || p.pheno.hemophilia))} 人・受け口 ${count((p) => p.pheno.jaw)} 人・狂気の素質 ${count((p) => p.pheno.madness)} 人・虚弱 ${count((p) => p.pheno.load > 0)} 人</dd>` : ''}
      </dl>
      ${rulers.length ? `<h3>この家から出た君主（${rulers.length}）</h3><div class="chips small">${rulers.map((r) => `${personLink(w, w.get(r.id), { short: true })}<span class="muted">（${esc(r.k.name)} ${r.from}〜${r.to ?? ''}）</span>`).join('')}</div>` : ''}
      ${this._ledger(w, d)}
      ${this._tombs(w, d)}
      ${members.length ? `<h3>存命の人々</h3><div class="chips small">${members.map((p) => personLink(w, p, { short: true }) + `<span class="muted">${w.age(p)}</span>`).join('')}</div>` : ''}
    `;
  }
}

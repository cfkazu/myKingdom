// パネル共通の小道具：人物・王国へのリンクと、年代記の本文の変換。

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function personLink(world, p, { short = false } = {}) {
  if (!p) return '<span class="muted">不明</span>';
  const name = short ? p.regnal ?? p.name : world.displayName(p);
  const life = p.alive ? '' : '<span class="dead-mark" title="故人">故</span>';
  return `<a class="plink${p.alive ? '' : ' dead'}" data-pid="${p.id}">${esc(name)}${life}</a>`;
}

export function kingdomLink(k) {
  return `<span class="klink" data-kid="${k.id}"><span class="kdot" style="background:${k.color}"></span>${esc(k.name)}</span>`;
}

export function richText(world, text) {
  return esc(text)
    .replace(/\{p:(\d+)\}/g, (_, id) => personLink(world, world.get(Number(id))))
    .replace(/\{k:(\d+)\}/g, (_, id) => kingdomLink(world.kingdoms[Number(id)]));
}

export function lifeSpan(world, p) {
  return p.alive ? `${p.birthYear}年生まれ・${world.age(p)}歳` : `${p.birthYear}〜${p.deathYear}年（${world.age(p)}歳・${p.cause}）`;
}

// data-pid / data-kid のクリックをまとめて受ける
export function bindLinks(root, { onPerson, onKingdom, onDynasty }) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-pid],[data-kid],[data-did]');
    if (!a || !root.contains(a)) return;
    if (a.dataset.pid) onPerson(Number(a.dataset.pid));
    else if (a.dataset.kid) onKingdom(Number(a.dataset.kid));
    else if (a.dataset.did && onDynasty) onDynasty(Number(a.dataset.did));
  });
}

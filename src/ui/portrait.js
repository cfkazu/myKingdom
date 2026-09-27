// 遺伝子どおりの肖像画（SVG）。肌・髪・瞳の色、顎、身長、年齢、王冠。

const mix = (a, b, t) => {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

const HAIR = { D: '#2a1d14', L: '#d8b35c', r: '#a8431f' };
const EYE = { B: '#5a3a1e', g: '#3f7d4a', u: '#3a6fb8' };

export function portraitSVG(world, p, size = 112) {
  const ph = p.pheno;
  const age = world.age(p);
  const male = p.sex === 'M';
  const skin = mix('#f6dcc6', '#6e4429', Math.min(1, Math.max(0, ph.skin)));
  let hair = HAIR[ph.hair];
  if (age >= 50) hair = mix(hair.slice(1), 'b8b4ab', Math.min(1, (age - 50) / 25));
  const eye = EYE[ph.eye];
  const d = world.dyn(p);
  const cloth = d ? d.color : '#8a8a8a';
  const child = age < 14;
  const s = child ? 0.82 : 1;
  const faceRy = 26 * s;
  const faceRx = 21 * s;
  const cy = 50;
  const parts = [];
  // 服
  parts.push(`<path d="M16 112 Q20 ${child ? 88 : 84} 50 ${child ? 86 : 82} Q80 ${child ? 88 : 84} 84 112 Z" fill="${cloth}" stroke="rgba(0,0,0,.25)"/>`);
  parts.push(`<path d="M44 ${child ? 86 : 82} L50 ${child ? 94 : 92} L56 ${child ? 86 : 82}" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="2"/>`);
  // 首
  parts.push(`<rect x="44" y="${cy + faceRy - 8}" width="12" height="14" fill="${skin}"/>`);
  // 後ろ髪（女性は長い）
  if (!male) parts.push(`<path d="M${50 - faceRx - 5} ${cy - 6} Q${50 - faceRx - 10} ${cy + 34} ${50 - faceRx + 2} ${cy + 40} L${50 + faceRx - 2} ${cy + 40} Q${50 + faceRx + 10} ${cy + 34} ${50 + faceRx + 5} ${cy - 6} Z" fill="${hair}"/>`);
  // 顔
  parts.push(`<ellipse cx="50" cy="${cy}" rx="${faceRx}" ry="${faceRy}" fill="${skin}"/>`);
  // 受け口の顎（下顎が前に出る）
  if (ph.jaw && !child) parts.push(`<path d="M${50 - faceRx + 5} ${cy + 12} Q50 ${cy + faceRy + 9} ${50 + faceRx - 5} ${cy + 12}" fill="${skin}" stroke="rgba(0,0,0,.18)"/>`);
  // 耳
  parts.push(`<ellipse cx="${50 - faceRx}" cy="${cy + 2}" rx="3.5" ry="6" fill="${skin}"/><ellipse cx="${50 + faceRx}" cy="${cy + 2}" rx="3.5" ry="6" fill="${skin}"/>`);
  // 前髪（年をとった男性は薄くなることがある）
  const bald = male && age >= 45 && p.id % 3 === 0;
  if (!bald) parts.push(`<path d="M${50 - faceRx - 1} ${cy - 2} Q${50 - faceRx} ${cy - faceRy - 8} 50 ${cy - faceRy - 4} Q${50 + faceRx} ${cy - faceRy - 8} ${50 + faceRx + 1} ${cy - 2} Q${50 + 6} ${cy - faceRy + 8} ${50 - faceRx - 1} ${cy - 2} Z" fill="${hair}"/>`);
  else parts.push(`<path d="M${50 - faceRx - 1} ${cy} Q${50 - faceRx} ${cy - 12} ${50 - faceRx + 6} ${cy - 16}" stroke="${hair}" stroke-width="4" fill="none"/><path d="M${50 + faceRx + 1} ${cy} Q${50 + faceRx} ${cy - 12} ${50 + faceRx - 6} ${cy - 16}" stroke="${hair}" stroke-width="4" fill="none"/>`);
  // 目・眉
  const ey = cy - 2;
  for (const dx of [-8, 8]) {
    parts.push(`<ellipse cx="${50 + dx}" cy="${ey}" rx="4" ry="2.8" fill="#fff"/><circle cx="${50 + dx}" cy="${ey}" r="2" fill="${eye}"/><circle cx="${50 + dx}" cy="${ey}" r="0.9" fill="#111"/>`);
    const brow = p.mad ? (dx < 0 ? -3 : 3) : 0;
    parts.push(`<path d="M${50 + dx - 5} ${ey - 6 + brow} L${50 + dx + 5} ${ey - 6 - brow}" stroke="${hair}" stroke-width="1.6" stroke-linecap="round"/>`);
  }
  // 鼻・口
  parts.push(`<path d="M50 ${ey + 3} L48 ${ey + 10} L51 ${ey + 11}" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="1"/>`);
  const mouthY = ph.jaw && !child ? cy + 16 : cy + 13;
  const smile = ph.kindness > 60 ? 3 : ph.kindness < 30 ? -1.5 : 1;
  parts.push(`<path d="M45 ${mouthY} Q50 ${mouthY + smile} 55 ${mouthY}" fill="none" stroke="#8a3b36" stroke-width="1.6" stroke-linecap="round"/>`);
  // 頬（容姿のよい人）
  if (ph.beauty >= 70) parts.push(`<circle cx="39" cy="${cy + 7}" r="3.5" fill="#e88" opacity=".35"/><circle cx="61" cy="${cy + 7}" r="3.5" fill="#e88" opacity=".35"/>`);
  // ひげ（大人の男性の一部）
  if (male && age >= 20 && p.id % 2 === 0) parts.push(`<path d="M${50 - faceRx + 4} ${cy + 6} Q50 ${cy + faceRy + (ph.jaw ? 12 : 6)} ${50 + faceRx - 4} ${cy + 6} Q50 ${cy + 18} ${50 - faceRx + 4} ${cy + 6} Z" fill="${hair}" opacity=".9"/>`);
  // しわ
  if (age >= 55) parts.push(`<path d="M40 ${cy - 12} q5 -2 10 0 M50 ${cy - 12} q5 -2 10 0" stroke="rgba(0,0,0,.2)" fill="none"/>`);
  // 王冠・ティアラ
  if (p.rulerOf != null || (p.alive === false && p.rulerOfEver != null)) {
    const t = cy - faceRy - 6;
    parts.push(`<path d="M32 ${t + 8} L34 ${t - 6} L41 ${t + 2} L50 ${t - 10} L59 ${t + 2} L66 ${t - 6} L68 ${t + 8} Z" fill="#e3b53a" stroke="#9c7412"/>`);
    parts.push(`<circle cx="50" cy="${t - 2}" r="2.2" fill="#c0392b"/><circle cx="40" cy="${t + 3}" r="1.6" fill="#2e6fbd"/><circle cx="60" cy="${t + 3}" r="1.6" fill="#2e6fbd"/>`);
  } else if (world.royalOf(p)) {
    const t = cy - faceRy - 2;
    parts.push(`<path d="M38 ${t + 5} Q50 ${t - 6} 62 ${t + 5}" stroke="#d9c27a" stroke-width="3" fill="none"/><circle cx="50" cy="${t - 1}" r="2" fill="#6ba8d8"/>`);
  }
  const label = `${p.name}の肖像：${ph.hair === 'D' ? '黒髪' : ph.hair === 'L' ? '金髪' : '赤毛'}、${ph.eye === 'B' ? '茶色' : ph.eye === 'g' ? '緑' : '青'}の瞳${ph.jaw ? '、受け口の顎' : ''}`;
  return `<svg class="portrait${p.alive ? '' : ' dead'}" viewBox="0 0 100 112" width="${size}" height="${Math.round(size * 1.12)}" role="img" aria-label="${label}">${parts.join('')}</svg>`;
}

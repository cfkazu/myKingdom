// 大陸の地図。地方を王国・王朝・出自・人口・戦禍で塗り分け、国境・首都・戦場を描く。

import { cssVar } from './charts.js';

const CELL = 10;

function hexToRgb(h) {
  const m = h.match(/\w\w/g).map((x) => parseInt(x, 16));
  return m;
}

export class MapView {
  constructor(canvas, tip, world, { onSelectKingdom }) {
    this.canvas = canvas;
    this.tip = tip;
    this.world = world;
    this.mode = 'kingdom';
    this.selectedKingdom = null;
    this.onSelectKingdom = onSelectKingdom;
    canvas.addEventListener('pointermove', (e) => this._hover(e));
    canvas.addEventListener('pointerleave', () => (this.tip.hidden = true));
    canvas.addEventListener('click', (e) => {
      const pr = this._provinceAt(e);
      if (pr && pr.ownerId >= 0) this.onSelectKingdom(pr.ownerId);
    });
  }

  setWorld(w) {
    this.world = w;
  }

  _provinceAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const { W, H, cells } = this.world.map;
    const x = Math.floor(((e.clientX - r.left) / r.width) * W);
    const y = Math.floor(((e.clientY - r.top) / r.height) * H);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const id = cells[y * W + x];
    return id >= 0 ? this.world.provinces[id] : null;
  }

  _hover(e) {
    const pr = this._provinceAt(e);
    if (!pr) {
      this.tip.hidden = true;
      return;
    }
    const w = this.world;
    const k = w.kingdoms[pr.ownerId];
    const origin = w.kingdoms[pr.origin];
    const houses = w.dynasties.filter((d) => !d.extinct && d.homeProvinceId === pr.id).map((d) => `${d.name}家`);
    this.tip.innerHTML = `<b>${pr.name}</b>${k && k.capital === pr.id ? '（首都）' : ''}<br>${k ? `${k.name}領` : ''}${origin && origin !== k ? `（もとは${origin.name}）` : ''}<br>人口 ${Math.round(pr.pop)}千人${pr.devastation > 0.1 ? `・戦禍 ${Math.round(pr.devastation * 100)}%` : ''}${houses.length ? `<br>本拠の家：${houses.join('・')}` : ''}`;
    this.tip.hidden = false;
    const r = this.canvas.getBoundingClientRect();
    let x = e.clientX - r.left + 14;
    if (x + 220 > r.width) x = e.clientX - r.left - 230;
    this.tip.style.left = `${Math.max(4, x)}px`;
    this.tip.style.top = `${Math.max(4, e.clientY - r.top + 10)}px`;
  }

  _provinceColor(pr) {
    const w = this.world;
    const k = w.kingdoms[pr.ownerId];
    switch (this.mode) {
      case 'dynasty': {
        const r = w.ruler(k);
        const d = r ? w.dyn(r) : null;
        return d ? d.color : '#999999';
      }
      case 'origin':
        return w.kingdoms[pr.origin]?.color ?? '#999999';
      case 'pop': {
        const t = Math.min(1, pr.pop / (pr.area * 1.6));
        const a = hexToRgb('#f1e7c9');
        const b = hexToRgb('#7a3b12');
        return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
      }
      case 'devastation': {
        const t = Math.min(1, pr.devastation);
        const a = hexToRgb('#dfe6cf');
        const b = hexToRgb('#b3261e');
        return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
      }
      default:
        return k ? k.color : '#999999';
    }
  }

  legendHTML() {
    const w = this.world;
    if (this.mode === 'kingdom' || this.mode === 'origin') {
      const ks = this.mode === 'kingdom' ? w.aliveKingdoms() : [...new Set(w.provinces.map((p) => p.origin))].map((id) => w.kingdoms[id]);
      return ks.map((k) => `<span><span class="sw" style="background:${k.color}"></span>${k.name}${k.alive ? '' : '（滅）'}</span>`).join('');
    }
    if (this.mode === 'dynasty') {
      return w
        .aliveKingdoms()
        .map((k) => {
          const r = w.ruler(k);
          const d = r ? w.dyn(r) : null;
          return d ? `<span><span class="sw" style="background:${d.color}"></span>${d.name}朝（${k.name}）</span>` : '';
        })
        .join('');
    }
    if (this.mode === 'pop') return '<span>薄い＝人が少ない　濃い＝人が多い（兵力のもと）</span>';
    return '<span>赤いほど最近の戦で荒れている</span>';
  }

  draw() {
    const w = this.world;
    const { W, H, cells } = w.map;
    const cv = this.canvas;
    if (cv.width !== W * CELL) {
      cv.width = W * CELL;
      cv.height = H * CELL;
    }
    const ctx = cv.getContext('2d');
    const sea = cssVar('--sea') || '#b9cbd6';
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, cv.width, cv.height);
    const colors = w.provinces.map((pr) => this._provinceColor(pr));
    const sel = this.selectedKingdom;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const id = cells[y * W + x];
        if (id < 0) continue;
        const pr = w.provinces[id];
        ctx.fillStyle = colors[id];
        ctx.globalAlpha = sel != null && pr.ownerId !== sel ? 0.55 : 1;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    ctx.globalAlpha = 1;
    // 地方の境（細い）と国境（太い）
    ctx.lineCap = 'round';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = cells[y * W + x];
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const b = nx < W && ny < H ? cells[ny * W + nx] : -1;
          if (a === b) continue;
          if (a < 0 && b < 0) continue;
          const coast = a < 0 || b < 0;
          const border = !coast && w.provinces[a].ownerId !== w.provinces[b].ownerId;
          ctx.strokeStyle = coast ? 'rgba(40,50,60,.55)' : border ? 'rgba(20,15,10,.85)' : 'rgba(20,15,10,.18)';
          ctx.lineWidth = border ? 2.5 : coast ? 1.5 : 1;
          ctx.beginPath();
          if (dx) {
            ctx.moveTo(nx * CELL, y * CELL);
            ctx.lineTo(nx * CELL, (y + 1) * CELL);
          } else {
            ctx.moveTo(x * CELL, ny * CELL);
            ctx.lineTo((x + 1) * CELL, ny * CELL);
          }
          ctx.stroke();
        }
      }
    }
    // 首都
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const k of w.aliveKingdoms()) {
      const pr = w.provinces[k.capital];
      if (!pr) continue;
      const x = (pr.cx + 0.5) * CELL;
      const y = (pr.cy + 0.5) * CELL;
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = '#fff5cc';
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.lineWidth = 3;
      ctx.strokeText('♛', x, y - 4);
      ctx.fillText('♛', x, y - 4);
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.lineWidth = 3.5;
      ctx.strokeText(k.name, x, y + 14);
      ctx.fillStyle = '#fff';
      ctx.fillText(k.name, x, y + 14);
    }
    // 今年の戦場
    ctx.font = '16px system-ui, sans-serif';
    for (const war of w.wars) {
      if (war.ended) continue;
      const b = war.battles.at(-1);
      if (!b || b.year !== w.year || b.field == null) continue;
      const pr = w.provinces[b.field];
      ctx.fillText('⚔️', (pr.cx + 0.5) * CELL, (pr.cy + 0.5) * CELL);
    }
  }
}

// 大陸の地図。
// - 地形の層：地方を王国・王朝・出自・人口・戦禍で塗り分け、国境・首都を描く（年が変わるたびに描き直してためておく）
// - 生きものの層：王侯貴族を一人ずつ点で描き、毎フレーム少しずつ動かす。
//   嫁いだ人は新しい宮廷へ旅をし、生まれた子は母のそばに現れる。戦争中は軍旗が戦場へ進み、
//   誕生・結婚・死・即位・会戦はその場所にアイコンが浮かぶ。

import { cssVar } from './charts.js';

const CELL = 10;
const FX_ICON = { birth: '👶', marriage: '💍', death: '✝', crown: '👑', battle: '⚔️' };
const FX_VERB = { birth: '誕生', marriage: '結婚', death: '死去', crown: '即位' };

const hexToRgb = (h) => h.match(/\w\w/g).map((x) => parseInt(x, 16));
const rgbStr = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;
const shade = (rgb, f) => rgb.map((v) => Math.max(0, Math.min(255, f >= 0 ? v + (255 - v) * f : v * (1 + f))));
const lerpRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// 決まった値を返すハッシュ（0〜1）
const hash01 = (n) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class MapView {
  constructor(canvas, tip, world, { onSelectKingdom, onSelectPerson }) {
    this.canvas = canvas;
    this.tip = tip;
    this.mode = 'kingdom';
    this.selectedKingdom = null;
    this.selectedPerson = null;
    this.onSelectKingdom = onSelectKingdom;
    this.onSelectPerson = onSelectPerson;
    this.base = document.createElement('canvas');
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.hover = null;
    canvas.addEventListener('pointermove', (e) => this._hover(e));
    canvas.addEventListener('pointerleave', () => {
      this.tip.hidden = true;
      this.hover = null;
    });
    canvas.addEventListener('click', (e) => {
      const who = this._personAt(e);
      if (who) return this.onSelectPerson(who.id);
      const pr = this._provinceAt(e);
      if (pr && pr.ownerId >= 0) this.onSelectKingdom(pr.ownerId);
    });
    if (world) this.setWorld(world);
  }

  setWorld(w) {
    this.world = w;
    const { W, H, cells } = w.map;
    this.cellsOf = w.provinces.map(() => []);
    for (let i = 0; i < W * H; i++) if (cells[i] >= 0) this.cellsOf[cells[i]].push(i);
    // 陸に近い海（浅瀬）
    this.shallow = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (cells[y * W + x] >= 0) continue;
        let near = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && cells[ny * W + nx] >= 0) near = Math.max(near, 3 - Math.max(Math.abs(dx), Math.abs(dy)));
          }
        }
        this.shallow[y * W + x] = near;
      }
    }
    this.dots = new Map();
    this.floaters = [];
    this.fxSeen = w.fxSeq;
    this.armies = new Map();
  }

  // ───────── 位置 ─────────

  // 人ごとに、その地方の中の決まったマス（家の屋敷）に住まわせる
  _spot(pid, personId) {
    const list = this.cellsOf[pid];
    if (!list || !list.length) return null;
    const { W } = this.world.map;
    const c = list[Math.floor(hash01(personId * 7 + pid) * list.length)];
    const x = c % W;
    const y = (c - x) / W;
    return { x: (x + 0.2 + 0.6 * hash01(personId * 13)) * CELL, y: (y + 0.2 + 0.6 * hash01(personId * 17)) * CELL };
  }

  _provinceCenter(pid) {
    const pr = this.world.provinces[pid];
    return { x: (pr.cx + 0.5) * CELL, y: (pr.cy + 0.5) * CELL };
  }

  // 年が変わったら、一人ひとりの行き先を決め直す
  _retarget() {
    const w = this.world;
    const alive = new Set();
    const rulers = new Set(w.aliveKingdoms().map((k) => k.rulerId));
    for (const p of w.living) {
      if (!p.alive) continue;
      alive.add(p.id);
      const pid = w.homeProvince(p);
      if (pid == null) continue;
      const target = rulers.has(p.id) ? this._provinceCenter(pid) : this._spot(pid, p.id);
      if (!target) continue;
      let d = this.dots.get(p.id);
      if (!d) {
        // 生まれた子は母のそばから、ほかは行き先から
        const mom = this.dots.get(p.motherId);
        d = { x: mom ? mom.x : target.x, y: mom ? mom.y : target.y, born: performance.now() };
        this.dots.set(p.id, d);
      }
      d.tx = target.x;
      d.ty = target.y;
      d.p = p;
      const a = w.age(p);
      const royal = rulers.has(p.id) ? 3 : w.royalOf(p) ? 2 : 0;
      const dd = w.dyn(p);
      d.rank = royal || (dd && w.head(dd) === p ? 1 : 0);
      d.child = a < 16;
      d.color = dd ? dd.color : '#b9b2a2';
    }
    for (const id of this.dots.keys()) if (!alive.has(id)) this.dots.delete(id);
  }

  // ───────── 地形の層 ─────────

  _provinceRgb(pr) {
    const w = this.world;
    const k = w.kingdoms[pr.ownerId];
    switch (this.mode) {
      case 'dynasty': {
        const r = w.ruler(k);
        const d = r ? w.dyn(r) : null;
        return hexToRgb(d ? d.color : '#999999');
      }
      case 'origin':
        return hexToRgb(w.kingdoms[pr.origin]?.color ?? '#999999');
      case 'pop':
        return lerpRgb(hexToRgb('#f1e7c9'), hexToRgb('#7a3b12'), Math.min(1, pr.pop / (pr.area * 1.6)));
      case 'devastation':
        return lerpRgb(hexToRgb('#dfe6cf'), hexToRgb('#b3261e'), Math.min(1, pr.devastation));
      default:
        return hexToRgb(k ? k.color : '#999999');
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

  // 地形の層を描き直す（年が変わったとき・表示を切り替えたとき）
  draw() {
    const w = this.world;
    const { W, H, cells } = w.map;
    const cv = this.base;
    if (cv.width !== W * CELL) {
      cv.width = W * CELL;
      cv.height = H * CELL;
      this.canvas.width = W * CELL;
      this.canvas.height = H * CELL;
    }
    const ctx = cv.getContext('2d');
    const sea = hexToRgb(cssVar('--sea') || '#b9cbd6');
    const shallowRgb = shade(sea, 0.28);
    const img = ctx.createImageData(W * CELL, H * CELL);
    const data = img.data;
    const rgbs = w.provinces.map((pr) => {
      // 同じ国の中でも地方ごとに少しずつ色合いを変え、境目が読めるようにする
      const base = this._provinceRgb(pr);
      return shade(base, (hash01(pr.id * 31) - 0.5) * 0.16);
    });
    const sel = this.selectedKingdom;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const id = cells[i];
        let rgb;
        if (id < 0) rgb = this.shallow[i] ? lerpRgb(sea, shallowRgb, this.shallow[i] / 3) : sea;
        else {
          rgb = rgbs[id];
          // 地面のざらつき（丘や森のような陰影）
          rgb = shade(rgb, (hash01(i * 3 + 1) - 0.5) * 0.08);
          if (sel != null && w.provinces[id].ownerId !== sel) rgb = lerpRgb(rgb, [200, 196, 186], 0.45);
        }
        for (let py = 0; py < CELL; py++) {
          let o = ((y * CELL + py) * W * CELL + x * CELL) * 4;
          for (let px = 0; px < CELL; px++, o += 4) {
            data[o] = rgb[0];
            data[o + 1] = rgb[1];
            data[o + 2] = rgb[2];
            data[o + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // 地方の境（細い）・国境（太い）・海岸
    ctx.lineCap = 'round';
    const seg = (x, y, dx) => {
      ctx.beginPath();
      if (dx) {
        ctx.moveTo((x + 1) * CELL, y * CELL);
        ctx.lineTo((x + 1) * CELL, (y + 1) * CELL);
      } else {
        ctx.moveTo(x * CELL, (y + 1) * CELL);
        ctx.lineTo((x + 1) * CELL, (y + 1) * CELL);
      }
      ctx.stroke();
    };
    for (const pass of ['province', 'coast', 'border']) {
      ctx.strokeStyle = pass === 'coast' ? 'rgba(30,45,60,.6)' : pass === 'border' ? 'rgba(25,18,12,.9)' : 'rgba(25,18,12,.16)';
      ctx.lineWidth = pass === 'border' ? 2.6 : pass === 'coast' ? 1.4 : 1;
      if (pass === 'border') ctx.setLineDash([]);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const a = cells[y * W + x];
          for (const dx of [1, 0]) {
            const nx = x + dx;
            const ny = y + (1 - dx);
            const b = nx < W && ny < H ? cells[ny * W + nx] : -1;
            if (a === b || (a < 0 && b < 0)) continue;
            const coast = a < 0 || b < 0;
            const border = !coast && w.provinces[a].ownerId !== w.provinces[b].ownerId;
            const kind = coast ? 'coast' : border ? 'border' : 'province';
            if (kind === pass) seg(x, y, dx);
          }
        }
      }
    }
    this._retarget();
  }

  // ───────── 出来事のアイコン ─────────

  _consumeFx(msPerYear) {
    const w = this.world;
    const now = performance.now();
    const fresh = w.fx.filter((f) => f.seq >= this.fxSeen);
    this.fxSeen = w.fxSeq;
    // 速く進めているときは、目立つものだけにしぼる
    const budget = msPerYear && msPerYear < 150 ? 6 : 40;
    const pick = fresh.filter((f) => f.important || f.kind === 'battle').concat(fresh.filter((f) => !f.important && f.kind !== 'battle'));
    for (const f of pick.slice(0, budget)) {
      const d = f.personId != null ? this.dots.get(f.personId) : null;
      const at = d ? { x: d.tx ?? d.x, y: d.ty ?? d.y } : this._spot(f.provinceId, f.seq) ?? this._provinceCenter(f.provinceId);
      const p = f.personId != null ? w.get(f.personId) : null;
      const labels = this.floaters.filter((x) => x.label && now < x.start + x.life).length;
      const label = f.important && p && FX_VERB[f.kind] && labels < 3 ? `${p.regnal ?? p.name} ${FX_VERB[f.kind]}` : null;
      this.floaters.push({ ...at, icon: FX_ICON[f.kind], label, start: now + (msPerYear ? hash01(f.seq) * msPerYear * 0.8 : 0), life: f.important ? 2600 : 1600, big: f.important });
    }
    if (this.floaters.length > 90) this.floaters.splice(0, this.floaters.length - 90);
  }

  // App から、年が進んだあとに呼ばれる
  yearAdvanced(msPerYear) {
    this._consumeFx(msPerYear);
  }

  // ───────── 毎フレーム ─────────

  frame(now, dt, phase) {
    if (!this.world || !this.base.width) return;
    const ctx = this.canvas.getContext('2d');
    ctx.drawImage(this.base, 0, 0);
    const w = this.world;
    const t = this.reduced ? 0 : now / 1000;

    // 軍勢：攻め手の首都（反乱なら指導者の本拠）から戦場へ、1 年かけて進む
    for (const war of w.wars) {
      if (war.ended) continue;
      const A = w.kingdoms[war.attackerId];
      const b = war.battles.at(-1);
      const toPid = b && b.field != null ? b.field : w.kingdoms[war.defenderId].capital;
      let fromPid = A.capital;
      if (war.leaderId != null) {
        const leader = w.get(war.leaderId);
        fromPid = w.homeProvince(leader) ?? fromPid;
      }
      const from = this._provinceCenter(fromPid);
      const to = this._provinceCenter(toPid);
      const e = this.reduced ? 1 : ease(Math.min(1, phase * 1.25));
      const x = from.x + (to.x - from.x) * e;
      const y = from.y + (to.y - from.y) * e;
      const color = war.kind === 'civil' || war.kind === 'independence' ? w.dyn(w.get(war.leaderId))?.color ?? '#444' : A.color;
      this._banner(ctx, x, y, color, t);
      const D = w.kingdoms[war.defenderId];
      if (war.kind !== 'civil' && war.kind !== 'independence') this._banner(ctx, to.x + 9, to.y + 2, D.color, t + 1, true);
      // 会戦の火花
      if (b && b.year === w.year && phase > 0.72) {
        const k = Math.min(1, (phase - 0.72) / 0.28);
        ctx.save();
        ctx.globalAlpha = 1 - k * 0.6;
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = 2;
        for (let r = 0; r < 8; r++) {
          const ang = (r / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(to.x + Math.cos(ang) * (4 + 6 * k), to.y + Math.sin(ang) * (4 + 6 * k));
          ctx.lineTo(to.x + Math.cos(ang) * (8 + 12 * k), to.y + Math.sin(ang) * (8 + 12 * k));
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 人々
    const follow = Math.min(1, dt * 1.6);
    const sel = this.selectedPerson;
    const list = [...this.dots.values()].sort((a, b) => a.rank - b.rank);
    for (const d of list) {
      if (d.tx == null) continue;
      d.x += (d.tx - d.x) * follow;
      d.y += (d.ty - d.y) * follow;
      const id = d.p.id;
      // 屋敷のまわりをゆっくり歩く
      const wx = Math.sin(t * 0.7 + id * 1.7) * 2.6 + Math.sin(t * 0.23 + id) * 1.5;
      const wy = Math.cos(t * 0.6 + id * 2.3) * 2.2;
      const x = d.x + (d.rank === 3 ? 0 : wx);
      const y = d.y + (d.rank === 3 ? 0 : wy);
      d.sx = x;
      d.sy = y;
      const grow = Math.min(1, (now - d.born) / 600);
      let r = d.child ? 1.6 : d.rank === 3 ? 4.6 : d.rank === 2 ? 3.3 : d.rank === 1 ? 3 : 2.3;
      r *= 0.4 + 0.6 * grow;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = d.rank >= 2 ? 1.6 : 1;
      ctx.strokeStyle = d.rank >= 2 ? '#f1c94a' : d.rank === 1 ? '#ffffff' : 'rgba(20,15,10,.75)';
      ctx.stroke();
      if (d.p.sex === 'F' && !d.child && d.rank < 3) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        ctx.fill();
      }
      if (id === sel || id === this.hover?.id) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4 + (this.reduced ? 0 : Math.sin(t * 4) * 1.2), 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // 首都と国名
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const k of w.aliveKingdoms()) {
      const c = this._provinceCenter(k.capital);
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.fillStyle = '#fff5cc';
      ctx.strokeText('♛', c.x, c.y - 12);
      ctx.fillText('♛', c.x, c.y - 12);
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.lineWidth = 3.5;
      ctx.strokeText(k.name, c.x, c.y + 14);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(k.name, c.x, c.y + 14);
    }

    // 浮かぶアイコン
    this.floaters = this.floaters.filter((f) => now < f.start + f.life);
    for (const f of this.floaters) {
      if (now < f.start) continue;
      const k = (now - f.start) / f.life;
      const rise = this.reduced ? 0 : 22 * k;
      ctx.save();
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
      ctx.font = `${f.big ? 18 : 13}px system-ui, sans-serif`;
      ctx.fillText(f.icon, f.x, f.y - 8 - rise);
      if (f.label) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.75)';
        ctx.strokeText(f.label, f.x, f.y - 24 - rise);
        ctx.fillStyle = '#fff';
        ctx.fillText(f.label, f.x, f.y - 24 - rise);
      }
      ctx.restore();
    }
  }

  _banner(ctx, x, y, color, t, small = false) {
    const s = small ? 0.75 : 1;
    const wave = this.reduced ? 0 : Math.sin(t * 5) * 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = 'rgba(20,15,10,.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, -16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.quadraticCurveTo(7, -15 + wave, 14, -12 + wave);
    ctx.lineTo(0, -7);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();
    // 兵のかたまり
    ctx.fillStyle = 'rgba(20,15,10,.8)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(-6 + i * 3, 6 + (i % 2), 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ───────── 指し示し ─────────

  _canvasPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.canvas.width, y: ((e.clientY - r.top) / r.height) * this.canvas.height, scale: this.canvas.width / r.width };
  }

  _personAt(e) {
    const pt = this._canvasPoint(e);
    let best = null;
    let bestD = 9 * pt.scale;
    for (const d of this.dots.values()) {
      if (d.sx == null) continue;
      const dist = Math.hypot(d.sx - pt.x, d.sy - pt.y) - (d.rank === 3 ? 3 : 0);
      if (dist < bestD) {
        bestD = dist;
        best = d.p;
      }
    }
    return best;
  }

  _provinceAt(e) {
    const pt = this._canvasPoint(e);
    const { W, H, cells } = this.world.map;
    const x = Math.floor(pt.x / CELL);
    const y = Math.floor(pt.y / CELL);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    const id = cells[y * W + x];
    return id >= 0 ? this.world.provinces[id] : null;
  }

  _hover(e) {
    const w = this.world;
    const who = this._personAt(e);
    this.hover = who;
    let html = '';
    if (who) {
      const title = w.titleOf(who);
      html = `<b>${w.displayName(who)}</b><br>${title ? `${title}・` : ''}${w.age(who)}歳<br><span class="muted">クリックで人物を見る</span>`;
    } else {
      const pr = this._provinceAt(e);
      if (!pr) {
        this.tip.hidden = true;
        return;
      }
      const k = w.kingdoms[pr.ownerId];
      const origin = w.kingdoms[pr.origin];
      const houses = w.dynasties.filter((d) => !d.extinct && d.homeProvinceId === pr.id).map((d) => `${d.name}家`);
      html = `<b>${pr.name}</b>${k && k.capital === pr.id ? '（首都）' : ''}<br>${k ? `${k.name}領` : ''}${origin && origin !== k ? `（もとは${origin.name}）` : ''}<br>人口 ${Math.round(pr.pop)}千人${pr.devastation > 0.1 ? `・戦禍 ${Math.round(pr.devastation * 100)}%` : ''}${houses.length ? `<br>本拠の家：${houses.join('・')}` : ''}`;
    }
    this.tip.innerHTML = html;
    this.tip.hidden = false;
    const r = this.canvas.getBoundingClientRect();
    let x = e.clientX - r.left + 14;
    if (x + 220 > r.width) x = e.clientX - r.left - 230;
    this.tip.style.left = `${Math.max(4, x)}px`;
    this.tip.style.top = `${Math.max(4, e.clientY - r.top + 10)}px`;
  }
}

// 大陸と地方（プロヴィンス）の生成。マスの格子に陸地をつくり、陸を地方に分ける。
import { provinceName } from './names.js';

export const MAP_W = 96;
export const MAP_H = 64;

function valueNoise(rng, w, h, scale) {
  const gw = Math.ceil(w / scale) + 2;
  const gh = Math.ceil(h / scale) + 2;
  const g = Array.from({ length: gw * gh }, () => rng.next());
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / scale;
    const fy = y / scale;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const v = (i, j) => g[(y0 + j) * gw + (x0 + i)];
    const a = v(0, 0) + (v(1, 0) - v(0, 0)) * tx;
    const b = v(0, 1) + (v(1, 1) - v(0, 1)) * tx;
    return a + (b - a) * ty;
  };
}

export function generateMap(rng, { provinces: nProv = 42 } = {}) {
  const W = MAP_W;
  const H = MAP_H;
  const n1 = valueNoise(rng, W, H, 16);
  const n2 = valueNoise(rng, W, H, 7);
  const land = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const fall = Math.pow(dx * dx + dy * dy, 1.2);
      const v = 0.65 * n1(x, y) + 0.35 * n2(x, y) - 0.62 * fall;
      land[y * W + x] = v > 0.18 ? 1 : 0;
    }
  }
  // いちばん大きい陸地だけ残す（島を渡る仕組みはないため）
  const comp = new Int32Array(W * H).fill(-1);
  let best = -1;
  let bestSize = 0;
  let cid = 0;
  for (let i = 0; i < W * H; i++) {
    if (!land[i] || comp[i] >= 0) continue;
    const stack = [i];
    comp[i] = cid;
    let size = 0;
    while (stack.length) {
      const c = stack.pop();
      size++;
      const x = c % W;
      const y = (c - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (land[ni] && comp[ni] < 0) {
          comp[ni] = cid;
          stack.push(ni);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = cid;
    }
    cid++;
  }
  for (let i = 0; i < W * H; i++) if (comp[i] !== best) land[i] = 0;

  // 地方の中心を、互いに離して陸の上に置く
  const landCells = [];
  for (let i = 0; i < W * H; i++) if (land[i]) landCells.push(i);
  const minD = Math.sqrt(bestSize / nProv) * 0.8;
  const seeds = [];
  for (let tries = 0; tries < 5000 && seeds.length < nProv; tries++) {
    const c = rng.pick(landCells);
    const x = c % W;
    const y = (c - x) / W;
    if (seeds.every((s) => Math.hypot(s.x - x, s.y - y) >= minD)) seeds.push({ x, y });
  }

  // 陸を通って近い中心に割り当てる（ボロノイを陸の上で広げる）
  const cells = new Int16Array(W * H).fill(-1);
  let frontier = seeds.map((s, i) => {
    cells[s.y * W + s.x] = i;
    return s.y * W + s.x;
  });
  while (frontier.length) {
    const next = [];
    // 広がる順をばらつかせて境界をぎざぎざにする
    for (let k = frontier.length - 1; k > 0; k--) {
      const j = rng.int(k + 1);
      [frontier[k], frontier[j]] = [frontier[j], frontier[k]];
    }
    for (const c of frontier) {
      const x = c % W;
      const y = (c - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (land[ni] && cells[ni] < 0) {
          cells[ni] = cells[c];
          next.push(ni);
        }
      }
    }
    frontier = next;
  }

  const used = new Set();
  const provinces = seeds.map((s, id) => ({
    id,
    name: provinceName(rng, used),
    cx: 0,
    cy: 0,
    area: 0,
    neighbors: new Set(),
    ownerId: -1,
    culture: 0,
    fertility: 0.7 + rng.next() * 0.6,
    pop: 0,
    devastation: 0,
  }));
  for (let i = 0; i < W * H; i++) {
    const p = cells[i];
    if (p < 0) continue;
    const pr = provinces[p];
    const x = i % W;
    const y = (i - x) / W;
    pr.cx += x;
    pr.cy += y;
    pr.area++;
    for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
      if (nx >= W || ny >= H) continue;
      const q = cells[ny * W + nx];
      if (q >= 0 && q !== p) {
        pr.neighbors.add(q);
        provinces[q].neighbors.add(p);
      }
    }
  }
  for (const pr of provinces) {
    pr.cx /= Math.max(1, pr.area);
    pr.cy /= Math.max(1, pr.area);
    pr.lat = pr.cy / H;
    // 人口（千人）：広さと土地の豊かさに比例
    pr.capacity = pr.area * pr.fertility * 1.2;
    pr.pop = pr.capacity * (0.7 + rng.next() * 0.2);
  }
  return { W, H, cells, provinces };
}

// 最初の王国の領土：互いに離れた首都から地方を順に取り合う
export function partition(rng, provinces, k) {
  const capitals = [rng.int(provinces.length)];
  while (capitals.length < k) {
    let bestP = -1;
    let bestD = -1;
    for (const p of provinces) {
      const d = Math.min(...capitals.map((c) => Math.hypot(provinces[c].cx - p.cx, provinces[c].cy - p.cy)));
      if (d > bestD) {
        bestD = d;
        bestP = p.id;
      }
    }
    capitals.push(bestP);
  }
  const owner = new Array(provinces.length).fill(-1);
  const fronts = capitals.map((c, i) => {
    owner[c] = i;
    return [c];
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < k; i++) {
      const f = fronts[i];
      const next = [];
      for (const p of f) {
        for (const q of provinces[p].neighbors) {
          if (owner[q] < 0 && rng.chance(0.7)) {
            owner[q] = i;
            next.push(q);
            changed = true;
          } else if (owner[q] < 0) next.push(p);
        }
      }
      fronts[i] = [...new Set(next)];
    }
  }
  return { capitals, owner };
}

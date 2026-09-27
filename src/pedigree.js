// 家系と血縁係数（kinship）。
// 近交係数 F(子) = 血縁係数 φ(父, 母)。
// 古すぎる祖先（cutoffYear より前に生まれた人）は無関係な創始者として扱い、計算量を抑える。

export class Pedigree {
  constructor() {
    this.records = new Map();
    this.memo = new Map();
    this.cutoffYear = -Infinity;
  }

  add(person) {
    this.records.set(person.id, person);
  }

  get(id) {
    return id == null ? undefined : this.records.get(id);
  }

  _rec(id) {
    const r = this.records.get(id);
    if (!r || r.birthYear < this.cutoffYear) return null;
    return r;
  }

  kinship(a, b) {
    if (a == null || b == null) return 0;
    if (a === b) {
      const r = this._rec(a);
      return 0.5 * (1 + (r ? r.F : 0));
    }
    // 親の ID は必ず子より小さいので、大きい方（若い方）を親へさかのぼる
    const x = a > b ? a : b;
    const y = a > b ? b : a;
    const key = x * 67108864 + y;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const r = this._rec(x);
    let v = 0;
    if (r && r.fatherId != null && r.motherId != null) {
      v = 0.5 * (this.kinship(r.fatherId, y) + this.kinship(r.motherId, y));
    }
    this.memo.set(key, v);
    return v;
  }

  // 境目は step 年単位でまとめて動かす（動くたびに記憶を捨てるため）
  prune(cutoffYear, step = 20) {
    const snapped = Math.floor(cutoffYear / step) * step;
    for (const r of this.records.values()) {
      if (!r.alive && r.birthYear < snapped && r.genome) r.genome = null;
    }
    if (snapped !== this.cutoffYear) {
      this.cutoffYear = snapped;
      this.memo.clear();
    }
  }
}

// 血縁係数を「いとこ」などの言葉にする（おおよそ）
export function kinshipLabel(phi) {
  if (phi >= 0.24) return '親子・きょうだい並み';
  if (phi >= 0.11) return '叔父姪・半きょうだい並み';
  if (phi >= 0.05) return 'いとこ並み';
  if (phi >= 0.02) return 'またいとこ並み';
  if (phi > 0.001) return '遠い親戚';
  return '血縁なし';
}

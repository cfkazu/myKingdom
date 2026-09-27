import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, CUSTOMS } from '../src/world.js';

test('同じシードなら同じ歴史になる', () => {
  const a = new World({ seed: 'same' });
  const b = new World({ seed: 'same' });
  for (let i = 0; i < 60; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.log.map((e) => e.text), b.log.map((e) => e.text));
  assert.equal(a.people.size, b.people.size);
});

test('300 年動かしても辻褄が合っている', () => {
  const w = new World({ seed: 'invariants', warLust: 2 });
  for (let i = 0; i < 300; i++) {
    w.step();
    for (const k of w.kingdoms) {
      if (!k.alive) {
        assert.equal(w.provincesOf(k).length, 0, `${k.name} は滅んだのに地方がある`);
        continue;
      }
      assert.ok(w.provincesOf(k).length > 0, `${w.year}: ${k.name} に地方がない`);
      const r = w.ruler(k);
      assert.ok(r && r.alive, `${w.year}: ${k.name} に生きた君主がいない`);
      assert.equal(r.rulerOf, k.id);
      assert.equal(w.provinces[k.capital].ownerId, k.id, `${k.name} の首都が他国にある`);
    }
    for (const pr of w.provinces) assert.ok(w.kingdoms[pr.ownerId].alive);
    for (const p of w.living) {
      if (!p.alive) continue;
      if (p.spouseId != null) {
        const s = w.get(p.spouseId);
        assert.ok(s.alive && s.spouseId === p.id, `${p.id} の配偶者の記録が食い違う`);
        assert.notEqual(s.sex, p.sex);
      }
      if (p.rulerOf != null) assert.equal(w.kingdoms[p.rulerOf].rulerId, p.id);
    }
  }
  assert.ok(w.history.length === 301);
  assert.ok(w.living.length > 50, '貴族が絶えかけている');
  assert.ok(w.living.length < 1500, '貴族が増えすぎている');
});

function withKids(law) {
  const w = new World({ seed: `law-${law}`, law });
  const k = w.aliveKingdoms()[0];
  const r = w.ruler(k);
  let sp = r.spouseId != null ? w.get(r.spouseId) : null;
  if (!sp) {
    sp = w._founder(r.sex === 'M' ? 'F' : 'M', w.age(r), null, { kingdomId: k.id, lowborn: true });
    w._marry(r, sp);
  }
  const [mom, dad] = r.sex === 'F' ? [r, sp] : [sp, r];
  // 既存の子を除いて、姉と弟をつくる
  r.children = [];
  const daughter = w._child(mom, dad, w.year - 10, { sex: 'F', dynastyId: r.dynastyId, kingdomId: k.id });
  const son = w._child(mom, dad, w.year - 5, { sex: 'M', dynastyId: r.dynastyId, kingdomId: k.id });
  r.children = [daughter.id, son.id];
  return { w, k, daughter, son };
}

test('継承法：男系は息子だけ、男子優先は息子が先、絶対長子は先に生まれた子', () => {
  {
    const { w, k, son } = withKids('agnatic');
    const line = w.successionLine(k, 5);
    assert.equal(line[0], son);
    assert.ok(line.every((p) => p.sex === 'M'), '男系相続に女性が入っている');
  }
  {
    const { w, k, son, daughter } = withKids('cognatic');
    const line = w.successionLine(k, 5);
    assert.equal(line[0], son);
    assert.equal(line[1], daughter);
  }
  {
    const { w, k, daughter } = withKids('absolute');
    assert.equal(w.successionLine(k, 5)[0], daughter);
  }
});

test('王が死ぬと継承順位の 1 位が即位する', () => {
  const { w, k, son } = withKids('cognatic');
  const old = w.ruler(k);
  w._kill(old, '病死');
  assert.equal(w.ruler(k), son);
  assert.equal(son.rulerOf, k.id);
  assert.ok(k.regentId != null || w.age(son) >= 16, '幼い王に摂政がつく');
});

test('近親婚の慣習：「近親婚を禁じる」国ではいとこ並みの相手を選ばない', () => {
  const w = new World({ seed: 'custom', custom: 'strict' });
  const men = w.living.filter((p) => p.sex === 'M');
  const women = w.living.filter((p) => p.sex === 'F');
  const s = w.spouseScore(men[0], women[0], 0.0625);
  assert.equal(s, -Infinity);
  assert.ok(CUSTOMS.royal.maxPhi > 0.125, '「血の純潔」なら叔父と姪も許される');
});

test('魅力の高い相手ほど縁談の評価が高い', () => {
  const w = new World({ seed: 'charm' });
  const man = w.living.find((p) => p.sex === 'M' && w.age(p) >= 20 && !w.royalOf(p));
  const a = w.living.find((p) => p.sex === 'F' && w.age(p) >= 16 && w.age(p) <= 25);
  const saved = { ...a.pheno };
  const low = w.spouseScore(man, a, 0);
  a.pheno.beauty = Math.min(100, a.pheno.beauty + 40);
  const high = w.spouseScore(man, a, 0);
  a.pheno = saved;
  assert.ok(high > low);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { World } from "../src/world.js";

// 決断をいつも最初の選択肢で片づけながら進める
function play(w, years, pick = {}) {
  const seen = { marriage: 0, education: 0, grant: 0, faction: 0, end: 0 };
  for (let i = 0; i < years; i++) {
    w.step();
    for (const d of [...w.pendingDecisions()]) {
      seen[d.type]++;
      const choice =
        pick[d.type]?.(d) ??
        {
          marriage: d.candidateIds?.[0] ?? "lowborn",
          education: "learning",
          grant: d.candidateDynIds?.[0] ?? "knight",
          faction: "decline",
          end: "ok",
        }[d.type];
      w.decide(d.id, String(choice));
    }
    if (w.player.over) break;
  }
  return seen;
}

test("遊ぶ家：当主と子の縁談と教育はプレイヤーが決め、AI は勝手に結婚させない", () => {
  const w = new World({ seed: "player-a" });
  const d = w.dynasties.find((x) => w.houseRank(x) === "count");
  w.setPlayer(d.id);
  let aiMarriedChild = 0;
  const seen = { marriage: 0, foster: 0 };
  for (let i = 0; i < 80; i++) {
    const before = new Map(
      w.living
        .filter((p) => p.alive && w.isCore(p))
        .map((p) => [p.id, p.spouseId]),
    );
    w.step();
    // 決断を出さないまま（まだ選んでいない）人が結婚していたら、AI が決めたことになる
    for (const [id, sp] of before) {
      const p = w.get(id);
      // 年の途中で当主が代わり、プレイヤーの手を離れた人（前の当主の子→今の当主のきょうだい）は除く
      if (sp == null && p.spouseId != null && p.alive && w.isCore(p))
        aiMarriedChild++;
    }
    for (const x of [...w.pendingDecisions()]) {
      if (x.type in seen) seen[x.type]++;
      w.decide(x.id, x.type === "foster" ? "general" : "later");
    }
    if (w.player.over) break;
  }
  assert.equal(
    aiMarriedChild,
    0,
    "プレイヤーが選んでいないのに結婚した近親がいる",
  );
  assert.ok(seen.marriage > 0, "縁談の決断が来ない");
  assert.ok(seen.foster > 0, "養育先の決断が来ない");
});

test("縁談を選ぶと結婚し、跡継ぎは養育先で育ち、16 歳で成人の報せが届く", () => {
  const w = new World({ seed: "player-b" });
  const k = w.aliveKingdoms()[0];
  w.setPlayer(w.ruler(k).dynastyId);
  let married = false;
  let fostered = null;
  let grown = false;
  for (let i = 0; i < 160 && !(married && grown); i++) {
    w.step();
    for (const d of [...w.pendingDecisions()]) {
      if (d.type === "marriage" && d.candidateIds.length && !married) {
        const p = w.get(d.personId);
        const c = w.get(d.candidateIds[0]);
        w.decide(d.id, String(c.id));
        if (p.spouseId === c.id) married = true;
      } else if (d.type === "foster" && !fostered) {
        assert.ok(d.options.some((o) => o.key === "home") && d.options.some((o) => o.key === "cloister"));
        const o = d.options.find((x) => x.key === "sage") ?? d.options[0];
        w.decide(d.id, o.key);
        fostered = w.get(d.personId);
        assert.equal(fostered.foster.key, o.key);
      } else if (d.type === "news") {
        if (fostered && d.items.some((x) => x.icon === "🎓" && x.title.includes(fostered.name))) grown = true;
        w.decide(d.id, "ok");
      } else
        w.decide(d.id, d.type === "grant" ? "knight" : d.type === "faction" ? "decline" : "later");
    }
  }
  assert.ok(married, "選んだ相手と結婚しなかった");
  assert.ok(fostered, "養育先の決断が来ない");
  if (fostered.alive && w.age(fostered) >= 16) {
    assert.ok(fostered.foster.done, "16 歳で成人しない");
    assert.ok(grown, "成人の報せが来ない");
  }
});

test("王として宣戦でき、AI はプレイヤーの国の代わりに宣戦しない", () => {
  const w = new World({ seed: "player-c", warLust: 4 });
  const k = w.aliveKingdoms()[0];
  w.setPlayer(w.ruler(k).dynastyId);
  play(w, 30);
  const pk = w.playerKingdom();
  if (pk) {
    const aiWars = w.wars.filter(
      (x) =>
        x.attackerId === pk.id && (x.kind === "conquest" || x.kind === "claim"),
    );
    assert.equal(aiWars.length, 0, "プレイヤーの国が勝手に宣戦している");
    const t = w.warTargets(pk)[0];
    if (t) {
      const war = w.playerDeclareWar(t.t.id, t.claimant?.id ?? null);
      assert.ok(war && !war.ended && war.attackerId === pk.id);
    }
  }
});

test("家が絶えたら、おしまいの知らせが来る", () => {
  const w = new World({ seed: "player-d" });
  const d = w.dynasties.find((x) => w.houseRank(x) === "count");
  w.setPlayer(d.id);
  for (const p of w.living) if (p.dynastyId === d.id) w._kill(p, "病死");
  w.step();
  assert.equal(w.player.over, true);
  assert.equal(w.pendingDecisions()[0]?.type, "end");
});

test("イベント：6 種類とも起こり、継承から外した人は継承順位から消える", () => {
  const seen = new Set();
  let setAsideOk = true;
  for (const seed of ["ev-a", "ev-b", "ev-c", "ev-d"]) {
    const w = new World({ seed });
    const k = w.aliveKingdoms()[0];
    w.setPlayer(
      seed.endsWith("b") || seed.endsWith("d")
        ? w.dynasties.find((x) => w.houseRank(x) === "count").id
        : w.ruler(k).dynastyId,
    );
    for (let i = 0; i < 250 && !w.player.over; i++) {
      w.step();
      for (const d of [...w.pendingDecisions()]) {
        if (d.type === "event") {
          seen.add(d.key);
          const opt =
            d.options.find((o) =>
              ["pass", "disown", "imprison"].includes(o.id),
            ) ?? d.options[0];
          w.decide(d.id, opt.id);
          const p = w.get(d.personId);
          if (
            (p.passedOver || p.imprisoned) &&
            w.aliveKingdoms().some((kk) => w.successionLine(kk, 20).includes(p))
          )
            setAsideOk = false;
          continue;
        }
        w.decide(
          d.id,
          String(
            {
              marriage: d.candidateIds?.[0] ?? "lowborn",
              education: "learning",
              grant: d.candidateDynIds?.[0] ?? "knight",
              faction: "decline",
              end: "ok",
            }[d.type],
          ),
        );
      }
    }
  }
  assert.ok(seen.size >= 5, `起きたイベントが少ない：${[...seen].join(",")}`);
  assert.ok(setAsideOk, "継承から外した人が継承順位に残っている");
});

test("縁談：候補には縁があり、高嶺の花は家格を払えば必ず受ける。国の大事は報せで届く", () => {
  let offers = 0;
  let news = 0;
  let courted = 0;
  for (const seed of ["match", "match2", "match3"]) {
    const w = new World({ seed });
    for (let i = 0; i < 3; i++) w.step();
    const lord = w.dynasties.find(
      (d) =>
        !d.extinct &&
        w.countiesOf(d.id).length &&
        !w.aliveKingdoms().some((k) => w.ruler(k)?.dynastyId === d.id),
    );
    w.setPlayer(lord.id);
    for (let i = 0; i < 150 && !w.player.over; i++) {
      w.step();
      for (const d of [...w.pendingDecisions()]) {
        if (d.type === "news") {
          news++;
          for (const x of d.items) assert.ok(x.title && x.why && x.means);
          w.decide(d.id, "ok");
        } else if (d.type === "marriage" && d.offers?.length) {
          for (const o of d.offers) {
            offers++;
            assert.ok(Array.isArray(o.hooks) && o.cost >= 0);
          }
          const p = w.get(d.personId);
          const my = w.playerDynasty();
          const o =
            d.offers.find((x) => x.cost > 0 && x.cost <= my.prestige) ??
            d.offers.find((x) => !x.cost);
          if (!o) {
            w.decide(d.id, "later");
            continue;
          }
          const before = my.prestige;
          const taken = w.get(o.id).spouseId != null;
          w.decide(d.id, String(o.id));
          // ランダムに断られることはない：選べば必ずまとまる（相手がもう結婚していたら選び直し）
          if (taken) assert.ok(w.pendingDecisions().some((x) => x.type === "marriage" && x.personId === p.id));
          else assert.equal(p.spouseId, o.id);
          if (o.cost) {
            courted++;
            assert.ok(my.prestige <= before - o.cost + 30);
          }
        } else
          w.decide(
            d.id,
            d.type === "education"
              ? "martial"
              : d.type === "grant"
                ? "knight"
                : d.type === "faction"
                  ? "decline"
                  : d.type === "end"
                    ? "ok"
                    : "later",
          );
      }
    }
  }
  assert.ok(offers > 0);
  assert.ok(news > 0);
  assert.ok(courted >= 0);
});

test("内乱：王はカードで知らされ、傭兵・切り崩し・譲歩で手を打てる", () => {
  const w = new World({ seed: "rebel-1" });
  const k = w.aliveKingdoms().find((x) => w.vassals(x).filter((d) => w.countiesOf(d.id, x.id).length).length >= 2);
  w.setPlayer(w.ruler(k).dynastyId);
  for (const d of [...w.pendingDecisions()]) w.decide(d.id, "none");
  const rebels = w.vassals(k).filter((d) => w.countiesOf(d.id, k.id).length && w.head(d)).slice(0, 2);
  w._rebel(k, "usurp", w.head(rebels[0]), [...rebels]);
  const war = w.realmRebellions()[0];
  assert.ok(war, "内乱が始まらない");
  const card = w.pendingDecisions().find((d) => w.dynasties && d.type === "rebellion");
  assert.ok(card && card.role === "king", "内乱のカードが来ない");
  const my = w.playerDynasty();
  my.prestige = 100;
  const before = w._sidePower(war, "D");
  w.rebAction(war.id, "mercs");
  assert.ok(w._sidePower(war, "D") > before * 1.3, "傭兵で兵力が増えない");
  assert.equal(Math.round(my.prestige), 85);
  const other = war.members.find((id) => id !== w.get(war.leaderId).dynastyId);
  if (other != null) {
    w.rebAction(war.id, "peel", other);
    assert.ok(!war.members.includes(other), "切り崩した家が反乱軍に残っている");
  }
  w.rebAction(war.id, "concede");
  assert.ok(war.ended, "譲歩しても戦が終わらない");
});

test("戦争：宣戦の見込みが出て、傭兵・和平・降伏で手を打て、同盟は破棄できる", () => {
  const w = new World({ seed: "war-1" });
  const k = w.aliveKingdoms().find((x) => w.neighbors(x).length);
  w.setPlayer(w.ruler(k).dynastyId);
  for (const d of [...w.pendingDecisions()]) w.decide(d.id, "none");
  const t = w.neighbors(k)[0];
  const pv = w.warPreview(k, t);
  assert.ok(pv.ratio > 0 && ["有利", "互角", "不利"].includes(pv.verdict));
  const war = w.playerDeclareWar(t.id);
  assert.ok(war && w.externalWars().includes(war));
  w.playerDynasty().prestige = 100;
  const before = w._sidePower(war, "A");
  w.warAction(war.id, "mercs");
  assert.ok(w._sidePower(war, "A") > before * 1.3, "傭兵で兵力が増えない");
  war.score = 0;
  w.warAction(war.id, "peace");
  assert.ok(war.ended && war.result === "white", "和平で終わらない");
  // 同盟の破棄
  const o = w.aliveKingdoms().find((x) => x !== k);
  const key = k.id < o.id ? `${k.id}-${o.id}` : `${o.id}-${k.id}`;
  w.alliances.add(key);
  w.breakAlliance(o.id);
  assert.ok(!w.allied(k.id, o.id));
  w._updateAlliances();
  assert.ok(!w.allied(k.id, o.id), "破棄した同盟がすぐ結び直された");
});

test("家格の使い道と野望：伯爵領を買い取り、祝宴・献上・請求権の捏造ができ、野望を果たすと★が増える", () => {
  const w = new World({ seed: "favor-1" });
  // 諸侯の家：買い取りと献上
  const lord = w.dynasties.find((d) => w.houseRank(d) === "count" && w.buyableCounties && w.countiesOf(d.id).length === 1);
  w.setPlayer(lord.id);
  for (const d of [...w.pendingDecisions()]) w.decide(d.id, "none");
  assert.ok(w.player.ambitions.some((a) => a.key === "counts3"), "伯爵家の野望に「伯爵領を 3 つ」がない");
  lord.prestige = 500;
  const buys = w.buyableCounties();
  if (buys.length) {
    const o = buys[0];
    w.buyCounty(o.pr.id);
    assert.equal(o.pr.holder, lord.id, "買い取った伯爵領が自分のものにならない");
  }
  w.tribute();
  assert.ok(lord.favorUntil > w.year);
  // 野望：伯爵領を 3 つにすると果たされる
  while (w.countiesOf(lord.id).length < 3) {
    const pr = w.provinces.find((p) => p.ownerId === lord.kingdomId && p.holder !== lord.id && w.isDemesne(p));
    if (!pr) break;
    pr.holder = lord.id;
  }
  if (w.countiesOf(lord.id).length >= 3) {
    w._ambitionTick();
    assert.ok(w.player.ambitions.find((a) => a.key === "counts3").done != null);
    assert.ok(w.score().stars >= 1);
  }
  // 王家：祝宴と請求権の捏造
  const w2 = new World({ seed: "favor-2" });
  const k = w2.aliveKingdoms().find((x) => w2.neighbors(x).length);
  w2.setPlayer(w2.ruler(k).dynastyId);
  w2.playerDynasty().prestige = 500;
  w2.feast();
  assert.equal(k.feastYear, w2.year);
  const t = w2.fabricateTargets()[0];
  w2.fabricate(t.t.id);
  assert.ok(w2.playerHead().claims.includes(t.t.id));
  assert.ok(w2.warTargets(k).some((x) => x.kind === "claim" && x.t === t.t), "捏造した請求権で継承戦争を起こせない");
});

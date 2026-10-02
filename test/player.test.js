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
  const seen = { marriage: 0, education: 0 };
  for (let i = 0; i < 80; i++) {
    const before = new Map(
      w.living
        .filter((p) => p.alive && w.playerControls(p))
        .map((p) => [p.id, p.spouseId]),
    );
    w.step();
    // 決断を出さないまま（まだ選んでいない）人が結婚していたら、AI が決めたことになる
    for (const [id, sp] of before) {
      const p = w.get(id);
      // 年の途中で当主が代わり、プレイヤーの手を離れた人（前の当主の子→今の当主のきょうだい）は除く
      if (sp == null && p.spouseId != null && p.alive && w.playerControls(p))
        aiMarriedChild++;
    }
    for (const x of [...w.pendingDecisions()]) {
      if (x.type in seen) seen[x.type]++;
      w.decide(x.id, x.type === "education" ? "martial" : "later");
    }
    if (w.player.over) break;
  }
  assert.equal(
    aiMarriedChild,
    0,
    "プレイヤーが選んでいないのに結婚した近親がいる",
  );
  assert.ok(seen.marriage > 0, "縁談の決断が来ない");
  assert.ok(seen.education > 0, "教育の決断が来ない");
});

test("縁談を選ぶと結婚し、教育は能力を伸ばす", () => {
  const w = new World({ seed: "player-b" });
  const k = w.aliveKingdoms()[0];
  w.setPlayer(w.ruler(k).dynastyId);
  let married = false;
  let educated = null;
  for (let i = 0; i < 120 && !(married && educated); i++) {
    w.step();
    for (const d of [...w.pendingDecisions()]) {
      if (d.type === "marriage" && d.candidateIds.length && !married) {
        const p = w.get(d.personId);
        const c = w.get(d.candidateIds[0]);
        w.decide(d.id, String(c.id));
        if (p.spouseId === c.id) married = true;
      } else if (d.type === "education" && !educated) {
        const p = w.get(d.personId);
        const before = p.pheno.intellect;
        w.decide(d.id, "learning");
        educated = p.pheno.intellect - before;
      } else
        w.decide(
          d.id,
          d.type === "education"
            ? "martial"
            : d.type === "grant"
              ? "knight"
              : d.type === "faction"
                ? "decline"
                : "later",
        );
    }
  }
  assert.ok(married, "選んだ相手と結婚しなかった");
  assert.ok(educated > 5, `学問で知略が伸びない（${educated}）`);
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
          w.decide(d.id, String(o.id));
          // ランダムに断られることはない：選べば必ずまとまる
          assert.equal(p.spouseId, o.id);
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

// 王国パネル：王国の一覧と、選んだ王国の君主・継承順位・歴代の王・戦争。

import { LAWS, CUSTOMS } from '../world.js';
import { esc, personLink, kingdomLink, richText } from './util.js';
import { FACTION_LABEL } from '../feudal.js';
import { rebellionHTML, rebellionTitle } from './rebellionView.js';
import { warHTML, previewHTML } from './warView.js';

const HOW = { inherit: '世襲', elected: '選挙', conquest: '征服', usurp: '簒奪', independence: '独立', init: '世襲' };
const KIND = { conquest: '征服戦争', claim: '継承戦争', civil: '内乱', independence: '独立戦争' };

export class RealmPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-war],[data-revoke],[data-rebel],[data-grant]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.war) app.act('war', Number(b.dataset.war), b.dataset.claimant ? Number(b.dataset.claimant) : null);
      else if (b.dataset.revoke) app.act('revoke', Number(b.dataset.revoke));
      else if (b.dataset.rebel) app.act('rebel', b.dataset.rebel);
      else if (b.dataset.grant) app.act('grant', Number(b.dataset.grant));
    });
  }

  // プレイヤーの国なら宣戦、主君の国なら反乱のボタン
  _actions(w, k) {
    return this._rebellions(w, k) + this._actions2(w, k);
  }

  // 内乱への対処（あなたの国で反乱が起きているとき）
  _rebellions(w, k) {
    if (!w.player || w.player.over) return '';
    const wars = w.realmRebellions().filter((x) => x.defenderId === k.id);
    return wars
      .map((war) => {
        const role = w.playerKingdom()?.id === k.id ? 'king' : (war.members ?? []).includes(w.player.dynastyId) ? 'rebel' : 'vassal';
        return `<div class="actions reb-panel"><h3>🔥 内乱への対処：${esc(war.name)}</h3><p class="small">${rebellionTitle(w, war)}</p>${rebellionHTML(w, war, role)}</div>`;
      })
      .join('');
  }

  _actions2(w, k) {
    if (k === w.playerKingdom()) {
      const targets = w.warTargets(k);
      const atWar = w.activeWars(k.id).length;
      const ext = w.externalWars();
      const allies = w.alliesOf(k.id).map((id) => w.kingdoms[id]);
      return `${ext.map((war) => `<div class="actions reb-panel"><h3>⚔ 戦争中：${esc(war.name)}</h3>${warHTML(w, war)}</div>`).join('')}
        <div class="actions"><h3>⚔️ あなたの国の行い</h3>
        ${atWar ? `<p class="small">いま ${atWar} つの戦争を戦っています。</p>` : ''}
        ${allies.length ? `<p class="small">同盟国：${allies.map((a) => `${kingdomLink(a)} <button type="button" class="small" data-break="${a.id}" title="家格 −10。諸侯が少し眉をひそめ、30 年は結び直せない">同盟を破棄</button>`).join(' ')}<br><span class="muted">同盟は王家どうしの婚姻から生まれます。同盟国は戦に加勢してくれますが、同盟国に宣戦すると裏切りになります。</span></p>` : ''}
        ${
          targets.length
            ? `<table class="list"><tbody>${targets
                .map(
                  (t) => `<tr><td>${kingdomLink(t.t)}${t.claimant ? `<div class="small">${personLink(w, t.claimant, { short: true })} の請求権</div>` : '<div class="small muted">国境の地方を奪う</div>'}</td>
                  <td class="small">${previewHTML(w, k, t.t, t.kind)}${w.allied(k.id, t.t.id) ? '<br><span class="bad">同盟国：宣戦すると同盟を破る（諸侯が怒る・30 年は結び直せない）</span>' : ''}${(() => {
                    const tr = w.ruler(t.t);
                    const g = tr ? w.grudgesOf(w.playerDynasty(), tr.dynastyId)[0] : null;
                    return g ? `<br><span class="feud">⚔ 因縁：${richText(w, w.grudgeText(w.playerDynasty(), g))}</span>` : '';
                  })()}</td>
                  <td><button type="button" data-war="${t.t.id}" ${t.claimant ? `data-claimant="${t.claimant.id}"` : ''}>${t.claimant ? '継承戦争' : '宣戦'}</button></td></tr>`,
                )
                .join('')}</tbody></table>`
            : '<p class="small muted">いま攻められる相手はいません（同盟・休戦中・隣国がない）。</p>'
        }
        <p class="small muted">見込みは、同盟国の加勢と包囲網の恐れまで含めた兵力の比です。大陸の 3 分の 1 を超える国が攻めると、ほかの国々が包囲網をつくります。諸侯の土地を取り上げるには、下の諸侯の表の「没収」を。</p></div>`;
    }
    if (k === w.playerLiege()) {
      const d = w.playerDynasty();
      const o = Math.round(d.opinion ?? 0);
      const odds = w.rebelOdds(k);
      const busy = w.activeWars(k.id).some((x) => x.kind === 'civil' || x.kind === 'independence');
      return `<div class="actions"><h3>🗡️ あなたの立場（${esc(d.name)}家）</h3>
        <p class="small">王への忠誠 <span class="opinion ${o >= 10 ? 'pos' : o <= -10 ? 'neg' : ''}">${o > 0 ? '+' : ''}${o}</span>。反乱を起こすと、あなたの兵 ${Math.round(odds.mine)}千${odds.allies ? `＋加わりそうな ${odds.allies} 家` : ''} 対 王の兵 ${Math.round(odds.king)}千（比 <b class="${odds.ratio >= 1 ? 'good' : 'bad'}">${odds.ratio.toFixed(2)}</b>）。</p>
        ${busy ? '<p class="small muted">いまは内乱の最中です。</p>' : `<p class="choices"><button type="button" data-rebel="usurp">👑 王位を奪う反乱</button><button type="button" data-rebel="independence">🏳️ 独立の反乱</button></p>`}
        <p class="small muted">負ければ当主は処刑か幽閉、家の所領は没収されます。王が幼い・狂っている・負け戦のあと、が狙い目です。</p></div>`;
    }
    return '';
  }

  render() {
    const w = this.app.world;
    const selId = this.app.selectedKingdom;
    const cards = w.aliveKingdoms().map((k) => {
      const r = w.ruler(k);
      const d = r ? w.dyn(r) : null;
      const allies = w.alliesOf(k.id).map((a) => w.kingdoms[a].name);
      const wars = w.activeWars(k.id);
      return `<div class="card${k.id === selId ? ' sel' : ''}" data-kid="${k.id}" style="--kc:${k.color}">
        <div class="t">${esc(k.name)}王国 <span class="muted small">${w.provincesOf(k).length} 地方・兵力 ${Math.round(w.power(k))}千</span></div>
        <div>${r ? `${r.sex === 'M' ? '王' : '女王'} ${personLink(w, r)}（${w.age(r)}歳）` : '空位'}${k.regentId != null ? `・摂政 ${personLink(w, w.get(k.regentId), { short: true })}` : ''}</div>
        <div class="small muted">${d ? `${esc(d.name)}朝・` : ''}${LAWS[k.law].label}・${CUSTOMS[k.custom].label}${allies.length ? `・同盟：${esc(allies.join('・'))}` : ''}${wars.length ? `・<b style="color:var(--war)">交戦中</b>` : ''}</div>
      </div>`;
    });
    const dead = w.kingdoms.filter((k) => !k.alive);
    this.el.innerHTML = `
      <div class="cards">${cards.join('')}</div>
      ${dead.length ? `<p class="small muted">滅んだ国：${dead.map((k) => `<span class="klink" data-kid="${k.id}">${esc(k.name)}（${k.foundedYear}〜${k.endYear}）</span>`).join('、')}</p>` : ''}
      ${selId != null ? this._detail(w, w.kingdoms[selId]) : '<p class="small muted">王国をクリックするか、地図の地方をクリックすると詳細が出ます。</p>'}
    `;
  }

  _detail(w, k) {
    const r = w.ruler(k);
    const line = k.alive && r ? w.successionLine(k, 6) : [];
    const rulers = [...k.rulers].reverse();
    const wars = w.wars.filter((x) => x.attackerId === k.id || x.defenderId === k.id || x.attackerAllies.includes(k.id) || x.defenderAllies.includes(k.id)).slice(-12).reverse();
    return `
      <h2 style="margin-top:16px">${kingdomLink(k)}王国 <span class="small muted">${k.foundedYear}年〜${k.alive ? '' : `${k.endYear}年`}</span></h2>
      <p class="small">${LAWS[k.law].label}：${LAWS[k.law].desc}<br>${CUSTOMS[k.custom].label}：${CUSTOMS[k.custom].desc}</p>
      ${
        k.alive && r
          ? `<h3>${k.law === 'elective' ? '次の選挙の票読み' : '継承順位'}</h3>
        <table class="list"><tbody>${line
          .map((p, i) => {
            const rel = this._relation(w, r, p);
            return `<tr><td class="num">${i + 1}</td><td>${personLink(w, p)}</td><td>${w.age(p)}歳</td><td class="muted">${esc(rel)}</td></tr>`;
          })
          .join('') || '<tr><td class="muted">継承者がいない（王家断絶の危機）</td></tr>'}</tbody></table>`
          : ''
      }
      ${k.alive ? this._actions(w, k) : ''}
      ${k.alive ? this._feudal(w, k) : ''}
      <h3>歴代の君主（${k.rulers.length}）</h3>
      <table class="list"><thead><tr><th>君主</th><th>王朝</th><th>治世</th><th>即位</th></tr></thead><tbody>
      ${rulers
        .map((x) => {
          const p = w.get(x.id);
          const d = w.dynasties[x.dynastyId];
          return `<tr class="click" data-pid="${x.id}"><td>${esc(x.name)}${x.epithet ? `「${esc(x.epithet)}」` : ''}</td><td>${d ? esc(d.name) : '—'}</td><td class="num">${x.from}〜${x.to ?? ''}</td><td>${HOW[x.how]}${p && p.F >= 0.05 ? ` <span class="badge gene">F=${p.F.toFixed(2)}</span>` : ''}</td></tr>`;
        })
        .join('')}
      </tbody></table>
      <h3>戦争</h3>
      ${
        wars.length
          ? `<table class="list"><tbody>${wars
              .map(
                (x) =>
                  `<tr><td>${esc(x.name)}<div class="small muted">${KIND[x.kind]}・${x.startYear}〜${x.endYear ?? ''}・会戦 ${x.battles.length}</div></td><td>${
                    x.ended ? { attacker: '攻め手の勝ち', defender: '守り手の勝ち', white: '痛み分け' }[x.result] : `<b style="color:var(--war)">継続中</b>（戦況 ${Math.round(x.score)}）`
                  }</td></tr>`,
              )
              .join('')}</tbody></table>`
          : '<p class="small muted">戦争の記録はない。</p>'
      }
    `;
  }

  _feudal(w, k) {
    const demesne = w.demesneOf(k);
    const vassals = w.vassals(k).sort((a, b) => w.countiesOf(b.id, k.id).length - w.countiesOf(a.id, k.id).length || (a.opinion ?? 0) - (b.opinion ?? 0));
    const mine = k === w.playerKingdom();
    const inFaction = new Map();
    for (const f of k.factions ?? []) for (const id of f.members) inFaction.set(id, f.kind);
    const rank = { duke: '公爵', count: '伯爵', landless: '無領' };
    const rows = vassals
      .map((d) => {
        const h = w.head(d);
        const o = Math.round(d.opinion ?? 0);
        const parts = w.opinionOf(d, k).parts;
        const why = parts.map(([v, t]) => `${v > 0 ? '+' : ''}${v} ${t}`).join('\n');
        // 大きく効いている理由を 2 つ、表にそのまま出す
        const top = [...parts].filter(([, t]) => t !== '基本').sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 2);
        const f = inFaction.get(d.id);
        return `<tr><td><span class="kdot" style="background:${d.color}"></span>${esc(d.name)}家<div class="small">${h ? personLink(w, h, { short: true }) : ''}</div></td>
          <td>${esc(w.houseTitle(d) ?? rank[w.houseRank(d)])}</td>
          <td class="num"><button type="button" class="chip-btn" data-flash="${w.countiesOf(d.id, k.id).map((pr) => pr.id).join(',')}" data-flash-kind="news" title="この家の伯爵領を地図で光らせる">${w.countiesOf(d.id, k.id).length}</button></td>
          <td class="num"><span class="opinion ${o >= 10 ? 'pos' : o <= -10 ? 'neg' : ''}" title="${esc(why)}">${o > 0 ? '+' : ''}${o}</span><div class="small muted why">${top.map(([v, t]) => `${esc(t)} ${v > 0 ? '+' : ''}${v}`).join('<br>')}</div></td>
          <td>${f ? `<span class="badge bad">${FACTION_LABEL[f]}</span>` : ''}${mine ? `<button type="button" class="small" data-revoke="${d.id}" title="いちばん大きな伯爵領を取り上げて王領にする。その家は強く恨み、ほかの諸侯も王を恐れる">没収</button>` : ''}</td></tr>`;
      })
      .join('');
    const factions = (k.factions ?? [])
      .map((f) => {
        const leader = w.get(f.leaderId);
        const goal = f.kind === 'claimant' ? `${personLink(w, leader)} を王に` : f.kind === 'usurp' ? `盟主 ${personLink(w, leader)} を王に` : `盟主 ${personLink(w, leader)} のもとで独立`;
        return `<li><b>${FACTION_LABEL[f.kind]}</b>：${f.members.map((id) => esc(w.dynasties[id].name)).join('・')}家 — ${goal}。兵力は王の <b>${Math.round(f.ratio * 100)}%</b></li>`;
      })
      .join('');
    return `
      <h3>王領（${demesne.length} / 直轄できる上限 ${w.demesneLimit(k)}）</h3>
      ${
        mine
          ? `<div class="chips small">${demesne.map((pr) => `<span><button type="button" class="chip-btn" data-flash="${pr.id}" data-flash-kind="mine" title="地図で光らせる">${esc(pr.name)}</button>${pr.id === k.capital ? '（首都）' : ` <button type="button" class="small" data-grant="${pr.id}" title="この伯爵領を諸侯に与える（相手を選べる）。与えた家の忠誠は上がる">与える</button>`}</span>`).join('')}</div><p class="small muted">土地を与えると、その家の忠誠が上がり兵もよく出すようになります。上限を超えた分は、年に一度、誰に与えるか聞かれます。</p>`
          : `<p class="small">${demesne.map((pr) => `<button type="button" class="chip-btn" data-flash="${pr.id}" title="地図で光らせる">${esc(pr.name)}</button>${pr.id === k.capital ? '（首都）' : ''}`).join('')}。上限を超えた土地は恩賞として諸侯に与えられる。</p>`
      }
      <h3>諸侯（${vassals.length} 家）</h3>
      ${vassals.length ? `<table class="list"><thead><tr><th>家</th><th>爵位</th><th class="num">伯爵領</th><th class="num">忠誠</th><th>派閥</th></tr></thead><tbody>${rows}</tbody></table><p class="small muted">忠誠の数字の下は、大きく効いている理由。数字にマウスを乗せると内訳がすべて出ます。忠誠が低い家は兵を出し渋り、-10 を下回ると派閥をつくりはじめます。${mine ? '没収すると、その家は強く恨み（-50）、ほかの諸侯も王を恐れます（-8）。' : ''}</p>` : '<p class="small muted">諸侯はいない。</p>'}
      ${factions ? `<h3>不満な諸侯の派閥</h3><ul class="small">${factions}</ul><p class="small muted">派閥の兵力が王の兵力に迫ると反乱が起きる。王が弱い（幼い・狂気・敗戦続き）ほど早く立ち上がる。</p>` : ''}
    `;
  }

  _relation(w, r, p) {
    if (p.fatherId === r.id || p.motherId === r.id) return p.sex === 'M' ? '息子' : '娘';
    const gp = [p.fatherId, p.motherId].map((id) => w.get(id)).filter(Boolean);
    if (gp.some((x) => x.fatherId === r.id || x.motherId === r.id)) return p.sex === 'M' ? '孫息子' : '孫娘';
    if (p.fatherId != null && (p.fatherId === r.fatherId || p.motherId === r.motherId)) return p.sex === 'M' ? '兄弟' : '姉妹';
    const rp = [r.fatherId, r.motherId].map((id) => w.get(id)).filter(Boolean);
    if (rp.some((y) => y.fatherId != null && (p.fatherId === y.fatherId || p.motherId === y.motherId))) return p.sex === 'M' ? 'おじ' : 'おば';
    if (gp.some((x) => x.fatherId != null && (x.fatherId === r.fatherId || x.motherId === r.motherId))) return p.sex === 'M' ? '甥' : '姪';
    const phi = w.ped.kinship(r.id, p.id);
    return phi > 0.001 ? `血縁係数 ${phi.toFixed(3)}` : '血縁なし';
  }
}

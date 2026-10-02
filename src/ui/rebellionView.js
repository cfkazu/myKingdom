// 内乱の戦況と、打てる手（決断カードと王国タブで共用）。

import { MERC_COST, CONCEDE_COST } from '../rebellion.js';
import { esc, richText } from './util.js';

export function rebellionHTML(w, war, role) {
  const s = w.rebelStatus(war);
  const k = w.kingdoms[war.defenderId];
  const my = w.playerDynasty();
  const prestige = Math.round(my?.prestige ?? 0);
  // 戦況のメーター：左が王、右が反乱軍。真ん中が 0
  const pos = Math.max(0, Math.min(100, 50 + s.score / 2));
  const meter = `<div class="reb-meter" title="戦況 ${Math.round(s.score)}（+100 で反乱軍の勝ち、−100 で王の勝ち）"><span class="reb-side">王</span><div class="reb-bar"><i style="left:${pos}%"></i></div><span class="reb-side">反乱軍</span></div>`;
  const lean = s.score <= -30 ? '王が優勢' : s.score >= 30 ? '反乱軍が優勢' : '五分五分';
  const head = `<p class="small">兵力 王 ${Math.round(s.king)} 対 反乱軍 ${Math.round(s.rebels)}（反乱軍は王の ${s.ratio.toFixed(2)} 倍）・戦況 ${Math.round(s.score)}（${lean}）・長くてもあと ${s.yearsLeft} 年で決着${s.mercs ? '・<span class="good">傭兵が王の側で戦っている</span>' : ''}</p>${meter}
    <p class="small muted">戦は毎年の会戦で進み、戦況が ±100 に届くか 7 年たつと決着します。兵力の多い側・指揮の高い側が会戦に勝ちやすい。忠誠が −15 を下回る諸侯は、王のために兵を出しません。</p>`;
  const btn = (act, label, cost, title, arg = '') => `<button type="button" class="${cost != null && prestige < cost ? '' : 'primary'}" data-reb="${war.id}" data-reb-act="${act}" data-reb-arg="${arg}"${cost != null && prestige < cost ? ' disabled' : ''} title="${esc(title)}">${label}</button>`;
  if (role === 'king') {
    // 戦況に応じた、おすすめの一言
    const tip =
      s.ratio > 1.3
        ? '⚠ 兵力で大きく負けています。決戦は危険です。傭兵を雇うか、兵の多い家を切り崩して差を縮めましょう。家格が足りなければ、譲歩して和睦するのも手です。'
        : s.ratio > 0.9
          ? '兵力はほぼ互角です。傭兵か切り崩しで少し上回れば、決戦で早く片づけられます。'
          : '兵力では勝っています。決戦を挑めば早く鎮められます（指揮の差しだいで負けることもあります）。';
    const peel = s.members
      .map((m) => `<tr><td>${esc(m.d.name)}家${m.leader ? ' <span class="badge bad">盟主</span>' : ''}</td><td class="num">${m.counties}</td><td class="num">${Math.round(m.d.opinion ?? 0)}</td><td>${m.leader ? '<span class="small muted">切り崩せない</span>' : btn('peel', `切り崩す（家格 −${Math.round(m.cost)}）`, Math.round(m.cost), '恩赦と恩賞を約束して、この家を反乱から抜けさせる。その家の兵が反乱軍から消える', m.d.id)}</td></tr>`)
      .join('');
    return `${head}
      <p class="small reb-tip">${tip}</p>
      <div class="reb-acts">
        ${btn('mercs', `💰 傭兵を雇う（家格 −${MERC_COST}）`, s.mercs ? 1e9 : MERC_COST, '3 年のあいだ、王の兵力が 35% 増える')}
        ${btn('battle', '⚔ 決戦を挑む', null, '今年もう一度会戦する。勝てば戦況が王に傾き、負ければ反乱軍に傾く。兵力の比が悪いときは危ない')}
        ${btn('concede', war.kind === 'independence' ? `🏳 独立を認める（家格 −${CONCEDE_COST}）` : `📜 譲歩して和睦する（家格 −${CONCEDE_COST}）`, CONCEDE_COST, war.kind === 'independence' ? '地方は離れるが、戦はすぐ終わる' : '王領を一つ盟主の家に与え、戦を終わらせる。反乱した家は罰を受けない')}
      </div>
      <h3 class="small">反乱軍の家（切り崩すと、その家の兵が反乱軍から消える）</h3>
      <table class="list small"><thead><tr><th>家</th><th class="num">伯爵領</th><th class="num">忠誠</th><th></th></tr></thead><tbody>${peel}</tbody></table>
      <p class="small muted">いまの家格 ${prestige}。勝てば盟主は処刑か幽閉、反乱した家の所領は没収されます。負ければ${war.kind === 'independence' ? '地方が独立します' : 'あなたは王位を失います'}。</p>`;
  }
  if (role === 'rebel') {
    return `${head}<div class="reb-acts">${btn('surrender', '🙇 降伏して許しを請う（家格 −20%）', null, '反乱から抜ける。罰は免れるが、家格が下がる')}</div>
      <p class="small muted">あなたの家は反乱軍です。勝てば望みがかない、負ければ盟主は処刑か幽閉、所領は没収されます。</p>`;
  }
  return `${head}<div class="reb-acts">
      ${(war.loyalists ?? []).includes(my.id) ? '<span class="good small">王に兵を出しています</span>' : btn('support', '🛡 王に兵を出す', null, '王の忠誠 +10。王が勝てば、反乱した家の没収地を賜りやすい')}
      ${btn('join', '🗡 反乱に加わる', null, 'あなたの所領の兵が反乱軍に回る。勝てば望みがかない、負ければ罰を受ける')}
    </div><p class="small muted">何もしなければ、あなたの兵はふつうに王のために戦います（忠誠が −15 未満なら出しません）。</p>`;
}

export function rebellionTitle(w, war) {
  const names = (war.members ?? []).map((id) => `${w.dynasties[id].name}家`).join('・');
  const goal = war.kind === 'independence' ? '独立' : war.claimantId != null ? `${richText(w, w.pn(w.get(war.claimantId)))} の擁立` : `${richText(w, w.pn(w.get(war.leaderId)))} の王位`;
  return `${esc(names)}が反旗：狙いは${goal}`;
}

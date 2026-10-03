// 他国との戦争：戦況と打てる手（決断カード・王国タブで共用）と、宣戦前の見込み。

import { MERC_COST } from '../rebellion.js';
import { esc, kingdomLink } from './util.js';

// 王の出陣：自ら指揮をとるか、後方にとどまるか（あなたの国の戦争・内乱で共通）
export function leadHTML(w) {
  const k = w.playerKingdom();
  if (!k) return '';
  const r = w.ruler(k);
  const lead = !!w.player.kingLeads;
  const c = w.commander(k);
  return `<div class="small lead-row">${lead ? `👑 <b>王が自ら出陣している</b>（指揮 ${Math.round(w.martial(r))}・兵の士気で兵力 +10%。ただし戦死の恐れ）` : `🏰 <b>王は後方にとどまっている</b>（指揮は ${c && c !== r ? `${esc(c.regnal ?? c.name)}・指揮 ${Math.round(w.martial(c))}` : 'なし'}。王は戦死しない）`}
    <button type="button" class="small" data-lead="${lead ? 0 : 1}">${lead ? '後方にとどまる' : '自ら出陣する'}</button></div>`;
}

export function warHTML(w, war) {
  const v = w.warView(war);
  const my = w.playerDynasty();
  const prestige = Math.round(my?.prestige ?? 0);
  const pos = Math.max(0, Math.min(100, 50 - v.score / 2));
  const lean = v.score >= 30 ? 'こちらが優勢' : v.score <= -30 ? '相手が優勢' : '五分五分';
  const peaceCost = v.score >= -20 ? 0 : Math.round(-v.score * 0.3);
  const tip =
    v.ratio < 0.75
      ? '⚠ 兵力で負けています。決戦は危険です。傭兵で差を縮めるか、戦況が悪くなる前に和平を申し入れましょう。'
      : v.ratio < 1.15
        ? '兵力はほぼ互角です。傭兵を雇えば会戦に勝ちやすくなります。'
        : '兵力では勝っています。決戦を挑めば戦況を早く進められます。戦況が +50 を超えたら、勝ちを認めさせられます。';
  const btn = (act, label, disabled, title, plain = false) => `<button type="button" class="${disabled || plain ? '' : 'primary'}" data-war-act="${act}" data-war-id="${war.id}"${disabled ? ' disabled' : ''} title="${esc(title)}">${label}</button>`;
  return `<p class="small">相手：${kingdomLink(v.enemy)}${v.main ? '' : '（同盟国として加勢中）'}・兵力 こちら ${Math.round(v.my)} 対 ${Math.round(v.their)}（${v.ratio.toFixed(2)} 倍）・戦況 ${Math.round(v.score)}（${lean}）・長くてもあと ${v.yearsLeft} 年${v.mercs ? '・<span class="good">傭兵が戦っている</span>' : ''}</p>
    <div class="reb-meter" title="戦況：+100 でこちらの勝ち、−100 で負け"><span class="reb-side">こちら</span><div class="reb-bar war-bar"><i style="left:${pos}%"></i></div><span class="reb-side">${esc(v.enemy.name)}</span></div>
    <p class="small reb-tip">${tip}</p>
    ${leadHTML(w)}
    <div class="reb-acts">
      ${btn('mercs', `💰 傭兵を雇う（家格 −${MERC_COST}）`, v.mercs || prestige < MERC_COST, '3 年のあいだ、こちらの兵力が 35% 増える')}
      ${btn('battle', war.pitched === w.year ? '⚔ 決戦（今年は済み）' : '⚔ 決戦を挑む', war.pitched === w.year, '今年もう一度会戦する（1 年に 1 回まで）。勝てば戦況が進み、負ければ戻る')}
      ${v.main ? (() => { const need = war.kind === 'claim' ? 80 : 50; return btn('demand', `🏆 勝ちを認めさせる（戦況 +${need} から）`, v.score < need, `戦況が +${need} を超えていれば、相手はすぐ負けを認める${war.kind === 'claim' ? '（王位がかかる継承戦争は +80）' : ''}`); })() : ''}
      ${v.main ? btn('peace', peaceCost ? `🤝 和平を申し入れる（賠償 家格 −${peaceCost}）` : '🤝 和平を申し入れる（白紙）', peaceCost > prestige, '領土は動かさずに戦を終える。戦況が −20 より悪いと賠償が要る') : ''}
      ${v.main ? '' : '<span class="small muted">加勢している戦争は、主の国どうしが終わらせます（和平・勝ちを認めさせる・降伏は選べません）</span>'}
      ${v.main ? btn('surrender', '🏳 降伏する', false, '負けを認めて戦を終える。攻めた側なら地方を失うこともある', true) : ''}
    </div>
    <p class="small muted">勝てば${v.side === 'A' ? (war.kind === 'claim' ? '請求者が王位に就きます' : '国境の地方を奪えます') : '相手から地方を奪えることがあります'}。負ければ${v.side === 'D' ? (war.kind === 'claim' ? '王位を追われます' : '国境の地方を割譲します') : '地方を失うことがあります'}。7 年たつと戦況で決着します。いまの家格 ${prestige}。</p>`;
}

// 宣戦の見込み（王国タブの宣戦の表で使う）
export function previewHTML(w, k, t, kind) {
  const p = w.warPreview(k, t, kind);
  const list = (ks) => ks.map((x) => esc(x.name)).join('・');
  const lines = [];
  if (p.theirAllies.length) lines.push(`<span class="bad">守り手に加勢しそう：${list(p.theirAllies)}</span>`);
  if (p.coalition.length) lines.push(`<span class="bad">⚠ 包囲網の恐れ：${list(p.coalition)}</span>`);
  if (p.myAllies.length) lines.push(`<span class="good">こちらに加勢しそう：${list(p.myAllies)}</span>`);
  return `見込み <b class="${p.verdict === '有利' ? 'good' : p.verdict === '不利' ? 'bad' : ''}">${p.verdict}</b>（同盟国を含めた兵力 ${p.ratio.toFixed(1)} 倍・相手だけなら ${p.plain.toFixed(1)} 倍）${lines.length ? `<br>${lines.join('<br>')}` : ''}`;
}

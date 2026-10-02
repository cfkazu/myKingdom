// ゲームループと画面の組み立て。

import { World, LAWS, CUSTOMS } from './world.js';
import { MapView } from './ui/mapView.js';
import { PersonPanel } from './ui/personPanel.js';
import { FamilyTree } from './ui/familyTree.js';
import { RealmPanel } from './ui/realmPanel.js';
import { DynastyPanel } from './ui/dynastyPanel.js';
import { StatsPanel } from './ui/statsPanel.js';
import { renderGuide } from './ui/guidePanel.js';
import { Court } from './ui/court.js';
import { DecisionPanel } from './ui/decisions.js';
import { richText, bindLinks, esc } from './ui/util.js';

const $ = (sel) => document.querySelector(sel);

const LOG_ICON = { war: '⚔️', succession: '👑', dynasty: '🏰', marriage: '💍', birth: '👶', death: '✝️', gene: '🧬', event: '🌍' };

const randomSeed = () => Math.random().toString(36).slice(2, 8);

class App {
  constructor() {
    this.settings = { seed: randomSeed(), kingdoms: 5, provinces: 42, law: 'mixed', custom: 'mixed', plague: true, warLust: 1 };
    this.playing = false;
    this.speed = 3;
    this.tab = 'person';
    this.logFilter = 'major';
    this.followKingdom = null;
    this.followDynasty = null;
    this.map = new MapView($('#map'), $('#map-tip'), null, {
      onSelectKingdom: (id) => this.selectKingdom(id, true),
      onSelectPerson: (id) => this.selectPerson(id),
    });
    this.court = new Court($('#court'), this);
    this.decisionPanel = new DecisionPanel($('#decision'), this);
    this.choosing = false;
    this.panels = {
      person: new PersonPanel($('#tab-person'), this),
      family: new FamilyTree($('#tab-family'), this),
      realm: new RealmPanel($('#tab-realm'), this),
      dynasty: new DynastyPanel($('#tab-dynasty'), this),
      stats: new StatsPanel($('#tab-stats'), this),
    };
    renderGuide($('#tab-guide'));
    this._bind();
    this.newWorld();
    this._loop();
    this._intro();
  }

  newWorld() {
    this.world = new World(this.settings);
    this.map.setWorld(this.world);
    this.selectedPerson = null;
    this.selectedKingdom = null;
    this.selectedDynasty = null;
    this.pinned = null;
    // 最初は最も大きな国の王を見せる
    const big = this.world.aliveKingdoms().reduce((a, b) => (this.world.provincesOf(a).length >= this.world.provincesOf(b).length ? a : b));
    this.selectedPerson = big.rulerId;
    this.map.selectedPerson = big.rulerId;
    this.followKingdom = big.id;
    this.followDynasty = null;
    this.renderSettings();
    this.renderAll(true);
  }

  _bind() {
    // 内乱への手（決断カードと王国タブのどちらからでも）
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-reb]');
      if (!b || b.disabled) return;
      e.stopPropagation();
      const arg = b.dataset.rebArg === '' ? null : Number(b.dataset.rebArg);
      const msg = this.world.rebAction(Number(b.dataset.reb), b.dataset.rebAct, arg);
      if (msg) this.toast(msg);
      this.renderAll();
    });
    // 他国との戦争の手と、同盟の破棄
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-war-act],[data-break]');
      if (!b || b.disabled) return;
      e.stopPropagation();
      const msg = b.dataset.break != null ? this.world.breakAlliance(Number(b.dataset.break)) : this.world.warAction(Number(b.dataset.warId), b.dataset.warAct);
      if (msg) this.toast(msg);
      this.renderAll();
    });
    // 地方の名前のボタン：地図でその地方を光らせる（決断カードの中はカードの側で受ける）
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-flash]');
      if (!b || b.closest('#decision')) return;
      this.flashProvinces(b.dataset.flash.split(',').filter(Boolean).map(Number), b.dataset.flashKind ?? 'mine');
      $('#map')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    $('#btn-play').addEventListener('click', () => this.setPlaying(!this.playing));
    $('#btn-step').addEventListener('click', () => this.advance(1));
    $('#btn-step10').addEventListener('click', () => this.advance(10));
    $('#speed').addEventListener('change', (e) => (this.speed = Number(e.target.value)));
    const setMode = (mode) => {
      this.map.mode = mode;
      document.querySelectorAll('#map-levels button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      if (['kingdom', 'duchy', 'county'].includes(mode)) $('#map-mode').value = '';
      this.renderMap();
    };
    document.querySelectorAll('#map-levels button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('#map-mode').addEventListener('change', (e) => setMode(e.target.value || 'kingdom'));
    $('#log-filter').addEventListener('change', (e) => {
      this.logFilter = e.target.value;
      this.renderLog(true);
    });
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    document.querySelectorAll('[data-event]').forEach((b) =>
      b.addEventListener('click', () => {
        const w = this.world;
        const ev = b.dataset.event;
        if (ev === 'plague') w.startPlague();
        if (ev === 'war' || ev === 'peace') w.setEra(ev);
        if (ev === 'hemophilia') {
          const g = w.sendCarrierPrincess();
          if (g) this.selectPerson(g.id);
        }
        this.renderAll();
      }),
    );
    const links = {
      onPerson: (id) => this.selectPerson(id),
      onKingdom: (id) => this.selectKingdom(id, true),
      onDynasty: (id) => this.selectDynasty(id),
    };
    bindLinks($('#log'), links);
    bindLinks($('#court'), links);
    bindLinks($('#follow-bar'), links);
    bindLinks($('#decision'), links);
    for (const id of ['#tab-person', '#tab-family', '#tab-realm', '#tab-dynasty']) bindLinks($(id), links);
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        this.setPlaying(!this.playing);
      }
    });
  }

  // はじめての人への案内（一度閉じたら出さない）
  _intro() {
    let seen = false;
    try {
      seen = localStorage.getItem('mykingdom-intro') === '1';
    } catch {
      seen = false;
    }
    $('#intro').hidden = seen;
    $('#intro-close').addEventListener('click', () => {
      $('#intro').hidden = true;
      try {
        localStorage.setItem('mykingdom-intro', '1');
      } catch {
        // 保存できなくても困らない
      }
      this.choosing = true;
      this.decisionPanel.render();
    });
    if (seen) {
      this.choosing = true;
      this.decisionPanel.render();
    }
  }

  setPlaying(v) {
    // 決断が待っているあいだは進めない。決め終わったら自動で再生を再開する
    if (v && this.world && (this.world.pendingDecisions().length || this.choosing)) {
      this.resumeAfterDecision = true;
      if (!this.choosing) this.toast('先に決断を選んでください。選び終わると再生が始まります。');
      v = false;
    }
    if (!v && !this.world?.pendingDecisions().length) this.resumeAfterDecision = false;
    this.playing = v;
    $('#btn-play').textContent = v ? '⏸ 一時停止' : '▶ 再生';
  }

  advance(n) {
    for (let i = 0; i < n; i++) {
      if (this.world.pendingDecisions().length || this.choosing) break;
      this.world.step();
    }
    this.phase = 1;
    this.renderAll();
  }

  _loop() {
    let last = performance.now();
    let acc = 0;
    this.phase = 1;
    const frame = (t) => {
      const dt = Math.min(0.5, (t - last) / 1000);
      last = t;
      if (this.playing && this.world.pendingDecisions().length) {
        this.resumeAfterDecision = true;
        this.setPlaying(false);
      }
      if (this.playing) {
        acc += dt * this.speed;
        let n = 0;
        while (acc >= 1 && n < 10) {
          this.world.step();
          acc -= 1;
          n++;
          // 決断が来たら時間を止める
          if (this.world.pendingDecisions().length) {
            this.resumeAfterDecision = true;
            this.setPlaying(false);
            break;
          }
        }
        if (acc >= 1) acc %= 1;
        this.phase = acc;
        if (n) this.renderAll();
      } else acc = 0;
      this.map.frame(t, dt, this.phase);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  showTab(tab) {
    this.tab = tab;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${tab}`));
    this.renderPanel();
  }

  selectPerson(id) {
    this.selectedPerson = id;
    this.map.selectedPerson = id;
    const p = this.world.get(id);
    // 君主を選んだら、その国の王位を追いかける（亡くなったら次の君主に切り替わる）
    this.followKingdom = p && p.alive && p.rulerOf != null ? p.rulerOf : null;
    if (p && p.kingdomId != null) this.map.selectedKingdom = null;
    if (this.tab !== 'person' && this.tab !== 'family') this.showTab('person');
    else this.renderPanel();
  }

  selectKingdom(id, show) {
    this.selectedKingdom = id;
    this.map.selectedKingdom = this.world.kingdoms[id]?.alive ? id : null;
    this.renderMap();
    this.court.render();
    if (show) this.showTab('realm');
    this.renderLog(true);
  }

  selectDynasty(id) {
    this.selectedDynasty = id;
    this.showTab('dynasty');
  }

  // 遊ぶ家を決める（null なら眺めるだけ）
  startPlaying(dynId) {
    this.choosing = false;
    this.world.setPlayer(dynId);
    this.follow(dynId);
    this.renderAll();
    this.setPlaying(true);
  }

  // 鑑定：家格を払って、よその家の人の遺伝子を調べる
  // 報せの地方を地図で光らせる
  flashProvinces(pids, kind = 'news') {
    this.map.flash(pids, kind);
  }

  // 人物欄の「縁談を探す」
  seekMatch(pid) {
    const p = this.world.get(pid);
    if (!this.world.seekMatch(p)) return this.toast('いまは縁談を探せません。');
    this.setPlaying(false);
    this.renderAll();
  }

  examine(pid) {
    const ok = this.world.examine(this.world.get(pid));
    if (!ok) this.toast('家格が足りません。');
    this.renderAll();
  }

  decide(id, choice) {
    if (choice === 'another') {
      this.world.decide(id, 'ok');
      this.choosing = true;
      this.renderAll();
      return;
    }
    const msg = this.world.decide(id, choice);
    if (msg) this.toast(msg);
    this.renderAll();
    if (!this.world.pendingDecisions().length && this.resumeAfterDecision) {
      this.resumeAfterDecision = false;
      this.setPlaying(true);
    }
  }

  // プレイヤーの行い（宣戦・没収・反乱）
  act(kind, a, b) {
    const w = this.world;
    if (kind === 'war') w.playerDeclareWar(a, b);
    if (kind === 'revoke') w.playerRevoke(a);
    if (kind === 'rebel') w.playerRebel(a);
    if (kind === 'grant') {
      const k = w.playerKingdom();
      if (k) w._playerGrantDecision(k, w.provinces[a], true);
    }
    this.renderAll();
  }

  toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (el.hidden = true), 3200);
  }

  // 家を追う：当主が亡くなると次の当主に切り替わる。年代記もその家に絞る
  follow(dynId) {
    this.followDynasty = dynId;
    const d = dynId != null ? this.world.dynasties[dynId] : null;
    const h = d ? this.world.head(d) : null;
    if (h) {
      this._followedHead = h.id;
      this.selectedPerson = h.id;
      this.map.selectedPerson = h.id;
    }
    if (d) {
      this.logFilter = 'house';
      $('#log-filter').value = 'house';
      this.renderLog(true);
    } else if (this.logFilter === 'house') {
      this.logFilter = 'major';
      $('#log-filter').value = 'major';
      this.renderLog(true);
    }
    this.renderFollowBar();
    this.showTab('person');
  }

  // 内乱・戦争中なら、戦況と「対処する」。王で戦がなければ「宣戦する」
  _rebelBar(w, d) {
    if (!w.player || w.player.dynastyId !== d.id || w.player.over) return '';
    const pk = w.playerKingdom();
    const ext = w.externalWars().map((war) => {
      const v = w.warView(war);
      return `<div class="lands-bar small">⚔ <b>戦争中：${war.name}</b>　戦況 ${Math.round(v.score)}（${v.score >= 30 ? 'こちらが優勢' : v.score <= -30 ? '相手が優勢' : '五分五分'}）<button type="button" class="small" data-gorealm="${pk.id}">対処する</button></div>`;
    });
    const idle = pk && !ext.length && !w.realmRebellions().length ? `<div class="lands-bar small">⚔ 戦争はしていません <button type="button" class="small" data-gorealm="${pk.id}">宣戦・同盟を見る</button></div>` : '';
    return ext.join('') + idle + w
      .realmRebellions()
      .map((war) => `<div class="lands-bar small bad">🔥 <b>内乱中：${war.name}</b>　戦況 ${Math.round(war.score)}（${war.score <= -30 ? '王が優勢' : war.score >= 30 ? '反乱軍が優勢' : '五分五分'}）<button type="button" class="small" data-gorealm="${war.defenderId}">対処する</button></div>`)
      .join('');
  }

  // あなたの領地：名前を押すと地図で光る
  _landsBar(w, d) {
    if (!w.player || w.player.dynastyId !== d.id || w.player.over) return '';
    const mine = [...this.map.myProvinces()].map((id) => w.provinces[id]);
    if (!mine.length) return '';
    const pk = w.playerKingdom();
    const label = (pr) => `${pr.name}${pk && pr.id === pk.capital ? '♛' : pr.id === d.homeProvinceId ? '🏰' : ''}`;
    const duchies = w.duchies.filter((du) => w.duchyHolderDyn(du) === d.id);
    return `<div class="lands-bar small">🗺️ <b>あなたの領地 ${mine.length}</b>${duchies.length ? `（${duchies.map((du) => `${du.name}公領`).join('・')}）` : ''}：<button type="button" class="small" data-flash="${mine.map((pr) => pr.id).join(',')}" data-flash-kind="mine">すべて光らせる</button>${mine.map((pr) => `<button type="button" class="chip-btn" data-flash="${pr.id}" data-flash-kind="mine">${pr.name ? label(pr) : ''}</button>`).join('')}</div>`;
  }

  _goalBar(w, d) {
    if (!w.player || w.player.dynastyId !== d.id || w.player.over) return '';
    const g = w.goalProgress();
    const ach = (w.player.achievements ?? []).map((x) => x.icon).join('');
    if (!g) return `<div class="goal-bar small">🎯 目標なし ${ach}<button type="button" class="small" data-goal="1">目標を選ぶ</button></div>`;
    const bar = g.ratio != null ? `<span class="goal-meter"><i style="width:${Math.round(g.ratio * 100)}%"></i></span>` : '';
    return `<div class="goal-bar small">${g.icon} <b>${g.label}</b>：${g.text} ${bar}${g.met ? `<span class="good">目標ラインに到達！あと ${g.hold - g.held} 年保てば達成</span>` : ''} ${ach}<button type="button" class="small" data-goal="1">目標を変える</button></div>`;
  }

  renderFollowBar() {
    const el = $('#follow-bar');
    const w = this.world;
    const d = this.followDynasty != null ? w.dynasties[this.followDynasty] : null;
    if (!d) {
      el.hidden = true;
      return;
    }
    const h = d.extinct ? null : w.head(d);
    const title = h ? w.titleOf(h) : '';
    el.hidden = false;
    if (!h) {
      el.innerHTML = `<span class="kdot" style="background:${d.color}"></span><b>✝️ ${d.name}家は ${d.extinctYear ?? w.year} 年に絶えました</b><button type="button" id="unfollow" class="small">閉じる</button>`;
      el.querySelector('#unfollow').addEventListener('click', () => this.follow(null));
      return;
    }
    el.innerHTML = `<span class="kdot" style="background:${d.color}"></span><b>${w.player && w.player.dynastyId === d.id && !w.player.over ? `👑 あなたの家：${d.name}家（${w.houseStanding(d).label}）` : `📌 ${d.name}家を追っています`}</b><span class="small">${h ? `当主 <a class="plink" data-pid="${h.id}">${h.regnal ?? h.name}</a>${title ? `（${title}）` : ''}・${w.age(h)}歳` : ''}</span><button type="button" id="unfollow" class="small">やめる</button>${this._rebelBar(w, d)}${this._landsBar(w, d)}${this._goalBar(w, d)}${
      w.player && w.player.dynastyId === d.id && !w.player.over && w.houseStanding(d).rank === 0
        ? '<div class="small hint">⚠️ あなたの家は所領を失いました。王家や大きな家との縁談で請求権や同盟を得るか、家タブから別の家に乗り換えましょう。</div>'
        : ''
    }`;
    el.querySelector('#unfollow').addEventListener('click', () => this.follow(null));
    for (const b of el.querySelectorAll('[data-gorealm]'))
      b.addEventListener('click', () => {
        this.selectKingdom(Number(b.dataset.gorealm), true);
        this.showTab('realm');
        this.setPlaying(false);
      });
    el.querySelector('[data-goal]')?.addEventListener('click', () => {
      this.world._goalDecision();
      this.setPlaying(false);
      this.renderAll();
    });
  }

  pin(id) {
    this.pinned = id;
    this.renderPanel();
  }

  renderAll(fresh = false) {
    const w = this.world;
    const sel = this.selectedPerson != null ? w.get(this.selectedPerson) : null;
    // 追っている家があれば、いつも当主を映す
    const fd = this.followDynasty != null ? w.dynasties[this.followDynasty] : null;
    if (fd) {
      const h = fd.extinct ? null : w.head(fd);
      if (!h) {
        // 絶えた家は、帯に「絶えました」と出す
      } else if (!sel || !sel.alive || h.id !== this._followedHead) {
        // 当主が代わったら、いつも新しい当主を映す
        this.selectedPerson = h.id;
        this.map.selectedPerson = h.id;
      }
      this._followedHead = h ? h.id : null;
    }
    if (sel && !sel.alive && this.followKingdom != null && !fd) {
      const k = w.kingdoms[this.followKingdom];
      const next = k && k.alive ? w.ruler(k) : null;
      if (next) {
        this.selectedPerson = next.id;
        this.map.selectedPerson = next.id;
      } else this.followKingdom = null;
    }
    $('#clock-year').textContent = `${w.year}年`;
    const status = [];
    if (w.plague) status.push('🦠 疫病');
    if (w.era && w.era.until > w.year) status.push(w.era.kind === 'war' ? `⚔️ 戦乱の時代（〜${w.era.until}）` : `🕊️ 平和の時代（〜${w.era.until}）`);
    $('#clock-status').textContent = status.join('　');
    const wars = w.wars.filter((x) => !x.ended).length;
    const h = w.history.at(-1);
    const stat = (label, value, hint, cls = '') => `<span class="qs${cls ? ` ${cls}` : ''}" title="${hint}"><span class="qs-l">${label}</span><b>${value}</b></span>`;
    $('#quick-stats').innerHTML = [
      stat('王国', w.aliveKingdoms().length, 'いま大陸にある王国の数'),
      stat('戦争中', wars, 'いま続いている戦争・反乱の数', wars ? 'hot' : ''),
      stat('王侯貴族', `${h.nobles}人`, '名前のある王侯貴族の人数（平民は人口として数えている）'),
      stat('家', w.dynasties.filter((d) => !d.extinct).length, '絶えていない貴族の家の数'),
      stat('君主の血の濃さ', h.rulerF.toFixed(3), '君主の近交係数の平均。いとこ婚の子は 0.0625、叔父と姪の子は 0.125。高いほど劣性の遺伝病が出やすい'),
      stat('遺伝病の患者', `血友病 ${h.cases.hem}・受け口 ${h.cases.jaw}・狂気 ${h.cases.mad}`, 'いま生きている王侯貴族のうち、発症している人の数。地図の「ほかの地図 → 遺伝病」で場所が見られる'),
    ].join('');
    this.renderMap();
    this.map.yearAdvanced(this.playing ? 1000 / this.speed : 0);
    this.court.render();
    this.renderLog(fresh);
    this.decisionPanel.render();
    this.renderFollowBar();
    this.renderPanel();
  }

  renderMap() {
    this.map.draw();
    $('#map-legend').innerHTML = this.map.legendHTML();
  }

  _logMatch(e) {
    const f = this.logFilter;
    if (f === 'all') return true;
    if (f === 'kingdom') {
      const p = this.selectedPerson != null ? this.world.get(this.selectedPerson) : null;
      const kid = this.selectedKingdom ?? p?.kingdomId;
      return kid != null && e.kingdoms.includes(kid);
    }
    if (f === 'house') {
      if (this.followDynasty == null) return false;
      return [...e.text.matchAll(/\{p:(\d+)\}/g)].some((m) => this.world.get(Number(m[1]))?.dynastyId === this.followDynasty) || e.text.includes(`${this.world.dynasties[this.followDynasty].name}家`);
    }
    if (f === 'marriage') return e.kind === 'marriage' || e.kind === 'birth';
    if (f === 'succession') return e.kind === 'succession' || e.kind === 'dynasty';
    if (f === 'major') return ['succession', 'dynasty', 'event', 'gene'].includes(e.kind) || (e.kind === 'war' && /宣戦|終わ|蜂起|反旗|鎮圧|滅/.test(e.text)) || (e.kind === 'death' && /崩御|倒れた|処刑|暗殺|噂/.test(e.text));
    return e.kind === f;
  }

  renderLog(fresh = false) {
    const el = $('#log');
    const w = this.world;
    if (fresh || this._logWorld !== w) {
      el.innerHTML = '';
      this._logWorld = w;
      this._logShown = Math.max(0, w.log.length - 400);
    }
    // 年代記はログの先頭が古いので、新しいものを上に積む
    if (this._logShown > w.log.length) this._logShown = Math.max(0, w.log.length - 400);
    const frag = document.createDocumentFragment();
    for (let i = this._logShown; i < w.log.length; i++) {
      const e = w.log[i];
      if (!this._logMatch(e)) continue;
      const li = document.createElement('li');
      li.className = e.kind;
      li.innerHTML = `<span class="y">${e.year}</span><span class="ic" aria-hidden="true">${LOG_ICON[e.kind] ?? '・'}</span><span class="tx">${richText(w, e.text)}</span>`;
      frag.prepend(li);
    }
    this._logShown = w.log.length;
    el.prepend(frag);
    while (el.children.length > 400) el.lastChild.remove();
  }

  renderPanel() {
    const p = this.panels[this.tab];
    if (p) p.render();
  }

  renderSettings() {
    const s = this.settings;
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${v.label}</option>`).join('');
    $('#tab-settings').innerHTML = `
      <h2>新しい世界</h2>
      <p class="small muted">同じシードと設定なら、同じ大陸・同じ歴史になります。</p>
      <div class="form">
        <label for="s-seed">シード</label><span><input id="s-seed" type="text" value="${esc(s.seed)}" size="12"> <button type="button" id="s-rand">🎲</button></span>
        <label for="s-k">王国の数</label><input id="s-k" type="number" min="2" max="10" value="${s.kingdoms}">
        <label for="s-p">地方の数</label><input id="s-p" type="number" min="16" max="70" value="${s.provinces}">
        <label for="s-law">継承法</label><select id="s-law"><option value="mixed"${s.law === 'mixed' ? ' selected' : ''}>国ごとにばらばら</option>${opt(LAWS, s.law)}</select>
        <label for="s-custom">近親婚への考え</label><select id="s-custom"><option value="mixed"${s.custom === 'mixed' ? ' selected' : ''}>国ごとにばらばら</option>${opt(CUSTOMS, s.custom)}</select>
        <label for="s-war">戦争の起こりやすさ</label><select id="s-war">${[0.3, 1, 2, 4].map((v) => `<option value="${v}"${v === s.warLust ? ' selected' : ''}>${{ 0.3: '穏やか', 1: 'ふつう', 2: '好戦的', 4: '戦国' }[v]}</option>`).join('')}</select>
        <label for="s-plague">疫病</label><span><input id="s-plague" type="checkbox"${s.plague ? ' checked' : ''}> ときどき流行する</span>
      </div>
      <p><button type="button" class="primary" id="s-go">この設定で新しい世界を始める</button></p>
    `;
    $('#s-rand').addEventListener('click', () => ($('#s-seed').value = randomSeed()));
    $('#s-go').addEventListener('click', () => {
      this.settings = {
        seed: $('#s-seed').value || randomSeed(),
        kingdoms: Math.max(2, Math.min(10, Number($('#s-k').value) || 5)),
        provinces: Math.max(16, Math.min(70, Number($('#s-p').value) || 42)),
        law: $('#s-law').value,
        custom: $('#s-custom').value,
        warLust: Number($('#s-war').value),
        plague: $('#s-plague').checked,
      };
      this.setPlaying(false);
      this.newWorld();
      this.choosing = true;
      this.decisionPanel.render();
      this.showTab('person');
    });
  }
}

window.app = new App();

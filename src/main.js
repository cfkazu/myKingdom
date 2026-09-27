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
import { richText, bindLinks, esc } from './ui/util.js';

const $ = (sel) => document.querySelector(sel);

const randomSeed = () => Math.random().toString(36).slice(2, 8);

class App {
  constructor() {
    this.settings = { seed: randomSeed(), kingdoms: 5, provinces: 42, law: 'mixed', custom: 'mixed', plague: true, warLust: 1 };
    this.playing = false;
    this.speed = 3;
    this.tab = 'person';
    this.logFilter = 'all';
    this.map = new MapView($('#map'), $('#map-tip'), null, {
      onSelectKingdom: (id) => this.selectKingdom(id, true),
      onSelectPerson: (id) => this.selectPerson(id),
    });
    this.court = new Court($('#court'), this);
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
    this.renderSettings();
    this.renderAll(true);
  }

  _bind() {
    $('#btn-play').addEventListener('click', () => this.setPlaying(!this.playing));
    $('#btn-step').addEventListener('click', () => this.advance(1));
    $('#btn-step10').addEventListener('click', () => this.advance(10));
    $('#speed').addEventListener('change', (e) => (this.speed = Number(e.target.value)));
    $('#map-mode').addEventListener('change', (e) => {
      this.map.mode = e.target.value;
      this.renderMap();
    });
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
    for (const id of ['#tab-person', '#tab-family', '#tab-realm', '#tab-dynasty']) bindLinks($(id), links);
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        this.setPlaying(!this.playing);
      }
    });
  }

  setPlaying(v) {
    this.playing = v;
    $('#btn-play').textContent = v ? '⏸ 一時停止' : '▶ 再生';
  }

  advance(n) {
    for (let i = 0; i < n; i++) this.world.step();
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
      if (this.playing) {
        acc += dt * this.speed;
        let n = 0;
        while (acc >= 1 && n < 10) {
          this.world.step();
          acc -= 1;
          n++;
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

  pin(id) {
    this.pinned = id;
    this.renderPanel();
  }

  renderAll(fresh = false) {
    const w = this.world;
    $('#clock-year').textContent = `${w.year}年`;
    const status = [];
    if (w.plague) status.push('🦠 疫病');
    if (w.era && w.era.until > w.year) status.push(w.era.kind === 'war' ? `⚔️ 戦乱の時代（〜${w.era.until}）` : `🕊️ 平和の時代（〜${w.era.until}）`);
    $('#clock-status').textContent = status.join('　');
    const wars = w.wars.filter((x) => !x.ended).length;
    const h = w.history.at(-1);
    $('#quick-stats').innerHTML = `
      <span>王国 <b>${w.aliveKingdoms().length}</b></span>
      <span>王侯貴族 <b>${h.nobles}</b> 人</span>
      <span>家 <b>${w.dynasties.filter((d) => !d.extinct).length}</b></span>
      <span>戦争 <b>${wars}</b></span>
      <span>君主の近交係数 <b>${h.rulerF.toFixed(3)}</b></span>
      <span>血友病の遺伝子 <b>${(h.freq.hem * 100).toFixed(1)}%</b></span>`;
    this.renderMap();
    this.map.yearAdvanced(this.playing ? 1000 / this.speed : 0);
    this.court.render();
    this.renderLog(fresh);
    this.renderPanel();
  }

  renderMap() {
    this.map.draw();
    $('#map-legend').innerHTML = this.map.legendHTML();
  }

  _logMatch(e) {
    const f = this.logFilter;
    if (f === 'all') return true;
    if (f === 'kingdom') return this.selectedKingdom != null && e.kingdoms.includes(this.selectedKingdom);
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
      li.innerHTML = `<span class="y">${e.year}</span>${richText(w, e.text)}`;
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
      this.showTab('realm');
    });
  }
}

window.app = new App();

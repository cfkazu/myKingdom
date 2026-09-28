// 統計パネル：領土・貴族の数・近交係数・遺伝病の遺伝子頻度・能力の平均・出生と死因。

import { Chart } from './charts.js';

export class StatsPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.build();
  }

  build() {
    this.el.innerHTML = '';
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    // 選んだ家（遊んでいる家・追っている家）と、貴族全体をくらべる
    const head = document.createElement('div');
    head.className = 'house-stats-head';
    head.innerHTML = '<h2>家の統計</h2><label class="small">家 <select id="stats-house"></select></label>';
    this.el.append(head);
    this.houseSelect = head.querySelector('select');
    this.houseSelect.addEventListener('change', () => {
      this.houseId = this.houseSelect.value === '' ? null : Number(this.houseSelect.value);
      this.render();
    });
    this.houseTraits = new Chart(this.el, {
      title: '能力の平均（実線＝この家、点線＝貴族全体）',
      series: [
        { label: '容姿', color: '--series-5' },
        { label: '知略', color: '--series-1' },
        { label: '武勇', color: '--series-2' },
        { label: 'カリスマ', color: '--series-4' },
        { label: '全体の容姿', color: '--series-5', dash: true },
        { label: '全体の知略', color: '--series-1', dash: true },
        { label: '全体の武勇', color: '--series-2', dash: true },
        { label: '全体のカリスマ', color: '--series-4', dash: true },
      ],
      desc: '縁談の相手と教育で、家の血筋がどう変わっていくか。',
    });
    this.houseBlood = new Chart(this.el, {
      title: '血の濃さ：近交係数 F の平均（実線＝この家、点線＝貴族全体）',
      series: [
        { label: 'この家', color: '--accent' },
        { label: '貴族全体', color: '--text-3', dash: true },
      ],
      format: (v) => v.toFixed(3),
    });
    this.houseSize = new Chart(this.el, {
      title: 'この家の人数と、遺伝病を発症している人',
      series: [
        { label: '存命の人数', color: '--series-3' },
        { label: '発症者（血友病・受け口・狂気・虚弱）', color: '--bad' },
      ],
    });
    const h2 = document.createElement('h2');
    h2.textContent = '大陸全体の統計';
    h2.style.marginTop = '20px';
    this.el.append(h2);
    this.land = new Chart(this.el, { title: '王国の領土（地方の数）', series: [], desc: '国の興亡。線が途切れた国は滅んだ国。' });
    this.nobles = new Chart(this.el, { title: '王侯貴族の人数', series: [{ label: '人数', color: '--series-1' }] });
    this.inbreed = new Chart(this.el, {
      title: '近交係数 F の平均',
      series: [
        { label: '君主', color: '--series-2' },
        { label: '王族', color: '--series-5' },
        { label: '貴族全体', color: '--series-1' },
      ],
      format: (v) => v.toFixed(3),
      desc: 'いとこ婚の子は 0.0625、叔父と姪の子は 0.125。「血の純潔を尊ぶ」国の王家で高くなりやすい。',
    });
    this.genes = new Chart(this.el, {
      title: '遺伝病の遺伝子の頻度（貴族全体）',
      series: [
        { label: '血友病 h', color: '--bad' },
        { label: '受け口 j', color: '--series-4' },
        { label: '狂気 m', color: '--gene' },
        { label: '有害因子 d', color: '--series-3' },
      ],
      format: pct,
      desc: '劣性の遺伝子は、保因者の中に潜んで世代を越える。血友病の男子は若くして亡くなりやすいので、h は選択で減っていく。',
    });
    this.traits = new Chart(this.el, {
      title: '能力の平均（貴族全体）',
      series: [
        { label: '容姿', color: '--series-5' },
        { label: '知略', color: '--series-1' },
        { label: '武勇', color: '--series-2' },
        { label: 'カリスマ', color: '--series-4' },
      ],
      desc: '魅力の高い人ほど結婚しやすく、有能な人ほど王に選ばれ戦で生き残る。平均はどう動く？',
    });
    this.vital = new Chart(this.el, {
      title: '出生・戦死・疫病死（年ごと）',
      series: [
        { label: '出生', color: '--series-3' },
        { label: '戦死', color: '--war' },
        { label: '疫病', color: '--gene' },
      ],
    });
  }

  render() {
    const w = this.app.world;
    const h = w.history;
    const xs = h.map((r) => r.year);
    // 家の選択肢：遊んでいる家・追っている家を先頭に、いま人のいる家
    const def = w.player && !w.player.over ? w.player.dynastyId : this.app.followDynasty;
    if (this.houseId == null || this._world !== w) this.houseId = def ?? null;
    this._world = w;
    const alive = w.dynasties.filter((d) => !d.extinct || d.id === this.houseId).sort((a, b) => (b.id === def) - (a.id === def) || b.prestige - a.prestige);
    this.houseSelect.innerHTML = `<option value="">（家を選ぶ）</option>${alive.map((d) => `<option value="${d.id}"${d.id === this.houseId ? ' selected' : ''}>${d.name}家${d.id === w.player?.dynastyId ? '（あなたの家）' : ''}${d.extinct ? '（断絶）' : ''}</option>`).join('')}`;
    const id = this.houseId;
    const hv = (f) => h.map((r) => (id != null && r.houses?.[id] ? f(r.houses[id]) : null));
    const show = id != null;
    for (const c of [this.houseTraits, this.houseBlood, this.houseSize]) c.root.hidden = !show;
    if (show) {
      const t = (k) => h.map((r) => r.traits[k]);
      this.houseTraits.setData(xs, [hv((x) => x.beauty), hv((x) => x.intellect), hv((x) => x.strength), hv((x) => x.charisma), t('beauty'), t('intellect'), t('strength'), t('charisma')]);
      this.houseBlood.setData(xs, [hv((x) => x.F), h.map((r) => r.nobleF)]);
      this.houseSize.setData(xs, [hv((x) => x.n), hv((x) => x.sick)]);
    }
    const seen = w.kingdoms.filter((k) => h.some((r) => r.kingdoms[k.id]));
    const dup = (k) => seen.filter((o) => o.name === k.name).length > 1;
    this.land.setSeries(seen.map((k) => ({ label: dup(k) ? `${k.name}（${k.foundedYear}〜${k.alive ? '' : k.endYear}）` : k.name, color: k.color })));
    this.land.setData(
      xs,
      seen.map((k) => h.map((r) => r.kingdoms[k.id]?.provinces ?? 0)),
    );
    this.nobles.setData(xs, [h.map((r) => r.nobles)]);
    this.inbreed.setData(xs, [h.map((r) => r.rulerF), h.map((r) => r.royalF), h.map((r) => r.nobleF)]);
    this.genes.setData(xs, [h.map((r) => r.freq.hem), h.map((r) => r.freq.jaw), h.map((r) => r.freq.mad), h.map((r) => r.freq.del)]);
    this.traits.setData(xs, [h.map((r) => r.traits.beauty), h.map((r) => r.traits.intellect), h.map((r) => r.traits.strength), h.map((r) => r.traits.charisma)]);
    this.vital.setData(xs, [h.map((r) => r.births), h.map((r) => r.deaths['戦死'] ?? 0), h.map((r) => r.deaths['疫病'] ?? 0)]);
  }
}

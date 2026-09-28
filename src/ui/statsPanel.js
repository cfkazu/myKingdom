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

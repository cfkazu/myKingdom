// 依存ライブラリなしの小さなチャート（折れ線・積み上げ面）。ホバーで十字線とツールチップを出す。

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function resolveColor(c) {
  return c.startsWith('--') ? cssVar(c) : c;
}

export class Chart {
  // options: { title, desc, kind: 'line'|'stack', series: [{label, color, dash}], yMax, yMin, format, refLine: {value, label} }
  constructor(container, options) {
    this.o = { kind: 'line', yMin: 0, format: (v) => String(Math.round(v)), ...options };
    this.xs = [];
    this.data = [];
    this.hoverIndex = null;

    this.root = document.createElement('div');
    this.root.className = 'chart';
    const head = document.createElement('div');
    head.className = 'chart-head';
    const title = document.createElement('div');
    title.className = 'chart-title';
    title.textContent = this.o.title;
    this.legend = document.createElement('div');
    this.legend.className = 'legend';
    head.append(title, this.legend);
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', this.o.title);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tooltip';
    this.tooltip.hidden = true;
    this.root.append(head, this.canvas, this.tooltip);
    if (this.o.desc) {
      const d = document.createElement('p');
      d.className = 'chart-desc';
      d.textContent = this.o.desc;
      this.root.append(d);
    }
    container.append(this.root);
    this._renderLegend();

    const move = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const n = this.xs.length;
      if (n === 0) return;
      const { left, width } = this._plot(r.width, r.height);
      const i = Math.round(((x - left) / width) * (n - 1));
      this.hoverIndex = Math.max(0, Math.min(n - 1, i));
      this.draw();
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerdown', move);
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverIndex = null;
      this.tooltip.hidden = true;
      this.draw();
    });
  }

  setSeries(series) {
    this.o.series = series;
    this._renderLegend();
  }

  _renderLegend() {
    const s = this.o.series;
    if (s.length < 2 && !this.o.refLine) {
      this.legend.innerHTML = '';
      return;
    }
    const items = s.map(
      (x) =>
        `<span><span class="key${x.dash ? ' dash' : ''}" style="background:${resolveColor(x.color)};color:${resolveColor(x.color)}"></span>${x.label}</span>`,
    );
    if (this.o.refLine) items.push(`<span><span class="key dash" style="color:var(--text-3)"></span>${this.o.refLine.label}</span>`);
    this.legend.innerHTML = items.join('');
  }

  setData(xs, data) {
    this.xs = xs;
    this.data = data;
    this.draw();
  }

  _plot(w, h) {
    const left = 40;
    const right = 22;
    const top = 8;
    const bottom = 22;
    return { left, top, width: w - left - right, height: h - top - bottom };
  }

  draw() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (w === 0) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { left, top, width, height } = this._plot(w, h);
    const { kind, series } = this.o;
    const n = this.xs.length;
    const textColor = cssVar('--text-3');
    const gridColor = cssVar('--grid');
    const surface = cssVar('--surface');

    // y 範囲
    let yMin = this.o.yMin;
    let yMax = this.o.yMax;
    if (yMax === undefined && kind === 'stack') yMax = 1;
    if (yMax === undefined) {
      yMax = 0;
      for (const s of this.data) for (const v of s) if (v > yMax) yMax = v;
      if (this.o.refLine) yMax = Math.max(yMax, this.o.refLine.value);
      // 4 分割した目盛りがきりのいい数になるように
      yMax = niceStep((yMax * 1.05 || 1) / 4) * 4;
    }
    const X = (i) => left + (n <= 1 ? width / 2 : (i / (n - 1)) * width);
    const Y = (v) => top + height - ((v - yMin) / (yMax - yMin)) * height;

    // グリッドと軸ラベル
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = textColor;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const v = yMin + ((yMax - yMin) * k) / 4;
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
      ctx.fillText(this.o.format(v), left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (n > 0) {
      const ticks = Math.min(6, n);
      for (let k = 0; k < ticks; k++) {
        const i = ticks === 1 ? 0 : Math.round((k / (ticks - 1)) * (n - 1));
        ctx.fillText(`${this.xs[i]}年`, X(i), top + height + 6);
      }
    }

    if (n === 0) return;

    if (this.o.refLine) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = textColor;
      ctx.beginPath();
      ctx.moveTo(left, Y(this.o.refLine.value));
      ctx.lineTo(left + width, Y(this.o.refLine.value));
      ctx.stroke();
      ctx.restore();
    }

    if (kind === 'stack') {
      const acc = new Array(n).fill(0);
      for (let s = 0; s < series.length; s++) {
        const lower = acc.slice();
        for (let i = 0; i < n; i++) acc[i] += this.data[s][i] || 0;
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(acc[i]));
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(lower[i]));
        ctx.closePath();
        ctx.fillStyle = resolveColor(series[s].color);
        ctx.fill();
        // 面と面の間に 2px の隙間
        ctx.strokeStyle = surface;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(acc[i]));
        ctx.stroke();
      }
    } else {
      for (let s = 0; s < series.length; s++) {
        ctx.save();
        ctx.strokeStyle = resolveColor(series[s].color);
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        if (series[s].dash) ctx.setLineDash([5, 4]);
        ctx.beginPath();
        for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(this.data[s][i]));
        ctx.stroke();
        ctx.restore();
      }
    }

    // ホバー
    const hi = this.hoverIndex;
    if (hi !== null && hi < n) {
      const x = X(hi);
      ctx.strokeStyle = textColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
      const rows = [];
      let acc = 0;
      for (let s = 0; s < series.length; s++) {
        const v = this.data[s][hi] || 0;
        acc += v;
        const yv = kind === 'stack' ? acc : v;
        ctx.beginPath();
        ctx.arc(x, Y(yv), 4, 0, Math.PI * 2);
        ctx.fillStyle = resolveColor(series[s].color);
        ctx.fill();
        ctx.strokeStyle = surface;
        ctx.lineWidth = 2;
        ctx.stroke();
        rows.push(
          `<div class="row"><span><span class="swatch" style="background:${resolveColor(series[s].color)}"></span>${series[s].label}</span><span class="val">${this.o.format(v, true)}</span></div>`,
        );
      }
      if (kind === 'stack') rows.reverse();
      this.tooltip.innerHTML = `<div><strong>${this.xs[hi]}年</strong></div>${rows.join('')}`;
      this.tooltip.hidden = false;
      const tw = this.tooltip.offsetWidth;
      const cw = this.root.clientWidth;
      let tx = x + 12;
      if (tx + tw > cw) tx = x - tw - 12;
      this.tooltip.style.left = `${Math.max(0, tx)}px`;
      this.tooltip.style.top = `${this.canvas.offsetTop + 4}px`;
    }
  }
}

function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

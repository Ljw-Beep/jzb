// 手写 SVG 图表：饼图 + 折线图。纯本地，无第三方库。
import { el } from './components.js';
import { fmtMoney } from './utils.js';

/** 计算每个扇区的起止角度（弧度），从 12 点方向顺时针。 */
export function computePie(items) {
  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  let angle = -Math.PI / 2;
  return items.map((item) => {
    const frac = total > 0 ? (Number(item.amount) || 0) / total : 0;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    return { ...item, frac, start, end, total };
  });
}

/** 生成一段饼图扇区路径。 */
export function arcPath(cx, cy, r, start, end) {
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return 'M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
    ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z';
}

/** 取一个好看的坐标轴最大值。 */
export function niceMax(v) {
  if (!v || v <= 0) return 100;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  let mult = 1;
  if (n <= 1) mult = 1;
  else if (n <= 2) mult = 2;
  else if (n <= 2.5) mult = 2.5;
  else if (n <= 5) mult = 5;
  else mult = 10;
  return mult * base;
}

/** 折线坐标点。 */
export function buildLinePoints(values, width, height, pad) {
  const n = values.length;
  const max = niceMax(Math.max(...values, 0));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  return values.map((v, i) => {
    const x = pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = pad.top + innerH - (max > 0 ? (v / max) * innerH : 0);
    return { x, y, value: v, index: i };
  });
}

function emptyChart(text) {
  return el('div', { class: 'chart-empty' }, el('div', { class: 'empty-ico', text: '📉' }), el('p', { text }));
}

/**
 * 饼图。
 * @param {{items:Array, onSelect?:Function, centerLabel?:string}} opts
 */
export function renderPie(opts) {
  const { items, onSelect, centerLabel } = opts;
  const wrap = el('div', { class: 'pie-wrap' });
  const total = items.reduce((s, i) => s + i.amount, 0);
  if (!items.length || total <= 0) return emptyChart('这段时间还没有支出');

  const slices = computePie(items);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 240 240');
  svg.setAttribute('class', 'pie-svg');
  svg.setAttribute('role', 'img');

  const cx = 120;
  const cy = 120;
  const r = 100;

  if (slices.length === 1) {
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', slices[0].color || '#2f80ed');
    circle.setAttribute('class', 'pie-slice');
    if (onSelect) circle.addEventListener('click', () => onSelect(slices[0]));
    svg.append(circle);
  } else {
    slices.forEach((s) => {
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', arcPath(cx, cy, r, s.start, s.end));
      p.setAttribute('fill', s.color || '#2f80ed');
      p.setAttribute('class', 'pie-slice');
      p.setAttribute('data-id', s.id);
      const t = document.createElementNS(svgNS, 'title');
      t.textContent = s.name + ' ' + fmtMoney(s.amount) + '（' + Math.round(s.frac * 100) + '%）';
      p.append(t);
      if (onSelect) p.addEventListener('click', () => onSelect(s));
      svg.append(p);
    });
  }

  // 中心留空 + 总额
  const hole = document.createElementNS(svgNS, 'circle');
  hole.setAttribute('cx', cx);
  hole.setAttribute('cy', cy);
  hole.setAttribute('r', 58);
  hole.setAttribute('fill', '#fff');
  svg.append(hole);

  const valueText = document.createElementNS(svgNS, 'text');
  valueText.setAttribute('x', cx);
  valueText.setAttribute('y', cy - 2);
  valueText.setAttribute('text-anchor', 'middle');
  valueText.setAttribute('class', 'pie-center-value');
  valueText.textContent = fmtMoney(total);
  svg.append(valueText);

  const labelText = document.createElementNS(svgNS, 'text');
  labelText.setAttribute('x', cx);
  labelText.setAttribute('y', cy + 18);
  labelText.setAttribute('text-anchor', 'middle');
  labelText.setAttribute('class', 'pie-center-label');
  labelText.textContent = centerLabel || '本月支出';
  svg.append(labelText);

  const legend = el('div', { class: 'pie-legend' });
  slices.forEach((s) => {
    const item = el('button', { class: 'legend-item', type: 'button' },
      el('span', { class: 'legend-dot', style: 'background:' + (s.color || '#2f80ed') }),
      el('span', { class: 'legend-name', text: s.name }),
      el('span', { class: 'legend-pct', text: Math.round(s.frac * 100) + '%' }),
      el('span', { class: 'legend-amount', text: fmtMoney(s.amount) })
    );
    if (onSelect) item.addEventListener('click', () => onSelect(s));
    legend.append(item);
  });

  wrap.append(svg, legend);
  return wrap;
}

/**
 * 折线图。
 * @param {{values:Array<number>, labels:string[], onHover?:Function}} opts
 */
export function renderLine(opts) {
  const { values, labels } = opts;
  const width = 640;
  const height = 220;
  const pad = { top: 14, right: 14, bottom: 28, left: 52 };
  const max = niceMax(Math.max(...values, 0));
  if (!values.length || values.every((v) => v === 0)) return emptyChart('这段时间还没有支出');

  const pts = buildLinePoints(values, width, height, pad);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  svg.setAttribute('class', 'line-svg');

  // 网格线 + Y 轴标签
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + ((height - pad.top - pad.bottom) * i) / 4;
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', pad.left);
    line.setAttribute('x2', width - pad.right);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.setAttribute('class', 'grid-line');
    svg.append(line);

    const val = max - (max * i) / 4;
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', pad.left - 8);
    t.setAttribute('y', y + 4);
    t.setAttribute('text-anchor', 'end');
    t.setAttribute('class', 'axis-label');
    t.textContent = Math.round(val / 100);
    svg.append(t);
  }

  // 面积
  const areaD = pts.map((p, i) => (i === 0 ? 'M ' : 'L ') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ') +
    ' L ' + pts[pts.length - 1].x.toFixed(1) + ' ' + (height - pad.bottom) +
    ' L ' + pts[0].x.toFixed(1) + ' ' + (height - pad.bottom) + ' Z';
  const area = document.createElementNS(svgNS, 'path');
  area.setAttribute('d', areaD);
  area.setAttribute('class', 'line-area');
  svg.append(area);

  // 折线
  const lineD = pts.map((p, i) => (i === 0 ? 'M ' : 'L ') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', lineD);
  path.setAttribute('class', 'line-path');
  svg.append(path);

  // X 轴标签
  const step = Math.max(1, Math.floor(values.length / 6));
  for (let i = 0; i < values.length; i += step) {
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', pts[i].x);
    t.setAttribute('y', height - 8);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'axis-label');
    t.textContent = labels[i];
    svg.append(t);
  }

  // 悬停指示
  const cursor = document.createElementNS(svgNS, 'line');
  cursor.setAttribute('class', 'cursor-line');
  cursor.setAttribute('y1', pad.top);
  cursor.setAttribute('y2', height - pad.bottom);
  cursor.style.display = 'none';
  svg.append(cursor);

  const dot = document.createElementNS(svgNS, 'circle');
  dot.setAttribute('r', 4);
  dot.setAttribute('class', 'cursor-dot');
  dot.style.display = 'none';
  svg.append(dot);

  const tip = el('div', { class: 'chart-tip', hidden: true });
  const wrap = el('div', { class: 'line-wrap' }, svg, tip);

  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.x - relX);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    const p = pts[best];
    cursor.style.display = '';
    cursor.setAttribute('x1', p.x);
    cursor.setAttribute('x2', p.x);
    dot.style.display = '';
    dot.setAttribute('cx', p.x);
    dot.setAttribute('cy', p.y);
    tip.hidden = false;
    tip.textContent = labels[best] + ' · ' + fmtMoney(values[best]);
    const left = (p.x / width) * rect.width;
    tip.style.left = Math.min(rect.width - 120, Math.max(0, left + 10)) + 'px';
    tip.style.top = Math.max(0, ((p.y / height) * rect.height) - 36) + 'px';
  });

  svg.addEventListener('mouseleave', () => {
    cursor.style.display = 'none';
    dot.style.display = 'none';
    tip.hidden = true;
  });

  return wrap;
}

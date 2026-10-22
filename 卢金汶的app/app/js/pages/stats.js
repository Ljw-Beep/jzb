import { el } from '../components.js';
import { store } from '../store.js';
import { monthSummary, expenseBreakdown, dailyTotals } from '../selectors.js';
import { renderPie, renderLine } from '../charts.js';
import { fmtMoney, monthLabel, addMonths, daysInMonth, monthKey } from '../utils.js';

export const title = '统计';

export function mount(root, ctx) {
  const page = el('div', { class: 'page', 'data-page': 'stats' });
  root.append(page);

  let drilled = null;
  let cumulative = false;

  const state = () => store.state;

  function deltaText(cur, prev) {
    if (!prev) return { text: '比上月 —', cls: 'muted' };
    const pct = ((cur - prev) / prev) * 100;
    const sign = pct > 0 ? '+' : '';
    return { text: '比上月 ' + sign + pct.toFixed(0) + '%', cls: pct > 0 ? 'text-expense' : 'text-income' };
  }

  function renderKpi() {
    const month = ctx.month;
    const cur = monthSummary(state(), month);
    const prev = monthSummary(state(), addMonths(month, -1));

    const cards = [
      { label: monthLabel(month) + ' 支出', value: fmtMoney(cur.expense), delta: deltaText(cur.expense, prev.expense), cls: 'text-expense' },
      { label: '本月收入', value: fmtMoney(cur.income), delta: deltaText(cur.income, prev.income), cls: 'text-income' },
      { label: '本月结余', value: fmtMoney(cur.balance), delta: { text: '共 ' + cur.count + ' 笔', cls: 'muted' }, cls: '' }
    ];

    const grid = el('div', { class: 'stat-grid' });
    cards.forEach((c) => {
      grid.append(el('div', { class: 'stat' },
        el('div', { class: 'stat-label', text: c.label }),
        el('div', { class: 'stat-value ' + c.cls, text: c.value }),
        el('div', { class: 'stat-delta ' + c.delta.cls, text: c.delta.text })
      ));
    });
    return grid;
  }

  function renderPieCard() {
    const month = ctx.month;
    const breakdown = expenseBreakdown(state(), month);
    const parents = breakdown.map((r) => ({ id: r.id, name: r.name, amount: r.amount, color: r.color, icon: r.icon, count: r.count }));

    let items = parents;
    let crumb = null;
    if (drilled) {
      const parent = breakdown.find((r) => r.id === drilled);
      if (parent) {
        items = parent.children.map((c) => ({ id: c.id, name: c.name, amount: c.amount, color: parent.color, count: c.count }));
        crumb = el('div', { class: 'crumb' },
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { drilled = null; render(); } }, '全部分类'),
          el('span', { class: 'muted', text: '›' }),
          el('span', { text: parent.name })
        );
      } else {
        drilled = null;
      }
    }

    const pie = renderPie({
      items,
      centerLabel: drilled ? '分类明细' : '本月支出',
      onSelect: drilled ? null : (slice) => { drilled = slice.id; render(); }
    });

    const card = el('div', { class: 'card chart-card' },
      el('div', { class: 'card-head' },
        el('div', { class: 'card-title', text: '支出分类占比' }),
        drilled ? crumb : el('span', { class: 'card-sub', text: '点击扇区查看明细' })
      ),
      pie
    );

    return card;
  }

  function renderLineCard() {
    const month = ctx.month;
    const daily = dailyTotals(state(), month);
    let values = daily.map((d) => d.amount);
    if (cumulative) {
      let acc = 0;
      values = values.map((v) => { acc += v; return acc; });
    }
    const labels = daily.map((d) => String(d.day));

    const toggle = el('div', { class: 'tabs tabs-sm' },
      el('button', {
        class: 'tab' + (cumulative ? '' : ' active'), type: 'button',
        onclick: () => { cumulative = false; render(); }
      }, '每日支出'),
      el('button', {
        class: 'tab' + (cumulative ? ' active' : ''), type: 'button',
        onclick: () => { cumulative = true; render(); }
      }, '累计支出')
    );

    return el('div', { class: 'card chart-card' },
      el('div', { class: 'card-head' },
        el('div', { class: 'card-title', text: '每日支出趋势' }),
        toggle
      ),
      renderLine({ values, labels })
    );
  }

  function renderRanking() {
    const month = ctx.month;
    const breakdown = expenseBreakdown(state(), month);
    const total = breakdown.reduce((s, r) => s + r.amount, 0);
    const days = month === monthKey()
      ? new Date().getDate()
      : daysInMonth(month);

    const card = el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('div', { class: 'card-title', text: '分类排行' }))
    );

    if (!breakdown.length) {
      card.append(el('div', { class: 'empty', style: 'padding:24px' }, el('p', { text: '本月还没有支出记录' })));
      return card;
    }

    const table = el('table', { class: 'table rank-table' });
    table.append(el('thead', {},
      el('tr', {},
        el('th', { text: '分类' }),
        el('th', { class: 'num', text: '金额' }),
        el('th', { class: 'num', text: '占比' }),
        el('th', { class: 'num', text: '笔数' }),
        el('th', { class: 'num', text: '日均' })
      )
    ));
    const tbody = el('tbody', {});
    breakdown.forEach((r) => {
      const tr = el('tr', { class: 'rank-row', 'data-cat': r.id, tabindex: '0' },
        el('td', {}, el('span', { class: 'cat-ico-inline', text: r.icon || '📦' }), ' ' + r.name),
        el('td', { class: 'num', text: fmtMoney(r.amount) }),
        el('td', { class: 'num', text: (total > 0 ? ((r.amount / total) * 100).toFixed(1) : '0.0') + '%' }),
        el('td', { class: 'num', text: String(r.count) }),
        el('td', { class: 'num', text: fmtMoney(Math.round(r.amount / Math.max(1, days))) })
      );
      tr.addEventListener('click', () => ctx.goto('bills', { category: r.id, month }));
      tbody.append(tr);
    });
    table.append(tbody);
    card.append(table);
    return card;
  }

  function render() {
    page.innerHTML = '';
    page.append(
      renderKpi(),
      el('div', { class: 'charts-grid' }, renderPieCard(), renderLineCard()),
      el('div', { style: 'margin-top:16px' }, renderRanking())
    );
  }

  render();
  const unsub = store.subscribe(render);
  return () => unsub();
}

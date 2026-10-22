import { el, confirmDialog, toast } from '../components.js';
import { store } from '../store.js';
import {
  filterTx, sortTxDesc, categoryMap, accountMap, activeAccounts, allAccountsSorted,
  topCategories, childrenOf
} from '../selectors.js';
import {
  fmtMoney, fmtSigned, todayStr, dateLabel, monthKey, addMonths, daysInMonth
} from '../utils.js';
import { openEditTransaction } from '../quickadd.js';

export const title = '账单';

function rangeFor(preset) {
  const today = todayStr();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'month') {
    const m = monthKey();
    return { from: m + '-01', to: m + '-' + daysInMonth(m) };
  }
  if (preset === 'lastMonth') {
    const m = addMonths(monthKey(), -1);
    return { from: m + '-01', to: m + '-' + daysInMonth(m) };
  }
  if (preset === 'week') {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // 周一为 0
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
    const fmt = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    return { from: fmt(monday), to: today };
  }
  return {};
}

const KIND_LABEL = { expense: '支出', income: '收入', transfer: '转账' };

export function mount(root, ctx) {
  const page = el('div', { class: 'page', 'data-page': 'bills' });
  const state = () => store.state;

  const filters = {
    preset: 'month',
    from: null,
    to: null,
    categoryIds: [],
    tagIds: [],
    accountId: 'all',
    kind: 'all',
    q: ''
  };

  // 从其他页面带过来的筛选条件
  const params = (ctx && ctx.params) || {};
  if (params.account) { filters.accountId = params.account; filters.preset = 'all'; }
  if (params.date) { filters.preset = 'custom'; filters.from = params.date; filters.to = params.date; }
  if (params.category) filters.categoryIds = [params.category];
  if (params.tag) filters.tagIds = [params.tag];
  if (params.q) filters.q = params.q;
  if (params.kind) filters.kind = params.kind;
  if (params.month) {
    filters.preset = 'custom';
    filters.from = params.month + '-01';
    filters.to = params.month + '-' + daysInMonth(params.month);
  }

  let limit = 50;

  // ---------------- 筛选栏 ----------------
  const bar = el('div', { class: 'filter-bar' });

  const presetSel = el('select', { class: 'select filter-preset', 'aria-label': '日期范围' });
  [['month', '本月'], ['today', '今天'], ['week', '本周'], ['lastMonth', '上月'], ['all', '全部时间'], ['custom', '自定义']]
    .forEach(([v, label]) => presetSel.append(el('option', { value: v }, label)));
  presetSel.value = filters.preset;
  presetSel.addEventListener('change', () => {
    filters.preset = presetSel.value;
    customRow.hidden = filters.preset !== 'custom';
    limit = 50;
    refresh();
  });

  const fromInput = el('input', { class: 'input', type: 'date', 'aria-label': '开始日期' });
  const toInput = el('input', { class: 'input', type: 'date', 'aria-label': '结束日期' });
  fromInput.value = filters.from || '';
  toInput.value = filters.to || '';
  const customRow = el('div', { class: 'custom-range', hidden: filters.preset !== 'custom' },
    fromInput, el('span', { class: 'muted', text: '至' }), toInput
  );
  fromInput.addEventListener('change', () => { filters.from = fromInput.value; limit = 50; refresh(); });
  toInput.addEventListener('change', () => { filters.to = toInput.value; limit = 50; refresh(); });

  function multiDropdown(label, items, selected, onChange) {
    const details = el('details', { class: 'dd' });
    const summary = el('summary', { class: 'dd-btn' });
    const body = el('div', { class: 'dd-body' });
    const update = () => {
      summary.textContent = selected.length ? label + '（' + selected.length + '）' : label;
    };
    items.forEach((it) => {
      const cb = el('input', { type: 'checkbox', value: it.id });
      cb.checked = selected.includes(it.id);
      cb.addEventListener('change', () => {
        const i = selected.indexOf(it.id);
        if (cb.checked && i < 0) selected.push(it.id);
        if (!cb.checked && i >= 0) selected.splice(i, 1);
        update();
        limit = 50;
        onChange();
      });
      body.append(el('label', { class: 'dd-item' + (it.child ? ' child' : '') }, cb, el('span', { text: it.label })));
    });
    details.append(summary, body);
    update();
    return details;
  }

  const st0 = state();
  const catItems = [];
  topCategories(st0, 'expense').forEach((p) => {
    catItems.push({ id: p.id, label: p.name });
    childrenOf(st0, p.id).forEach((k) => catItems.push({ id: k.id, label: '└ ' + k.name, child: true }));
  });
  const tagItems = (st0.tags || []).map((t) => ({ id: t.id, label: t.name }));

  const catDd = multiDropdown('分类', catItems, filters.categoryIds, refresh);
  const tagDd = multiDropdown('标签', tagItems, filters.tagIds, refresh);

  const accountSel = el('select', { class: 'select', 'aria-label': '账户' });
  accountSel.append(el('option', { value: 'all' }, '全部账户'));
  allAccountsSorted(st0).forEach((a) => accountSel.append(el('option', { value: a.id }, a.name + (a.archived ? '（已归档）' : ''))));
  accountSel.value = filters.accountId;
  accountSel.addEventListener('change', () => { filters.accountId = accountSel.value; limit = 50; refresh(); });

  const kindSel = el('select', { class: 'select', 'aria-label': '类型' });
  [['all', '全部类型'], ['expense', '支出'], ['income', '收入'], ['transfer', '转账']]
    .forEach(([v, label]) => kindSel.append(el('option', { value: v }, label)));
  kindSel.value = filters.kind;
  kindSel.addEventListener('change', () => { filters.kind = kindSel.value; limit = 50; refresh(); });

  const searchInput = el('input', { class: 'input filter-search', type: 'search', placeholder: '搜备注…', 'aria-label': '搜索备注' });
  searchInput.value = filters.q;
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filters.q = searchInput.value.trim(); limit = 50; refresh(); }, 200);
  });

  const resetBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '重置');
  resetBtn.addEventListener('click', () => {
    filters.preset = 'month';
    filters.from = null; filters.to = null;
    filters.categoryIds.length = 0;
    filters.tagIds.length = 0;
    filters.accountId = 'all';
    filters.kind = 'all';
    filters.q = '';
    limit = 50;
    presetSel.value = 'month';
    accountSel.value = 'all';
    kindSel.value = 'all';
    searchInput.value = '';
    customRow.hidden = true;
    catDd.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; });
    tagDd.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; });
    catDd.querySelector('summary').textContent = '分类';
    tagDd.querySelector('summary').textContent = '标签';
    refresh();
  });

  bar.append(
    presetSel,
    customRow,
    catDd,
    tagDd,
    accountSel,
    kindSel,
    searchInput,
    resetBtn
  );

  const summaryBar = el('div', { class: 'filter-summary' });
  const listWrap = el('div', { class: 'bill-list' });

  page.append(el('div', { class: 'card filter-card' }, bar), summaryBar, listWrap);
  root.append(page);

  // 点击空白处关闭下拉
  const closeDropdowns = (e) => {
    page.querySelectorAll('details.dd[open]').forEach((d) => {
      if (!d.contains(e.target)) d.removeAttribute('open');
    });
  };
  document.addEventListener('click', closeDropdowns);

  // ---------------- 渲染 ----------------
  function computeFiltered() {
    const range = filters.preset === 'custom'
      ? { from: filters.from, to: filters.to }
      : rangeFor(filters.preset);
    return filterTx(state(), {
      ...range,
      categoryIds: filters.categoryIds,
      tagIds: filters.tagIds,
      accountId: filters.accountId,
      kind: filters.kind,
      q: filters.q
    });
  }

  async function removeTx(t) {
    const okDelete = await confirmDialog({
      title: '删除账目',
      message: '删除这笔 ' + fmtMoney(t.amount) + ' 的' + KIND_LABEL[t.kind] + '？删除后不可恢复。',
      okText: '删除',
      danger: true
    });
    if (!okDelete) return;
    try {
      await store.commit((s) => { s.transactions = s.transactions.filter((x) => x.id !== t.id); });
      toast('已删除', 'ok');
    } catch (e) {
      toast('删除失败：' + e.message, 'err');
    }
  }

  function renderList(list) {
    listWrap.innerHTML = '';
    const sorted = sortTxDesc(list);
    const shown = sorted.slice(0, limit);
    const cMap = categoryMap(state());
    const aMap = accountMap(state());

    if (!sorted.length) {
      listWrap.append(el('div', { class: 'card' },
        el('div', { class: 'empty' },
          el('div', { class: 'empty-ico', text: '🔍' }),
          el('p', { text: '没有符合条件的账目' }),
          el('button', { class: 'btn btn-sm', type: 'button', onclick: () => resetBtn.click() }, '清空筛选')
        )
      ));
      return;
    }

    const groups = new Map();
    shown.forEach((t) => {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    });

    groups.forEach((items, date) => {
      const dayExpense = items.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);
      const group = el('div', { class: 'bill-group' },
        el('div', { class: 'bill-group-head' },
          el('span', { class: 'bill-date', text: dateLabel(date) }),
          el('span', { class: 'muted', text: '支出 ' + fmtMoney(dayExpense) })
        )
      );
      const box = el('div', { class: 'card bill-group-card' });
      items.forEach((t) => {
        const c = cMap[t.categoryId];
        const parentCat = c && c.parentId ? cMap[c.parentId] : null;
        const account = aMap[t.accountId];
        const toAccount = aMap[t.toAccountId];
        const transfer = t.kind === 'transfer';
        const rowLabel = transfer ? '转账' : (c ? c.name : '未分类');
        const icon = transfer ? '🔄' : ((c && c.icon) || (parentCat && parentCat.icon) || '📦');
        const amountText = transfer ? fmtMoney(t.amount) : fmtSigned(t.amount, t.kind);
        const amountClass = transfer ? 'muted' : (t.kind === 'income' ? 'text-income' : 'text-expense');
        const tagNames = (t.tagIds || []).map((id) => {
          const tag = (state().tags || []).find((x) => x.id === id);
          return tag ? tag.name : null;
        }).filter(Boolean);

        const row = el('div', { class: 'bill-row', 'data-id': t.id, tabindex: '0' },
          el('span', { class: 'row-ico', text: icon }),
          el('span', { class: 'row-main' },
            el('span', { class: 'row-title' },
              rowLabel,
              ...tagNames.map((n) => el('span', { class: 'chip chip-mini', text: n })),
              t.note ? el('span', { class: 'bill-note', text: '· ' + t.note }) : null
            ),
            el('span', { class: 'row-sub', text: (account ? account.name : '') + (transfer && toAccount ? ' → ' + toAccount.name : '') })
          ),
          el('span', { class: 'row-amount ' + amountClass, text: amountText }),
          el('span', { class: 'row-actions' },
            el('button', { class: 'icon-btn', type: 'button', title: '编辑', 'aria-label': '编辑', onclick: (e) => { e.stopPropagation(); openEditTransaction(t); } }, '✎'),
            el('button', { class: 'icon-btn danger', type: 'button', title: '删除', 'aria-label': '删除', onclick: (e) => { e.stopPropagation(); removeTx(t); } }, '🗑')
          )
        );
        row.addEventListener('click', () => openEditTransaction(t));
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openEditTransaction(t); });
        box.append(row);
      });
      group.append(box);
      listWrap.append(group);
    });

    if (sorted.length > limit) {
      const more = el('button', { class: 'btn btn-block load-more', type: 'button' }, '加载更多（还有 ' + (sorted.length - limit) + ' 笔）');
      more.addEventListener('click', () => { limit += 50; renderList(computeFiltered()); });
      listWrap.append(more);
    }
  }

  function renderSummary(list) {
    let expense = 0;
    let income = 0;
    list.forEach((t) => {
      if (t.kind === 'expense') expense += t.amount;
      if (t.kind === 'income') income += t.amount;
    });
    const net = income - expense;
    summaryBar.innerHTML = '';
    summaryBar.append(
      el('span', { text: '共 ' + list.length + ' 笔' }),
      el('span', { class: 'muted', text: '支出 ' + fmtMoney(expense) }),
      el('span', { class: 'muted', text: '收入 ' + fmtMoney(income) }),
      el('span', { text: '净额 ' + (net >= 0 ? '+' : '-') + fmtMoney(Math.abs(net)) })
    );
  }

  function refresh() {
    const list = computeFiltered();
    renderSummary(list);
    renderList(list);
  }

  refresh();
  const unsub = store.subscribe(refresh);

  return () => {
    unsub();
    document.removeEventListener('click', closeDropdowns);
    clearTimeout(searchTimer);
  };
}

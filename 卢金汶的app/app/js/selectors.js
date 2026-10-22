// 数据选择器：全部为纯函数（输入 state，输出结果），方便单元测试与复用。
import { todayStr, monthOfDate, daysInMonth, pad2 } from './utils.js';

export function activeAccounts(state) {
  return (state.accounts || [])
    .filter(a => !a.archived)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function allAccountsSorted(state) {
  return (state.accounts || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

/** 每个账户的余额（分）。转账不计入收支，但会同时改动两个账户。 */
export function accountBalances(state) {
  const bal = {};
  (state.accounts || []).forEach(a => { bal[a.id] = Number(a.initialBalance) || 0; });
  (state.transactions || []).forEach(t => {
    const amt = Number(t.amount) || 0;
    if (t.kind === 'income') {
      bal[t.accountId] = (bal[t.accountId] || 0) + amt;
    } else if (t.kind === 'expense') {
      bal[t.accountId] = (bal[t.accountId] || 0) - amt;
    } else if (t.kind === 'transfer') {
      bal[t.accountId] = (bal[t.accountId] || 0) - amt;
      if (t.toAccountId) bal[t.toAccountId] = (bal[t.toAccountId] || 0) + amt;
    }
  });
  return bal;
}

export function totalBalance(state) {
  const bal = accountBalances(state);
  return activeAccounts(state).reduce((sum, a) => sum + (bal[a.id] || 0), 0);
}

export function txInMonth(state, month) {
  return (state.transactions || []).filter(t => monthOfDate(t.date) === month);
}

export function monthSummary(state, month) {
  let expense = 0;
  let income = 0;
  let count = 0;
  (state.transactions || []).forEach(t => {
    if (monthOfDate(t.date) !== month) return;
    count++;
    if (t.kind === 'expense') expense += Number(t.amount) || 0;
    else if (t.kind === 'income') income += Number(t.amount) || 0;
  });
  return { expense, income, balance: income - expense, count };
}

export function daySummary(state, day) {
  let expense = 0;
  let count = 0;
  (state.transactions || []).forEach(t => {
    if (t.date !== day) return;
    if (t.kind === 'expense') { expense += Number(t.amount) || 0; count++; }
  });
  return { expense, count };
}

export function categoryMap(state) {
  const map = {};
  (state.categories || []).forEach(c => { map[c.id] = c; });
  return map;
}

export function tagMap(state) {
  const map = {};
  (state.tags || []).forEach(t => { map[t.id] = t; });
  return map;
}

export function accountMap(state) {
  const map = {};
  (state.accounts || []).forEach(a => { map[a.id] = a; });
  return map;
}

export function parentIdOf(state, id) {
  const map = categoryMap(state);
  const c = map[id];
  if (!c) return null;
  return c.parentId || null;
}

export function categoryLabel(state, id) {
  const map = categoryMap(state);
  const c = map[id];
  if (!c) return '未分类';
  if (c.parentId && map[c.parentId]) return map[c.parentId].name + ' · ' + c.name;
  return c.name;
}

export function childrenOf(state, parentId) {
  return (state.categories || [])
    .filter(c => c.parentId === parentId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function topCategories(state, kind) {
  return (state.categories || [])
    .filter(c => !c.parentId && c.kind === kind)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/** 某分类（含其子分类）的 id 集合。 */
export function categoryWithChildren(state, id) {
  const map = categoryMap(state);
  const out = new Set([id]);
  (state.categories || []).forEach(c => { if (c.parentId === id) out.add(c.id); });
  if (map[id] && map[id].parentId) out.add(map[id].parentId);
  return out;
}

/** 支出按一级分类聚合，带二级明细，按金额倒序。 */
export function expenseBreakdown(state, month) {
  const map = categoryMap(state);
  const rows = new Map();
  (state.transactions || []).forEach(t => {
    if (t.kind !== 'expense') return;
    if (monthOfDate(t.date) !== month) return;
    const c = map[t.categoryId];
    if (!c) return;
    const parent = c.parentId ? map[c.parentId] : c;
    if (!parent) return;
    if (!rows.has(parent.id)) {
      rows.set(parent.id, {
        id: parent.id, name: parent.name, icon: parent.icon, color: parent.color,
        amount: 0, count: 0, children: new Map()
      });
    }
    const row = rows.get(parent.id);
    row.amount += Number(t.amount) || 0;
    row.count++;
    const key = c.id;
    if (!row.children.has(key)) {
      row.children.set(key, { id: c.id, name: c.name, amount: 0, count: 0 });
    }
    const child = row.children.get(key);
    child.amount += Number(t.amount) || 0;
    child.count++;
  });
  const list = Array.from(rows.values()).map(r => ({
    ...r,
    children: Array.from(r.children.values()).sort((a, b) => b.amount - a.amount)
  }));
  return list.sort((a, b) => b.amount - a.amount);
}

/** 每日支出合计，返回 [{ day: 1, amount }...] 覆盖整月。 */
export function dailyTotals(state, month) {
  const days = daysInMonth(month);
  const arr = new Array(days).fill(0);
  (state.transactions || []).forEach(t => {
    if (t.kind !== 'expense') return;
    if (monthOfDate(t.date) !== month) return;
    const d = Number(String(t.date).slice(8, 10));
    if (d >= 1 && d <= days) arr[d - 1] += Number(t.amount) || 0;
  });
  return arr.map((amount, i) => ({ day: i + 1, amount }));
}

export function budgetFor(state, month) {
  const b = (state.budgets || []).find(x => x.month === month);
  if (!b) return { month, total: 0, byCategory: {} };
  return { month, total: Number(b.total) || 0, byCategory: b.byCategory || {} };
}

/**
 * 预算使用情况。
 * rows: [{ id, name, icon, color, budget, used, pct, status }]
 */
export function budgetUsage(state, month) {
  const b = budgetFor(state, month);
  const map = categoryMap(state);
  const spent = {};
  let totalUsed = 0;
  (state.transactions || []).forEach(t => {
    if (t.kind !== 'expense') return;
    if (monthOfDate(t.date) !== month) return;
    const amt = Number(t.amount) || 0;
    totalUsed += amt;
    const c = map[t.categoryId];
    if (!c) return;
    const pid = c.parentId || c.id;
    spent[pid] = (spent[pid] || 0) + amt;
  });

  const rows = topCategories(state, 'expense')
    .filter(c => !c.archived || b.byCategory[c.id] > 0 || spent[c.id] > 0)
    .map(c => {
      const budget = Number(b.byCategory[c.id]) || 0;
      const used = spent[c.id] || 0;
      const pct = budget > 0 ? (used / budget) * 100 : 0;
      let status = 'none';
      if (budget > 0) status = used > budget ? 'danger' : (pct >= 80 ? 'warn' : 'ok');
      return { id: c.id, name: c.name, icon: c.icon, color: c.color, budget, used, pct, status };
    });

  const totalPct = b.total > 0 ? (totalUsed / b.total) * 100 : 0;
  let totalStatus = 'none';
  if (b.total > 0) totalStatus = totalUsed > b.total ? 'danger' : (totalPct >= 80 ? 'warn' : 'ok');

  return {
    totalBudget: b.total,
    totalUsed,
    remaining: b.total > 0 ? b.total - totalUsed : 0,
    totalPct,
    totalStatus,
    rows,
    overspent: rows.filter(r => r.status === 'danger'),
    hasBudget: b.total > 0 || Object.keys(b.byCategory || {}).length > 0
  };
}

export function sortTxDesc(list) {
  return list.slice().sort((a, b) => {
    const d = String(b.date || '').localeCompare(String(a.date || ''));
    if (d !== 0) return d;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

export function recentTx(state, n = 8) {
  return sortTxDesc(state.transactions || []).slice(0, n);
}

/**
 * 账单筛选。
 * filters: { month, from, to, categoryIds: [], tagIds: [], accountId, kind, q }
 * 不同维度之间 AND，同维度多选 OR。
 */
export function filterTx(state, filters = {}) {
  const catSet = new Set();
  if (filters.categoryIds && filters.categoryIds.length) {
    filters.categoryIds.forEach(id => {
      catSet.add(id);
      (state.categories || []).forEach(c => { if (c.parentId === id) catSet.add(c.id); });
    });
  }
  const tagSet = new Set(filters.tagIds || []);
  const q = String(filters.q || '').trim().toLowerCase();

  return (state.transactions || []).filter(t => {
    if (filters.month && monthOfDate(t.date) !== filters.month) return false;
    if (filters.from && String(t.date) < filters.from) return false;
    if (filters.to && String(t.date) > filters.to) return false;
    if (filters.kind && filters.kind !== 'all' && t.kind !== filters.kind) return false;
    if (catSet.size && !catSet.has(t.categoryId)) return false;
    if (tagSet.size) {
      const own = new Set(t.tagIds || []);
      let hit = false;
      for (const id of tagSet) { if (own.has(id)) { hit = true; break; } }
      if (!hit) return false;
    }
    if (filters.accountId && filters.accountId !== 'all') {
      if (t.accountId !== filters.accountId && t.toAccountId !== filters.accountId) return false;
    }
    if (q && !String(t.note || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

/** 每个分类（含二级）被引用的笔数，用于分类管理的删除提示。 */
export function countTxByCategory(state) {
  const counts = {};
  (state.transactions || []).forEach(t => {
    if (!t.categoryId) return;
    counts[t.categoryId] = (counts[t.categoryId] || 0) + 1;
  });
  return counts;
}

export function hasAnyData(state) {
  return (state.transactions || []).length > 0;
}

export { todayStr };

/** 每日收支汇总（用于首页日历），返回整月每一天的金额。 */
export function dailySummary(state, month) {
  const days = daysInMonth(month);
  const out = [];
  for (let i = 1; i <= days; i++) out.push({ day: i, expense: 0, income: 0, count: 0 });
  (state.transactions || []).forEach((t) => {
    if (monthOfDate(t.date) !== month) return;
    const d = Number(String(t.date).slice(8, 10));
    if (!(d >= 1 && d <= days)) return;
    const cell = out[d - 1];
    if (t.kind === 'expense') cell.expense += Number(t.amount) || 0;
    else if (t.kind === 'income') cell.income += Number(t.amount) || 0;
    cell.count++;
  });
  return out;
}
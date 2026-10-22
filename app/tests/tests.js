// 前端单元测试：纯函数（utils / selectors）。用浏览器跑，结果打印到页面。
import * as U from '../js/utils.js';
import * as S from '../js/selectors.js';
import { validateEntry, makeTransaction, applyTransaction, validateBackup } from '../js/models.js';
import { computePie, arcPath, niceMax, buildLinePoints } from '../js/charts.js';
import { reorderWithinSiblings, moveToParent } from '../js/categoryOrder.js';

const list = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    list.push({ ok: true, name });
  } catch (e) {
    failed++;
    list.push({ ok: false, name: name + ' :: ' + e.message });
  }
}

function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg ? msg + ' ' : '') + '期望 ' + b + '，实际 ' + a);
}

function ok(value, msg = '期望为真') {
  if (!value) throw new Error(msg);
}

const fixture = {
  accounts: [
    { id: 'a1', name: '银行卡', initialBalance: 10000, order: 1 },
    { id: 'a2', name: '微信', initialBalance: 0, order: 2 },
    { id: 'a3', name: '旧卡', initialBalance: 5000, order: 3, archived: true }
  ],
  categories: [
    { id: 'c1', name: '餐饮', kind: 'expense', parentId: null, order: 1 },
    { id: 'c1-1', name: '午饭', kind: 'expense', parentId: 'c1', order: 2 },
    { id: 'c2', name: '交通', kind: 'expense', parentId: null, order: 3 },
    { id: 'c10', name: '工资', kind: 'income', parentId: null, order: 4 }
  ],
  tags: [{ id: 't1', name: '朋友' }, { id: 't2', name: '报销' }],
  transactions: [
    { id: 't1', kind: 'expense', amount: 2800, accountId: 'a2', categoryId: 'c1-1', date: '2026-10-18', note: '和同事吃饭', tagIds: ['t1'], createdAt: '2026-10-18T12:00:00' },
    { id: 't2', kind: 'expense', amount: 620, accountId: 'a2', categoryId: 'c2', date: '2026-10-17', note: '地铁', tagIds: [], createdAt: '2026-10-17T09:00:00' },
    { id: 't3', kind: 'income', amount: 800000, accountId: 'a1', categoryId: 'c10', date: '2026-10-01', note: '工资', tagIds: [], createdAt: '2026-10-01T10:00:00' },
    { id: 't4', kind: 'transfer', amount: 500, accountId: 'a2', toAccountId: 'a1', date: '2026-10-05', note: '转', tagIds: [], createdAt: '2026-10-05T10:00:00' },
    { id: 't5', kind: 'expense', amount: 100, accountId: 'a1', categoryId: 'c1', date: '2026-09-30', note: '上月', tagIds: ['t2'], createdAt: '2026-09-30T10:00:00' }
  ],
  budgets: [{ month: '2026-10', total: 10000, byCategory: { c1: 2000 } }],
  settings: { defaultAccountId: 'a1' }
};

// ---------------- utils ----------------
test('fmtMoney 千分位', () => eq(U.fmtMoney(123456), '¥1,234.56'));
test('fmtMoney 负数', () => eq(U.fmtMoney(-500), '-¥5.00'));
test('fmtMoney 零', () => eq(U.fmtMoney(0), '¥0.00'));
test('fmtSigned 支出', () => eq(U.fmtSigned(2800, 'expense'), '−¥28.00'));
test('fmtSigned 收入', () => eq(U.fmtSigned(800, 'income'), '+¥8.00'));
test('parseAmount 一位小数', () => eq(U.parseAmount('28.5'), 2850));
test('parseAmount 两位小数', () => eq(U.parseAmount('0.01'), 1));
test('parseAmount 千分位', () => eq(U.parseAmount('1,234.56'), 123456));
test('parseAmount 三位小数拒绝', () => eq(U.parseAmount('12.345'), null));
test('parseAmount 非数字拒绝', () => eq(U.parseAmount('abc'), null));
test('parseAmount 空值拒绝', () => eq(U.parseAmount(''), null));
test('sanitizeAmountInput 截断三位小数', () => eq(U.sanitizeAmountInput('12.345'), '12.34'));
test('sanitizeAmountInput 只留一个小数点', () => eq(U.sanitizeAmountInput('1.2.3'), '1.23'));
test('sanitizeAmountInput 过滤字母', () => eq(U.sanitizeAmountInput('a1b2'), '12'));
test('fenToInput 去掉多余零', () => eq(U.fenToInput(2800), '28'));
test('fenToInput 保留角分', () => eq(U.fenToInput(2850), '28.5'));
test('daysInMonth 闰年二月', () => eq(U.daysInMonth('2024-02'), 29));
test('daysInMonth 平年二月', () => eq(U.daysInMonth('2026-02'), 28));
test('daysInMonth 大月', () => eq(U.daysInMonth('2026-10'), 31));
test('addMonths 跨年向前', () => eq(U.addMonths('2026-01', -1), '2025-12'));
test('addMonths 跨年向后', () => eq(U.addMonths('2026-12', 1), '2027-01'));
test('monthLabel 中文', () => eq(U.monthLabel('2026-10'), '2026年10月'));
test('dateLabel 含星期', () => eq(U.dateLabel('2026-10-18'), '10月18日 周日'));
test('weekdayOf 周三', () => eq(U.weekdayOf('2026-10-21'), '周三'));
test('escapeHtml 转义', () => eq(U.escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;'));
test('uid 带前缀且唯一', () => {
  const a = U.uid('tx');
  const b = U.uid('tx');
  ok(a.startsWith('tx-'), '前缀丢失');
  ok(a !== b, 'uid 重复');
});
test('clamp 边界', () => {
  eq(U.clamp(5, 1, 3), 3);
  eq(U.clamp(0, 1, 3), 1);
});

// ---------------- selectors ----------------
test('账户余额：收入/支出/转账', () => {
  const b = S.accountBalances(fixture);
  eq(b.a1, 810400, '银行卡');
  eq(b.a2, -3920, '微信');
  eq(b.a3, 5000, '归档账户仍有余额但不应计入总额');
});
test('总余额排除归档账户', () => eq(S.totalBalance(fixture), 806480));
test('活跃账户排序', () => {
  const ids = S.activeAccounts(fixture).map(a => a.id);
  eq(ids, ['a1', 'a2']);
});
test('本月收支汇总', () => {
  const s = S.monthSummary(fixture, '2026-10');
  eq(s.expense, 3420);
  eq(s.income, 800000);
  eq(s.balance, 796580);
  eq(s.count, 4, '转账也计入笔数');
});
test('今日汇总', () => {
  const s = S.daySummary(fixture, '2026-10-18');
  eq(s.expense, 2800);
  eq(s.count, 1);
});
test('分类标签', () => eq(S.categoryLabel(fixture, 'c1-1'), '餐饮 · 午饭'));
test('支出按一级分类聚合', () => {
  const rows = S.expenseBreakdown(fixture, '2026-10');
  eq(rows.length, 2);
  eq(rows[0].name, '餐饮');
  eq(rows[0].amount, 2800);
  eq(rows[0].children[0].name, '午饭');
  eq(rows[1].name, '交通');
  eq(rows[1].amount, 620);
});
test('每日支出数组', () => {
  const d = S.dailyTotals(fixture, '2026-10');
  eq(d.length, 31);
  eq(d[17].amount, 2800, '18 日');
  eq(d[16].amount, 620, '17 日');
  eq(d[0].amount, 0);
});
test('预算使用：分类超支', () => {
  const u = S.budgetUsage(fixture, '2026-10');
  eq(u.totalBudget, 10000);
  eq(u.totalUsed, 3420);
  eq(u.remaining, 6580);
  ok(Math.abs(u.totalPct - 34.2) < 0.001, '总进度');
  eq(u.rows[0].id, 'c1');
  eq(u.rows[0].budget, 2000);
  eq(u.rows[0].used, 2800);
  eq(u.rows[0].status, 'danger');
  eq(u.overspent.length, 1);
  eq(u.overspent[0].name, '餐饮');
});
test('预算：未设分类预算的状态', () => {
  const u = S.budgetUsage(fixture, '2026-10');
  const jiaotong = u.rows.find(r => r.id === 'c2');
  eq(jiaotong.status, 'none');
});
test('预算：其他月份无预算', () => {
  const u = S.budgetUsage(fixture, '2026-09');
  eq(u.totalBudget, 0);
  eq(u.totalUsed, 100);
  eq(u.hasBudget, false);
});
test('筛选：按月份', () => eq(S.filterTx(fixture, { month: '2026-10' }).length, 4));
test('筛选：一级分类包含二级', () => {
  const r = S.filterTx(fixture, { month: '2026-10', categoryIds: ['c1'] });
  eq(r.length, 1);
  eq(r[0].id, 't1');
});
test('筛选：标签', () => eq(S.filterTx(fixture, { tagIds: ['t1'] }).length, 1));
test('筛选：多个标签取并集', () => {
  eq(S.filterTx(fixture, { tagIds: ['t1', 't2'] }).length, 2);
});
test('筛选：备注关键词', () => eq(S.filterTx(fixture, { q: '地铁' }).length, 1));
test('筛选：类型', () => eq(S.filterTx(fixture, { kind: 'income' }).length, 1));
test('筛选：账户含转入', () => eq(S.filterTx(fixture, { accountId: 'a1' }).length, 3));
test('筛选：日期区间', () => {
  const r = S.filterTx(fixture, { from: '2026-10-05', to: '2026-10-17' });
  eq(r.map(t => t.id).sort(), ['t2', 't4']);
});
test('筛选：多维度组合', () => {
  eq(S.filterTx(fixture, { month: '2026-10', kind: 'expense', accountId: 'a2' }).length, 2);
});
test('排序：日期倒序', () => {
  const r = S.sortTxDesc(fixture.transactions);
  eq(r.map(t => t.id), ['t1', 't2', 't4', 't3', 't5']);
});
test('最近记录默认 8 条', () => eq(S.recentTx(fixture, 8).length, 5));
test('分类引用计数', () => {
  const c = S.countTxByCategory(fixture);
  eq(c['c1-1'], 1);
  eq(c['c1'], 1);
  eq(c['c2'], 1);
  eq(c['c10'], 1);
});
test('分类子节点', () => eq(S.childrenOf(fixture, 'c1').map(c => c.id), ['c1-1']));
test('一级分类按类型过滤', () => eq(S.topCategories(fixture, 'expense').map(c => c.id), ['c1', 'c2']));


// ---------------- models ----------------
test('校验：合法支出', () => {
  const r = validateEntry({ kind: 'expense', amount: 2850, categoryId: 'c1', accountId: 'a1', date: '2026-10-18' });
  eq(r.ok, true);
});
test('校验：金额为空', () => {
  const r = validateEntry({ kind: 'expense', amount: null, categoryId: 'c1', accountId: 'a1', date: '2026-10-18' });
  eq(r.ok, false);
  ok(r.errors.amount, '缺少金额错误');
});
test('校验：金额为 0', () => {
  const r = validateEntry({ kind: 'expense', amount: 0, categoryId: 'c1', accountId: 'a1', date: '2026-10-18' });
  eq(r.ok, false);
});
test('校验：缺少分类', () => {
  const r = validateEntry({ kind: 'expense', amount: 100, categoryId: null, accountId: 'a1', date: '2026-10-18' });
  eq(r.ok, false);
  ok(r.errors.category, '缺少分类错误');
});
test('校验：转账不能同账户', () => {
  const r = validateEntry({ kind: 'transfer', amount: 100, accountId: 'a1', toAccountId: 'a1', date: '2026-10-18' });
  eq(r.ok, false);
  ok(r.errors.toAccount, '缺少转账错误');
});
test('校验：不能记未来', () => {
  const future = new Date(Date.now() + 86400000);
  const d = future.getFullYear() + '-' + String(future.getMonth() + 1).padStart(2, '0') + '-' + String(future.getDate()).padStart(2, '0');
  const r = validateEntry({ kind: 'expense', amount: 100, categoryId: 'c1', accountId: 'a1', date: d });
  eq(r.ok, false);
  ok(r.errors.date, '缺少日期错误');
});
test('生成账目：金额取整、转账清空分类', () => {
  const tx = makeTransaction({ kind: 'transfer', amount: 100.4, accountId: 'a1', toAccountId: 'a2', date: '2026-10-18', note: '  转  ', tagIds: ['t1'] });
  eq(tx.amount, 100);
  eq(tx.categoryId, null);
  eq(tx.toAccountId, 'a2');
  eq(tx.note, '转');
  eq(tx.tagIds, [], '转账不应带标签');
  ok(tx.id.startsWith('tx-'), 'id 前缀');
});
test('生成账目：标签去重', () => {
  const tx = makeTransaction({ kind: 'expense', amount: 100, accountId: 'a1', categoryId: 'c1', date: '2026-10-18', tagIds: ['t1', 't1', 't2'] });
  eq(tx.tagIds, ['t1', 't2']);
});
test('编辑账目：保留 id 与创建时间', () => {
  const base = { id: 'x1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', amount: 100 };
  const next = applyTransaction(base, { kind: 'expense', amount: 200, accountId: 'a1', categoryId: 'c1', date: '2026-10-18', note: 'n', tagIds: [] });
  eq(next.id, 'x1');
  eq(next.createdAt, '2026-01-01T00:00:00Z');
  eq(next.amount, 200);
  ok(next.updatedAt !== base.updatedAt, '更新时间应变化');
});

// ---------------- charts ----------------
test('饼图角度：两个等额各占一半', () => {
  const s = computePie([{ id: 'a', amount: 100 }, { id: 'b', amount: 100 }]);
  eq(s.length, 2);
  ok(Math.abs(s[0].frac - 0.5) < 1e-9);
  ok(Math.abs((s[1].end - s[0].start) - Math.PI * 2) < 1e-9);
});
test('饼图角度：总额为 0 不报错', () => {
  const s = computePie([{ id: 'a', amount: 0 }]);
  eq(s[0].frac, 0);
});
test('arcPath 生成合法路径', () => {
  const d = arcPath(100, 100, 80, 0, Math.PI / 2);
  ok(d.startsWith('M 100 100 L '), d);
  ok(d.includes(' A 80 80 '), d);
});
test('niceMax 取整刻度', () => {
  eq(niceMax(3420), 5000);
  eq(niceMax(100), 100);
  eq(niceMax(0), 100);
  eq(niceMax(12000), 20000);
});
test('折线坐标：首尾对齐内边距', () => {
  const pts = buildLinePoints([0, 100], 600, 200, { top: 10, right: 10, bottom: 10, left: 50 });
  eq(pts[0].x, 50);
  eq(pts[1].x, 590);
  eq(pts[0].y, 190, '0 值应贴底');
  eq(pts[1].y, 10, '最大值应贴顶');
});

test('备份校验：合法备份', () => {
  const r = validateBackup({ version: 1, accounts: [], categories: [], transactions: [] });
  eq(r.ok, true);
});
test('备份校验：不是对象', () => {
  eq(validateBackup(null).ok, false);
  eq(validateBackup('abc').ok, false);
});
test('备份校验：缺少 transactions', () => {
  const r = validateBackup({ version: 1, accounts: [], categories: [] });
  eq(r.ok, false);
  ok(r.error.includes('transactions'), r.error);
});
test('备份校验：版本过高', () => {
  const r = validateBackup({ version: 9, accounts: [], categories: [], transactions: [] });
  eq(r.ok, false);
  ok(r.error.includes('版本'), r.error);
});
test('备份校验：账目字段错误', () => {
  const r = validateBackup({ version: 1, accounts: [], categories: [], transactions: [{ id: 'x' }] });
  eq(r.ok, false);
  ok(r.error.includes('账目'), r.error);
});
// ---------------- CSS ----------------
test('hidden 属性真实生效（不再被 display 覆盖）', () => {
  const cases = [['div', 'offline'], ['div', 'month-switch'], ['button', 'cat-btn'], ['div', 'form-hint'], ['div', 'field']];
  cases.forEach(([tag, cls]) => {
    const n = document.createElement(tag);
    n.className = cls;
    n.hidden = true;
    document.body.append(n);
    const d = getComputedStyle(n).display;
    n.remove();
    if (d !== 'none') throw new Error(cls + ' 未隐藏，display=' + d);
  });
});


// ---------------- 分类排序 / 日历 ----------------
const catFixture = [
  { id: 'c1', name: '餐饮', kind: 'expense', parentId: null, order: 1 },
  { id: 'c2', name: '交通', kind: 'expense', parentId: null, order: 2 },
  { id: 'c3', name: '购物', kind: 'expense', parentId: null, order: 3 },
  { id: 'c1-1', name: '午饭', kind: 'expense', parentId: 'c1', order: 4 },
  { id: 'c1-2', name: '晚饭', kind: 'expense', parentId: 'c1', order: 5 }
];

test('分类排序：拖到目标前面', () => {
  const out = reorderWithinSiblings(catFixture, 'c3', 'c1', false);
  const tops = out.filter((c) => !c.parentId).sort((a, b) => a.order - b.order).map((c) => c.id);
  eq(tops, ['c3', 'c1', 'c2']);
  eq(catFixture[0].order, 1, '原始数据不应被修改');
});

test('分类排序：拖到目标后面', () => {
  const out = reorderWithinSiblings(catFixture, 'c1', 'c3', true);
  const tops = out.filter((c) => !c.parentId).sort((a, b) => a.order - b.order).map((c) => c.id);
  eq(tops, ['c2', 'c3', 'c1']);
});

test('分类排序：同父级内调整', () => {
  const out = reorderWithinSiblings(catFixture, 'c1-2', 'c1-1', false);
  const kids = out.filter((c) => c.parentId === 'c1').sort((a, b) => a.order - b.order).map((c) => c.id);
  eq(kids, ['c1-2', 'c1-1']);
});

test('分类排序：跨级不处理', () => {
  const out = reorderWithinSiblings(catFixture, 'c1-1', 'c2', true);
  eq(out.map((c) => c.id + ':' + c.order), catFixture.map((c) => c.id + ':' + c.order));
});

test('分类换父级：子分类移到另一个大类', () => {
  const out = moveToParent(catFixture, 'c1-1', 'c2');
  eq(out.find((c) => c.id === 'c1-1').parentId, 'c2');
  eq(catFixture[3].parentId, 'c1', '原始数据不应被修改');
});

test('分类换父级：不允许挂到子分类下', () => {
  const out = moveToParent(catFixture, 'c2', 'c1-1');
  eq(out.find((c) => c.id === 'c2').parentId, null);
});

test('每日收支汇总：每天分开统计', () => {
  const d = S.dailySummary(fixture, '2026-10');
  eq(d.length, 31);
  eq(d[0].income, 800000, '10 月 1 日收入');
  eq(d[17].expense, 2800, '10 月 18 日支出');
  eq(d[16].expense, 620, '10 月 17 日支出');
  eq(d[4].expense, 0, '转账不计入');
  eq(d[17].count, 1);
});
// ---------------- 输出 ----------------
const summary = document.getElementById('summary');
summary.textContent = 'PASS ' + passed + ' / FAIL ' + failed;
summary.className = failed ? 'fail' : 'pass';
const ol = document.getElementById('results');
list.forEach(r => {
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name;
  ol.append(li);
});
document.title = 'TESTS PASS ' + passed + ' FAIL ' + failed;

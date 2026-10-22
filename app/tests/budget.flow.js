// 预算页流程测试：超支提醒、编辑预算、分类预算、按月隔离。
import { api } from '../js/api.js';
import { store } from '../js/store.js';
import { mount } from '../js/pages/budget.js';
import { budgetUsage } from '../js/selectors.js';
import { monthKey, addMonths } from '../js/utils.js';

const results = [];
let passed = 0;
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (fn()) return true; await sleep(50); }
  return false;
}

async function test(name, fn) {
  try { await fn(); passed++; results.push({ ok: true, name }); }
  catch (e) { failed++; results.push({ ok: false, name: name + ' :: ' + e.message }); }
}

function eq(a, b, msg = '') {
  const as = JSON.stringify(a); const bs = JSON.stringify(b);
  if (as !== bs) throw new Error((msg ? msg + ' ' : '') + '期望 ' + bs + '，实际 ' + as);
}
function ok(v, msg = '期望为真') { if (!v) throw new Error(msg); }

const MONTH = monthKey();
const PREV = addMonths(MONTH, -1);
const DAY = MONTH + '-05';

async function seed() {
  const r = await api.getState();
  const s = r.data;
  const mk = (id, amount, categoryId, date) => ({
    id, kind: 'expense', amount, accountId: 'a1', toAccountId: null, categoryId, date, note: '',
    tagIds: [], createdAt: date + 'T10:00:00+08:00', updatedAt: date + 'T10:00:00+08:00'
  });
  s.transactions = [
    mk('q1', 1040, 'c1-2', DAY),
    mk('q2', 462, 'c2-1', DAY)
  ];
  s.budgets = [{ month: MONTH, total: 4000, byCategory: { c1: 1000 } }];
  await api.putState(s, r.rev);
  await store.load();
}

function pressEnter(input) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

async function run() {
  await api.ping();
  await seed();
  const host = document.getElementById('host');
  mount(host, { month: MONTH, params: {}, goto() {}, openQuickAdd() {} });
  await sleep(100);

  await test('超支提醒显示在顶部', async () => {
    const alert = host.querySelector('.alert-warn');
    ok(alert, '缺少超支提示');
    ok(alert.textContent.includes('餐饮'), alert.textContent);
  });

  await test('总预算显示已用与总额', async () => {
    const line = host.querySelector('.budget-total-line').textContent;
    ok(line.includes('¥15.02'), line);
    ok(line.includes('¥40.00'), line);
  });

  await test('餐饮进度条为红色并显示超支', async () => {
    const row = Array.from(host.querySelectorAll('.budget-row')).find((r) => r.textContent.includes('餐饮'));
    ok(row, '找不到餐饮行');
    ok(row.querySelector('.progress-bar.danger'), '进度条未变红');
    ok(row.textContent.includes('超支 ¥0.40'), row.textContent);
  });

  await test('未设预算的分类显示设预算入口', async () => {
    const row = Array.from(host.querySelectorAll('.budget-row')).find((r) => r.textContent.includes('交通'));
    ok(row, '找不到交通行');
    ok(row.textContent.includes('已花 ¥4.62'), row.textContent);
    ok(row.textContent.includes('未设预算'), row.textContent);
  });

  await test('编辑总预算并保存', async () => {
    const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '编辑');
    btn.click();
    await sleep(100);
    const input = host.querySelector('input[aria-label="预算金额"]');
    ok(input, '没有出现预算输入框');
    input.value = '100';
    pressEnter(input);
    const done = await waitFor(() => (store.state.budgets.find((b) => b.month === MONTH) || {}).total === 10000);
    ok(done, '总预算未更新');
  });

  await test('给分类设置预算', async () => {
    const row = Array.from(host.querySelectorAll('.budget-row')).find((r) => r.textContent.includes('交通'));
    const btn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === '设预算');
    ok(btn, '没有设预算按钮');
    btn.click();
    await sleep(100);
    const input = host.querySelector('input[aria-label="预算金额"]');
    input.value = '5';
    pressEnter(input);
    const done = await waitFor(() => {
      const b = store.state.budgets.find((x) => x.month === MONTH);
      return b && b.byCategory && b.byCategory.c2 === 500;
    });
    ok(done, '分类预算未保存');
  });

  await test('分类预算使用率达到 80% 变黄', async () => {
    await sleep(200);
    const row = Array.from(host.querySelectorAll('.budget-row')).find((r) => r.textContent.includes('交通'));
    ok(row.querySelector('.progress-bar.warn'), '进度条未变黄：' + row.innerHTML.slice(0, 120));
    ok(row.textContent.includes('剩 ¥0.38'), row.textContent);
  });

  await test('删除账目后预算已用金额回退', async () => {
    const before = budgetUsage(store.state, MONTH).totalUsed;
    await store.commit((s) => { s.transactions = s.transactions.filter((t) => t.id !== 'q2'); });
    const done = await waitFor(() => budgetUsage(store.state, MONTH).totalUsed === before - 462);
    ok(done, '已用金额未回退');
  });

  await test('切换月份读到独立预算', async () => {
    const host2 = document.getElementById('host2');
    mount(host2, { month: PREV, params: {}, goto() {}, openQuickAdd() {} });
    await sleep(100);
    ok(host2.textContent.includes('还没有设置本月总预算'), host2.textContent.slice(0, 120));
  });

  await test('总预算为 0 时不显示进度条', async () => {
    const host3 = document.getElementById('host3');
    mount(host3, { month: PREV, params: {}, goto() {}, openQuickAdd() {} });
    await sleep(80);
    eq(host3.querySelectorAll('.budget-bar').length, 0);
  });
}

function render() {
  const summary = document.getElementById('summary');
  summary.textContent = 'BUDGET PASS ' + passed + ' / FAIL ' + failed;
  summary.className = failed ? 'fail' : 'pass';
  const ol = document.getElementById('results');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name;
    ol.append(li);
  });
  document.title = 'BUDGET PASS ' + passed + ' FAIL ' + failed;
}

run().catch((e) => {
  failed++;
  results.push({ ok: false, name: '运行异常 :: ' + (e && e.message ? e.message : e) });
}).finally(render);

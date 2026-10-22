// 流程测试：真实挂载首页、填写表单、点击保存，校验数据与界面。
import { api } from '../js/api.js';
import { store } from '../js/store.js';
import { mount } from '../js/pages/home.js';
import { accountBalances, monthSummary } from '../js/selectors.js';
import { monthKey } from '../js/utils.js';

const results = [];
let passed = 0;
let failed = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ ok: true, name });
  } catch (e) {
    failed++;
    results.push({ ok: false, name: name + ' :: ' + e.message });
  }
}

function eq(a, b, msg = '') {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error((msg ? msg + ' ' : '') + '期望 ' + bs + '，实际 ' + as);
}

function ok(v, msg = '期望为真') { if (!v) throw new Error(msg); }

function findSaveButton(scope) {
  const buttons = Array.from(scope.querySelectorAll('button'));
  return buttons.find((b) => b.textContent.includes('保存') && !b.textContent.includes('修改'));
}

function inputAmount(scope, value) {
  const input = scope.querySelector('input[aria-label="金额"]');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}

async function run() {
  await api.ping();
  await store.load();

  const host = document.getElementById('host');
  const gotoCalls = [];
  const ctx = {
    month: monthKey(),
    today: '',
    goto(route, params) { gotoCalls.push({ route, params }); },
    setMonth() {},
    openQuickAdd() {}
  };
  mount(host, ctx);

  await test('首页渲染 4 张账户卡', async () => {
    await waitFor(() => host.querySelectorAll('.account-card').length === 4);
    eq(host.querySelectorAll('.account-card').length, 4);
  });

  await test('表单渲染：金额、分类、账户、日期、标签', async () => {
    ok(host.querySelector('input[aria-label="金额"]'), '金额');
    ok(host.querySelector('.cat-grid .cat-btn'), '分类');
    ok(host.querySelector('select[aria-label="账户"]'), '账户');
    ok(host.querySelector('input[type="date"]'), '日期');
    ok(host.querySelector('input[aria-label="添加标签"]'), '标签');
  });

  await test('保存一笔支出：金额与分类正确', async () => {
    const before = store.state.transactions.length;
    inputAmount(host, '28.5');
    host.querySelector('.cat-grid .cat-btn').click();
    findSaveButton(host).click();
    const done = await waitFor(() => store.state.transactions.length === before + 1);
    ok(done, '记录未增加');
    const tx = store.state.transactions[store.state.transactions.length - 1];
    eq(tx.amount, 2850);
    eq(tx.kind, 'expense');
    ok(tx.categoryId, '分类为空');
    eq(tx.date, new Date().toISOString().slice(0, 10));
  });

  await test('保存后金额清空、分类保留', async () => {
    const cleared = await waitFor(() => host.querySelector('input[aria-label="金额"]').value === '');
    ok(cleared, '金额没有清空');
    eq(host.querySelector('input[aria-label="金额"]').value, '');
    const active = host.querySelector('.cat-btn.active');
    ok(active, '分类未保留');
  });

  await test('最近记录出现新账目', async () => {
    const text = host.textContent;
    ok(text.includes('¥28.50') || text.includes('−¥28.50'), '最近记录没有金额：' + text.slice(0, 200));
  });

  await test('账户余额同步减少', async () => {
    const bal = accountBalances(store.state);
    eq(bal.a1, -2850, '现金余额');
  });

  await test('数据已写入服务端', async () => {
    const r = await api.getState();
    eq(r.data.transactions.length, 1);
    eq(r.data.transactions[0].amount, 2850);
  });

  await test('收入不计入支出', async () => {
    host.querySelector('.tab[data-kind="income"]').click();
    await sleep(60);
    inputAmount(host, '8000');
    host.querySelector('.cat-grid .cat-btn').click();
    findSaveButton(host).click();
    const done = await waitFor(() => store.state.transactions.length === 2);
    ok(done, '收入未保存');
    const s = monthSummary(store.state, monthKey());
    eq(s.expense, 2850);
    eq(s.income, 800000);
  });

  await test('转账：收支不变、双向余额变动', async () => {
    host.querySelector('.tab[data-kind="transfer"]').click();
    await sleep(60);
    eq(host.querySelector('.cat-grid').hidden, true, '转账不应显示分类');
    inputAmount(host, '100');
    findSaveButton(host).click();
    const done = await waitFor(() => store.state.transactions.length === 3);
    ok(done, '转账未保存');
    const tx = store.state.transactions[2];
    eq(tx.kind, 'transfer');
    eq(tx.categoryId, null);
    const s = monthSummary(store.state, monthKey());
    eq(s.income, 800000);
    eq(s.expense, 2850);
    const bal = accountBalances(store.state);
    eq(bal.a1, 787150, '转出账户');
    eq(bal.a2, 10000, '转入账户');
  });

  await test('金额为空时拦截保存', async () => {
    host.querySelector('.tab[data-kind="expense"]').click();
    await sleep(60);
    const before = store.state.transactions.length;
    inputAmount(host, '');
    findSaveButton(host).click();
    await sleep(200);
    eq(store.state.transactions.length, before);
    ok(host.querySelector('.form-error').textContent.length > 0, '没有错误提示');
  });

  await test('Alt+1/2/3 切换收支转账', async () => {
    const form = host.querySelector('.entry-form');
    form.dispatchEvent(new KeyboardEvent('keydown', { key: '2', altKey: true, bubbles: true }));
    await sleep(80);
    ok(host.querySelector('.tab[data-kind="income"]').classList.contains('active'), '未切到收入');
    form.dispatchEvent(new KeyboardEvent('keydown', { key: '3', altKey: true, bubbles: true }));
    await sleep(80);
    ok(host.querySelector('.tab[data-kind="transfer"]').classList.contains('active'), '未切到转账');
    form.dispatchEvent(new KeyboardEvent('keydown', { key: '1', altKey: true, bubbles: true }));
    await sleep(80);
    ok(host.querySelector('.tab[data-kind="expense"]').classList.contains('active'), '未切回支出');
  });

  await test('转账余额不足给出提示但仍可继续', async () => {
    const form = host.querySelector('.entry-form');
    form.dispatchEvent(new KeyboardEvent('keydown', { key: '3', altKey: true, bubbles: true }));
    await sleep(80);
    inputAmount(host, '999999');
    await sleep(100);
    const hint = host.querySelector('.form-hint');
    ok(hint && !hint.hidden, '没有余额提示');
    ok(hint.textContent.includes('余额只剩'), hint.textContent);
    form.dispatchEvent(new KeyboardEvent('keydown', { key: '1', altKey: true, bubbles: true }));
    await sleep(80);
    eq(store.state.transactions.filter((t) => t.kind === 'transfer').length, 1, '不应真的写入巨额转账');
  });

  await test('并发提交 10 笔不丢数据', async () => {
    const before = store.state.transactions.length;
    const today = new Date().toISOString().slice(0, 10);
    const jobs = [];
    for (let i = 0; i < 10; i++) {
      jobs.push(store.commit((s) => {
        s.transactions.push({
          id: 'rapid-' + i, kind: 'expense', amount: 100 + i, accountId: 'a1',
          categoryId: 'c1', date: today, note: '', tagIds: []
        });
      }));
    }
    await Promise.all(jobs);
    eq(store.state.transactions.length, before + 10);
    const r = await api.getState();
    eq(r.data.transactions.length, before + 10);
  });

  await test('点击最近记录可打开编辑弹窗并改金额', async () => {
    const row = host.querySelector('.list-row-btn');
    ok(row, '没有最近记录行');
    row.click();
    await sleep(150);
    const modal = document.querySelector('.modal');
    ok(modal, '弹窗未打开');
    const input = modal.querySelector('input[aria-label="金额"]');
    ok(input, '弹窗内没有金额输入');
    input.value = '66';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = Array.from(modal.querySelectorAll('button')).find((b) => b.textContent.includes('保存修改'));
    ok(btn, '没有保存修改按钮');
    btn.click();
    const done = await waitFor(() => store.state.transactions.some((t) => t.amount === 6600));
    ok(done, '金额未更新');
  });

  await test('编辑后服务端数据同步', async () => {
    await sleep(200);
    const r = await api.getState();
    ok(r.data.transactions.some((t) => t.amount === 6600), '服务端没有更新');
  });


  await test('首页日历渲染整月天数', async () => {
    const cells = host.querySelectorAll('.cal-cell:not(.blank)');
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    eq(cells.length, days);
  });

  await test('今天格子显示当天支出', async () => {
    const cell = host.querySelector('.cal-cell.today');
    ok(cell, '没有今天的格子');
    ok(/\d/.test(cell.textContent), '今天格子没有金额：' + cell.textContent);
    ok(cell.classList.contains('has-data'), '今天格子未标记有数据');
  });

  await test('点日期打开当天收支明细', async () => {
    const cell = host.querySelector('.cal-cell.has-data');
    ok(cell, '找不到有数据的日期');
    cell.click();
    await sleep(200);
    const m = document.querySelector('.modal');
    ok(m, '当天明细弹窗未打开');
    ok(m.textContent.includes('收支'), '弹窗标题不对：' + m.textContent.slice(0, 40));
    const closeBtn = Array.from(m.querySelectorAll('button')).find((b) => b.textContent === '关闭');
    if (closeBtn) closeBtn.click();
  });

  await test('日历“查看当天账单”跳转账单页', async () => {
    const cell = host.querySelector('.cal-cell.today');
    cell.click();
    await sleep(200);
    const m = document.querySelector('.modal');
    const goBtn = Array.from(m.querySelectorAll('button')).find((b) => b.textContent === '查看当天账单');
    ok(goBtn, '没有查看当天账单按钮');
    goBtn.click();
    await sleep(150);
    const last = gotoCalls[gotoCalls.length - 1];
    ok(last && last.route === 'bills', '没有跳转账单：' + JSON.stringify(last));
    ok(last.params && last.params.date, '没有带上日期参数');
  });
}
function render() {
  const summary = document.getElementById('summary');
  summary.textContent = 'FLOW PASS ' + passed + ' / FAIL ' + failed;
  summary.className = failed ? 'fail' : 'pass';
  const ol = document.getElementById('results');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name;
    ol.append(li);
  });
  document.title = 'FLOW PASS ' + passed + ' FAIL ' + failed;
}

run()
  .catch((e) => {
    failed++;
    results.push({ ok: false, name: '运行异常 :: ' + (e && e.message ? e.message : e) });
  })
  .finally(render);

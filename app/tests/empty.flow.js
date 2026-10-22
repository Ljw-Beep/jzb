// 空状态巡检：清空数据后每个页面都要有引导文案，不能白屏或报错。
import { api } from '../js/api.js';
import { store } from '../js/store.js';
import { mount as mHome } from '../js/pages/home.js';
import { mount as mBills } from '../js/pages/bills.js';
import { mount as mStats } from '../js/pages/stats.js';
import { mount as mBudget } from '../js/pages/budget.js';
import { mount as mCategories } from '../js/pages/categories.js';
import { mount as mSettings } from '../js/pages/settings.js';
import { monthKey } from '../js/utils.js';

const results = [];
let passed = 0;
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function test(name, fn) {
  try { await fn(); passed++; results.push({ ok: true, name }); }
  catch (e) { failed++; results.push({ ok: false, name: name + ' :: ' + e.message }); }
}
function ok(v, msg = '期望为真') { if (!v) throw new Error(msg); }
function eq(a, b, msg = '') {
  const as = JSON.stringify(a); const bs = JSON.stringify(b);
  if (as !== bs) throw new Error((msg ? msg + ' ' : '') + '期望 ' + bs + '，实际 ' + as);
}

const ctx = { month: monthKey(), params: {}, goto() {}, openQuickAdd() {} };

async function run() {
  await api.ping();
  const r = await api.getState();
  const s = r.data;
  s.transactions = [];
  s.budgets = [];
  s.tags = [];
  await api.putState(s, r.rev);
  await store.load();

  const pages = [
    { name: '首页', id: 'h1', mount: mHome, expect: '还没有账目' },
    { name: '账单', id: 'h2', mount: mBills, expect: '没有符合条件的账目' },
    { name: '统计', id: 'h3', mount: mStats, expect: '还没有支出' },
    { name: '预算', id: 'h4', mount: mBudget, expect: '还没有设置本月总预算' },
    { name: '分类', id: 'h5', mount: mCategories, expect: '分类' },
    { name: '设置', id: 'h6', mount: mSettings, expect: '历史备份' }
  ];

  for (const page of pages) {
    await test(page.name + '页空状态可见', async () => {
      const host = document.getElementById(page.id);
      host.innerHTML = '';
      page.mount(host, ctx);
      await sleep(80);
      ok(host.textContent.trim().length > 0, '页面空白');
      ok(host.textContent.includes(page.expect), '未找到“' + page.expect + '”：' + host.textContent.slice(0, 120));
    });
  }

  await test('空数据下统计 KPI 显示 0', async () => {
    const host = document.getElementById('h3');
    const values = Array.from(host.querySelectorAll('.stat-value')).map((n) => n.textContent);
    eq(values, ['¥0.00', '¥0.00', '¥0.00']);
  });

  await test('空数据下记账表单仍可用', async () => {
    const host = document.getElementById('h1');
    ok(host.querySelector('input[aria-label="金额"]'), '缺少金额输入');
    ok(host.querySelectorAll('.cat-btn').length > 0, '分类网格为空');
  });

  await test('空数据下预算页不显示进度条', async () => {
    const host = document.getElementById('h4');
    eq(host.querySelectorAll('.budget-bar').length, 0);
  });
}

function render() {
  const summary = document.getElementById('summary');
  summary.textContent = 'EMPTY PASS ' + passed + ' / FAIL ' + failed;
  summary.className = failed ? 'fail' : 'pass';
  const ol = document.getElementById('results');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name;
    ol.append(li);
  });
  document.title = 'EMPTY PASS ' + passed + ' FAIL ' + failed;
}

run().catch((e) => {
  failed++;
  results.push({ ok: false, name: '运行异常 :: ' + (e && e.message ? e.message : e) });
}).finally(render);

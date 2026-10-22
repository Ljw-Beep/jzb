// 账单页流程测试：筛选、汇总、编辑、删除。
import { api } from '../js/api.js';
import { store } from '../js/store.js';
import { mount } from '../js/pages/bills.js';
import { todayStr } from '../js/utils.js';

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
  try { await fn(); passed++; results.push({ ok: true, name }); }
  catch (e) { failed++; results.push({ ok: false, name: name + ' :: ' + e.message }); }
}

function eq(a, b, msg = '') {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error((msg ? msg + ' ' : '') + '期望 ' + bs + '，实际 ' + as);
}
function ok(v, msg = '期望为真') { if (!v) throw new Error(msg); }

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const TODAY = todayStr();
const y = new Date(); y.setDate(y.getDate() - 1);
const YESTERDAY = ymd(y);
const SAME_MONTH = YESTERDAY.slice(0, 7) === TODAY.slice(0, 7);
const LAST_MONTH_DAY = (() => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return ymd(d);
})();

const expectedThisMonth = SAME_MONTH ? 3 : 2;
const expectedGroups = SAME_MONTH ? 2 : 1;

async function seed() {
  const r = await api.getState();
  const s = r.data;
  const mk = (id, kind, amount, categoryId, date, note) => ({
    id, kind, amount, accountId: 'a1', toAccountId: null, categoryId, date, note,
    tagIds: [], createdAt: date + 'T12:00:00+08:00', updatedAt: date + 'T12:00:00+08:00'
  });
  s.transactions = [
    mk('b1', 'expense', 2800, 'c1-2', TODAY, '和同事吃午饭'),
    mk('b2', 'expense', 620, 'c2-1', TODAY, '地铁通勤'),
    mk('b3', 'income', 500000, 'c10', YESTERDAY, '本月工资'),
    mk('b4', 'expense', 9900, 'c1-2', LAST_MONTH_DAY, '上个月的午饭')
  ];
  await api.putState(s, r.rev);
  await store.load();
}

function rows() { return Array.from(document.querySelectorAll('.bill-row')); }
function summaryText() { return document.querySelector('.filter-summary').textContent; }
function categoryDd() { return document.querySelectorAll('details.dd')[0]; }

async function run() {
  await api.ping();
  await seed();
  const host = document.getElementById('host');
  mount(host, { month: '', params: {}, goto() {}, openQuickAdd() {} });

  await test('默认本月只显示本月账目', async () => {
    await waitFor(() => rows().length > 0);
    eq(rows().length, expectedThisMonth);
  });

  await test('按日期分组', async () => {
    eq(document.querySelectorAll('.bill-group').length, expectedGroups);
  });

  await test('汇总金额正确', async () => {
    const text = summaryText();
    ok(text.includes('共 ' + expectedThisMonth + ' 笔'), text);
    ok(text.includes('支出 ¥34.20'), text);
    if (SAME_MONTH) ok(text.includes('收入 ¥5,000.00'), text);
  });

  await test('支出带负号、收入带正号', async () => {
    const amounts = rows().map((r) => r.querySelector('.row-amount').textContent);
    ok(amounts.some((a) => a === '−¥28.00'), JSON.stringify(amounts));
    if (SAME_MONTH) ok(amounts.some((a) => a === '+¥5,000.00'), JSON.stringify(amounts));
  });

  await test('分类筛选：餐饮只留 1 笔', async () => {
    const cb = categoryDd().querySelector('input[value="c1"]');
    ok(cb, '找不到餐饮复选框');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    eq(rows().length, 1);
    ok(categoryDd().querySelector('summary').textContent.includes('分类（1）'));
  });

  await test('重置筛选恢复全部', async () => {
    document.querySelector('.filter-bar .btn-ghost').click();
    await sleep(100);
    eq(rows().length, expectedThisMonth);
  });

  await test('备注搜索', async () => {
    const input = document.querySelector('input[aria-label="搜索备注"]');
    input.value = '地铁';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);
    eq(rows().length, 1);
    eq(rows()[0].querySelector('.row-title').textContent.includes('地铁通勤'), true);
  });

  await test('搜索无结果时显示空状态', async () => {
    const input = document.querySelector('input[aria-label="搜索备注"]');
    input.value = '不存在的关键词';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);
    eq(rows().length, 0);
    ok(document.body.textContent.includes('没有符合条件的账目'));
  });

  await test('清空筛选按钮恢复', async () => {
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '清空筛选').click();
    await sleep(150);
    ok(rows().length > 0);
  });

  await test('点击行打开编辑弹窗并保存金额', async () => {
    rows()[0].click();
    await sleep(150);
    const modal = document.querySelector('.modal');
    ok(modal, '弹窗未打开');
    const input = modal.querySelector('input[aria-label="金额"]');
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(modal.querySelectorAll('button')).find((b) => b.textContent.includes('保存修改')).click();
    const done = await waitFor(() => store.state.transactions.some((t) => t.amount === 5000));
    ok(done, '金额未更新');
  });

  await test('删除一笔并确认', async () => {
    const before = store.state.transactions.length;
    const delBtn = rows()[0].querySelector('[aria-label="删除"]');
    delBtn.click();
    await sleep(150);
    const modal = document.querySelector('.modal');
    ok(modal, '删除确认未出现');
    Array.from(modal.querySelectorAll('button')).find((b) => b.textContent === '删除').click();
    const done = await waitFor(() => store.state.transactions.length === before - 1);
    ok(done, '删除未生效');
  });

  await test('删除后服务端同步', async () => {
    await sleep(300);
    const r = await api.getState();
    eq(r.data.transactions.length, 3);
  });

  await test('取消删除不改变数据', async () => {
    const before = store.state.transactions.length;
    rows()[0].querySelector('[aria-label="删除"]').click();
    await sleep(150);
    const modal = document.querySelector('.modal');
    Array.from(modal.querySelectorAll('button')).find((b) => b.textContent === '取消').click();
    await sleep(200);
    eq(store.state.transactions.length, before);
  });
}

function render() {
  const summary = document.getElementById('summary');
  summary.textContent = 'BILLS PASS ' + passed + ' / FAIL ' + failed;
  summary.className = failed ? 'fail' : 'pass';
  const ol = document.getElementById('results');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name;
    ol.append(li);
  });
  document.title = 'BILLS PASS ' + passed + ' FAIL ' + failed;
}

run().catch((e) => {
  failed++;
  results.push({ ok: false, name: '运行异常 :: ' + (e && e.message ? e.message : e) });
}).finally(render);

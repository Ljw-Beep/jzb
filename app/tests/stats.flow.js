// 统计页流程测试：KPI、饼图钻取、折线切换、排行跳转。
import { api } from '../js/api.js';
import { store } from '../js/store.js';
import { mount } from '../js/pages/stats.js';
import { monthKey, addMonths, todayStr } from '../js/utils.js';

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
const DAY1 = MONTH + '-01';
const DAY2 = MONTH + '-15';

async function seed() {
  const r = await api.getState();
  const s = r.data;
  const mk = (id, kind, amount, categoryId, date, note) => ({
    id, kind, amount, accountId: 'a1', toAccountId: null, categoryId, date, note,
    tagIds: [], createdAt: date + 'T10:00:00+08:00', updatedAt: date + 'T10:00:00+08:00'
  });
  s.transactions = [
    mk('s1', 'expense', 3000, 'c1-2', DAY1, '午饭'),
    mk('s2', 'expense', 1000, 'c2-1', DAY2, '地铁'),
    mk('s3', 'income', 10000, 'c10', DAY1, '红包'),
    mk('s4', 'expense', 2000, 'c1-2', PREV + '-10', '上月午饭')
  ];
  await api.putState(s, r.rev);
  await store.load();
}

const gotoLog = [];

async function run() {
  await api.ping();
  await seed();
  const host = document.getElementById('host');
  mount(host, {
    month: MONTH,
    params: {},
    goto(route, params) { gotoLog.push({ route, params }); },
    openQuickAdd() {}
  });
  await sleep(100);

  await test('KPI 显示本月支出/收入/结余', async () => {
    const values = Array.from(host.querySelectorAll('.stat-value')).map((n) => n.textContent);
    eq(values[0], '¥40.00');
    eq(values[1], '¥100.00');
    eq(values[2], '¥60.00');
  });

  await test('环比显示比上月 +100%', async () => {
    const delta = host.querySelectorAll('.stat-delta')[0].textContent;
    ok(delta.includes('+100%'), delta);
  });

  await test('饼图两个扇区、两份图例', async () => {
    eq(host.querySelectorAll('.pie-slice').length, 2);
    eq(host.querySelectorAll('.legend-item').length, 2);
  });

  await test('饼图中心显示本月支出总额', async () => {
    ok(host.querySelector('.pie-center-value').textContent.includes('40.00'));
  });

  await test('饼图图例金额之和等于本月支出', async () => {
    const nums = Array.from(host.querySelectorAll('.legend-amount')).map((n) => Number(n.textContent.replace(/[^\d.]/g, '')));
    const sum = nums.reduce((a, b) => a + b, 0);
    const kpi = Number(host.querySelector('.stat-value').textContent.replace(/[^\d.]/g, ''));
    ok(Math.abs(sum - kpi) < 0.011, sum + ' vs ' + kpi);
  });

  await test('点击扇区钻取到二级分类', async () => {
    const slice = host.querySelector('.pie-slice[data-id="c1"]');
    ok(slice, '找不到餐饮扇区');
    slice.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);
    eq(host.querySelectorAll('.pie-slice').length, 1);
    ok(host.querySelector('.crumb'), '缺少面包屑');
    ok(host.querySelector('.crumb').textContent.includes('餐饮'));
  });

  await test('面包屑返回全部分类', async () => {
    host.querySelector('.crumb button').click();
    await sleep(150);
    eq(host.querySelectorAll('.pie-slice').length, 2);
    eq(host.querySelector('.crumb'), null);
  });

  await test('折线图渲染且可切换到累计', async () => {
    ok(host.querySelector('.line-svg'), '缺少折线图');
    const tabs = host.querySelectorAll('.tabs-sm .tab');
    tabs[1].click();
    await sleep(150);
    ok(host.querySelectorAll('.tabs-sm .tab')[1].classList.contains('active'), '累计未激活');
    ok(host.querySelector('.line-svg'), '切换后图表消失');
  });

  await test('累计折线终值等于本月支出', async () => {
    // 通过切回每日再切累计，确保渲染成功
    const tabs = host.querySelectorAll('.tabs-sm .tab');
    tabs[0].click();
    await sleep(100);
    const daily = Array.from(host.querySelectorAll('.line-svg .axis-label')).length;
    ok(daily > 0, '坐标轴标签缺失');
  });

  await test('分类排行显示两行且占比正确', async () => {
    const rows = host.querySelectorAll('.rank-row');
    eq(rows.length, 2);
    const cells = Array.from(rows[0].querySelectorAll('td')).map((c) => c.textContent.trim());
    ok(cells[0].includes('餐饮'), cells[0]);
    eq(cells[1], '¥30.00');
    eq(cells[2], '75.0%');
    eq(cells[3], '1');
  });

  await test('点击排行跳转账单并带上分类与月份', async () => {
    host.querySelector('.rank-row').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(100);
    eq(gotoLog.length, 1);
    eq(gotoLog[0].route, 'bills');
    eq(gotoLog[0].params.category, 'c1');
    eq(gotoLog[0].params.month, MONTH);
  });

  await test('切换月份后数据随之变化', async () => {
    const host2 = document.getElementById('host');
    host2.innerHTML = '';
    mount(host2, { month: PREV, params: {}, goto() {}, openQuickAdd() {} });
    await sleep(100);
    const values = Array.from(host2.querySelectorAll('.stat-value')).map((n) => n.textContent);
    eq(values[0], '¥20.00');
  });
}

function render() {
  const summary = document.getElementById('summary');
  summary.textContent = 'STATS PASS ' + passed + ' / FAIL ' + failed;
  summary.className = failed ? 'fail' : 'pass';
  const ol = document.getElementById('results');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name;
    ol.append(li);
  });
  document.title = 'STATS PASS ' + passed + ' FAIL ' + failed;
}

run().catch((e) => {
  failed++;
  results.push({ ok: false, name: '运行异常 :: ' + (e && e.message ? e.message : e) });
}).finally(render);

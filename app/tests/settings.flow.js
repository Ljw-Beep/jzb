// 设置页流程测试：数据信息、导入、偏好、清空。
import { api } from '../js/api.js';
import { store } from '../js/store.js';
import { mount } from '../js/pages/settings.js';
import { monthKey } from '../js/utils.js';

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
function modal() { return document.querySelector('.modal'); }
function byText(scope, sel, text) {
  return Array.from(scope.querySelectorAll(sel)).find((n) => n.textContent.trim() === text);
}

async function seed() {
  const r = await api.getState();
  const s = r.data;
  s.transactions = [
    { id: 'i1', kind: 'expense', amount: 1000, accountId: 'a1', categoryId: 'c1', date: monthKey() + '-01', note: 'A', tagIds: [], createdAt: '', updatedAt: '' },
    { id: 'i2', kind: 'income', amount: 5000, accountId: 'a2', categoryId: 'c10', date: monthKey() + '-02', note: 'B', tagIds: [], createdAt: '', updatedAt: '' }
  ];
  s.budgets = [{ month: monthKey(), total: 1000, byCategory: {} }];
  s.tags = [];
  await api.putState(s, r.rev);
  await store.load();
}

async function dispatchFile(input, text, name) {
  const file = new File([text], name || 'backup.json', { type: 'application/json' });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function run() {
  await api.ping();
  await seed();
  const host = document.getElementById('host');
  mount(host, { month: monthKey(), params: {}, goto() {}, openQuickAdd() {} });
  await sleep(200);

  await test('显示数据文件路径与备份数量', async () => {
    const path = host.querySelector('.info-row code');
    ok(path, '缺少数据路径');
    ok(path.textContent.includes('ledger.json'), path.textContent);
    ok(host.textContent.includes('历史备份'));
  });

  await test('提供 JSON 导出与 CSV 导出按钮', async () => {
    const buttons = Array.from(host.querySelectorAll('button')).map((b) => b.textContent);
    ok(buttons.includes('导出 JSON 备份'), buttons.join('|'));
    ok(buttons.includes('导出 CSV'), buttons.join('|'));
    ok(host.querySelector('input[type=file]'), '缺少导入文件选择');
  });

  await test('导入备份覆盖现有账目', async () => {
    const backup = JSON.parse(JSON.stringify(store.state));
    backup.transactions = [
      { id: 'n1', kind: 'expense', amount: 100, accountId: 'a1', categoryId: 'c1', date: monthKey() + '-03', note: '新1', tagIds: [] },
      { id: 'n2', kind: 'expense', amount: 200, accountId: 'a1', categoryId: 'c1', date: monthKey() + '-04', note: '新2', tagIds: [] },
      { id: 'n3', kind: 'expense', amount: 300, accountId: 'a1', categoryId: 'c1', date: monthKey() + '-05', note: '新3', tagIds: [] }
    ];
    const input = host.querySelector('input[type=file]');
    dispatchFile(input, JSON.stringify(backup));
    const appeared = await waitFor(() => !!modal());
    ok(appeared, '导入确认框未出现');
    ok(modal().textContent.includes('覆盖当前 2 笔'), modal().textContent.slice(0, 80));
    byText(modal(), 'button', '导入').click();
    const done = await waitFor(() => store.state.transactions.length === 3);
    ok(done, '导入后账目数量不对：' + store.state.transactions.length);
  });

  await test('导入前已自动备份', async () => {
    const info = await api.info();
    ok(info.backupCount >= 2, '备份数量 ' + info.backupCount);
  });

  await test('非法文件不改变数据', async () => {
    const before = store.state.transactions.length;
    const input = host.querySelector('input[type=file]');
    dispatchFile(input, '这不是 JSON');
    await sleep(400);
    eq(store.state.transactions.length, before);
    const toasts = document.getElementById('toastRoot').textContent;
    ok(toasts.includes('JSON'), toasts);
  });

  await test('切换默认账户', async () => {
    const select = host.querySelector('select[aria-label="默认账户"]');
    ok(select, '缺少默认账户选择');
    select.value = 'a2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const done = await waitFor(() => store.state.settings.defaultAccountId === 'a2');
    ok(done, '默认账户未保存');
  });

  await test('关闭超支提醒', async () => {
    const cb = host.querySelector('#prefAlert');
    ok(cb, '缺少超支提醒开关');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    const done = await waitFor(() => store.state.settings.overspendAlert === false);
    ok(done, '超支提醒未关闭');
  });

  await test('清空需要输入确认文字', async () => {
    byText(host, 'button', '清空数据').click();
    await sleep(150);
    const m = modal();
    ok(m, '清空弹窗未出现');
    m.querySelector('input').value = '随便写';
    byText(m, 'button', '确认清空').click();
    await sleep(200);
    ok(m.textContent.includes('请输入'), m.textContent.slice(0, 80));
    eq(store.state.transactions.length, 3);
  });

  await test('输入清空后账目与预算被删除', async () => {
    const m = modal();
    m.querySelector('input').value = '清空';
    byText(m, 'button', '确认清空').click();
    const done = await waitFor(() => store.state.transactions.length === 0);
    ok(done, '账目未清空');
    eq(store.state.budgets.length, 0);
  });

  await test('清空后服务端同步为空', async () => {
    await sleep(300);
    const r = await api.getState();
    eq(r.data.transactions.length, 0);
  });
}

function render() {
  const summary = document.getElementById('summary');
  summary.textContent = 'SETTINGS PASS ' + passed + ' / FAIL ' + failed;
  summary.className = failed ? 'fail' : 'pass';
  const ol = document.getElementById('results');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name;
    ol.append(li);
  });
  document.title = 'SETTINGS PASS ' + passed + ' FAIL ' + failed;
}

run().catch((e) => {
  failed++;
  results.push({ ok: false, name: '运行异常 :: ' + (e && e.message ? e.message : e) });
}).finally(render);

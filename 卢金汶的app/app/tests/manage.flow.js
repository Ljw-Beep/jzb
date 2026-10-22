// 分类 / 账户 / 标签管理流程测试
import { api } from '../js/api.js';
import { store } from '../js/store.js';
import { mount as mountCategories } from '../js/pages/categories.js';
import { mount as mountSettings } from '../js/pages/settings.js';
import { categoryTiles } from '../js/quickadd.js';
import { topCategories, activeAccounts } from '../js/selectors.js';
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
  const as = JSON.stringify(a); const bs = JSON.stringify(b);
  if (as !== bs) throw new Error((msg ? msg + ' ' : '') + '期望 ' + bs + '，实际 ' + as);
}
function ok(v, msg = '期望为真') { if (!v) throw new Error(msg); }

function findButton(scope, text) {
  return Array.from(scope.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
}
function rowByText(scope, selector, text) {
  return Array.from(scope.querySelectorAll(selector)).find((r) => r.textContent.includes(text));
}
function modal() { return document.querySelector('.modal'); }

async function run() {
  await api.ping();
  // 清空账目与标签，保证起点干净
  const r = await api.getState();
  const base = r.data;
  base.transactions = [];
  base.tags = [];
  await api.putState(base, r.rev);
  await store.load();

  const host = document.getElementById('host');
  mountCategories(host, {});
  await sleep(100);

  await test('支出分类显示 9 个一级分类', async () => {
    eq(host.querySelectorAll('.cat-row.parent').length, 9);
  });

  await test('新建一级分类「宠物」', async () => {
    findButton(host, '＋ 新建一级分类').click();
    await sleep(80);
    modal().querySelector('input.input').value = '宠物';
    findButton(modal(), '创建').click();
    const done = await waitFor(() => store.state.categories.some((c) => c.name === '宠物' && !c.parentId));
    ok(done, '分类未创建');
  });

  await test('在宠物下新建二级分类「猫粮」', async () => {
    const petRow = rowByText(host, '.cat-row', '宠物');
    findButton(petRow, '加子类').click();
    await sleep(80);
    modal().querySelector('input.input').value = '猫粮';
    findButton(modal(), '创建').click();
    const done = await waitFor(() => store.state.categories.some((c) => c.name === '猫粮'));
    ok(done, '子分类未创建');
    const pet = store.state.categories.find((c) => c.name === '宠物');
    const food = store.state.categories.find((c) => c.name === '猫粮');
    eq(food.parentId, pet.id);
  });

  await test('展开后能看到子分类行', async () => {
    const petRow = rowByText(host, '.cat-row', '宠物');
    ok(petRow, '找不到宠物分类行');
    if (!rowByText(host, '.cat-row.child', '猫粮')) {
      petRow.querySelector('.cat-expand').click();
      await sleep(100);
    }
    ok(rowByText(host, '.cat-row.child', '猫粮'), '子分类行未显示');
  });

  await test('二级分类下不能再建子分类', async () => {
    if (!rowByText(host, '.cat-row.child', '猫粮')) {
      rowByText(host, '.cat-row', '宠物').querySelector('.cat-expand').click();
      await sleep(100);
    }
    const childRow = rowByText(host, '.cat-row.child', '猫粮');
    ok(childRow, '找不到猫粮行');
    eq(!!findButton(childRow, '加子类'), false);
  });

  await test('记账分类网格包含「猫粮」', async () => {
    const tiles = categoryTiles(store.state, 'expense');
    ok(tiles.some((t) => t.label === '猫粮'), '记账网格缺少猫粮');
  });

  await test('停用一级分类后记账网格不再出现其子类', async () => {
    findButton(rowByText(host, '.cat-row', '宠物'), '停用').click();
    await waitFor(() => store.state.categories.find((c) => c.name === '宠物').archived === true);
    const tiles = categoryTiles(store.state, 'expense');
    eq(tiles.some((t) => t.label === '猫粮'), false);
  });

  await test('重新启用后恢复显示', async () => {
    findButton(rowByText(host, '.cat-row', '宠物'), '启用').click();
    await waitFor(() => store.state.categories.find((c) => c.name === '宠物').archived === false);
    const tiles = categoryTiles(store.state, 'expense');
    ok(tiles.some((t) => t.label === '猫粮'), '启用后未恢复');
  });

  await test('上移调整分类顺序', async () => {
    const before = topCategories(store.state, 'expense').map((c) => c.id + ':' + c.order).join(',');
    const row = rowByText(host, '.cat-row', '交通');
    ok(row, '找不到交通行');
    const up = findButton(row, '↑');
    ok(up, '找不到上移按钮');
    up.click();
    await sleep(300);
    const after = topCategories(store.state, 'expense').map((c) => c.id + ':' + c.order).join(',');
    ok(before !== after, '顺序未变化 before=' + before + ' after=' + after + ' toast=' + (document.getElementById('toastRoot').textContent || ''));
  });

  await test('有引用的分类不允许直接删除，可转移后删除', async () => {
    const food = store.state.categories.find((c) => c.name === '猫粮');
    await store.commit((s) => {
      s.transactions.push({
        id: 'mx1', kind: 'expense', amount: 1000, accountId: 'a1', toAccountId: null,
        categoryId: food.id, date: todayStr(), note: '猫粮测试', tagIds: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
    });
    await sleep(150);
    if (!rowByText(host, '.cat-row.child', '猫粮')) {
      const petRow = rowByText(host, '.cat-row', '宠物');
      ok(petRow, '找不到宠物行');
      petRow.querySelector('.cat-expand').click();
      await sleep(120);
    }
    const foodRow = rowByText(host, '.cat-row.child', '猫粮');
    ok(foodRow, '找不到猫粮行');
    const delBtn = findButton(foodRow, '🗑');
    ok(delBtn, '找不到删除按钮');
    delBtn.click();
    await sleep(200);
    const m = modal();
    ok(m, '没有出现删除/转移弹窗');
    ok(m.textContent.includes('已被 1 笔账目使用'), m.textContent.slice(0, 80));
    findButton(m, '转移并删除').click();
    const done = await waitFor(() => !store.state.categories.some((c) => c.name === '猫粮'));
    ok(done, '分类未删除');
    const tx = store.state.transactions.find((t) => t.id === 'mx1');
    ok(tx.categoryId !== food.id, '账目未转移');
  });

  // ---------------- 设置页：账户与标签 ----------------
  const host2 = document.getElementById('host2');
  mountSettings(host2, {});
  await sleep(100);

  await test('设置页显示账户与标签区块', async () => {
    ok(host2.textContent.includes('账户管理'));
    ok(host2.textContent.includes('标签管理'));
  });

  await test('新建账户「饭卡」初始余额 500', async () => {
    findButton(host2, '＋ 新建账户').click();
    await sleep(80);
    const m = modal();
    const inputs = m.querySelectorAll('input.input');
    inputs[0].value = '饭卡';
    inputs[1].value = '500';
    findButton(m, '创建').click();
    const done = await waitFor(() => store.state.accounts.some((a) => a.name === '饭卡'));
    ok(done, '账户未创建');
    const acc = store.state.accounts.find((a) => a.name === '饭卡');
    eq(acc.initialBalance, 50000);
  });

  await test('编辑账户名称', async () => {
    const row = rowByText(host2, '.list-row', '饭卡');
    findButton(row, '编辑').click();
    await sleep(80);
    const m = modal();
    m.querySelectorAll('input.input')[0].value = '饭卡二';
    findButton(m, '保存').click();
    const done = await waitFor(() => store.state.accounts.some((a) => a.name === '饭卡二'));
    ok(done, '名称未更新');
  });

  await test('归档账户后不出现在活跃账户里', async () => {
    const row = rowByText(host2, '.list-row', '饭卡二');
    findButton(row, '归档').click();
    const done = await waitFor(() => store.state.accounts.find((a) => a.name === '饭卡二').archived === true);
    ok(done, '账户未归档');
    eq(activeAccounts(store.state).some((a) => a.name === '饭卡二'), false);
  });

  await test('添加标签', async () => {
    const input = Array.from(host2.querySelectorAll('input.input')).find((i) => i.placeholder === '新标签名称');
    input.value = '测试标签';
    findButton(host2, '添加').click();
    const done = await waitFor(() => store.state.tags.some((t) => t.name === '测试标签'));
    ok(done, '标签未添加');
  });

  await test('重命名标签', async () => {
    const chip = rowByText(host2, '.chip-lg', '测试标签');
    ok(chip, '找不到标签 chip');
    const renameBtn = chip.querySelector('.chip-act');
    ok(renameBtn, '找不到重命名按钮');
    renameBtn.click();
    await sleep(150);
    const m = modal();
    ok(m, '重命名弹窗未出现');
    m.querySelector('input.input').value = '改过的标签';
    findButton(m, '保存').click();
    const done = await waitFor(() => store.state.tags.some((t) => t.name === '改过的标签'));
    ok(done, '标签未重命名');
  });

  await test('删除标签并确认', async () => {
    const chip = rowByText(host2, '.chip-lg', '改过的标签');
    ok(chip, '找不到标签 chip');
    const delBtn = chip.querySelector('.chip-act.danger');
    ok(delBtn, '找不到删除按钮');
    delBtn.click();
    await sleep(200);
    const m = modal();
    ok(m, '删除确认未出现');
    findButton(m, '删除').click();
    const done = await waitFor(() => !store.state.tags.some((t) => t.name === '改过的标签'));
    ok(done, '标签未删除');
  });


  await test('子分类可在编辑时更换一级分类', async () => {
    // 新建 宠物 > 猫砂
    findButton(rowByText(host, '.cat-row', '宠物'), '加子类').click();
    await sleep(120);
    modal().querySelector('input.input').value = '猫砂';
    findButton(modal(), '创建').click();
    const created = await waitFor(() => store.state.categories.some((c) => c.name === '猫砂'));
    ok(created, '子分类未创建');

    if (!rowByText(host, '.cat-row.child', '猫砂')) {
      rowByText(host, '.cat-row', '宠物').querySelector('.cat-expand').click();
      await sleep(120);
    }
    const childRow = rowByText(host, '.cat-row.child', '猫砂');
    ok(childRow, '找不到猫砂行');
    findButton(childRow, '编辑').click();
    await sleep(150);

    const m = modal();
    const sel = m.querySelector('select[aria-label="所属一级分类"]');
    ok(sel, '编辑弹窗里没有“所属一级分类”选择');
    sel.value = 'c2'; // 交通
    findButton(m, '保存').click();

    const done = await waitFor(() => {
      const c = store.state.categories.find((x) => x.name === '猫砂');
      return c && c.parentId === 'c2';
    });
    ok(done, '子分类没有移动到交通');
  });
  await test('拖拽一级分类可以调整顺序', async () => {
    const rows = Array.from(host.querySelectorAll('.cat-row.parent'));
    ok(rows.length >= 3, '一级分类太少');
    const before = rows.map((r) => r.dataset.cat);
    const dragRow = rows[2];
    const targetRow = rows[0];
    const dt = new DataTransfer();
    dragRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const rect = targetRow.getBoundingClientRect();
    const y = rect.top + 2;
    targetRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: y }));
    targetRow.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: y }));
    await sleep(400);
    const after = Array.from(host.querySelectorAll('.cat-row.parent')).map((r) => r.dataset.cat);
    eq(after[0], before[2], '被拖动的分类没有排到第一位');
  });
}
function render() {
  const summary = document.getElementById('summary');
  summary.textContent = 'MANAGE PASS ' + passed + ' / FAIL ' + failed;
  summary.className = failed ? 'fail' : 'pass';
  const ol = document.getElementById('results');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name;
    ol.append(li);
  });
  document.title = 'MANAGE PASS ' + passed + ' FAIL ' + failed;
}

run().catch((e) => {
  failed++;
  results.push({ ok: false, name: '运行异常 :: ' + (e && e.message ? e.message : e) });
}).finally(render);

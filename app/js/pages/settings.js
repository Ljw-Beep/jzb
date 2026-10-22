import { el, openModal, confirmDialog, toast, emptyBlock } from '../components.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { accountBalances, allAccountsSorted, activeAccounts } from '../selectors.js';
import { fmtMoney, parseAmount, fenToInput, uid, monthKey, addMonths, monthLabel } from '../utils.js';
import { validateBackup } from '../models.js';

export const title = '设置';

const ACCOUNT_ICONS = ['💵', '💬', '🔵', '💳', '🏦', '🏧', '📱', '🪙', '💼', '🎫'];
const ACCOUNT_COLORS = ['#2f80ed', '#07c160', '#1677ff', '#7b61ff', '#e67e22', '#16a085', '#e84393', '#7f8c8d'];

function state() { return store.state; }

function section(titleText, ...children) {
  return el('section', { class: 'card settings-section' },
    el('div', { class: 'card-head' }, el('h2', { class: 'card-title', text: titleText })),
    ...children
  );
}

export function mount(root, ctx) {
  const page = el('div', { class: 'page', 'data-page': 'settings' });
  root.append(page);

  const accountsBox = el('div', {});
  const tagsBox = el('div', {});
  const dataBox = el('div', {});
  const prefsBox = el('div', {});
  const dangerBox = el('div', {});
  let info = null;

  // ---------------- 账户 ----------------
  function openAccountEditor(acc) {
    const editing = !!acc;
    let icon = acc ? acc.icon : '💵';
    let color = acc ? acc.color : '#2f80ed';

    const nameInput = el('input', { class: 'input', maxlength: '10', placeholder: '账户名称' });
    nameInput.value = acc ? acc.name : '';

    const initInput = el('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00' });
    initInput.value = acc ? fenToInput(acc.initialBalance) : '';

    const iconGrid = el('div', { class: 'icon-grid' });
    ACCOUNT_ICONS.forEach((ic) => {
      const b = el('button', { type: 'button', class: 'icon-pick' + (ic === icon ? ' active' : '') }, ic);
      b.addEventListener('click', () => {
        icon = ic;
        iconGrid.querySelectorAll('.icon-pick').forEach((x) => x.classList.toggle('active', x.textContent === ic));
      });
      iconGrid.append(b);
    });

    const colorGrid = el('div', { class: 'color-grid' });
    ACCOUNT_COLORS.forEach((c) => {
      const b = el('button', { type: 'button', class: 'color-pick' + (c === color ? ' active' : ''), style: 'background:' + c });
      b.addEventListener('click', () => {
        color = c;
        colorGrid.querySelectorAll('.color-pick').forEach((x) => x.classList.toggle('active', x === b));
      });
      colorGrid.append(b);
    });

    const err = el('div', { class: 'form-error' });

    const m = openModal({
      title: editing ? '编辑账户' : '新建账户',
      width: 460,
      body: el('div', { class: 'stack' },
        el('div', { class: 'field' }, el('label', { class: 'field-label' }, '名称 *'), nameInput),
        el('div', { class: 'field' }, el('label', { class: 'field-label' }, '初始余额（元）'), initInput),
        el('div', { class: 'field' }, el('label', { class: 'field-label' }, '图标'), iconGrid),
        el('div', { class: 'field' }, el('label', { class: 'field-label' }, '颜色'), colorGrid),
        err
      ),
      footer: [
        el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, '取消'),
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async () => {
            const name = nameInput.value.trim();
            if (!name) { err.textContent = '请输入账户名称'; return; }
            if (state().accounts.some((a) => a.name === name && (!acc || a.id !== acc.id))) {
              err.textContent = '已有同名账户'; return;
            }
            const initVal = parseAmount(initInput.value || '0');
            if (initVal === null) { err.textContent = '初始余额格式不正确'; return; }
            try {
              if (editing) {
                await store.commit((s) => {
                  const a = s.accounts.find((x) => x.id === acc.id);
                  a.name = name; a.icon = icon; a.color = color; a.initialBalance = initVal;
                });
                toast('已保存', 'ok');
              } else {
                const order = state().accounts.reduce((mx, a) => Math.max(mx, a.order || 0), 0) + 1;
                await store.commit((s) => {
                  s.accounts.push({
                    id: uid('acc'), name, icon, color, initialBalance: initVal,
                    archived: false, order
                  });
                });
                toast('已创建账户', 'ok');
              }
              m.close();
            } catch (e) { err.textContent = '保存失败：' + e.message; }
          }
        }, editing ? '保存' : '创建')
      ]
    });
    setTimeout(() => nameInput.focus(), 50);
  }

  function renderAccounts() {
    const bal = accountBalances(state());
    const list = allAccountsSorted(state());
    accountsBox.innerHTML = '';
    accountsBox.append(el('div', { class: 'card-head' },
      el('span', { class: 'card-sub', text: '共 ' + list.length + ' 个账户' }),
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openAccountEditor(null) }, '＋ 新建账户')
    ));

    if (!list.length) {
      accountsBox.append(emptyBlock({ icon: '💳', text: '还没有账户', actionText: '新建账户', onAction: () => openAccountEditor(null) }));
      return;
    }

    const wrap = el('div', { class: 'list' });
    list.forEach((a) => {
      const amount = bal[a.id] || 0;
      const row = el('div', { class: 'list-row' + (a.archived ? ' archived' : '') },
        el('span', { class: 'row-ico', style: 'color:' + (a.color || '#666'), text: a.icon || '💳' }),
        el('span', { class: 'row-main' },
          el('span', { class: 'row-title' }, a.name, a.archived ? el('span', { class: 'chip chip-mini', text: '已归档' }) : null),
          el('span', { class: 'row-sub', text: '初始 ¥' + fmtMoney(a.initialBalance || 0).replace('¥', '') })
        ),
        el('span', { class: 'row-amount', text: fmtMoney(amount) }),
        el('span', { class: 'row-actions always' },
          el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openAccountEditor(a) }, '编辑'),
          el('button', {
            class: 'btn btn-sm', type: 'button',
            onclick: async () => {
              try {
                await store.commit((s) => {
                  const x = s.accounts.find((y) => y.id === a.id);
                  x.archived = !x.archived;
                });
                toast(a.archived ? '已恢复账户' : '已归档账户', 'ok');
              } catch (e) { toast('操作失败：' + e.message, 'err'); }
            }
          }, a.archived ? '恢复' : '归档')
        )
      );
      wrap.append(row);
    });
    accountsBox.append(wrap, el('div', { class: 'card-sub', style: 'margin-top:10px' },
      '有账目的账户不能删除，只能归档；归档后不再出现在记账页，但仍保留历史余额。'));
  }

  // ---------------- 标签 ----------------
  const tagInput = el('input', { class: 'input', maxlength: '12', placeholder: '新标签名称' });
  const tagAddBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, '添加');

  async function addTag() {
    const name = tagInput.value.trim();
    if (!name) return;
    if ((state().tags || []).some((t) => t.name === name)) { toast('标签已存在', 'warn'); return; }
    try {
      await store.commit((s) => { s.tags.push({ id: uid('tag'), name }); });
      tagInput.value = '';
      toast('已添加标签', 'ok');
    } catch (e) { toast('添加失败：' + e.message, 'err'); }
  }
  tagAddBtn.addEventListener('click', addTag);
  tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });

  function tagUsage(id) {
    return state().transactions.filter((t) => (t.tagIds || []).includes(id)).length;
  }

  function openTagEditor(tag) {
    const input = el('input', { class: 'input', maxlength: '12' });
    input.value = tag.name;
    const err = el('div', { class: 'form-error' });
    const m = openModal({
      title: '重命名标签',
      width: 400,
      body: el('div', { class: 'stack' }, input, err),
      footer: [
        el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, '取消'),
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async () => {
            const name = input.value.trim();
            if (!name) { err.textContent = '名称不能为空'; return; }
            if (state().tags.some((t) => t.name === name && t.id !== tag.id)) { err.textContent = '标签已存在'; return; }
            try {
              await store.commit((s) => { s.tags.find((t) => t.id === tag.id).name = name; });
              toast('已重命名', 'ok');
              m.close();
            } catch (e) { err.textContent = e.message; }
          }
        }, '保存')
      ]
    });
    setTimeout(() => input.focus(), 50);
  }

  function renderTags() {
    const tags = state().tags || [];
    tagsBox.innerHTML = '';
    tagsBox.append(el('div', { class: 'tag-add-row', style: 'margin-bottom:12px' }, tagInput, tagAddBtn));

    if (!tags.length) {
      tagsBox.append(emptyBlock({ icon: '🏷️', text: '还没有标签，添加一个试试' }));
      return;
    }

    const wrap = el('div', { class: 'tag-cloud' });
    tags.forEach((t) => {
      const used = tagUsage(t.id);
      wrap.append(el('span', { class: 'chip chip-lg' },
        el('span', { text: t.name, class: 'tag-name' }),
        el('span', { class: 'tag-count', text: used ? used + ' 笔' : '未使用' }),
        el('button', { type: 'button', class: 'chip-act', title: '重命名', onclick: () => openTagEditor(t) }, '✎'),
        el('button', {
          type: 'button', class: 'chip-act danger', title: '删除',
          onclick: async () => {
            const okDelete = await confirmDialog({
              title: '删除标签',
              message: '删除标签「' + t.name + '」？' + (used ? '会从 ' + used + ' 笔账目上移除该标签。' : ''),
              okText: '删除', danger: true
            });
            if (!okDelete) return;
            try {
              await store.commit((s) => {
                s.tags = s.tags.filter((x) => x.id !== t.id);
                s.transactions.forEach((tx) => {
                  if (tx.tagIds && tx.tagIds.includes(t.id)) tx.tagIds = tx.tagIds.filter((id) => id !== t.id);
                });
              });
              toast('已删除标签', 'ok');
            } catch (e) { toast('删除失败：' + e.message, 'err'); }
          }
        }, '×')
      ));
    });
    tagsBox.append(wrap);
  }

  // ---------------- 数据与备份 ----------------
  function download(url) {
    const a = el('a', { href: url, download: '' });
    document.body.append(a);
    a.click();
    a.remove();
  }

  async function loadInfo() {
    try {
      info = await api.info();
    } catch (e) {
      info = null;
    }
    renderData();
  }

  async function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    let obj = null;
    try {
      const text = await file.text();
      obj = JSON.parse(text);
    } catch (err) {
      toast('文件不是合法的 JSON', 'err');
      e.target.value = '';
      return;
    }
    const v = validateBackup(obj);
    if (!v.ok) {
      toast(v.error, 'err', 4000);
      e.target.value = '';
      return;
    }
    const cur = state().transactions.length;
    const okImport = await confirmDialog({
      title: '导入备份',
      message: '将用备份中的 ' + obj.transactions.length + ' 笔账目覆盖当前 ' + cur + ' 笔（含分类、账户、预算）。导入前会自动备份当前数据。',
      okText: '导入',
      danger: true
    });
    if (!okImport) { e.target.value = ''; return; }
    try { await api.backup(); } catch (err) { /* 备份失败不阻断导入 */ }
    try {
      await store.commit((s) => {
        s.version = obj.version;
        s.accounts = obj.accounts;
        s.categories = obj.categories;
        s.tags = Array.isArray(obj.tags) ? obj.tags : [];
        s.transactions = obj.transactions;
        s.budgets = Array.isArray(obj.budgets) ? obj.budgets : [];
        if (obj.settings) s.settings = obj.settings;
      });
      toast('已恢复 ' + obj.transactions.length + ' 笔账目', 'ok', 4000);
      loadInfo();
    } catch (err) {
      toast('导入失败：' + err.message, 'err', 4000);
    }
    e.target.value = '';
  }

  function renderData() {
    dataBox.innerHTML = '';
    const fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    fileInput.addEventListener('change', onImportFile);

    const csvSelect = el('select', { class: 'select', 'aria-label': '导出范围' });
    csvSelect.append(
      el('option', { value: monthKey() }, '本月（' + monthLabel(monthKey()) + '）'),
      el('option', { value: addMonths(monthKey(), -1) }, '上月（' + monthLabel(addMonths(monthKey(), -1)) + '）'),
      el('option', { value: 'all' }, '全部账目')
    );

    dataBox.append(
      el('div', { class: 'info-row' },
        el('span', { class: 'muted', text: '数据文件' }),
        el('code', { class: 'path', text: info ? info.dataFile : '读取中…' })
      ),
      el('div', { class: 'info-row' },
        el('span', { class: 'muted', text: '历史备份' }),
        el('span', { text: info ? (info.backupCount + ' 份' + (info.lastBackup ? '，最近 ' + info.lastBackup : '')) : '—' })
      ),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => download(api.exportJsonUrl()) }, '导出 JSON 备份'),
        el('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, '从备份导入'),
        csvSelect,
        el('button', {
          class: 'btn', type: 'button',
          onclick: () => {
            const v = csvSelect.value;
            download(v === 'all' ? api.exportCsvUrl({ all: '1' }) : api.exportCsvUrl({ month: v }));
          }
        }, '导出 CSV')
      ),
      fileInput,
      el('p', { class: 'card-sub', text: '导入会覆盖当前全部数据，导入前会自动备份一份；CSV 用 Excel 可直接打开。' })
    );
  }

  // ---------------- 偏好 ----------------
  async function saveSetting(patch) {
    try {
      await store.commit((s) => {
        s.settings = s.settings || {};
        Object.assign(s.settings, patch);
      });
      toast('已保存', 'ok');
    } catch (e) {
      toast('保存失败：' + e.message, 'err');
    }
  }

  function renderPrefs() {
    const st = state();
    const settings = st.settings || {};
    prefsBox.innerHTML = '';

    const accSel = el('select', { class: 'select', 'aria-label': '默认账户' });
    allAccountsSorted(st).filter((a) => !a.archived).forEach((a) => {
      const opt = el('option', { value: a.id }, a.name);
      if (a.id === settings.defaultAccountId) opt.selected = true;
      accSel.append(opt);
    });
    accSel.addEventListener('change', () => saveSetting({ defaultAccountId: accSel.value }));

    const alertCb = el('input', { type: 'checkbox', id: 'prefAlert' });
    alertCb.checked = settings.overspendAlert !== false;
    alertCb.addEventListener('change', () => saveSetting({ overspendAlert: alertCb.checked }));

    prefsBox.append(
      el('div', { class: 'pref-row' },
        el('span', { class: 'pref-label', text: '默认账户' }),
        accSel,
        el('span', { class: 'card-sub', text: '记账时默认选中' })
      ),
      el('div', { class: 'pref-row' },
        el('label', { class: 'pref-label', for: 'prefAlert', text: '超支提醒' }),
        alertCb,
        el('span', { class: 'card-sub', text: '关闭后首页与侧边栏不再提示' })
      ),
      el('div', { class: 'pref-row' },
        el('span', { class: 'pref-label', text: '每月起始日' }),
        el('span', { class: 'muted', text: '每月 1 日（第一版固定）' })
      )
    );
  }

  // ---------------- 危险操作 ----------------
  function renderDanger() {
    dangerBox.innerHTML = '';
    dangerBox.append(
      el('div', { class: 'row-between' },
        el('div', {},
          el('div', { text: '清空所有账目与预算' }),
          el('div', { class: 'card-sub', text: '分类、账户、标签会保留。执行前自动备份。' })
        ),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: clearAll }, '清空数据')
      )
    );
  }

  function clearAll() {
    const input = el('input', { class: 'input', placeholder: '输入「清空」确认' });
    const err = el('div', { class: 'form-error' });
    const m = openModal({
      title: '清空数据',
      width: 420,
      body: el('div', { class: 'stack' },
        el('p', { text: '将删除全部 ' + state().transactions.length + ' 笔账目和所有预算设置，且不可撤销（会先自动备份）。' }),
        input,
        err
      ),
      footer: [
        el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, '取消'),
        el('button', {
          class: 'btn btn-danger', type: 'button',
          onclick: async () => {
            if (input.value.trim() !== '清空') { err.textContent = '请输入「清空」两个字'; return; }
            try { await api.backup(); } catch (e) { /* 忽略 */ }
            try {
              await store.commit((s) => { s.transactions = []; s.budgets = []; });
              toast('已清空账目', 'ok');
              m.close();
              loadInfo();
            } catch (e) { err.textContent = '清空失败：' + e.message; }
          }
        }, '确认清空')
      ]
    });
    setTimeout(() => input.focus(), 50);
  }

  function renderAll() {
    renderAccounts();
    renderTags();
    renderData();
    renderPrefs();
    renderDanger();
  }

  page.append(
    section('数据与备份', dataBox),
    section('账户管理', accountsBox),
    section('标签管理', tagsBox),
    section('偏好', prefsBox),
    section('危险操作', dangerBox)
  );

  renderAll();
  loadInfo();
  const unsub = store.subscribe(renderAll);
  return () => unsub();
}

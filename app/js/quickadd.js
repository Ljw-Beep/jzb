// 记账表单：首页常驻与全局弹窗共用。
import { el, toast, openModal } from './components.js';
import { store } from './store.js';
import {
  activeAccounts, topCategories, childrenOf, categoryMap, categoryLabel, accountBalances
} from './selectors.js';
import {
  todayStr, sanitizeAmountInput, parseAmount, fenToInput, fmtMoney, fmtSigned, uid
} from './utils.js';
import { validateEntry, makeTransaction, applyTransaction } from './models.js';

function state() { return store.state; }

/** 可选的分类磁贴：有子分类的展开成子分类，没有的直接用自身。 */
export function categoryTiles(st, kind) {
  const tiles = [];
  topCategories(st, kind).filter(p => !p.archived).forEach(p => {
    const kids = childrenOf(st, p.id).filter(k => !k.archived);
    if (kids.length) {
      kids.forEach(k => tiles.push({
        id: k.id, label: k.name, icon: p.icon || '📦', color: p.color,
        title: p.name + ' · ' + k.name
      }));
    } else {
      tiles.push({ id: p.id, label: p.name, icon: p.icon || '📦', color: p.color, title: p.name });
    }
  });
  return tiles;
}

/**
 * 创建记账表单。
 * @param {{initial?:Object, onSaved?:Function, onCancel?:Function}} opts
 */
export function createEntryForm(opts = {}) {
  const { initial = null, onSaved } = opts;
  const editing = !!initial;

  let kind = initial ? initial.kind : 'expense';
  let amountStr = initial ? fenToInput(initial.amount) : '';
  let categoryId = initial ? initial.categoryId : null;
  let accountId = initial ? initial.accountId : null;
  let toAccountId = initial ? initial.toAccountId : null;
  let date = initial ? initial.date : todayStr();
  let tagIds = initial ? Array.from(initial.tagIds || []) : [];
  let expanded = false;

  const st0 = state();
  if (!accountId) {
    const accs = activeAccounts(st0);
    accountId = (st0.settings && st0.settings.defaultAccountId) || (accs[0] && accs[0].id) || null;
  }
  if (kind === 'transfer' && !toAccountId) {
    const other = activeAccounts(st0).find(a => a.id !== accountId);
    toAccountId = other ? other.id : null;
  }

  const root = el('div', { class: 'entry-form' });

  // ---- 类型切换 ----
  const tabsEl = el('div', { class: 'tabs', role: 'tablist' });
  const kinds = [['expense', '支出'], ['income', '收入'], ['transfer', '转账']];
  const tabBtns = {};
  kinds.forEach(([k, label]) => {
    const b = el('button', { type: 'button', class: 'tab', role: 'tab', 'data-kind': k }, label + (k === 'expense' ? ' (Alt+1)' : k === 'income' ? ' (Alt+2)' : ' (Alt+3)'));
    b.addEventListener('click', () => setKind(k));
    tabBtns[k] = b;
    tabsEl.append(b);
  });

  // ---- 金额 ----
  const amountInput = el('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-label': '金额'
  });
  amountInput.value = amountStr;
  const moneyBox = el('div', { class: 'money-input' },
    el('span', { class: 'money-symbol', text: '¥' }),
    amountInput
  );
  const hintEl = el('div', { class: 'form-hint', hidden: true, role: 'status' });

  // ---- 分类 ----
  const catWrap = el('div', { class: 'cat-grid' });
  const moreBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm cat-more', hidden: true }, '更多分类');
  moreBtn.addEventListener('click', () => { expanded = !expanded; renderCategories(); });

  // ---- 账户 / 日期 ----
  const accountSelect = el('select', { class: 'select', 'aria-label': '账户' });
  const toAccountSelect = el('select', { class: 'select', 'aria-label': '转入账户' });
  const toAccountField = el('div', { class: 'field', hidden: true },
    el('label', { class: 'field-label' }, '到账户'),
    toAccountSelect
  );
  const dateInput = el('input', { class: 'input', type: 'date', max: todayStr(), 'aria-label': '日期' });
  dateInput.value = date;

  const accountField = el('div', { class: 'field' },
    el('label', { class: 'field-label' }, '账户'),
    accountSelect
  );

  const metaRow = el('div', { class: 'form-grid' },
    accountField,
    toAccountField,
    el('div', { class: 'field' },
      el('label', { class: 'field-label' }, '日期'),
      dateInput
    )
  );

  // ---- 标签 ----
  const tagSelected = el('div', { class: 'tag-selected' });
  const tagInput = el('input', { class: 'input tag-input', type: 'text', placeholder: '添加标签后回车', 'aria-label': '添加标签', maxlength: '20' });
  const tagSuggest = el('div', { class: 'tag-suggest' });
  const tagField = el('div', { class: 'field span-2', 'data-role': 'tags' },
    el('label', { class: 'field-label' }, '标签'),
    tagSelected,
    el('div', { class: 'tag-add-row' }, tagInput),
    tagSuggest
  );

  // ---- 备注 ----
  const noteInput = el('input', { class: 'input', type: 'text', placeholder: '备注（选填）', maxlength: '100', 'aria-label': '备注' });
  noteInput.value = initial ? (initial.note || '') : '';

  // ---- 错误与保存 ----
  const errorLine = el('div', { class: 'form-error', role: 'alert' });
  const saveBtn = el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button' }, editing ? '保存修改' : '保存');
  saveBtn.addEventListener('click', save);

  root.append(
    tabsEl,
    moneyBox,
    hintEl,
    catWrap,
    moreBtn,
    metaRow,
    tagField,
    el('div', { class: 'field' }, el('label', { class: 'field-label' }, '备注'), noteInput),
    errorLine,
    saveBtn
  );

  // ---------------- 渲染 ----------------
  function setKind(k) {
    if (kind === k) return;
    kind = k;
    if (k === 'transfer') {
      categoryId = null;
      const other = activeAccounts(state()).find(a => a.id !== accountId);
      if (!toAccountId || toAccountId === accountId) toAccountId = other ? other.id : null;
    }
    renderAll();
    amountInput.focus();
  }

  function renderTabs() {
    kinds.forEach(([k]) => tabBtns[k].classList.toggle('active', k === kind));
  }

  function renderCategories() {
    catWrap.innerHTML = '';
    catWrap.hidden = kind === 'transfer';
    moreBtn.hidden = kind === 'transfer';
    if (kind === 'transfer') return;

    const tiles = categoryTiles(state(), kind);
    const list = expanded ? tiles : tiles.slice(0, 12);
    if (!tiles.length) {
      catWrap.append(el('div', { class: 'muted', text: '还没有分类，请先到「分类」页添加' }));
      return;
    }
    list.forEach(t => {
      const b = el('button', {
        type: 'button',
        class: 'cat-btn' + (categoryId === t.id ? ' active' : ''),
        title: t.title
      }, el('span', { class: 'cat-ico', text: t.icon }), el('span', { class: 'cat-name', text: t.label }));
      b.addEventListener('click', () => {
        categoryId = t.id;
        renderCategories();
      });
      catWrap.append(b);
    });
    if (tiles.length > 12) {
      moreBtn.hidden = false;
      moreBtn.textContent = expanded ? '收起分类' : ('更多分类（' + (tiles.length - 12) + '）');
    } else {
      moreBtn.hidden = true;
    }
  }

  function renderAccounts() {
    const st = state();
    const accs = activeAccounts(st);
    const bal = accountBalances(st);

    const fill = (select, current, excludeId) => {
      select.innerHTML = '';
      accs.forEach(a => {
        if (excludeId && a.id === excludeId) return;
        const opt = el('option', { value: a.id }, a.name + '（' + fmtMoney(bal[a.id] || 0) + '）');
        if (a.id === current) opt.selected = true;
        select.append(opt);
      });
      if (!accs.length) select.append(el('option', { value: '' }, '无可用账户'));
    };

    fill(accountSelect, accountId, null);
    toAccountField.hidden = kind !== 'transfer';
    accountField.querySelector('.field-label').textContent = kind === 'transfer' ? '从账户' : '账户';
    if (kind === 'transfer') fill(toAccountSelect, toAccountId, accountId);
  }

  function renderTags() {
    tagSelected.innerHTML = '';
    const st = state();
    const map = {};
    (st.tags || []).forEach(t => { map[t.id] = t; });
    tagIds.forEach(id => {
      const t = map[id];
      if (!t) return;
      const chip = el('span', { class: 'chip chip-soft' }, t.name,
        el('button', { type: 'button', 'aria-label': '移除标签', onclick: () => { tagIds = tagIds.filter(x => x !== id); renderTags(); } }, '×')
      );
      tagSelected.append(chip);
    });

    tagSuggest.innerHTML = '';
    const unused = (st.tags || []).filter(t => !tagIds.includes(t.id)).slice(0, 8);
    unused.forEach(t => {
      const b = el('button', { type: 'button', class: 'chip', onclick: () => { tagIds.push(t.id); renderTags(); } }, t.name);
      tagSuggest.append(b);
    });
    tagField.hidden = kind === 'transfer';
    updateHint();
  }

  function updateHint() {
    if (kind !== 'transfer') { hintEl.hidden = true; return; }
    const st = state();
    const acc = activeAccounts(st).find((a) => a.id === accountId);
    const bal = accountBalances(st)[accountId] || 0;
    const amt = parseAmount(amountInput.value) || 0;
    if (acc && amt > bal) {
      hintEl.hidden = false;
      hintEl.textContent = acc.name + ' 余额只剩 ' + fmtMoney(bal) + '，仍可保存';
    } else {
      hintEl.hidden = true;
    }
  }

  function renderAll() {
    renderTabs();
    renderCategories();
    renderAccounts();
    renderTags();
    amountInput.value = amountStr;
  }

  // ---------------- 交互 ----------------
  amountInput.addEventListener('input', () => {
    const clean = sanitizeAmountInput(amountInput.value);
    if (clean !== amountInput.value) amountInput.value = clean;
    amountStr = clean;
    updateHint();
  });

  amountInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  });

  accountSelect.addEventListener('change', () => {
    accountId = accountSelect.value;
    if (kind === 'transfer' && toAccountId === accountId) {
      const other = activeAccounts(state()).find(a => a.id !== accountId);
      toAccountId = other ? other.id : null;
    }
    renderAccounts();
  });

  toAccountSelect.addEventListener('change', () => { toAccountId = toAccountSelect.value; });

  dateInput.addEventListener('change', () => { date = dateInput.value; });

  tagInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = tagInput.value.trim();
    if (!name) return;
    tagInput.value = '';
    await addTag(name);
  });

  async function addTag(name) {
    const st = state();
    let tag = (st.tags || []).find(t => t.name === name);
    if (!tag) {
      const id = uid('tag');
      try {
        await store.commit(s => { s.tags.push({ id, name }); });
      } catch (err) {
        toast('标签创建失败：' + err.message, 'err');
        return;
      }
      tag = { id, name };
    }
    if (!tagIds.includes(tag.id)) {
      tagIds.push(tag.id);
      renderTags();
    }
  }

  function showError(msg) {
    errorLine.textContent = msg || '';
  }

  async function save() {
    const amount = parseAmount(amountInput.value);
    const values = {
      kind, amount, categoryId,
      accountId,
      toAccountId: kind === 'transfer' ? toAccountSelect.value : null,
      date: dateInput.value,
      tagIds,
      note: noteInput.value
    };
    const v = validateEntry(values);
    if (!v.ok) {
      const first = Object.keys(v.errors)[0];
      showError(v.errors[first]);
      if (first === 'amount') amountInput.focus();
      if (first === 'category') catWrap.firstElementChild && catWrap.firstElementChild.focus();
      if (first === 'date') dateInput.focus();
      return;
    }
    showError('');
    saveBtn.disabled = true;
    try {
      if (editing) {
        await store.commit(s => {
          const i = s.transactions.findIndex(x => x.id === initial.id);
          if (i >= 0) s.transactions[i] = applyTransaction(s.transactions[i], values);
        });
        toast('已保存修改', 'ok');
      } else {
        const tx = makeTransaction(values);
        await store.commit(s => { s.transactions.push(tx); });
        const what = tx.kind === 'transfer'
          ? '转账 ' + fmtMoney(tx.amount)
          : categoryLabel(state(), tx.categoryId);
        toast('已记录 ' + fmtSigned(tx.amount, tx.kind) + ' ' + what, 'ok');
        amountStr = '';
        amountInput.value = '';
        noteInput.value = '';
        amountInput.focus();
      }
      if (onSaved) onSaved();
    } catch (err) {
      if (err && err.status === 409) toast('数据已被其他窗口更新，已刷新', 'warn', 4000);
      else toast('保存失败：' + (err && err.message ? err.message : err), 'err', 4000);
    } finally {
      saveBtn.disabled = false;
    }
  }

  // Alt+1/2/3 切换类型
  root.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    if (e.key === '1') { e.preventDefault(); setKind('expense'); }
    if (e.key === '2') { e.preventDefault(); setKind('income'); }
    if (e.key === '3') { e.preventDefault(); setKind('transfer'); }
  });

  renderAll();
  setTimeout(() => amountInput.focus(), 30);

  return {
    el: root,
    focus() { amountInput.focus(); },
    setKind,
    values: () => ({ kind, amountStr, categoryId, accountId, toAccountId, date, tagIds })
  };
}

/** 全局「+ 记一笔」弹窗。 */
export function openQuickAdd(ctx) {
  const holder = el('div', {});
  const modal = openModal({
    title: '记一笔',
    body: holder,
    width: 520
  });
  const form = createEntryForm({ onSaved: () => modal.close() });
  holder.append(form.el);
  return modal;
}

/** 编辑一笔已有账目。 */
export function openEditTransaction(tx) {
  const holder = el('div', {});
  const modal = openModal({
    title: '编辑账目',
    body: holder,
    width: 520
  });
  const form = createEntryForm({ initial: tx, onSaved: () => modal.close() });
  holder.append(form.el);
  return { modal, form };
}

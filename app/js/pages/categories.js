import { el, openModal, confirmDialog, toast, emptyBlock } from '../components.js';
import { store } from '../store.js';
import { topCategories, childrenOf, countTxByCategory, categoryMap } from '../selectors.js';
import { uid } from '../utils.js';
import { reorderWithinSiblings, moveToParent } from '../categoryOrder.js';

export const title = '分类';

const ICONS = ['🍜', '🚇', '🛍', '🏠', '🎬', '💊', '📚', '🎁', '📦', '💰', '🏆', '📈', '🧧', '☕', '🍺', '✈️', '🐱', '💡', '📱', '🎵'];
const COLORS = ['#e67e22', '#3498db', '#9b59b6', '#16a085', '#e84393', '#e17055', '#2980b9', '#d35400', '#7f8c8d', '#1a9c62', '#f1c40f', '#e74c3c'];

function state() { return store.state; }

export function mount(root, ctx) {
  const page = el('div', { class: 'page', 'data-page': 'categories' });
  let kind = 'expense';
  const expanded = new Set();

  const tabs = el('div', { class: 'tabs' });
  const tabExpense = el('button', { class: 'tab', type: 'button' }, '支出分类');
  const tabIncome = el('button', { class: 'tab', type: 'button' }, '收入分类');
  tabs.append(tabExpense, tabIncome);

  const head = el('div', { class: 'card-head' },
    tabs,
    el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openEditor({ mode: 'create' }) }, '＋ 新建一级分类')
  );

  const listWrap = el('div', {});
  page.append(el('div', { class: 'card' }, head), listWrap);
  root.append(page);

  tabExpense.addEventListener('click', () => { kind = 'expense'; render(); });
  tabIncome.addEventListener('click', () => { kind = 'income'; render(); });

  function catCounts() {
    const counts = countTxByCategory(state());
    return counts;
  }

  function rollupCount(id) {
    const counts = catCounts();
    let n = counts[id] || 0;
    childrenOf(state(), id).forEach((c) => { n += counts[c.id] || 0; });
    return n;
  }

  async function commit(fn, okMsg) {
    try {
      await store.commit(fn);
      if (okMsg) toast(okMsg, 'ok');
      return true;
    } catch (e) {
      toast('操作失败：' + e.message, 'err');
      return false;
    }
  }

  function move(id, dir) {
    const cats = state().categories;
    const me = cats.find((c) => c.id === id);
    if (!me) return;
    const siblings = cats
      .filter((c) => c.kind === me.kind && (c.parentId || null) === (me.parentId || null))
      .sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((c) => c.id === id);
    const other = siblings[idx + dir];
    if (!other) return;
    const a = me.order;
    const b = other.order;
    commit((s) => {
      const x = s.categories.find((c) => c.id === me.id);
      const y = s.categories.find((c) => c.id === other.id);
      x.order = b;
      y.order = a;
    });
  }

  function usageCount(id) {
    return catCounts()[id] || 0;
  }

  function deleteOrArchive(cat) {
    const used = usageCount(cat.id);
    const kids = childrenOf(state(), cat.id);
    if (kids.length) {
      toast('请先处理该分类下的子分类', 'warn');
      return;
    }
    if (used === 0) {
      confirmDialog({
        title: '删除分类',
        message: '删除「' + cat.name + '」？该分类没有账目引用。',
        okText: '删除',
        danger: true
      }).then((okDelete) => {
        if (!okDelete) return;
        commit((s) => { s.categories = s.categories.filter((c) => c.id !== cat.id); }, '已删除');
      });
      return;
    }

    // 有引用：停用或转移
    const targets = state().categories.filter((c) => c.kind === cat.kind && c.id !== cat.id && !c.archived);
    const select = el('select', { class: 'select' });
    targets.forEach((t) => {
      const map = categoryMap(state());
      const label = t.parentId && map[t.parentId] ? map[t.parentId].name + ' · ' + t.name : t.name;
      select.append(el('option', { value: t.id }, label));
    });

    const m = openModal({
      title: '分类正在使用中',
      width: 460,
      body: el('div', { class: 'stack' },
        el('p', { text: '「' + cat.name + '」已被 ' + used + ' 笔账目使用，不能直接删除。' }),
        el('div', { class: 'field' },
          el('label', { class: 'field-label' }, '把账目转移到'),
          select
        )
      ),
      footer: [
        el('button', { class: 'btn', type: 'button', onclick: () => m.close() }, '取消'),
        el('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            await commit((s) => {
              const c = s.categories.find((x) => x.id === cat.id);
              c.archived = true;
            }, '已停用');
            m.close();
          }
        }, '停用该分类'),
        el('button', {
          class: 'btn btn-danger', type: 'button',
          onclick: async () => {
            if (!select.value) { toast('请选择接收分类', 'err'); return; }
            const okMove = await commit((s) => {
              s.transactions.forEach((t) => { if (t.categoryId === cat.id) t.categoryId = select.value; });
              s.categories = s.categories.filter((c) => c.id !== cat.id);
            }, '已转移并删除');
            if (okMove) m.close();
          }
        }, '转移并删除')
      ]
    });
  }

  function openEditor({ mode, cat = null, parent = null }) {
    const isChild = !!(parent || (cat && cat.parentId));
    const base = cat || {
      name: '', icon: parent ? parent.icon : '📦', color: parent ? parent.color : '#7f8c8d',
      kind: parent ? parent.kind : kind, parentId: parent ? parent.id : null
    };
    let icon = base.icon || '📦';
    let color = base.color || '#7f8c8d';

    const nameInput = el('input', { class: 'input', maxlength: '12', placeholder: '分类名称' });
    nameInput.value = cat ? cat.name : '';

    const currentParentId = cat ? (cat.parentId || null) : (parent ? parent.id : null);
    const parentSelect = el('select', { class: 'select', 'aria-label': '所属一级分类' });
    if (isChild) {
      topCategories(state(), base.kind).forEach((p) => {
        const opt = el('option', { value: p.id }, p.name);
        if (p.id === currentParentId) opt.selected = true;
        parentSelect.append(opt);
      });
    }

    const iconGrid = el('div', { class: 'icon-grid' });
    ICONS.forEach((ic) => {
      const b = el('button', { type: 'button', class: 'icon-pick' + (ic === icon ? ' active' : '') }, ic);
      b.addEventListener('click', () => {
        icon = ic;
        iconGrid.querySelectorAll('.icon-pick').forEach((x) => x.classList.toggle('active', x.textContent === ic));
      });
      iconGrid.append(b);
    });

    const colorGrid = el('div', { class: 'color-grid' });
    COLORS.forEach((c) => {
      const b = el('button', { type: 'button', class: 'color-pick' + (c === color ? ' active' : ''), style: 'background:' + c });
      b.addEventListener('click', () => {
        color = c;
        colorGrid.querySelectorAll('.color-pick').forEach((x) => x.classList.toggle('active', x.style.background === c || x.style.backgroundColor === c));
      });
      colorGrid.append(b);
    });

    const err = el('div', { class: 'form-error' });

    const m = openModal({
      title: mode === 'create' ? (isChild ? '新建子分类' : '新建一级分类') : '编辑分类',
      width: 480,
      body: el('div', { class: 'stack' },
        el('div', { class: 'field' }, el('label', { class: 'field-label' }, '名称 *'), nameInput),
        isChild ? el('div', { class: 'field' }, el('label', { class: 'field-label' }, '所属一级分类'), parentSelect) : null,
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
            if (!name) { err.textContent = '请输入分类名称'; return; }
            const targetParentId = isChild && parentSelect.value ? parentSelect.value : (base.parentId || null);
            const dup = state().categories.some((c) => c.kind === base.kind
              && (c.parentId || null) === targetParentId
              && c.name === name && (!cat || c.id !== cat.id));
            if (dup) { err.textContent = '同级下已有同名分类'; return; }

            if (mode === 'create') {
              const orderBase = state().categories.reduce((mx, c) => Math.max(mx, c.order || 0), 0) + 1;
              const okAdd = await commit((s) => {
                s.categories.push({
                  id: uid('cat'),
                  name,
                  parentId: base.parentId || null,
                  kind: base.kind,
                  icon,
                  color,
                  archived: false,
                  order: orderBase
                });
              }, '已新建');
              if (okAdd) m.close();
            } else {
              const okEdit = await commit((s) => {
                let c = s.categories.find((x) => x.id === cat.id);
                c.name = name;
                c.icon = icon;
                c.color = color;
                // 子分类可以换到另一个大类下
                if (isChild && parentSelect.value && parentSelect.value !== c.parentId) {
                  s.categories = moveToParent(s.categories, c.id, parentSelect.value);
                  c = s.categories.find((x) => x.id === cat.id);
                  c.name = name;
                  c.icon = icon;
                  c.color = color;
                }
              }, '已保存');
              if (okEdit) m.close();
            }
          }
        }, mode === 'create' ? '创建' : '保存')
      ]
    });
    setTimeout(() => nameInput.focus(), 50);
  }

  // ---------------- 拖拽排序 / 换大类 ----------------
  let dragId = null;

  function clearDropMarks() {
    listWrap.querySelectorAll('.cat-row').forEach((r) => {
      r.classList.remove('drop-before', 'drop-after', 'drop-into');
    });
  }

  listWrap.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.cat-row');
    if (!row) return;
    dragId = row.dataset.cat;
    row.classList.add('dragging');
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    } catch (err) { /* 某些环境不支持 */ }
  });

  listWrap.addEventListener('dragend', () => {
    dragId = null;
    clearDropMarks();
    listWrap.querySelectorAll('.cat-row').forEach((r) => r.classList.remove('dragging'));
  });

  listWrap.addEventListener('dragover', (e) => {
    const row = e.target.closest('.cat-row');
    if (!row || !dragId || row.dataset.cat === dragId) return;
    const dragCat = state().categories.find((c) => c.id === dragId);
    const targetCat = state().categories.find((c) => c.id === row.dataset.cat);
    if (!dragCat || !targetCat) return;
    e.preventDefault();
    clearDropMarks();
    if (row.classList.contains('parent') && dragCat.parentId) {
      row.classList.add('drop-into');
    } else if ((dragCat.parentId || null) === (targetCat.parentId || null)) {
      const rect = row.getBoundingClientRect();
      row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    }
  });

  listWrap.addEventListener('dragleave', (e) => {
    if (!listWrap.contains(e.relatedTarget)) clearDropMarks();
  });

  listWrap.addEventListener('drop', async (e) => {
    const row = e.target.closest('.cat-row');
    if (!row || !dragId) return;
    e.preventDefault();
    const targetId = row.dataset.cat;
    const dragCat = state().categories.find((c) => c.id === dragId);
    const targetCat = state().categories.find((c) => c.id === targetId);
    const rect = row.getBoundingClientRect();
    const placeAfter = e.clientY >= rect.top + rect.height / 2;
    clearDropMarks();
    if (!dragCat || !targetCat || dragId === targetId) { dragId = null; return; }

    if (row.classList.contains('parent') && dragCat.parentId) {
      const moved = await commit((s) => {
        s.categories = moveToParent(s.categories, dragId, targetId);
      }, '已移动到「' + targetCat.name + '」');
      if (moved) expanded.add(targetId);
    } else if ((dragCat.parentId || null) === (targetCat.parentId || null)) {
      await commit((s) => {
        s.categories = reorderWithinSiblings(s.categories, dragId, targetId, placeAfter);
      }, '已调整顺序');
    }
    dragId = null;
  });

  function render() {
    tabExpense.classList.toggle('active', kind === 'expense');
    tabIncome.classList.toggle('active', kind === 'income');
    listWrap.innerHTML = '';

    const parents = topCategories(state(), kind);
    if (!parents.length) {
      listWrap.append(el('div', { class: 'card' }, emptyBlock({
        icon: '🏷️',
        text: '还没有分类，先建一个吧',
        actionText: '新建分类',
        onAction: () => openEditor({ mode: 'create' })
      })));
      return;
    }

    const counts = catCounts();
    const map = categoryMap(state());
    const card = el('div', { class: 'card cat-card' });

    parents.forEach((p) => {
      const kids = childrenOf(state(), p.id);
      const isOpen = expanded.has(p.id);
      const used = (counts[p.id] || 0) + kids.reduce((n, k) => n + (counts[k.id] || 0), 0);

      const row = el('div', {
        class: 'cat-row parent' + (p.archived ? ' archived' : ''),
        'data-cat': p.id,
        'data-parent': '',
        draggable: 'true'
      },
        el('span', { class: 'drag-handle', title: '拖动调整顺序', 'aria-hidden': 'true' }, '⋮⋮'),
        el('button', {
          class: 'cat-expand', type: 'button', 'aria-label': isOpen ? '收起' : '展开',
          onclick: () => { if (isOpen) expanded.delete(p.id); else expanded.add(p.id); render(); }
        }, kids.length ? (isOpen ? '▾' : '▸') : '·'),
        el('span', { class: 'cat-ico', style: 'color:' + (p.color || '#666'), text: p.icon || '📦' }),
        el('span', { class: 'cat-name' }, p.name, p.archived ? el('span', { class: 'chip chip-mini', text: '已停用' }) : null),
        el('span', { class: 'cat-meta', text: kids.length + ' 项 · ' + used + ' 笔' }),
        el('span', { class: 'cat-actions' },
          el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openEditor({ mode: 'create', parent: p }) }, '加子类'),
          el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openEditor({ mode: 'edit', cat: p }) }, '编辑'),
          el('button', {
            class: 'btn btn-sm', type: 'button',
            onclick: async () => {
              await commit((s) => {
                const c = s.categories.find((x) => x.id === p.id);
                c.archived = !c.archived;
              }, p.archived ? '已启用' : '已停用');
            }
          }, p.archived ? '启用' : '停用'),
          el('button', { class: 'icon-btn', type: 'button', title: '上移', onclick: () => move(p.id, -1) }, '↑'),
          el('button', { class: 'icon-btn', type: 'button', title: '下移', onclick: () => move(p.id, 1) }, '↓'),
          !kids.length ? el('button', { class: 'icon-btn danger', type: 'button', title: '删除', onclick: () => deleteOrArchive(p) }, '🗑') : null
        )
      );
      card.append(row);

      if (isOpen) {
        kids.forEach((k) => {
          const childRow = el('div', {
            class: 'cat-row child' + (k.archived ? ' archived' : ''),
            'data-cat': k.id,
            'data-parent': p.id,
            draggable: 'true'
          },
            el('span', { class: 'drag-handle', title: '拖动可排序或换大类', 'aria-hidden': 'true' }, '⋮⋮'),
            el('span', { class: 'cat-expand' }),
            el('span', { class: 'cat-ico', style: 'color:' + (k.color || p.color || '#666'), text: k.icon || p.icon || '📦' }),
            el('span', { class: 'cat-name' }, k.name, k.archived ? el('span', { class: 'chip chip-mini', text: '已停用' }) : null),
            el('span', { class: 'cat-meta', text: (counts[k.id] || 0) + ' 笔' }),
            el('span', { class: 'cat-actions' },
              el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openEditor({ mode: 'edit', cat: k }) }, '编辑'),
              el('button', { class: 'icon-btn', type: 'button', title: '上移', onclick: () => move(k.id, -1) }, '↑'),
              el('button', { class: 'icon-btn', type: 'button', title: '下移', onclick: () => move(k.id, 1) }, '↓'),
              el('button', { class: 'icon-btn danger', type: 'button', title: '删除', onclick: () => deleteOrArchive(k) }, '🗑')
            )
          );
          card.append(childRow);
        });
      }
    });

    listWrap.append(card, el('div', { class: 'card-sub', style: 'padding:10px 4px' },
      '提示：已有账目的分类不能直接删除，只能停用或把账目转移到其他分类。'
    ));
  }

  render();
  const unsub = store.subscribe(render);
  return () => unsub();
}

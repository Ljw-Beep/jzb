import { el, toast } from '../components.js';
import { store } from '../store.js';
import { budgetUsage, topCategories } from '../selectors.js';
import { fmtMoney, monthLabel, fenToInput, parseAmount } from '../utils.js';

export const title = '预算';

export function mount(root, ctx) {
  const page = el('div', { class: 'page', 'data-page': 'budget' });
  root.append(page);

  const state = () => store.state;
  let editing = null; // {type:'total'} | {type:'cat', id}

  async function saveBudget(patch) {
    const month = ctx.month;
    try {
      await store.commit((s) => {
        let b = (s.budgets || []).find((x) => x.month === month);
        if (!b) {
          b = { month, total: 0, byCategory: {} };
          s.budgets = s.budgets || [];
          s.budgets.push(b);
        }
        if (!b.byCategory) b.byCategory = {};
        if (patch.total !== undefined) b.total = patch.total;
        if (patch.catId !== undefined) {
          if (patch.amount > 0) b.byCategory[patch.catId] = patch.amount;
          else delete b.byCategory[patch.catId];
        }
      });
      return true;
    } catch (e) {
      toast('保存失败：' + e.message, 'err');
      return false;
    }
  }

  function budgetInput(initialFen, { onSave, onCancel }) {
    const input = el('input', { class: 'input budget-input', inputmode: 'decimal', 'aria-label': '预算金额' });
    input.value = fenToInput(initialFen);
    const commit = async () => {
      const fen = parseAmount(input.value);
      if (fen === null) { toast('金额格式不正确', 'err'); input.focus(); return; }
      const okSave = await onSave(fen);
      if (okSave) editing = null;
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { editing = null; render(); }
    });
    input.addEventListener('blur', () => { /* 失焦不保存，避免误触 */ });
    setTimeout(() => { input.focus(); input.select(); }, 30);
    return input;
  }

  function statusClass(status) {
    if (status === 'danger') return 'danger';
    if (status === 'warn') return 'warn';
    return '';
  }

  function renderTotal(u) {
    const card = el('div', { class: 'card budget-total' });
    card.append(el('div', { class: 'card-head' },
      el('div', { class: 'card-title', text: '本月总预算' }),
      el('span', { class: 'card-sub', text: monthLabel(ctx.month) })
    ));

    if (editing && editing.type === 'total') {
      card.append(el('div', { class: 'budget-edit-row' },
        budgetInput(u.totalBudget, {
          onSave: (fen) => saveBudget({ total: fen }),
          onCancel: () => { editing = null; render(); }
        }),
        el('span', { class: 'muted', text: '元，回车保存' })
      ));
      return card;
    }

    if (u.totalBudget > 0) {
      const pct = Math.min(100, u.totalPct);
      card.append(
        el('div', { class: 'budget-total-line' },
          el('strong', { class: 'num', text: fmtMoney(u.totalUsed) }),
          el('span', { class: 'muted', text: ' / ' + fmtMoney(u.totalBudget) })
        ),
        el('div', { class: 'progress budget-bar' },
          el('div', { class: 'progress-bar ' + statusClass(u.totalStatus), style: 'width:' + pct + '%' })
        ),
        el('div', { class: 'row-between budget-foot' },
          el('span', { class: 'muted', text: u.totalPct.toFixed(0) + '%' }),
          el('span', { class: u.remaining < 0 ? 'text-expense' : 'muted', text: u.remaining >= 0 ? '剩余 ' + fmtMoney(u.remaining) : '超支 ' + fmtMoney(-u.remaining) }),
          el('button', { class: 'btn btn-sm', type: 'button', onclick: () => { editing = { type: 'total' }; render(); } }, '编辑')
        )
      );
    } else {
      card.append(el('div', { class: 'budget-empty' },
        el('p', { class: 'muted', text: '还没有设置本月总预算' }),
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => { editing = { type: 'total' }; render(); } }, '设置总预算')
      ));
    }
    return card;
  }

  function renderRows(u) {
    const card = el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('div', { class: 'card-title', text: '分类预算' }),
        el('span', { class: 'card-sub', text: '只统计支出，不含转账' })
      )
    );

    const rows = u.rows;
    if (!rows.length) {
      card.append(el('div', { class: 'empty', style: 'padding:24px' }, el('p', { text: '还没有支出分类' })));
      return card;
    }

    rows.forEach((r) => {
      const isEditing = editing && editing.type === 'cat' && editing.id === r.id;
      const pct = r.budget > 0 ? Math.min(100, r.pct) : 0;
      const row = el('div', { class: 'budget-row status-' + r.status });

      row.append(
        el('div', { class: 'budget-row-name' },
          el('span', { class: 'cat-ico-inline', text: r.icon || '📦' }),
          el('span', { text: r.name })
        )
      );

      if (isEditing) {
        row.append(el('div', { class: 'budget-edit-row' },
          budgetInput(r.budget, {
            onSave: (fen) => saveBudget({ catId: r.id, amount: fen }),
            onCancel: () => { editing = null; render(); }
          })
        ));
      } else if (r.budget > 0) {
        row.append(
          el('div', { class: 'budget-row-bar' },
            el('div', { class: 'progress' },
              el('div', { class: 'progress-bar ' + statusClass(r.status), style: 'width:' + pct + '%' })
            )
          ),
          el('div', { class: 'budget-row-nums' },
            el('span', { class: 'num', text: fmtMoney(r.used) }),
            el('span', { class: 'muted', text: ' / ' + fmtMoney(r.budget) })
          ),
          el('div', { class: 'budget-row-status' },
            r.status === 'danger'
              ? el('span', { class: 'text-expense', text: '超支 ' + fmtMoney(r.used - r.budget) })
              : el('span', { class: 'muted', text: '剩 ' + fmtMoney(r.budget - r.used) })
          ),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { editing = { type: 'cat', id: r.id }; render(); } }, '改')
        );
      } else {
        row.append(
          el('div', { class: 'budget-row-bar' }, el('span', { class: 'muted', text: r.used > 0 ? '已花 ' + fmtMoney(r.used) : '—' })),
          el('div', { class: 'budget-row-nums muted', text: '未设预算' }),
          el('div', { class: 'budget-row-status' }),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { editing = { type: 'cat', id: r.id }; render(); } }, '设预算')
        );
      }
      card.append(row);
    });

    card.append(el('div', { class: 'card-sub', style: 'margin-top:10px' },
      '提示：分类预算只在下设了上限的分类上提醒，未设置的分类只计入总预算。'));
    return card;
  }

  function render() {
    const u = budgetUsage(state(), ctx.month);
    page.innerHTML = '';

    if (u.overspent.length && (state().settings ? state().settings.overspendAlert !== false : true)) {
      page.append(el('div', { class: 'alert alert-warn' },
        el('span', { text: '⚠ 本月已有 ' + u.overspent.length + ' 个分类超支：' + u.overspent.map((r) => r.name).join('、') })
      ));
    }

    page.append(renderTotal(u), renderRows(u));
  }

  render();
  const unsub = store.subscribe(render);
  return () => unsub();
}

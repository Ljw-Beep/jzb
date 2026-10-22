// 记账数据模型与校验（纯函数，可单元测试）
import { uid, todayStr } from './utils.js';

/**
 * 校验一笔账。
 * @returns {{ok:boolean, errors:Object<string,string>}}
 */
export function validateEntry(v) {
  const errors = {};
  const amount = Number(v.amount);
  if (!amount || amount <= 0) errors.amount = '请输入大于 0 的金额';

  if (v.kind === 'transfer') {
    if (!v.accountId) errors.account = '请选择转出账户';
    if (!v.toAccountId) errors.toAccount = '请选择转入账户';
    else if (v.toAccountId === v.accountId) errors.toAccount = '转出和转入不能是同一个账户';
  } else {
    if (!v.categoryId) errors.category = '请选择分类';
    if (!v.accountId) errors.account = '请选择账户';
  }

  if (!v.date) errors.date = '请选择日期';
  else if (v.date > todayStr()) errors.date = '不能记未来的账';

  return { ok: Object.keys(errors).length === 0, errors };
}

/** 由表单值生成一条账目。 */
export function makeTransaction(v) {
  const now = new Date().toISOString();
  return {
    id: uid('tx'),
    kind: v.kind,
    amount: Math.round(Number(v.amount) || 0),
    accountId: v.accountId,
    toAccountId: v.kind === 'transfer' ? v.toAccountId : null,
    categoryId: v.kind === 'transfer' ? null : v.categoryId,
    date: v.date,
    note: (v.note || '').trim().slice(0, 100),
    tagIds: v.kind === 'transfer' ? [] : Array.from(new Set(v.tagIds || [])),
    createdAt: now,
    updatedAt: now
  };
}

/** 编辑时更新已有账目（保留 id 与创建时间）。 */
export function applyTransaction(t, v) {
  return {
    ...t,
    kind: v.kind,
    amount: Math.round(Number(v.amount) || 0),
    accountId: v.accountId,
    toAccountId: v.kind === 'transfer' ? v.toAccountId : null,
    categoryId: v.kind === 'transfer' ? null : v.categoryId,
    date: v.date,
    note: (v.note || '').trim().slice(0, 100),
    tagIds: v.kind === 'transfer' ? [] : Array.from(new Set(v.tagIds || [])),
    updatedAt: new Date().toISOString()
  };
}


/** 校验导入的备份文件结构。 */
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: '不是有效的备份文件' };
  }
  if (!obj.version) return { ok: false, error: '备份文件缺少版本信息' };
  if (Number(obj.version) > 1) return { ok: false, error: '备份版本过高，请升级应用' };
  for (const k of ['accounts', 'categories', 'transactions']) {
    if (!Array.isArray(obj[k])) return { ok: false, error: '备份文件缺少 ' + k + ' 字段' };
  }
  const badTx = obj.transactions.find((x) => !x || typeof x.id !== 'string'
    || typeof x.amount !== 'number' || !x.kind || !x.date);
  if (badTx) return { ok: false, error: '备份中有格式不正确的账目' };
  const badCat = obj.categories.find((c) => !c || typeof c.id !== 'string' || typeof c.name !== 'string');
  if (badCat) return { ok: false, error: '备份中有格式不正确的分类' };
  return { ok: true };
}
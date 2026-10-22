// 通用工具：金额、日期、DOM 小工具。全部为纯函数，便于测试。

export function pad2(n) { return String(n).padStart(2, '0'); }

const MONTH_NAMES = null;

/** 分 → 元字符串，带千分位，最多两位小数。负数为 "-1,234.56"。 */
export function fmtNumber(fen) {
  const neg = fen < 0;
  const abs = Math.abs(Math.round(fen));
  const yuan = Math.floor(abs / 100);
  const cents = abs % 100;
  const y = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + y + '.' + pad2(cents);
}

/** 分 → 带 ¥ 的金额字符串。 */
export function fmtMoney(fen) {
  const f = Math.round(Number(fen) || 0);
  return (f < 0 ? '-¥' : '¥') + fmtNumber(Math.abs(f));
}

/** 带正负号的金额，用于收支列表。 */
export function fmtSigned(fen, kind) {
  const f = Math.abs(Math.round(Number(fen) || 0));
  if (kind === 'income') return '+' + fmtMoney(f);
  if (kind === 'expense') return '−' + fmtMoney(f);
  return fmtMoney(f);
}

/** 分 → 输入框里的值（不带符号与千分位，空为 ''）。 */
export function fenToInput(fen) {
  if (fen === null || fen === undefined || fen === '') return '';
  const f = Math.round(Number(fen));
  if (!isFinite(f)) return '';
  return (f / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

/**
 * 输入字符串 → 分。非法返回 null。
 * 只接受数字和最多两位小数，忽略千分位空格。
 */
export function parseAmount(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim().replace(/,/g, '').replace(/，/g, '');
  if (s === '') return null;
  if (!/^\d*(\.\d{0,2})?$/.test(s)) return null;
  if (s === '.') return null;
  const n = Number(s);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** 只保留输入框允许的字符：数字与一个小数点，最多两位小数。 */
export function sanitizeAmountInput(str) {
  let s = String(str).replace(/[^\d.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot >= 0) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
    s = s.slice(0, firstDot + 3);
  }
  s = s.replace(/^0+(\d)/, '$1');
  return s;
}

export function todayStr(d = new Date()) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function monthKey(d = new Date()) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

export function monthOfDate(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

export function monthLabel(key) {
  const [y, m] = String(key).split('-');
  return y + '年' + Number(m) + '月';
}

export function addMonths(key, delta) {
  const [y, m] = String(key).split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

export function daysInMonth(key) {
  const [y, m] = String(key).split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

export function dateLabel(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return m + '月' + d + '日 ' + weekdayOf(dateStr);
}

export function isFuture(dateStr) {
  return String(dateStr) > todayStr();
}

export function uid(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

export function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, ms = 250) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** 深度拷贝，优先用 structuredClone，退回 JSON。 */
export function clone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

// 应用入口：路由、顶部月份切换、全局状态加载。
import { api } from './api.js';
import { store } from './store.js';
import { daySummary, budgetUsage } from './selectors.js';
import { monthKey, monthLabel, addMonths, fmtMoney, todayStr } from './utils.js';
import { toast } from './components.js';
import { openQuickAdd } from './quickadd.js';

import * as home from './pages/home.js';
import * as bills from './pages/bills.js';
import * as stats from './pages/stats.js';
import * as budget from './pages/budget.js';
import * as categories from './pages/categories.js';
import * as settings from './pages/settings.js';

const routes = { home, bills, stats, budget, categories, settings };
const MONTH_PAGES = new Set(['home', 'stats', 'budget']);

let uiMonth = monthKey();
let unmount = null;
let booted = false;

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  return Object.prototype.hasOwnProperty.call(routes, raw) ? raw : 'home';
}

function parseParams() {
  const qs = location.hash.split('?')[1] || '';
  const out = {};
  new URLSearchParams(qs).forEach((v, k) => { out[k] = v; });
  return out;
}

function ctx() {
  return {
    month: uiMonth,
    today: todayStr(),
    params: parseParams(),
    setMonth(m) {
      uiMonth = m;
      render();
    },
    openQuickAdd() {
      openQuickAdd(ctx());
    },
    goto(route, params) {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      location.hash = '#/' + route + qs;
    }
  };
}

function updateChrome() {
  const brief = document.getElementById('todayBrief');
  if (brief && store.state) {
    const s = daySummary(store.state, todayStr());
    brief.textContent = fmtMoney(s.expense);
  }
  const label = document.getElementById('monthLabel');
  if (label) label.textContent = monthLabel(uiMonth);
  const badge = document.getElementById('budgetBadge');
  if (badge && store.state) {
    const u = budgetUsage(store.state, uiMonth);
    const alertOn = store.state.settings ? store.state.settings.overspendAlert !== false : true;
    badge.hidden = !(alertOn && u.overspent.length > 0);
  }
  const prev = document.getElementById('monthPrev');
  const next = document.getElementById('monthNext');
  if (prev) prev.disabled = false;
  if (next) next.disabled = uiMonth >= monthKey();
}

function render() {
  const name = currentRoute();
  const page = routes[name];
  if (typeof unmount === 'function') {
    try { unmount(); } catch (e) { console.error(e); }
    unmount = null;
  }
  const view = document.getElementById('view');
  view.innerHTML = '';
  document.getElementById('pageTitle').textContent = page.title || '';
  document.querySelectorAll('.nav-item').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });
  const monthSwitch = document.getElementById('monthSwitch');
  monthSwitch.hidden = !MONTH_PAGES.has(name);
  unmount = page.mount(view, ctx()) || null;
  updateChrome();
}

function bindChrome() {
  document.getElementById('monthPrev').addEventListener('click', () => {
    uiMonth = addMonths(uiMonth, -1);
    render();
  });
  document.getElementById('monthNext').addEventListener('click', () => {
    if (uiMonth >= monthKey()) return;
    uiMonth = addMonths(uiMonth, 1);
    render();
  });
  document.getElementById('monthLabel').addEventListener('click', () => {
    uiMonth = monthKey();
    render();
  });
  document.getElementById('quickAdd').addEventListener('click', () => openQuickAdd(ctx()));

  const retry = document.getElementById('retryBtn');
  if (retry) retry.addEventListener('click', () => boot(true));
}

let offlineTimer = null;

function showOffline(show) {
  const node = document.getElementById('offline');
  if (node) node.hidden = !show;

  // 断线时每 5 秒自动重连一次：服务晚启动也能自己恢复，不用手动点
  if (show && !offlineTimer) {
    offlineTimer = setInterval(() => { boot(true); }, 5000);
  }
  if (!show && offlineTimer) {
    clearInterval(offlineTimer);
    offlineTimer = null;
  }
}

async function boot(force = false) {
  if (booted && !force) return;
  try {
    await api.ping();
    await store.load();
  } catch (err) {
    console.error(err);
    showOffline(true);
    return;
  }
  showOffline(false);
  if (!booted) {
    bindChrome();
    window.addEventListener('hashchange', render);
    store.subscribe(updateChrome);
    booted = true;
    if (!location.hash) location.replace('#/home');
  }
  render();
}

boot();

// 全局错误兜底：任何未捕获的错误都给出可见提示，不静默失败
window.addEventListener('error', (e) => {
  toast('页面出错：' + (e.message || '未知错误'), 'err', 4000);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  if (reason && reason.name === 'ApiError') return;
  toast('操作失败：' + (reason && reason.message ? reason.message : String(reason)), 'err', 4000);
});

// 供调试与测试使用
window.__ledger = { store, render, getMonth: () => uiMonth };

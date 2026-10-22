// 通用 UI 组件：DOM 构造、toast、弹窗、确认框、空状态。
import { escapeHtml } from './utils.js';

/** 极简 DOM 构造器。 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const child of children.flat(3)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** 右下角提示。 */
export function toast(message, type = 'ok', ms = 3000) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const node = el('div', { class: 'toast ' + type, text: message });
  root.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

/**
 * 打开弹窗。
 * @param {{title:string, body:Node|string, footer?:Node[], onClose?:Function, width?:number}} opts
 */
export function openModal(opts) {
  const root = document.getElementById('modalRoot');
  const mask = el('div', { class: 'modal-mask' });
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  if (opts.width) box.style.maxWidth = opts.width + 'px';

  const close = () => {
    if (!mask.isConnected) return;
    mask.remove();
    document.removeEventListener('keydown', onKey);
    if (opts.onClose) opts.onClose();
  };

  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const head = el('div', { class: 'modal-head' },
    el('div', { class: 'modal-title', text: opts.title || '' }),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', onclick: close }, '×')
  );

  const body = el('div', { class: 'modal-body' });
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else if (opts.body) body.append(opts.body);

  box.append(head, body);
  if (opts.footer && opts.footer.length) {
    box.append(el('div', { class: 'modal-foot' }, ...opts.footer));
  }
  mask.append(box);
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
  document.addEventListener('keydown', onKey);
  root.append(mask);

  const firstInput = box.querySelector('input, select, textarea, button');
  if (firstInput) setTimeout(() => firstInput.focus(), 30);

  return { el: box, body, close };
}

/** 确认框，返回 Promise<boolean>。 */
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); m.close(); };
    const m = openModal({
      title: opts.title || '确认',
      width: 420,
      body: el('div', {}, el('p', { class: 'muted', text: opts.message || '' })),
      footer: [
        el('button', { class: 'btn', onclick: () => finish(false) }, opts.cancelText || '取消'),
        el('button', {
          class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
          onclick: () => finish(true)
        }, opts.okText || '确定')
      ],
      onClose: () => { if (!settled) { settled = true; resolve(false); } }
    });
  });
}

/** 空状态块。 */
export function emptyBlock({ icon = '🗒️', text = '暂无内容', actionText, onAction } = {}) {
  const node = el('div', { class: 'empty' },
    el('div', { class: 'empty-ico', text: icon }),
    el('p', { text })
  );
  if (actionText && onAction) {
    node.append(el('button', { class: 'btn btn-primary btn-sm', onclick: onAction }, actionText));
  }
  return node;
}

/** 把 HTML 字符串安全地塞进容器（调用方负责转义）。 */
export function setHtml(node, html) {
  node.innerHTML = html;
  return node;
}

export { escapeHtml };

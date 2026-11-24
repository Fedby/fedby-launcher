// 通用 UI：Toast / 状态栏 / 弹窗 / 确认框 / 空状态
import { $, esc } from './dom.js';
import { icon } from './icons.js';

// ---------- Toast ----------
export function toast(message, kind = '') {
  const root = $('#toast-root');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  root.appendChild(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 260);
  }, 3000);
}

export const toastOk = message => toast(message, 'ok');
export const toastErr = message => toast(message, 'err');

// ---------- 状态栏 ----------
export function setStatus(text, busy = false) {
  const label = $('#status-text');
  const dot = $('#status-dot');
  if (label) label.textContent = text;
  if (dot) dot.classList.toggle('busy', !!busy);
}

// ---------- 弹窗 ----------
let activeOnClose = null;

export function modal({ title, subtitle = '', body = '', footer = '', wide = false, onClose = null }) {
  const root = $('#modal-root');
  activeOnClose = typeof onClose === 'function' ? onClose : null;
  root.innerHTML = `
    <div class="modal-mask">
      <div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-head-main">
            <div class="modal-title">${title}</div>
            ${subtitle ? `<div class="modal-sub">${subtitle}</div>` : ''}
          </div>
          <button class="modal-x" data-close title="关闭">${icon('close', 14)}</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${footer || '<button class="btn" data-close>关闭</button>'}</div>
      </div>
    </div>`;
  const mask = root.querySelector('.modal-mask');
  mask.addEventListener('mousedown', event => {
    if (event.target === mask) closeModal();
  });
  root.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeModal));
  return root.querySelector('.modal');
}

export function closeModal() {
  const root = $('#modal-root');
  if (root) root.innerHTML = '';
  const callback = activeOnClose;
  activeOnClose = null;
  if (callback) { try { callback(); } catch (_) {} }
}

export const isModalOpen = () => !!$('#modal-root .modal');

export function confirm({ title = '确认操作', message = '', confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    modal({
      title,
      body: `<div style="font-size:12.5px;color:var(--text-sub);line-height:1.75">${message}</div>`,
      footer: `<button class="btn" data-close>${esc(cancelText)}</button>
               <button class="btn ${danger ? 'danger' : 'primary'}" id="confirm-yes">${esc(confirmText)}</button>`,
      onClose: () => { if (!answered) { answered = true; resolve(false); } },
    });
    $('#confirm-yes').onclick = () => { answered = true; closeModal(); resolve(true); };
  });
}

// ---------- 片段 ----------
export function empty({ iconName = 'box', title, desc = '', action = '' }) {
  return `<div class="empty">
    <div class="empty-icon">${icon(iconName, 22)}</div>
    <div class="empty-title">${esc(title)}</div>
    ${desc ? `<div class="empty-desc">${desc}</div>` : ''}
    ${action ? `<div style="margin-top:12px">${action}</div>` : ''}
  </div>`;
}

export function pageHead(title, sub, actions = '') {
  return `<div class="page-head">
    <div class="page-head-main">
      <div class="page-title">${title}</div>
      <div class="page-sub">${sub}</div>
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </div>`;
}

export function loading(text = '加载中…') {
  return `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:26px;color:var(--text-mute);font-size:12px">
    <span class="spinner"></span>${esc(text)}</div>`;
}

// 按钮进入「处理中」状态，返回恢复函数
export function busy(button, text = '处理中…') {
  if (!button) return () => {};
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span>${esc(text)}`;
  return () => { button.disabled = false; button.innerHTML = original; };
}

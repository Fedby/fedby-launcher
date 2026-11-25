// 自定义下拉框：把原生 <select class="select"> 包一层可美化的按钮 + 自绘弹层。
// 原生 select 仍然留在 DOM 里当数据源（opacity:0 覆盖在上面），所以 value / options /
// change 事件全部保持原样，页面代码不用改一行。
import { esc } from '../lib/dom.js';

const CHECK = '<svg class="cs-check" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.2L4.8 8.4L9.4 3.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CARET = '<svg class="cs-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.7L6 7.7L9 4.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let pop = null;            // 全局共享弹层（永远只有一个）
let current = null;        // 当前展开的 { wrap, btn, select, cursor }

const enhanced = new WeakSet();
const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

function labelOf(select) {
  const option = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
  return option ? (option.textContent || '').trim() : '';
}

/** 同步按钮上的文字与禁用态 */
function syncButton(wrap, select) {
  const label = wrap.querySelector('.cs-label');
  if (label) {
    const text = labelOf(select);
    label.textContent = text;
    wrap.classList.toggle('cs-placeholder', !select.value);
    wrap.classList.toggle('cs-disabled', select.disabled);
  }
  const btn = wrap.querySelector('.cs-btn');
  if (btn) {
    btn.disabled = select.disabled;
    btn.title = labelOf(select);
  }
}

function syncAll() {
  document.querySelectorAll('select.select[data-cs]').forEach(select => {
    if (select.parentElement?.classList.contains('cs')) syncButton(select.parentElement, select);
  });
}

function enhance(select) {
  if (enhanced.has(select) || select.dataset.cs === '1') return;
  if (!select.parentNode) return;
  enhanced.add(select);
  select.dataset.cs = '1';

  const wrap = document.createElement('div');
  wrap.className = 'cs';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cs-btn';
  btn.innerHTML = `<span class="cs-label"></span>${CARET}`;
  wrap.appendChild(btn);

  syncButton(wrap, select);

  // 程序里直接写 select.value = x 也要立刻反映到按钮上
  try {
    Object.defineProperty(select, 'value', {
      configurable: true,
      enumerable: true,
      get() { return valueDesc.get.call(this); },
      set(next) {
        valueDesc.set.call(this, next);
        syncButton(wrap, this);
      },
    });
  } catch { /* 某些环境不允许覆盖，退化成打开时刷新 */ }

  // options 被重写（比如只更新 innerHTML）时也刷新文字；节点被移除后自动停掉观察
  const optionObserver = new MutationObserver(() => {
    if (!select.isConnected) { optionObserver.disconnect(); return; }
    syncButton(wrap, select);
  });
  optionObserver.observe(select, { childList: true, subtree: true });

  // 绑定在按钮上而不是外层：<label> 包裹时点击 label 会把 click 转发给原生 select，
  // 若监听 wrapper 会收到两次（打开又立刻关闭）。
  btn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (select.disabled) return;
    current && current.select === select ? closePop() : openPop(wrap, select);
  });
  wrap.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openPop(wrap, select, event.key === 'ArrowUp');
    }
  });

  // <label> 会把点击转发给里面的原生 select，这里拦下来，改成打开自绘弹层
  const label = select.closest('label');
  if (label) {
    label.addEventListener('click', event => {
      event.preventDefault();
      if (select.disabled || event.target.closest?.('.cs')) return;
      current && current.select === select ? closePop() : openPop(wrap, select);
    });
  }
}

function enhanceAll(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches?.('select.select')) enhance(root);
  root.querySelectorAll?.('select.select').forEach(enhance);
}

/* ---------------- 弹层 ---------------- */

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'cs-pop';
  pop.setAttribute('role', 'listbox');
  pop.addEventListener('mousedown', event => {
    // 只对空白与选项阻止默认行为（不抢搜索框焦点），滚动条照常可拖
    if (event.target === pop || event.target.closest?.('.cs-item')) event.preventDefault();
  });
  document.body.appendChild(pop);
  return pop;
}

function itemsOf(select) {
  return [...select.options].map((option, index) => ({
    index,
    value: option.value,
    label: (option.textContent || '').trim(),
    disabled: option.disabled,
    group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
  }));
}

function openPop(wrap, select, fromEnd = false) {
  closePop();
  const btn = wrap.querySelector('.cs-btn');
  if (!btn) return;

  const all = itemsOf(select);
  const withSearch = all.length > 10;
  const el = ensurePop();
  el.innerHTML = `
    ${withSearch ? `<div class="cs-search"><input type="text" placeholder="搜索…" spellcheck="false"></div>` : ''}
    <div class="cs-list" role="presentation"></div>
    <div class="cs-empty" hidden>没有匹配的选项</div>`;
  el.classList.add('cs-open');
  wrap.classList.add('cs-on');

  const list = el.querySelector('.cs-list');
  const empty = el.querySelector('.cs-empty');
  const input = el.querySelector('.cs-search input');
  let shown = all;
  let cursor = Math.max(0, all.findIndex(item => item.value === select.value));

  function paint() {
    list.innerHTML = shown.length
      ? shown.map((item, order) => `
        <button type="button" class="cs-item${item.value === select.value ? ' active' : ''}${item.disabled ? ' disabled' : ''}${order === cursor ? ' cursor' : ''}"
          data-value="${esc(item.value)}" data-order="${order}"${item.disabled ? ' aria-disabled="true"' : ''}>
          <span class="cs-item-text">${esc(item.label)}</span>${CHECK}
        </button>`).join('')
      : '';
    empty.hidden = shown.length > 0;
    // 自己算滚动位置，不用 scrollIntoView（它会连带滚动外层导致弹层收起）
    const mark = list.querySelector('.cs-item.cursor') || list.querySelector('.cs-item.active');
    if (mark) {
      const box = list.getBoundingClientRect();
      const rect = mark.getBoundingClientRect();
      if (rect.top < box.top) list.scrollTop -= box.top - rect.top + 2;
      else if (rect.bottom > box.bottom) list.scrollTop += rect.bottom - box.bottom + 2;
    }
  }

  function move(step) {
    if (!shown.length) return;
    let next = cursor;
    for (let i = 0; i < shown.length; i++) {
      next = (next + step + shown.length) % shown.length;
      if (!shown[next].disabled) break;
    }
    cursor = next;
    paint();
  }

  function commit(order) {
    const item = shown[order];
    if (!item || item.disabled) return;
    valueDesc.set.call(select, item.value);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncButton(wrap, select);
    closePop();
    btn.focus({ preventScroll: true });
  }

  el.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); closePop(); btn.focus({ preventScroll: true }); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); commit(cursor); }
    else if (event.key === 'Tab') closePop();
  };

  list.onclick = event => {
    const node = event.target.closest('.cs-item');
    if (node) commit(Number(node.dataset.order));
  };
  list.onmousemove = event => {
    const node = event.target.closest('.cs-item');
    if (!node) return;
    const order = Number(node.dataset.order);
    if (order === cursor) return;
    cursor = order;
    list.querySelectorAll('.cs-item').forEach((item, i) => item.classList.toggle('cursor', i === cursor));
  };

  if (input) {
    input.addEventListener('input', () => {
      const keyword = input.value.trim().toLowerCase();
      shown = keyword
        ? all.filter(item => item.label.toLowerCase().includes(keyword) || item.value.toLowerCase().includes(keyword))
        : all;
      cursor = Math.max(0, shown.findIndex(item => !item.disabled));
      paint();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); commit(cursor); }
      else if (event.key === 'Escape') { event.preventDefault(); closePop(); btn.focus({ preventScroll: true }); }
    });
  }

  paint();
  position(el, btn);

  current = { wrap, btn, select, el };
  el.tabIndex = -1;
  if (input) { input.focus({ preventScroll: true }); input.select(); }
  else el.focus({ preventScroll: true });

  if (fromEnd) { cursor = Math.max(0, shown.length - 1); paint(); }
}

function position(el, btn) {
  const rect = btn.getBoundingClientRect();
  // 按钮很宽时（整列宽）不让弹层跟着拉满，最多 360px，看着更像菜单
  const width = Math.min(Math.max(rect.width, 168), 360);
  const innerH = window.innerHeight;
  el.style.width = `${width}px`;
  el.classList.remove('up');
  el.style.top = '0px';
  el.style.bottom = 'auto';
  el.style.left = '0px';

  const height = el.offsetHeight;
  const below = innerH - rect.bottom;
  const up = below < height + 12 && rect.top > below;
  el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  if (up) {
    el.classList.add('up');
    el.style.top = 'auto';
    el.style.bottom = `${Math.max(8, innerH - rect.top + 6)}px`;
  } else {
    el.style.top = `${rect.bottom + 6}px`;
  }
}

function closePop() {
  if (!current) return;
  const { wrap, el } = current;
  wrap.classList.remove('cs-on');
  el.classList.remove('cs-open');
  el.classList.remove('up');
  el.onkeydown = null;
  el.innerHTML = '';
  current = null;
}

document.addEventListener('mousedown', event => {
  if (!current) return;
  if (current.el.contains(event.target) || current.wrap.contains(event.target)) return;
  closePop();
}, true);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && current) closePop();
});

// 滚动 / 缩放时弹层位置会飘，直接收起（弹层内部的滚动不算）
window.addEventListener('scroll', event => {
  if (!current) return;
  if (event.target instanceof Element && current.el.contains(event.target)) return;
  closePop();
}, true);
window.addEventListener('resize', () => current && closePop());

/* ---------------- 对外 ---------------- */

export function initSelects(root = document.body) {
  enhanceAll(root);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) enhanceAll(node);
      }
    }
    // 页面整块重渲染后，正在展开的那个 select 可能已经被换掉，收起弹层免得点到幽灵项
    if (current && !current.select.isConnected) closePop();
  });
  observer.observe(root, { childList: true, subtree: true });
  return observer;
}

/** 手工同步（例如外部改了 select.value 但覆盖失败时） */
export const refreshSelects = syncAll;

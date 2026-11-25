// 极简路由：页面 = { id, label, icon, render(state), mount?(root, state) }
import { state } from './store.js';
import { esc } from './lib/dom.js';
import { setStatus } from './lib/ui.js';

const pages = new Map();
let currentId = '';

export function registerPage(page) {
  pages.set(page.id, page);
}

export const getPage = id => pages.get(id);
export const pageList = () => [...pages.values()];

export async function navigate(id) {
  const page = pages.get(id);
  if (!page) return;
  const samePage = id === currentId;
  const keepScroll = samePage ? document.getElementById('view')?.scrollTop || 0 : 0;
  currentId = id;
  state.page = id;

  document.querySelectorAll('#nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === id);
  });
  const title = document.getElementById('page-title');
  if (title) title.textContent = page.label;

  const view = document.getElementById('view');
  view.innerHTML = '';
  try {
    view.innerHTML = page.render(state);
  } catch (error) {
    console.error('页面渲染失败', error);
    view.innerHTML = `<div class="card"><div class="empty"><div class="empty-title">页面渲染失败</div>
      <div class="empty-desc">${esc(error.message)}</div></div></div>`;
    setStatus('就绪');
    return;
  }
  view.scrollTop = keepScroll;
  view.classList.remove('page-enter');
  void view.offsetWidth;
  view.classList.add('page-enter');

  if (typeof page.mount === 'function') {
    try { await page.mount(view, state); }
    catch (error) {
      console.error('页面挂载失败', error);
      setStatus('就绪');
    }
  }
  document.dispatchEvent(new CustomEvent('fedby:page', { detail: { id } }));
}

export const rerender = () => navigate(currentId || state.page);
export const currentPageId = () => currentId;

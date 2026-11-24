// 应用外壳：导航、窗口按钮、顶部账户入口
import { $ } from './lib/dom.js';
import { call } from './lib/ipc.js';
import { icon } from './lib/icons.js';
import { navigate, pageList } from './router.js';
import { state, currentAccount, accountTypeLabel } from './store.js';
import { avatarInner, openAccountManager } from './components/accounts.js';

export function mountChrome() {
  const nav = $('#nav');
  nav.innerHTML = `
    ${pageList().map(page => `<button class="nav-item" data-page="${page.id}">${icon(page.icon, 16)}${page.label}</button>`).join('')}
    <div class="nav-status">
      <span class="status-dot" id="status-dot"></span>
      <span id="status-text">就绪</span>
    </div>`;

  nav.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => navigate(button.dataset.page));
  });

  $('#btn-min').addEventListener('click', () => call('win.minimize').catch(() => {}));
  $('#btn-max').addEventListener('click', () => call('win.toggleMaximize').catch(() => {}));
  $('#btn-close').addEventListener('click', () => call('win.close').catch(() => {}));
  $('#account-chip').addEventListener('click', openAccountManager);
}

export function syncChrome() {
  const account = currentAccount();
  const name = $('#account-chip-name');
  const avatar = $('#account-chip-avatar');
  if (name) name.textContent = account ? account.name : '未登录';
  if (avatar) avatar.innerHTML = avatarInner(account);
  const chip = $('#account-chip');
  if (chip) {
    chip.title = account ? `${account.name} · ${accountTypeLabel(account)}（点击管理账户）` : '点击添加账户';
  }
  // 导航上的状态值也随账户变化重置一次提示
  if (!state.launching) {
    const status = $('#status-text');
    if (status && status.textContent === '启动中…') status.textContent = '就绪';
  }
}

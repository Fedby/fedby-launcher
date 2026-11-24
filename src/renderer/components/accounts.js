// 账户相关 UI：头像、主页账户条、账户管理弹窗、三种登录方式
import { $, esc, fmtTime } from '../lib/dom.js';
import { call } from '../lib/ipc.js';
import { icon, MICROSOFT_LOGO } from '../lib/icons.js';
import { modal, closeModal, confirm, toast, toastOk, toastErr, busy, setStatus, empty } from '../lib/ui.js';
import { state, accountTypeLabel, refreshAccounts, loadSkins, selectAccount, reportError } from '../store.js';
import { rerender } from '../router.js';

export function avatarInner(account) {
  if (!account) return '?';
  const skin = state.skins[account.uuid];
  if (skin) return `<img src="${skin}" alt="">`;
  if (account.type === 'microsoft') return `<span class="ms-mark">${MICROSOFT_LOGO}</span>`;
  if (account.type === 'thirdparty') return icon('globe', 13);
  return esc(String(account.name || '?').slice(0, 1).toUpperCase());
}

// ---------- 主页账户条 ----------
export function accountStripHtml() {
  const chips = state.accounts.map(account => `
    <button class="acc-chip${account.id === state.selection.accountId ? ' active' : ''}" data-account="${esc(account.id)}"
      title="${esc(account.name)} · ${accountTypeLabel(account)}">
      <span class="acc-chip-avatar">${avatarInner(account)}</span>
      <span class="acc-chip-name">${esc(account.name)}</span>
    </button>`).join('');
  return `<div class="acc-strip">
      ${chips || '<span class="muted" style="font-size:11.5px">还没有账户，用右边的按钮添加</span>'}
      <span class="acc-add">
        <button class="acc-add-btn" data-add="offline" title="创建离线账户">${icon('plus', 13)}</button>
        <button class="acc-add-btn" data-add="microsoft" title="使用 Microsoft 账号登录">${MICROSOFT_LOGO}</button>
        <button class="acc-add-btn" data-add="site" title="皮肤站登录">${icon('globe', 13)}</button>
      </span>
    </div>`;
}

export function bindAccountStrip(root) {
  root.querySelectorAll('[data-account]').forEach(button => {
    button.addEventListener('click', async () => {
      await selectAccount(button.dataset.account);
      rerender();
    });
  });
  root.querySelectorAll('[data-add]').forEach(button => {
    button.addEventListener('click', () => {
      const kind = button.dataset.add;
      if (kind === 'offline') showOfflineDialog();
      else if (kind === 'microsoft') showMicrosoftDialog();
      else showSiteDialog();
    });
  });
}

// ---------- 账户管理 ----------
export function openAccountManager() {
  modal({
    title: '账户管理',
    subtitle: `共 ${state.accounts.length} 个账户 · 点击卡片切换当前账户`,
    body: '<div id="account-manager"></div>',
    footer: `<span class="lead muted" style="font-size:11px">皮肤站使用 Yggdrasil 协议，游戏内皮肤需 authlib-injector</span>
             <button class="btn" data-close>关闭</button>`,
  });
  renderAccountManager();
}

function renderAccountManager() {
  const box = $('#account-manager');
  if (!box) return;
  const rows = state.accounts.map(account => `
    <div class="list-row account-row${account.id === state.selection.accountId ? ' active' : ''}" data-row="${esc(account.id)}">
      <div class="list-icon">${avatarInner(account)}</div>
      <div class="list-body">
        <div class="list-title">${esc(account.name)}
          <span class="badge ${account.type === 'microsoft' ? 'blue' : account.type === 'thirdparty' ? 'amber' : ''}">${accountTypeLabel(account)}</span>
          ${account.id === state.selection.accountId ? '<span class="badge green">当前</span>' : ''}
        </div>
        <div class="list-desc">UUID ${esc(String(account.uuid || '').slice(0, 13))}… · ${fmtTime(account.createdAt || account.lastLoginAt)}${account.skinSite ? ' · ' + esc(account.skinSite) : ''}</div>
      </div>
      <div class="list-actions">
        ${account.id === state.selection.accountId ? '' : `<button class="btn sm" data-use="${esc(account.id)}">选用</button>`}
        <button class="btn sm danger" data-remove="${esc(account.id)}" title="删除账户">${icon('trash', 13)}</button>
      </div>
    </div>`).join('');

  box.innerHTML = `
    <div class="list-account">${rows || empty({ iconName: 'user', title: '还没有账户', desc: '离线账户可直接开玩；正版请用 Microsoft 登录' })}</div>
    <div class="account-actions">
      <button class="btn sm" data-add="offline">${icon('plus', 13)} 离线账户</button>
      <button class="btn sm" data-add="microsoft">${MICROSOFT_LOGO} 微软登录</button>
      <button class="btn sm" data-add="site">${icon('globe', 13)} 皮肤站</button>
      <button class="btn sm ghost" id="refresh-skins">${icon('refresh', 13)} 刷新皮肤</button>
    </div>`;

  box.querySelectorAll('[data-use]').forEach(button => button.addEventListener('click', async () => {
    await selectAccount(button.dataset.use);
    renderAccountManager();
    rerender();
  }));
  box.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', async () => {
    const account = state.accounts.find(item => item.id === button.dataset.remove);
    const yes = await confirm({
      title: '删除账户',
      message: `确定删除账户 <b>${esc(account?.name || '')}</b>？该操作只移除启动器内的登录信息。`,
      confirmText: '删除',
      danger: true,
    });
    if (!yes) return;
    try {
      await call('accounts.remove', button.dataset.remove);
      await refreshAccounts();
      renderAccountManager();
      rerender();
      toast('已删除账户');
    } catch (error) { reportError('删除失败', error); }
  }));
  box.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => {
    const kind = button.dataset.add;
    if (kind === 'offline') showOfflineDialog();
    else if (kind === 'microsoft') showMicrosoftDialog();
    else showSiteDialog();
  }));
  const refresh = box.querySelector('#refresh-skins');
  if (refresh) refresh.addEventListener('click', async () => {
    const restore = busy(refresh, '同步中…');
    setStatus('同步皮肤…', true);
    try {
      await call('accounts.refreshSkins');
      await loadSkins();
      renderAccountManager();
      rerender();
      toastOk('皮肤已同步');
    } catch (error) { reportError('同步失败', error); }
    restore();
    setStatus('就绪');
  });
}

// ---------- 离线账户 ----------
export function showOfflineDialog() {
  modal({
    title: '创建离线账户',
    body: `
      <div class="field">
        <label>游戏昵称</label>
        <input class="input" id="offline-name" maxlength="16" placeholder="1-16 位字母、数字或下划线" autocomplete="off">
      </div>
      <div class="hint-box">离线账户不验证正版，适合单机与离线服务器；UUID 由昵称稳定生成。</div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn primary" id="offline-create">创建</button>`,
  });
  const input = $('#offline-name');
  input.focus();
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return toastErr('请输入昵称');
    try {
      const account = await call('accounts.createOffline', name);
      await refreshAccounts();
      await selectAccount(account.id);
      closeModal();
      rerender();
      toastOk(`已创建离线账户 ${account.name}`);
    } catch (error) { toastErr(error.message); }
  };
  $('#offline-create').onclick = submit;
  input.addEventListener('keydown', event => { if (event.key === 'Enter') submit(); });
}

// ---------- 微软登录 ----------
export function showMicrosoftDialog() {
  modal({
    title: 'Microsoft 账号登录',
    body: `
      <div class="ms-panel">
        <div class="ms-hero">${MICROSOFT_LOGO}</div>
        <div class="ms-title">使用 Microsoft 账号登录</div>
        <div class="ms-desc">点击下方按钮会打开<b>微软官方登录窗口</b>，登录完成后窗口自动关闭并返回启动器。</div>
        <ul class="ms-list">
          <li>需要拥有 Minecraft: Java Edition（含 Game Pass）</li>
          <li>没有 Xbox 档案时微软会在登录流程中引导创建</li>
          <li>启动器不会接触你的密码，只保存令牌</li>
        </ul>
        <div class="ms-wait" id="ms-wait"><span class="spinner"></span> 等待在微软窗口中完成登录…</div>
      </div>`,
    footer: `<button class="btn" data-close>取消</button>
             <button class="btn primary" id="ms-start">${MICROSOFT_LOGO} 打开登录窗口</button>`,
  });

  const startButton = $('#ms-start');
  const wait = $('#ms-wait');
  startButton.onclick = async () => {
    if (startButton.disabled) return;
    const restore = busy(startButton, '等待登录…');
    wait.classList.add('on');
    setStatus('等待微软登录…', true);
    try {
      const account = await call('accounts.msLogin');
      await refreshAccounts();
      await selectAccount(account.id);
      closeModal();
      rerender();
      toastOk(`登录成功：${account.name}`);
    } catch (error) {
      const message = String(error.message || error);
      if (/取消|超时/.test(message)) toast(message);
      else toastErr('登录失败：' + message);
      if ($('#ms-start')) { restore(); wait.classList.remove('on'); }
    } finally {
      setStatus('就绪');
    }
  };
}

// ---------- 皮肤站 ----------
export function showSiteDialog() {
  const site = state.settings.skinSite || 'https://littleskin.cn';
  modal({
    title: '皮肤站登录',
    subtitle: '支持 LittleSkin、Blessing Skin 等 Yggdrasil 皮肤站',
    body: `
      <div class="field"><label>站点地址</label><input class="input" id="site-url" value="${esc(site)}" placeholder="https://littleskin.cn"></div>
      <div class="field"><label>账号 / 邮箱</label><input class="input" id="site-user" autocomplete="off" placeholder="皮肤站用户名"></div>
      <div class="field"><label>密码</label><input class="input" id="site-pass" type="password" placeholder="皮肤站密码"></div>
      <div class="site-info" id="site-info">正在检测站点…</div>`,
    footer: `<button class="btn ghost" id="site-register">注册账号</button>
             <button class="btn" data-close>取消</button>
             <button class="btn primary" id="site-login">登录</button>`,
  });

  let info = null;
  const infoBox = $('#site-info');
  const check = async () => {
    infoBox.textContent = '正在检测站点…';
    infoBox.classList.remove('err');
    try {
      info = await call('accounts.siteInfo', $('#site-url').value.trim());
      infoBox.innerHTML = `站点：<b>${esc(info.name)}</b> · ${esc(info.homepage)}`;
    } catch (error) {
      info = null;
      infoBox.textContent = '无法连接站点：' + error.message;
      infoBox.classList.add('err');
    }
  };

  $('#site-url').addEventListener('change', check);
  $('#site-register').onclick = async () => {
    try {
      const target = info || await call('accounts.siteInfo', $('#site-url').value.trim());
      await call('app.openExternal', target.register);
    } catch (error) { toastErr(error.message); }
  };
  $('#site-login').onclick = async () => {
    const button = $('#site-login');
    const restore = busy(button, '登录中…');
    try {
      const account = await call('accounts.siteLogin', {
        site: $('#site-url').value.trim(),
        username: $('#site-user').value.trim(),
        password: $('#site-pass').value,
      });
      await refreshAccounts();
      await selectAccount(account.id);
      closeModal();
      rerender();
      toastOk(`登录成功：${account.name}`);
    } catch (error) {
      toastErr('登录失败：' + error.message);
      restore();
    }
  };
  check();
}

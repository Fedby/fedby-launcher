// 版本管理页
import { $, esc, fmtSize, fmtTime } from '../lib/dom.js';
import { call } from '../lib/ipc.js';
import { icon } from '../lib/icons.js';
import { pageHead, toast, toastOk, toastErr, modal, closeModal, confirm, busy, empty, setStatus, loading } from '../lib/ui.js';
import { state, refreshVersions, selectVersion, loadRecommendRuntime, reportError } from '../store.js';
import { rerender, navigate } from '../router.js';
import { showVersionCheck } from '../components/versionCheck.js';

function render(state) {
  const rows = state.versions.map(version => `
    <div class="list-row version-row">
      <div class="list-icon">${icon('layers', 16)}</div>
      <div class="list-body">
        <div class="list-title">${esc(version.id)}
          <span class="badge ${version.type === 'release' ? 'green' : 'amber'}">${esc(version.type)}</span>
          ${version.modded ? '<span class="badge blue">模组</span>' : ''}
          ${version.id === state.selection.versionId ? '<span class="badge green">当前</span>' : ''}
        </div>
        <div class="list-desc">${fmtTime(version.releaseTime)} · Java ${version.javaMajor}+ · ${fmtSize(version.jarSize)} · 资源索引 ${esc(version.assetIndex || '-')}</div>
      </div>
      <div class="list-actions">
        <button class="btn sm" data-use="${esc(version.id)}">选用</button>
        <button class="btn sm" data-check="${esc(version.id)}">检查</button>
        <button class="btn sm" data-dir="${esc(version.id)}" title="打开版本文件夹">${icon('folder', 13)}</button>
        <button class="btn sm danger" data-remove="${esc(version.id)}" title="删除版本">${icon('trash', 13)}</button>
      </div>
    </div>`).join('');

  return `
    ${pageHead('版本管理', `已安装 ${state.versions.length} 个版本`, `
      <button class="btn" id="refresh-versions">${icon('refresh', 14)} 刷新</button>
      <button class="btn primary" id="install-version">${icon('download', 14)} 安装新版本</button>`)}

    <div class="card">
      <div class="card-head">${icon('layers', 15)} 本地版本 <span class="hint">所有版本共用同一个游戏目录</span></div>
      ${state.versions.length ? `<div class="list">${rows}</div>`
        : empty({
          iconName: 'layers',
          title: '还没有安装版本',
          desc: '从 Mojang 官方下载，自动补齐依赖库与资源文件',
          action: `<button class="btn primary" id="install-empty">${icon('download', 14)} 安装新版本</button>`,
        })}
    </div>`;
}

function mount(root) {
  const open = () => showInstallDialog();
  const installEmpty = $('#install-empty');
  if (installEmpty) installEmpty.addEventListener('click', open);
  $('#install-version').addEventListener('click', open);

  $('#refresh-versions').addEventListener('click', async () => {
    try {
      await refreshVersions();
      rerender();
      toastOk('已刷新');
    } catch (error) { reportError('刷新失败', error); }
  });

  root.querySelectorAll('[data-use]').forEach(button => {
    button.addEventListener('click', async () => {
      await selectVersion(button.dataset.use);
      toastOk(`已选用 ${button.dataset.use}`);
      navigate('launch');
    });
  });
  root.querySelectorAll('[data-check]').forEach(button => {
    button.addEventListener('click', () => showVersionCheck(button.dataset.check));
  });
  root.querySelectorAll('[data-dir]').forEach(button => {
    button.addEventListener('click', () => call('versions.openDir', button.dataset.dir).catch(error => toastErr(error.message)));
  });
  root.querySelectorAll('[data-remove]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.remove;
      const yes = await confirm({
        title: '删除版本',
        message: `确定删除版本 <b>${esc(id)}</b>？版本目录会被整体移除，此操作不可恢复。`,
        confirmText: '删除',
        danger: true,
      });
      if (!yes) return;
      try {
        await call('versions.remove', id);
        await refreshVersions();
        await loadRecommendRuntime();
        rerender();
        toast('已删除版本 ' + id);
      } catch (error) { reportError('删除失败', error); }
    });
  });
}

async function showInstallDialog() {
  modal({
    title: '安装新版本',
    subtitle: '从 Mojang 官方源下载，自动校验 SHA1',
    body: `
      <div class="field">
        <label>版本类型</label>
        <select class="select" id="install-type">
          <option value="release">正式版（Release）</option>
          <option value="all">全部（含快照 / 旧预览）</option>
        </select>
      </div>
      <div class="field">
        <label>选择版本 <span class="muted" id="install-count"></span></label>
        <select class="select" id="install-id" size="9" style="height:220px"></select>
      </div>
      <div class="install-progress" id="install-progress">
        <div class="progress"><span id="install-fill" style="width:0"></span></div>
        <div class="install-progress-text"><span id="install-stage">等待开始</span><b id="install-percent">0%</b></div>
      </div>`,
    footer: `<button class="btn" data-close>取消</button>
             <button class="btn primary" id="install-go" disabled>${icon('download', 14)} 开始安装</button>`,
  });

  const typeSelect = $('#install-type');
  const idSelect = $('#install-id');
  const goButton = $('#install-go');
  const stage = $('#install-stage');
  const percent = $('#install-percent');

  async function loadList() {
    stage.textContent = '获取版本列表…';
    idSelect.innerHTML = '<option>加载中…</option>';
    goButton.disabled = true;
    try {
      const list = await call('versions.remote', typeSelect.value);
      const installedIds = new Set(state.versions.map(version => version.id));
      const filtered = list.filter(version => !installedIds.has(version.id));
      idSelect.innerHTML = filtered.length
        ? filtered.map(version => `<option value="${esc(version.id)}">${esc(version.id)} · ${esc(version.type)} · ${fmtTime(version.releaseTime)}</option>`).join('')
        : '<option value="">该类型下没有未安装的版本</option>';
      $('#install-count').textContent = `未安装 ${filtered.length} 个`;
      goButton.disabled = !idSelect.value;
      stage.textContent = '等待开始';
      percent.textContent = '0%';
      $('#install-fill').style.width = '0';
    } catch (error) {
      idSelect.innerHTML = '<option value="">获取失败</option>';
      stage.textContent = '获取版本列表失败：' + error.message;
    }
    setStatus('就绪');
  }

  typeSelect.addEventListener('change', loadList);
  idSelect.addEventListener('change', () => { goButton.disabled = !idSelect.value; });

  goButton.addEventListener('click', async () => {
    const id = idSelect.value;
    if (!id) return;
    const restore = busy(goButton, '安装中…');
    setStatus('安装版本 ' + id, true);
    stage.textContent = '准备中…';
    try {
      await call('versions.install', id);
      await refreshVersions();
      await selectVersion(id);
      await loadRecommendRuntime();
      closeModal();
      rerender();
      toastOk(`版本 ${id} 安装完成`);
    } catch (error) {
      stage.textContent = '安装失败：' + error.message;
      toastErr('安装失败：' + error.message);
      restore();
    }
    setStatus('就绪');
  });

  loadList();
}

export default { id: 'versions', label: '版本', icon: 'layers', render, mount };

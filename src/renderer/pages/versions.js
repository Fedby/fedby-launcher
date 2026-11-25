// 版本管理页
import { $, esc, fmtSize, fmtTime } from '../lib/dom.js';
import { call } from '../lib/ipc.js';
import { icon } from '../lib/icons.js';
import { pageHead, toast, toastOk, toastErr, confirm, empty } from '../lib/ui.js';
import { state, refreshVersions, selectVersion, loadRecommendRuntime, reportError } from '../store.js';
import { rerender, navigate } from '../router.js';
import { showVersionCheck } from '../components/versionCheck.js';

const loaderLabel = id => {
  const text = String(id || '');
  if (/neoforge/i.test(text)) return 'NeoForge';
  if (/fabric/i.test(text)) return 'Fabric';
  if (/quilt/i.test(text)) return 'Quilt';
  if (/forge/i.test(text)) return 'Forge';
  if (/optifine/i.test(text)) return 'OptiFine';
  return '模组';
};

function render(state) {
  const rows = state.versions.map(version => `
    <div class="list-row version-row">
      <div class="list-icon">${icon('layers', 16)}</div>
      <div class="list-body">
        <div class="list-title">${esc(version.id)}
          <span class="badge ${version.type === 'release' ? 'green' : 'amber'}">${esc(version.type)}</span>
          ${version.modded ? `<span class="badge blue">${esc(loaderLabel(version.id))}</span>` : ''}
          ${version.id === state.selection.versionId ? '<span class="badge green">当前</span>' : ''}
        </div>
        <div class="list-desc">${fmtTime(version.releaseTime)} · Java ${version.javaMajor}+ · ${fmtSize(version.jarSize)}${version.inheritsFrom ? ` · 基于 ${esc(version.inheritsFrom)}` : ''} · 资源索引 ${esc(version.assetIndex || '-')}</div>
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
  // 「安装新版本」统一走下载中心的原版游戏页（可搭配 Fabric / Forge / NeoForge / Quilt / OptiFine）
  const open = () => {
    state.download.section = 'game';
    state.download.install = null;
    navigate('download');
  };
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

export default { id: 'versions', label: '版本', icon: 'layers', render, mount };

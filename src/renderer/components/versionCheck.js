// 版本检查弹窗：基本信息 / 模组 / 资源包 / 光影 / 存档
import { $, esc, fmtSize, fmtTime } from '../lib/dom.js';
import { call } from '../lib/ipc.js';
import { icon } from '../lib/icons.js';
import { modal, toastOk, toastErr, confirm, loading, empty } from '../lib/ui.js';
import { state, reportError } from '../store.js';

const TABS = [
  { key: 'info', label: '基本信息', icon: 'info' },
  { key: 'mods', label: '模组', icon: 'box' },
  { key: 'resourcepacks', label: '资源包', icon: 'image' },
  { key: 'shaderpacks', label: '光影', icon: 'star' },
  { key: 'saves', label: '存档', icon: 'folder' },
];

const DIRS = [
  { key: 'version', label: '版本目录', icon: 'layers' },
  { key: 'game', label: '游戏根目录', icon: 'folder' },
  { key: 'mods', label: '模组', icon: 'box' },
  { key: 'resourcepacks', label: '资源包', icon: 'image' },
  { key: 'shaderpacks', label: '光影', icon: 'star' },
  { key: 'saves', label: '存档', icon: 'folder' },
  { key: 'backups', label: '存档备份', icon: 'shield' },
];

export async function showVersionCheck(versionId) {
  if (!versionId) return;
  let detail = {};
  try { detail = await call('versions.detail', versionId) || {}; } catch (_) {}
  const gameDir = await call('app.info').then(info => info.gameDir).catch(() => '');

  modal({
    wide: true,
    title: `版本检查 · ${esc(versionId)}`,
    subtitle: '模组、资源包、光影与存档共用同一游戏目录，可直接查看或打开对应文件夹',
    body: `
      <div class="tab-bar">
        ${TABS.map((tab, index) => `<button class="tab${index === 0 ? ' active' : ''}" data-tab="${tab.key}">${icon(tab.icon, 14)}${tab.label}</button>`).join('')}
      </div>
      <div id="check-body">${loading()}</div>`,
    footer: `<button class="btn" data-close>关闭</button>`,
  });

  const body = $('#check-body');
  let currentTab = 'info';

  document.querySelectorAll('.tab-bar [data-tab]').forEach(button => {
    button.addEventListener('click', () => {
      currentTab = button.dataset.tab;
      document.querySelectorAll('.tab-bar .tab').forEach(node => node.classList.toggle('active', node === button));
      body.classList.remove('fade');
      void body.offsetWidth;
      body.classList.add('fade');
      load(currentTab);
    });
  });

  const openDir = key => (key === 'version' ? call('versions.openDir', versionId) : call('app.openDir', key));

  const bar = (title, sub, actions) => `
    <div class="section-bar">
      <div><div class="section-title">${title}</div><div class="section-sub">${sub}</div></div>
      <div class="section-actions">${actions}</div>
    </div>`;
  const dirButton = (key, label = '打开文件夹') => `<button class="btn sm" data-dir="${key}">${icon('folder', 13)} ${label}</button>`;

  function wire() {
    body.querySelectorAll('[data-dir]').forEach(button => {
      button.addEventListener('click', () => openDir(button.dataset.dir).catch(error => toastErr(error.message)));
    });
    const refresh = body.querySelector('#tab-refresh');
    if (refresh) refresh.addEventListener('click', () => load(currentTab));
  }

  async function load(tab) {
    try {
      if (tab === 'info') {
        body.innerHTML = `
          <div class="info-grid">
            <div class="kv"><span>版本 ID</span><b class="mono">${esc(detail.id || versionId)}</b></div>
            <div class="kv"><span>类型</span><b>${esc(detail.type || '-')}</b></div>
            <div class="kv"><span>主类</span><b class="mono">${esc(detail.mainClass || '-')}</b></div>
            <div class="kv"><span>需要 Java</span><b>${detail.javaVersion?.majorVersion || '-'}</b></div>
            <div class="kv"><span>资源索引</span><b>${esc(detail.assetIndex?.id || '-')}</b></div>
            <div class="kv"><span>依赖库</span><b>${detail.libraries ?? '-'}</b></div>
            <div class="kv"><span>发布时间</span><b>${fmtTime(detail.releaseTime)}</b></div>
            <div class="kv"><span>客户端 jar</span><b>${detail.hasJar ? '已就绪' : '缺失'}</b></div>
          </div>
          <div class="section-title" style="margin:16px 0 8px">快捷目录</div>
          <div class="dir-grid">
            ${DIRS.map(dir => `<button class="dir-card" data-dir="${dir.key}">${icon(dir.icon, 16)}<span>${dir.label}</span></button>`).join('')}
          </div>
          ${gameDir ? `<div class="path-line mono" title="${esc(gameDir)}">${esc(gameDir)}</div>` : ''}`;
        wire();
        return;
      }

      if (tab === 'mods') {
        const mods = await call('content.mods');
        body.innerHTML = bar('已安装模组', `共 ${mods.length} 个 · 启用 ${mods.filter(mod => mod.enabled).length} 个`,
          dirButton('mods') + `<button class="btn sm" id="tab-refresh">${icon('refresh', 13)} 刷新</button>`) +
          (mods.length ? `<div class="list">${mods.map(mod => `
            <div class="list-row">
              <div class="list-icon">${icon('box', 15)}</div>
              <div class="list-body">
                <div class="list-title">${esc(mod.name)} <span class="badge ${mod.enabled ? 'green' : ''}">${mod.enabled ? '已启用' : '已禁用'}</span></div>
                <div class="list-desc">${esc(mod.file)} · ${fmtSize(mod.size)} · ${fmtTime(mod.modified)}</div>
              </div>
              <div class="list-actions">
                <button class="btn sm" data-toggle="${esc(mod.file)}" data-enable="${!mod.enabled}">${mod.enabled ? '禁用' : '启用'}</button>
                <button class="btn sm danger" data-del="${esc(mod.file)}">${icon('trash', 13)}</button>
              </div>
            </div>`).join('')}</div>`
            : empty({ iconName: 'box', title: '还没有模组', desc: '到「下载」页安装，或点上面的按钮打开文件夹把 .jar 放进去' }));

        body.querySelectorAll('[data-toggle]').forEach(button => {
          button.addEventListener('click', async () => {
            try {
              await call('content.toggleMod', button.dataset.toggle, button.dataset.enable === 'true');
              load('mods');
            } catch (error) { toastErr(error.message); }
          });
        });
        body.querySelectorAll('[data-del]').forEach(button => {
          button.addEventListener('click', async () => {
            const yes = await confirm({ title: '删除模组', message: `确定删除 <b>${esc(button.dataset.del)}</b>？`, confirmText: '删除', danger: true });
            if (!yes) return;
            try { await call('content.deleteMod', button.dataset.del); load('mods'); }
            catch (error) { toastErr(error.message); }
          });
        });
        wire();
        return;
      }

      if (tab === 'resourcepacks' || tab === 'shaderpacks') {
        const packs = await call('content.packs', tab);
        const isShader = tab === 'shaderpacks';
        body.innerHTML = bar(isShader ? '光影包' : '资源包', `共 ${packs.length} 个${isShader ? ' · 需要 Iris / OptiFine' : ''}`,
          dirButton(tab) + `<button class="btn sm" id="tab-refresh">${icon('refresh', 13)} 刷新</button>`) +
          (packs.length ? `<div class="list">${packs.map(pack => `
            <div class="list-row">
              <div class="list-icon">${icon(pack.kind === 'folder' ? 'folder' : 'image', 15)}</div>
              <div class="list-body">
                <div class="list-title">${esc(pack.name)}</div>
                <div class="list-desc">${esc(pack.file)} · ${pack.kind === 'folder' ? '文件夹' : 'ZIP'}</div>
              </div>
            </div>`).join('')}</div>`
            : empty({ iconName: 'image', title: `还没有${isShader ? '光影' : '资源包'}`, desc: `点「打开文件夹」把 .zip 放进 ${tab} 目录即可` }));
        wire();
        return;
      }

      if (tab === 'saves') {
        const [saves, backups] = await Promise.all([call('content.saves'), call('content.backups')]);
        body.innerHTML = bar('世界存档', `共 ${saves.length} 个`,
          dirButton('saves') + `<button class="btn sm" id="tab-refresh">${icon('refresh', 13)} 刷新</button>`) +
          (saves.length ? `<div class="list">${saves.map(save => `
            <div class="list-row">
              <div class="list-icon">${save.icon ? `<img src="${save.icon}" alt="">` : icon('folder', 15)}</div>
              <div class="list-body">
                <div class="list-title">${esc(save.name)}</div>
                <div class="list-desc">${fmtSize(save.size)} · ${fmtTime(save.modified)}</div>
              </div>
              <div class="list-actions">
                <button class="btn sm" data-backup="${esc(save.id)}">备份</button>
                <button class="btn sm danger" data-delete="${esc(save.id)}">${icon('trash', 13)}</button>
              </div>
            </div>`).join('')}</div>`
            : empty({ iconName: 'folder', title: '还没有存档', desc: '启动游戏并创建世界后会出现在这里' })) +
          `<div class="section-bar" style="margin-top:16px">
            <div><div class="section-title">备份</div><div class="section-sub">共 ${backups.length} 个</div></div>
            <div class="section-actions">${dirButton('backups', '备份文件夹')}</div>
          </div>` +
          (backups.length ? `<div class="list">${backups.map(backup => `
            <div class="list-row">
              <div class="list-icon">${icon('shield', 15)}</div>
              <div class="list-body">
                <div class="list-title">${esc(backup.name)}</div>
                <div class="list-desc">${fmtSize(backup.size)} · ${fmtTime(backup.created)}</div>
              </div>
              <div class="list-actions"><button class="btn sm" data-restore="${esc(backup.name)}">还原</button></div>
            </div>`).join('')}</div>` : '<div class="muted" style="font-size:11.5px">还没有备份</div>');

        body.querySelectorAll('[data-backup]').forEach(button => {
          button.addEventListener('click', async () => {
            try { await call('content.backupSave', button.dataset.backup); toastOk('备份完成'); load('saves'); }
            catch (error) { toastErr(error.message); }
          });
        });
        body.querySelectorAll('[data-delete]').forEach(button => {
          button.addEventListener('click', async () => {
            const yes = await confirm({ title: '删除存档', message: '删除后不可恢复，确定继续？', confirmText: '删除', danger: true });
            if (!yes) return;
            try { await call('content.deleteSave', button.dataset.delete); load('saves'); }
            catch (error) { toastErr(error.message); }
          });
        });
        body.querySelectorAll('[data-restore]').forEach(button => {
          button.addEventListener('click', async () => {
            const yes = await confirm({ title: '还原存档', message: '还原会覆盖同名存档（原存档会自动改名保留），确定继续？' });
            if (!yes) return;
            try { await call('content.restoreBackup', button.dataset.restore); toastOk('还原完成'); load('saves'); }
            catch (error) { toastErr(error.message); }
          });
        });
        wire();
      }
    } catch (error) {
      body.innerHTML = empty({ iconName: 'info', title: '读取失败', desc: esc(error.message) });
    }
  }

  await load('info');
}

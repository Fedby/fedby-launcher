// 启动器自更新：启动时静默查 GitHub Release，有新版本弹窗询问；设置页「检查更新」走同一套界面。
import { esc, fmtSize, fmtTime } from '../lib/dom.js';
import { call, listen } from '../lib/ipc.js';
import { icon } from '../lib/icons.js';
import { modal, closeModal, toast, toastOk, toastErr } from '../lib/ui.js';
import { state } from '../store.js';

/** 把 Release 说明里的 Markdown 压成纯文本行，保留标题/列表层级 */
function plain(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '');
}

function renderNotes(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').slice(0, 120);
  const body = lines.map(line => {
    const raw = line.trim();
    if (!raw) return '<div class="upd-gap"></div>';
    const heading = raw.match(/^#{1,6}\s+(.*)$/);
    if (heading) return `<div class="upd-h">${esc(plain(heading[1]))}</div>`;
    const bullet = raw.match(/^[-*+]\s+(.*)$/);
    if (bullet) return `<div class="upd-li">${esc(plain(bullet[1]))}</div>`;
    const quote = raw.match(/^>\s*(.*)$/);
    if (quote) return `<div class="upd-quote">${esc(plain(quote[1]))}</div>`;
    return `<div class="upd-p">${esc(plain(raw))}</div>`;
  }).join('');
  return body || '<div class="upd-p">这一版没有写更新说明，可以到发布页查看。</div>';
}

function openUpdateModal(info, { manual = false } = {}) {
  const size = info.asset?.size ? fmtSize(info.asset.size) : '';
  const published = info.publishedAt ? fmtTime(info.publishedAt) : '';
  const canAuto = !!info.asset;

  modal({
    title: `发现新版本 v${esc(info.version)}`,
    subtitle: `当前 v${esc(info.current)}${published ? ' · 发布于 ' + esc(published) : ''}${size ? ' · 安装包 ' + esc(size) : ''}`,
    body: `
      <div class="upd-notes">${renderNotes(info.notes)}</div>
      <div class="upd-progress" id="upd-progress" hidden>
        <div class="progress"><span id="upd-fill" style="width:0%"></span></div>
        <div class="upd-progress-text"><span id="upd-msg">准备中…</span><b id="upd-percent">0%</b></div>
      </div>`,
    footer: `
      ${manual ? '' : '<button class="btn ghost" id="upd-skip">跳过此版本</button>'}
      <button class="btn" id="upd-later">稍后提醒</button>
      <button class="btn primary" id="upd-go">${icon('download', 14)} ${canAuto ? '下载并安装' : '打开发布页'}</button>`,
  });

  const go = document.querySelector('#upd-go');
  const later = document.querySelector('#upd-later');
  const skip = document.querySelector('#upd-skip');
  const box = document.querySelector('#upd-progress');
  const fill = document.querySelector('#upd-fill');
  const msg = document.querySelector('#upd-msg');
  const percent = document.querySelector('#upd-percent');
  const buttons = [go, later, skip].filter(Boolean);

  later.addEventListener('click', () => closeModal());

  if (skip) {
    skip.addEventListener('click', async () => {
      try {
        await call('update.skip', info.version);
        state.settings.skippedVersion = info.version;
        closeModal();
        toast(`已跳过 v${info.version}，下次有新版本还会提醒`);
      } catch (error) { toastErr(error.message); }
    });
  }

  go.addEventListener('click', async () => {
    if (!canAuto) {
      await call('update.open', info.page).catch(error => toastErr(error.message));
      closeModal();
      return;
    }
    buttons.forEach(button => { button.disabled = true; });
    box.hidden = false;
    const started = Date.now();
    let speed = 0;
    const stopListening = listen('updateProgress', progress => {
      if (!progress) return;
      if (progress.total) fill.style.width = `${Math.min(100, Math.round((progress.received / progress.total) * 100))}%`;
      else fill.style.width = `${progress.percent || 0}%`;
      if (progress.speed) speed = progress.speed;
      const done = progress.phase === 'done';
      const label = done
        ? '下载完成'
        : progress.received
          ? `${fmtSize(progress.received)}${progress.total ? ' / ' + fmtSize(progress.total) : ''}${speed ? ' · ' + fmtSize(speed) + '/s' : ''}`
          : progress.message || '准备中…';
      msg.textContent = label;
      percent.textContent = done ? '100%' : `${progress.percent || 0}%`;
    });

    try {
      const result = await call('update.download');
      stopListening();
      fill.style.width = '100%';
      percent.textContent = '100%';
      msg.textContent = '下载完成，正在启动安装程序…';
      await new Promise(resolve => setTimeout(resolve, 650));
      await call('update.install', result.file);
      msg.textContent = `安装程序已启动，启动器即将关闭（用时 ${Math.max(1, Math.round((Date.now() - started) / 1000))} 秒）`;
      later.textContent = '关闭';
      buttons.forEach(button => { button.disabled = false; });
      later.disabled = false;
    } catch (error) {
      stopListening();
      box.hidden = true;
      buttons.forEach(button => { button.disabled = false; });
      toastErr('更新失败：' + error.message);
    }
  });
}

/**
 * 检查更新。manual=true 表示用户主动点的，任何时候都提示结果。
 * 自动检查会尊重「跳过此版本」和「启动时自动检查」两个开关。
 */
export async function checkForUpdate({ manual = false } = {}) {
  const config = state.settings || {};
  if (!manual && config.autoCheckUpdate === false) return null;

  let info = null;
  try {
    info = await call('update.check', manual);
  } catch (error) {
    if (manual) toastErr('检查更新失败：' + error.message);
    return null;
  }
  if (!info) return null;
  if (info.error) {
    if (manual) toastErr('检查更新失败：' + info.error);
    return null;
  }
  if (!info.newer) {
    if (manual) toastOk(`已是最新版本 v${info.current}`);
    return info;
  }
  if (!manual && info.version && info.version === config.skippedVersion) return info;
  openUpdateModal(info, { manual });
  return info;
}

/** 启动后延迟调用，别和首屏抢网络 */
export function scheduleUpdateCheck(delay = 2600) {
  const timer = setTimeout(() => {
    checkForUpdate().catch(error => console.warn('检查更新失败', error.message));
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

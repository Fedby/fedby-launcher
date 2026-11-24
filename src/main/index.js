'use strict';
// 主进程入口：自定义协议托管界面、创建窗口、挂载 IPC、生命周期。
const { app, BrowserWindow, protocol, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

const { dirs, ensureDirs } = require('./services/paths');
const bridge = require('./bridge');

const APP_SCHEME = 'fedby';
const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

app.setName('Fedby 启动器');
ensureDirs();

// 自定义协议：让渲染层可以用 ES 模块（file:// 下模块会被 CORS 拦掉）
protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

let mainWindow = null;

function resolveAsset(requestUrl) {
  const { pathname } = new URL(requestUrl);
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const root = path.resolve(RENDERER_ROOT);
  const target = path.resolve(root, relative);
  return target.startsWith(root + path.sep) ? target : null;
}

function registerProtocol() {
  protocol.handle(APP_SCHEME, async request => {
    const file = resolveAsset(request.url);
    if (!file || !fs.existsSync(file)) return new Response('Not Found', { status: 404 });
    const data = await fs.promises.readFile(file);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': [
          "default-src 'self'",
          "img-src 'self' data: https:",
          "style-src 'self' 'unsafe-inline'",
          "script-src 'self'",
          "connect-src 'self' https:",
          "font-src 'self' data:",
        ].join('; '),
      },
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    title: 'Fedby 启动器',
    backgroundColor: '#f3f5fa',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`${APP_SCHEME}://app/index.html`);

  // 界面内不允许跳走；外链交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://`)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  bridge.registerAll(mainWindow);
}

app.whenReady().then(() => {
  registerProtocol();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

process.on('uncaughtException', error => {
  // 未捕获异常记录后继续运行，避免启动器整体崩掉
  console.error('[main] 未捕获异常:', error);
});

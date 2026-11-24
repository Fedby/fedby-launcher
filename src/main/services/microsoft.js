'use strict';
// 微软登录：live.com 授权码流程（内置窗口）→ Xbox Live → XSTS → Minecraft → 档案与皮肤。
// 说明：设备码流程需要启动器自有且经 Mojang 审批的 Azure 应用，公开 client id 在 consumers 租户已失效，
// 因此统一走官方登录页授权码回调。
const { BrowserWindow, session } = require('electron');
const net = require('./net');
const accounts = require('./accounts');

const CLIENT_ID = '00000000402b5328'; // Minecraft 官方启动器的公开 client id
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';
const AUTHORIZE_URL = 'https://login.live.com/oauth20_authorize.srf';
const TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
const LOGIN_PARTITION = 'persist:microsoft-login';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const XERR_TEXT = {
  2148916227: '该 Xbox 账号已被封禁',
  2148916229: '账号受年龄限制，无法使用 Xbox Live',
  2148916233: '该微软账号还没有 Xbox 档案，请先到 xbox.com 创建',
  2148916235: '所在地区不支持 Xbox Live',
  2148916236: '需要进行成人身份验证（韩国）',
  2148916237: '需要进行成人身份验证（韩国）',
  2148916238: '未成年账号需由家长加入 Microsoft 家庭组',
};

function authorizeUrl() {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    display: 'touch',
    locale: 'zh_CN',
  });
  return `${AUTHORIZE_URL}?${query.toString()}`;
}

function oauthErrorText(code, description) {
  const map = {
    invalid_grant: '授权码无效或已过期，请重新登录',
    invalid_client: '登录应用标识不可用',
    invalid_request: '微软拒绝了登录请求，请重试',
    access_denied: '你取消了微软账号授权',
    unauthorized_client: '该登录方式不可用，请重新登录',
  };
  return map[code] || (description ? String(description).slice(0, 180) : `微软登录失败（${code || '未知错误'}）`);
}

/** 打开微软官方登录页，拦截 oauth20_desktop.srf?code=... 回调后返回授权码 */
function openLoginWindow(parent) {
  return new Promise((resolve, reject) => {
    const loginSession = session.fromPartition(LOGIN_PARTITION);
    try { loginSession.webRequest.onBeforeRequest(null); } catch (_) {}

    const window = new BrowserWindow({
      width: 520,
      height: 760,
      minWidth: 440,
      minHeight: 560,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      title: '登录 Microsoft 账号',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition: LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setMenuBarVisibility(false);

    let settled = false;
    let timer = null;

    const cleanup = () => {
      try { loginSession.webRequest.onBeforeRequest(null); } catch (_) {}
      if (timer) { clearTimeout(timer); timer = null; }
    };
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!window.isDestroyed()) window.destroy();
      if (error) reject(error); else resolve(code);
    };

    loginSession.webRequest.onBeforeRequest(
      { urls: ['https://login.live.com/oauth20_desktop.srf*'] },
      (details, callback) => {
        callback({ cancel: true });
        try {
          const url = new URL(details.url);
          const code = url.searchParams.get('code');
          const errorCode = url.searchParams.get('error');
          if (code) return finish(null, code);
          finish(new Error(errorCode
            ? (url.searchParams.get('error_description') || '微软拒绝了本次登录授权')
            : '登录未返回授权码，请重试'));
        } catch (err) { finish(err); }
      },
    );

    window.on('closed', () => { if (!settled) finish(new Error('已取消微软登录')); });
    timer = setTimeout(() => finish(new Error('微软登录超时，请重试')), 5 * 60 * 1000);
    window.loadURL(authorizeUrl(), { userAgent: BROWSER_UA })
      .catch(err => finish(new Error('无法打开微软登录页面：' + err.message)));
  });
}

async function exchangeCode(code) {
  if (!code) throw new Error('微软未返回授权码');
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
  }).toString();
  const data = await net.requestJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (data.error) throw new Error(oauthErrorText(data.error, data.error_description));
  if (!data.access_token) throw new Error('微软未返回访问令牌');
  return { accessToken: data.access_token, refreshToken: data.refresh_token || '', expiresIn: data.expires_in || 3600 };
}

async function refreshToken(refreshTokenValue) {
  if (!refreshTokenValue) throw new Error('缺少微软刷新令牌');
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
  }).toString();
  const data = await net.requestJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (data.error) throw new Error(oauthErrorText(data.error, data.error_description));
  if (!data.access_token) throw new Error('微软令牌续期失败');
  return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshTokenValue, expiresIn: data.expires_in || 3600 };
}

// ---------- Xbox / Minecraft 链路 ----------
async function xboxLive(accessToken) {
  const data = await net.postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + accessToken },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  if (!data.Token) throw new Error('Xbox Live 授权失败：微软令牌无效或已过期，请重新登录');
  return data.Token;
}

async function xsts(xboxToken) {
  const data = await net.postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xboxToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  if (data.XErr) {
    const hint = XERR_TEXT[data.XErr];
    throw new Error(hint ? `${hint}（XErr ${data.XErr}）` : `Xbox 授权失败（XErr ${data.XErr}）`);
  }
  const uhs = data.DisplayClaims?.xui?.[0]?.uhs;
  if (!data.Token || !uhs) throw new Error('Xbox 授权返回异常，请重试');
  return { token: data.Token, uhs };
}

async function minecraftToken(xstsToken, uhs) {
  const data = await net.postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
  });
  if (data.error) {
    throw new Error(data.error === 'Invalid app registration'
      ? '当前登录应用未通过 Minecraft 审核，暂时无法登录'
      : `Minecraft 登录失败：${data.errorMessage || data.error}`);
  }
  if (!data.access_token) throw new Error('获取 Minecraft 令牌失败');
  return data;
}

async function fetchProfile(accessToken) {
  try {
    return await net.requestJson('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
  } catch (err) {
    if (err.status === 404) throw new Error('该微软账号未拥有 Minecraft Java 版（或尚未在官方启动器初始化）');
    if (err.status === 401) throw new Error('Minecraft 令牌校验失败，请重新登录');
    throw err;
  }
}

async function cacheSkin(profile, uuid) {
  const skins = Array.isArray(profile.skins) ? profile.skins : [];
  const active = skins.find(skin => skin.state === 'ACTIVE') || skins[0];
  if (!active?.url) return null;
  try {
    const buffer = await fetchBinary(active.url);
    if (!buffer) return null;
    accounts.writeSkin(uuid, buffer);
    return { url: active.url, model: active.variant === 'SLIM' ? 'slim' : 'steve' };
  } catch (_) {
    return null;
  }
}

function fetchBinary(url) {
  const https = require('https');
  return new Promise(resolve => {
    https.get(url, { headers: { 'User-Agent': net.UA } }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', () => resolve(null));
  });
}

/**
 * 用微软令牌完成整条登录链，写入账户列表。
 * @param {{accessToken:string, refreshToken?:string}} tokens
 * @param {string} [accountId] 传入时更新原账户（用于静默续期）
 */
async function completeLogin(tokens, accountId) {
  const xbl = await xboxLive(tokens.accessToken);
  const ticket = await xsts(xbl);
  const mc = await minecraftToken(ticket.token, ticket.uhs);
  const profile = await fetchProfile(mc.access_token);
  if (!profile?.name) throw new Error('无法读取 Minecraft 档案，请稍后重试');

  const uuid = String(profile.id || '').replace(/-/g, '');
  const skin = await cacheSkin(profile, uuid);
  const previous = accountId ? accounts.find(accountId) : null;

  const account = {
    ...(previous || {}),
    id: accountId || accounts.newId(),
    type: 'microsoft',
    name: profile.name,
    uuid,
    accessToken: mc.access_token,
    refreshToken: tokens.refreshToken || previous?.refreshToken || '',
    expiresAt: Date.now() + (mc.expires_in || 3600) * 1000,
    skinModel: skin?.model || previous?.skinModel || 'steve',
    createdAt: previous?.createdAt || new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  accounts.upsert(account);
  return account;
}

async function login(parent) {
  const code = await openLoginWindow(parent);
  const tokens = await exchangeCode(code);
  return completeLogin(tokens);
}

async function refresh(accountId) {
  const account = accounts.find(accountId);
  if (!account || account.type !== 'microsoft') return account;
  if (!account.refreshToken) throw new Error('该账户缺少刷新令牌，请重新登录');
  const tokens = await refreshToken(account.refreshToken);
  return completeLogin(tokens, account.id);
}

function needsRefresh(account, skewMs = 5 * 60 * 1000) {
  if (!account || account.type !== 'microsoft' || !account.expiresAt) return false;
  return account.expiresAt - Date.now() < skewMs;
}

async function refreshSkin(accountId) {
  const account = accounts.find(accountId);
  if (!account || account.type !== 'microsoft') return account;
  const profile = await fetchProfile(account.accessToken);
  if (!profile?.id) return account;
  const uuid = String(profile.id).replace(/-/g, '');
  const skin = await cacheSkin(profile, uuid);
  if (!skin) return account;
  return accounts.upsert({ ...account, uuid, skinModel: skin.model });
}

module.exports = {
  authorizeUrl, openLoginWindow, exchangeCode, refreshToken,
  completeLogin, login, refresh, needsRefresh, refreshSkin, cacheSkin,
  BROWSER_UA, CLIENT_ID,
};

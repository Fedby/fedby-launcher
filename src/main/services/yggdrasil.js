'use strict';
// 第三方皮肤站登录（Yggdrasil 协议：LittleSkin / Blessing Skin 等）。
const path = require('path');
const net = require('./net');
const accounts = require('./accounts');

const CLIENT_TOKEN = '8f7d1c6a-1c2d-4f6a-9a0e-b1c2d3e4f5a6';

function parseSite(input) {
  let site = String(input || '').trim();
  if (!site) throw new Error('请填写皮肤站地址');
  if (!/^https?:\/\//i.test(site)) site = 'https://' + site;
  return site.replace(/\/+$/, '');
}

async function siteInfo(input) {
  const base = parseSite(input);
  const meta = await net.requestJson(base + '/api/yggdrasil', { headers: { Accept: 'application/json' } });
  if (meta?.error) throw new Error(meta.errorMessage || meta.error);
  return {
    base,
    name: meta?.meta?.serverName || 'Yggdrasil 皮肤站',
    homepage: meta?.meta?.links?.homepage || base,
    register: meta?.meta?.links?.register || base + '/auth/register',
  };
}

async function login({ site, username, password }) {
  const base = parseSite(site);
  if (!username || !password) throw new Error('请输入皮肤站账号和密码');
  const data = await net.postJson(base + '/api/yggdrasil/authserver/authenticate', {
    agent: { name: 'Minecraft', version: 1 },
    username,
    password,
    clientToken: CLIENT_TOKEN,
    requestUser: true,
  });
  if (data?.error) throw new Error(data.errorMessage || data.error);
  const profile = data.selectedProfile || data.user?.selectedProfile;
  if (!profile?.id || !profile?.name) throw new Error('该账号没有可用的游戏角色');

  const account = {
    id: accounts.newId(),
    type: 'thirdparty',
    name: profile.name,
    uuid: String(profile.id).replace(/-/g, ''),
    accessToken: data.accessToken || '',
    clientToken: CLIENT_TOKEN,
    skinSite: base,
    createdAt: new Date().toISOString(),
  };
  accounts.upsert(account);
  try { return await refreshSkin(account.id) || account; } catch (_) { return account; }
}

function decodeTextures(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value || ''), 'base64').toString('utf-8'));
    const textures = parsed.textures || parsed;
    return {
      skin: textures.SKIN?.url || '',
      model: textures.SKIN?.metadata?.model === 'slim' ? 'slim' : 'steve',
    };
  } catch (_) {
    return { skin: '', model: 'steve' };
  }
}

async function refreshSkin(accountId) {
  const account = accounts.find(accountId);
  if (!account || account.type !== 'thirdparty' || !account.skinSite) return account || null;
  const profile = await net.requestJson(
    `${account.skinSite}/api/yggdrasil/sessionserver/session/minecraft/profile/${account.uuid}`,
    { headers: { Authorization: 'Bearer ' + account.accessToken } },
  ).catch(async () => net.requestJson(`${account.skinSite}/api/yggdrasil/minecraft/profile/${account.uuid}`));
  if (profile?.error) throw new Error(profile.errorMessage || profile.error);

  const textures = (profile.properties || []).find(prop => prop.name === 'textures');
  const info = decodeTextures(textures?.value);
  if (!info.skin) return account;

  const saved = path.basename(accounts.skinPath(account.uuid) || '');
  if (!saved) return account;
  try {
    await net.download(info.skin, path.join(path.dirname(accounts.skinPath(account.uuid)), saved), { timeout: 20000 });
  } catch (_) { return account; }
  return accounts.upsert({ ...account, skinModel: info.model });
}

async function refreshAll() {
  for (const account of accounts.list()) {
    try {
      if (account.type === 'thirdparty') await refreshSkin(account.id);
    } catch (_) { /* 单个失败不影响其他账户 */ }
  }
  return accounts.list();
}

module.exports = { parseSite, siteInfo, login, refreshSkin, refreshAll };

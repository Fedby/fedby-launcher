// IPC 封装：统一解包 {ok,data} / {ok:false,error}，失败直接抛错给调用方 try/catch。
const bridge = window.fedby;

export async function call(path, ...args) {
  const [group, method] = path.split('.');
  const namespace = bridge[group];
  if (!namespace || typeof namespace[method] !== 'function') {
    throw new Error(`未定义的接口: ${path}`);
  }
  const result = await namespace[method](...args);
  if (result && result.ok === false) throw new Error(result.error || '操作失败');
  return result && result.ok ? result.data : result;
}

export const listen = (channel, handler) => {
  const subscribe = bridge.on?.[channel];
  return subscribe ? subscribe(handler) : () => {};
};

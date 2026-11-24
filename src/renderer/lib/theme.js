// 主题色：写入 CSS 变量，界面即时生效（不需要重绘）
export const PRESET_COLORS = ['#4f6ef7', '#7c4dff', '#0ea5a4', '#17b978', '#f59e0b', '#e5484d', '#ec4899', '#64748b'];

function mix(hex, target, ratio) {
  const parse = value => [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16));
  const [r, g, b] = parse(hex);
  const [tr, tg, tb] = parse(target);
  const channel = (from, to) => Math.round(from + (to - from) * ratio).toString(16).padStart(2, '0');
  return `#${channel(r, tr)}${channel(g, tg)}${channel(b, tb)}`;
}

export function applyTheme(color) {
  const hex = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#4f6ef7';
  const style = document.documentElement.style;
  style.setProperty('--primary', hex);
  style.setProperty('--primary-hover', mix(hex, '#000000', 0.14));
  style.setProperty('--primary-soft', mix(hex, '#ffffff', 0.9));
  style.setProperty('--primary-line', mix(hex, '#ffffff', 0.8));
  document.querySelectorAll('[data-color]').forEach(node => {
    node.classList.toggle('active', String(node.dataset.color).toLowerCase() === hex.toLowerCase());
  });
  const picker = document.querySelector('#color-picker');
  if (picker) picker.value = hex;
}

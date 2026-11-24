// 内联 SVG 图标（stroke 风格，颜色跟随 currentColor）
const PATHS = {
  play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"/>',
  layers: '<path d="M12 3.2L3.6 7.6 12 12l8.4-4.4L12 3.2z"/><path d="M3.6 12.4L12 16.8l8.4-4.4"/><path d="M3.6 16.8L12 21.2l8.4-4.4"/>',
  download: '<path d="M12 3.5v11.5"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 20.5h15"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9"/>',
  folder: '<path d="M3.4 7.4a2 2 0 012-2h3.4l2 2h7.8a2 2 0 012 2v8.2a2 2 0 01-2 2H5.4a2 2 0 01-2-2V7.4z"/>',
  refresh: '<path d="M20 11.4A8 8 0 105.6 16.8"/><path d="M20 5.4v6h-6"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8L20.4 20.4"/>',
  trash: '<path d="M4.5 7.5h15"/><path d="M9.5 7.5V5.2h5v2.3"/><path d="M6.4 7.5l1 12.3h9.2l1-12.3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  minus: '<path d="M5.2 12h13.6"/>',
  check: '<path d="M4.8 12.6l4.8 4.8L19.2 7"/>',
  arrowRight: '<path d="M4.8 12h14.4"/><path d="M13.6 6.4L19.2 12l-5.6 5.6"/>',
  user: '<circle cx="12" cy="8.4" r="3.6"/><path d="M4.8 20.4c1.4-3.6 4-5.4 7.2-5.4s5.8 1.8 7.2 5.4"/>',
  globe: '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.4 2.2 3.6 5 3.6 8.4s-1.2 6.2-3.6 8.4c-2.4-2.2-3.6-5-3.6-8.4S9.6 5.8 12 3.6z"/>',
  key: '<circle cx="15.4" cy="8.6" r="3.8"/><path d="M12.7 11.3L4.4 19.6"/><path d="M7.2 16.8l2 2M9.6 14.4l2 2"/>',
  star: '<path d="M12 4l2.5 5.1 5.6.8-4 4 .9 5.6L12 16.9 7 19.5l.9-5.6-4-4 5.6-.8L12 4z"/>',
  info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r=".9" fill="currentColor" stroke="none"/>',
  coffee: '<path d="M4.8 8h11v6.4a4 4 0 01-4 4H8.8a4 4 0 01-4-4V8z"/><path d="M15.8 9.4h2a2.4 2.4 0 010 4.8h-2"/><path d="M7.4 4.6v1.6M11 4.6v1.6"/>',
  palette: '<path d="M12 3.6c4.6 0 8.4 3.2 8.4 7.2 0 4.4-3.8 8.4-8.4 8.4S3.6 15.6 3.6 12 7.4 3.6 12 3.6z"/><circle cx="9" cy="9.6" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="9.6" r="1" fill="currentColor" stroke="none"/><circle cx="8.4" cy="14" r="1" fill="currentColor" stroke="none"/>',
  sliders: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2.2"/><circle cx="10" cy="16" r="2.2"/>',
  box: '<path d="M12 3.4l7.6 4v9.2L12 20.6l-7.6-4V7.4L12 3.4z"/><path d="M4.4 7.4L12 11.6l7.6-4.2M12 11.6v9"/>',
  image: '<rect x="3.8" y="5" width="16.4" height="14" rx="2.4"/><circle cx="9" cy="10" r="1.4"/><path d="M4.6 16.6l4.4-3.8 3.4 2.8 2.6-2.2 4.4 3.6"/>',
  shield: '<path d="M12 3.4l7 2.6v6.2c0 4-3 7-7 8.4-4-1.4-7-4.4-7-8.4V6L12 3.4z"/><path d="M9 12.2l2.2 2.2 4-4.2"/>',
  cloud: '<path d="M7.4 18.4h9.2a3.6 3.6 0 00.4-7.2A5 5 0 007.6 10a3.9 3.9 0 00-.2 8.4z"/>',
  tag: '<path d="M11.2 3.6H19a1.4 1.4 0 011.4 1.4v7.8L11 22 2.6 13.6 10.8 5.4a1.4 1.4 0 011.4-1.8z"/><circle cx="16.4" cy="7.6" r="1.2"/>',
  link: '<path d="M10 13.6a3.6 3.6 0 005.1 0l3-3a3.6 3.6 0 10-5.1-5.1L11.6 7"/><path d="M14 10.4a3.6 3.6 0 00-5.1 0l-3 3a3.6 3.6 0 105.1 5.1l1.4-1.4"/>',
};

export function icon(name, size = 16, className = '') {
  const body = PATHS[name] || PATHS.info;
  return `<svg class="ico ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const MICROSOFT_LOGO = `<svg class="ms-logo" viewBox="0 0 23 23" aria-hidden="true"><rect width="10.5" height="10.5" fill="#f25022"/><rect x="12.5" width="10.5" height="10.5" fill="#7fba00"/><rect y="12.5" width="10.5" height="10.5" fill="#00a4ef"/><rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#ffb900"/></svg>`;

'use strict';
// Java 运行时自动下载自检：真实下载 → 解压 → 探测主版本
const javadl = require('./src/main/services/javadl');
const java = require('./src/main/services/java');

(async () => {
  const before = javadl.list();
  console.log('已有运行时:', before.length ? before.map(item => `Java ${item.feature} → ${item.path}`).join(' | ') : '无');

  const started = Date.now();
  const entry = await javadl.ensure(25, progress => {
    if (progress.phase === 'download') {
      if (progress.percent % 20 === 0 || progress.percent === 100) console.log(`  [${progress.percent}%] ${progress.message}`);
    } else {
      console.log(`  [${progress.phase}] ${progress.message}`);
    }
  });
  console.log('用时', ((Date.now() - started) / 1000).toFixed(1) + 's');
  console.log('安装结果:', JSON.stringify(entry, null, 2));

  const probed = await java.probe(entry.path);
  console.log('探测结果:', probed);

  const list = await java.scanCached(true);
  console.log('扫描到 Java:', list.map(item => `Java ${item.major} (${item.vendor})`).join(' / '));
  console.log('下载的运行时已被扫描纳入:', list.some(item => item.path === entry.path));

  const again = await javadl.ensure(25, () => {});
  console.log('二次 ensure 直接复用:', again.path === entry.path);
})().catch(error => {
  console.error('失败:', error.message);
  process.exit(1);
});

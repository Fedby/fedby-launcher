'use strict';
// 用 Electron 的 nativeImage 把任意图片转成 PNG（供打包图标使用）。
// 用法：electron tools/convert-icon.js <源图> <目标.png> [边长]
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const [source, target, size] = process.argv.slice(2);

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  try {
    if (!source || !target) throw new Error('缺少参数：源图 与 目标路径');
    const image = nativeImage.createFromPath(source);
    if (image.isEmpty()) throw new Error('无法读取图片: ' + source);

    const { width, height } = image.getSize();
    const side = Number(size) || Math.min(width, height);
    const square = image.getSize().width === image.getSize().height
      ? image
      : image.crop({ x: 0, y: 0, width: Math.min(width, height), height: Math.min(width, height) });
    const resized = side === square.getSize().width ? square : square.resize({ width: side, height: side, quality: 'best' });

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, resized.toPNG());
    console.log(`已转换: ${source} (${width}x${height}) -> ${target} (${side}x${side}), ${fs.statSync(target).size} 字节`);
  } catch (error) {
    console.error('转换失败:', error.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});

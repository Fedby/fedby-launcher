'use strict';
// 极简 ZIP 解压：只支持 store(0) / deflate(8)，够解 Java 运行时压缩包用。
// 不引三方依赖，避免打包后 asar 里的 node_modules 路径问题。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function readUInt64(buffer, offset) {
  const low = buffer.readUInt32LE(offset);
  const high = buffer.readUInt32LE(offset + 4);
  return high * 0x100000000 + low;
}

function findEocd(buffer) {
  const floor = Math.max(0, buffer.length - 66000); // EOCD 最大 65557 字节（含注释）
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

function centralDirectoryInfo(buffer, eocd) {
  let count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  // Zip64：字段被写成 0xFFFF / 0xFFFFFFFF 时去 Zip64 目录里取真实值
  if (count === 0xFFFF || offset === 0xFFFFFFFF) {
    const locator = eocd - 20;
    if (locator >= 0 && buffer.readUInt32LE(locator) === SIG_EOCD64_LOCATOR) {
      const record = readUInt64(buffer, locator + 8);
      if (record >= 0 && record < buffer.length - 56 && buffer.readUInt32LE(record) === SIG_EOCD64) {
        count = readUInt64(buffer, record + 32);
        offset = readUInt64(buffer, record + 48);
      }
    }
  }
  return { count, offset };
}

// Zip64 扩展字段：只有被写成 0xFFFFFFFF 的项才按顺序出现
function readZip64Extra(extra, need) {
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    if (id === 0x0001) {
      const body = extra.subarray(cursor + 4, cursor + 4 + size);
      const out = {};
      let p = 0;
      for (const key of need) {
        if (p + 8 > body.length) break;
        out[key] = readUInt64(body, p);
        p += 8;
      }
      return out;
    }
    cursor += 4 + size;
  }
  return {};
}

function safeTarget(root, entryName) {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) throw new Error('压缩包内含绝对路径: ' + entryName);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, normalized);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) throw new Error('压缩包路径越界: ' + entryName);
  return target;
}

/**
 * 解压 zip 到目录。
 * @param {string} zipPath
 * @param {string} destDir
 * @param {(info:{done:number,total:number})=>void} [onProgress]
 * @returns {{files:number, bytes:number}}
 */
function extract(zipPath, destDir, onProgress = null) {
  const buffer = fs.readFileSync(zipPath);
  if (buffer.length > 512 * 1024 * 1024) throw new Error('压缩包过大，拒绝解压');

  const eocd = findEocd(buffer);
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');

  const { count, offset } = centralDirectoryInfo(buffer, eocd);
  fs.mkdirSync(destDir, { recursive: true });

  let cursor = offset;
  let files = 0;
  let bytes = 0;

  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw new Error('ZIP 目录结构损坏（第 ' + (i + 1) + ' 项）');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    let compSize = buffer.readUInt32LE(cursor + 20);
    let uncompSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    let localOffset = buffer.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLen;
    const name = buffer.toString(flags & 0x800 ? 'utf8' : 'latin1', cursor + 46, nameEnd);

    if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) {
      const need = [];
      if (uncompSize === 0xFFFFFFFF) need.push('uncomp');
      if (compSize === 0xFFFFFFFF) need.push('comp');
      if (localOffset === 0xFFFFFFFF) need.push('offset');
      const extra = buffer.subarray(nameEnd, nameEnd + extraLen);
      const zip64 = readZip64Extra(extra, need);
      if (zip64.uncomp != null) uncompSize = zip64.uncomp;
      if (zip64.comp != null) compSize = zip64.comp;
      if (zip64.offset != null) localOffset = zip64.offset;
    }

    cursor = nameEnd + extraLen + commentLen;

    if (name.endsWith('/')) {
      fs.mkdirSync(safeTarget(destDir, name), { recursive: true });
    } else {
      if (buffer.readUInt32LE(localOffset) !== SIG_LOCAL) throw new Error('ZIP 局部头损坏: ' + name);
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buffer.subarray(dataStart, dataStart + compSize);

      let data;
      if (method === 0) data = raw;
      else if (method === 8) data = zlib.inflateRawSync(raw);
      else throw new Error('不支持的压缩方式 ' + method + ': ' + name);

      const target = safeTarget(destDir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
      files += 1;
      bytes += data.length;
    }

    if (onProgress && (i % 40 === 0 || i === count - 1)) onProgress({ done: i + 1, total: count });
  }

  return { files, bytes };
}

module.exports = { extract };

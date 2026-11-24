'use strict';
// 运行时推荐：根据版本要求的 Java 主版本与物理内存，给出默认 Java / 内存。
// satisfied=false 表示本机没有满足要求的 Java，调用方可以据此触发自动下载。
const versions = require('./versions');
const java = require('./java');

async function recommend(versionId) {
  let required = 17;
  const json = versionId ? versions.read(versionId) : null;
  if (json) required = json.javaVersion?.majorVersion || 17;
  const list = await java.scanCached(false);
  const chosen = java.pickJava(list, required);
  const satisfied = !!chosen && chosen.major >= required;
  return {
    requiredJava: required,
    satisfied,
    javaPath: chosen?.path || '',
    javaDisplay: chosen?.display || '',
    javaMajor: chosen?.major || 0,
    totalMemMB: java.totalMemMB(),
    memoryMB: java.recommendedMemoryMB(),
  };
}

module.exports = { recommend };

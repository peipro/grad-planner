// 研途计划 · fs.watch 写入来源判断（Phase 1B Task 6）
// 核心原则：不依赖时间窗口猜测来源，基于 envelope.writeId 识别"自己刚刚写盘"。
// 自己的写盘（writeId 匹配）→ 跳过（防同步循环）；
// 其他（外部写入 / 未知）→ 视为外部，进入同步处理。

// 分类文件变化事件。返回 { external: boolean, reason: string }
function classifyWatchEvent({ fileText, lastWrittenWriteId }) {
  if (fileText === null || fileText === undefined || fileText === '') {
    return { external: false, reason: 'no-file' }
  }
  let env
  try {
    env = JSON.parse(fileText)
  } catch {
    return { external: false, reason: 'invalid-json' }
  }
  const writeId = env && typeof env === 'object' && typeof env.writeId === 'string' ? env.writeId : null
  if (writeId !== null && typeof lastWrittenWriteId === 'string' && writeId === lastWrittenWriteId) {
    return { external: false, reason: 'self-write' }
  }
  // 外部写入：writeId 不同，或文件无 writeId（旧格式/外部工具修改）→ 保守视为外部
  return { external: true, reason: writeId === null ? 'unknown-write' : 'external-write' }
}

module.exports = { classifyWatchEvent }

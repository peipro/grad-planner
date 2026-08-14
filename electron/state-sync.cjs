// 研途计划 · State Sync 辅助（Phase 1B-2）
// 纯 Node 可测：fs.watch 事件分类逻辑。
//
// 职责：fs.watch 只负责“检测真正的外部文件变化”，不再触发 reload。
// 判断依据是内容 sha256（而非时间窗口）：
//   - 文件不存在 / 无法读 → skip
//   - hash 与“自己最近一次写盘”一致 → self-write（mutation persist 已走 state-sync 广播，跳过）
//   - 其他 → external（外部写入：旧客户端整份写 / 手动编辑）→ 需要重读权威并广播 state-sync

// 分类文件变化事件。返回 { action: 'skip' | 'self-write' | 'external', reason }
function classifyStorageChange({ hash, lastWrittenHash }) {
  if (hash === null || hash === undefined) return { action: 'skip', reason: 'no-file' }
  if (typeof lastWrittenHash === 'string' && hash === lastWrittenHash) {
    return { action: 'self-write', reason: 'own-persist-already-synced' }
  }
  return { action: 'external', reason: 'external-change' }
}

module.exports = { classifyStorageChange }

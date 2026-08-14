// Renderer Flush Protocol（Phase 1B Task 1）
// 主进程检测到外部写入、准备 reload 时，必须保证：
//   1. 各视图未 blur 的草稿先提交到 store（dispatch 'app:prepare-flush'，同步事件）
//      → zustand persist 同步触发 setItem → sync-adapter 构造 revision 感知提交（串行队列）
//   2. 等待 sync-adapter 提交队列排空（window.__gradSyncFlush）
//   3. ACK（flushAck），主进程随后 flush + reload
// 协议由事件/承诺驱动，不依赖固定等待。

export const PREPARE_FLUSH_EVENT = 'app:prepare-flush'

export interface FlushApi {
  flushAck: () => Promise<unknown>
}

export const performPrepareFlush = async (api: FlushApi): Promise<void> => {
  // 1. 各视图同步提交草稿（handler 内 zustand setState 立即生效，persist 同步触发提交）
  window.dispatchEvent(new CustomEvent(PREPARE_FLUSH_EVENT))
  // 2. 等待 sync-adapter 的串行提交队列排空（提交带 expectedRevision，reload 前数据已推送主进程）
  const sync = (window as any).__gradSyncFlush
  if (typeof sync === 'function') {
    await sync()
  }
  // 3. ACK：主进程收到后 flush + reload
  await api.flushAck()
}

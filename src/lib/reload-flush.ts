// Renderer Flush Protocol（Phase 1B Task 1）
// 主进程检测到外部写入、准备 reload 时，必须保证：
//   1. 各视图未 blur 的草稿先提交到 store（dispatch 'app:prepare-flush'，同步事件）
//   2. 最新持久化 state 推给主进程（syncStorageSet，确保 pendingSyncData 已更新）
//   3. ACK（flushAck），主进程随后 flush + reload
// 协议由事件驱动（ACK），不依赖固定等待。

export const PREPARE_FLUSH_EVENT = 'app:prepare-flush'

export interface FlushApi {
  syncStorageSet: (data: string) => Promise<unknown>
  flushAck: () => Promise<unknown>
}

export const performPrepareFlush = async (api: FlushApi, serialize: () => string): Promise<void> => {
  // 1. 各视图同步提交草稿（dispatchEvent 同步执行 handler；handler 内 zustand setState 立即生效）
  window.dispatchEvent(new CustomEvent(PREPARE_FLUSH_EVENT))
  // 2. 推送最新持久化 state（覆盖 300ms 节流：即使计时器未到期，pendingSyncData 也已是最新）
  await api.syncStorageSet(serialize())
  // 3. ACK：主进程收到后 flush + reload
  await api.flushAck()
}

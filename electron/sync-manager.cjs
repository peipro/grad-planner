// 研途计划 · 数据同步写入管理器（主进程侧）
// 统一管理桌面端 sync-storage 写入节流 + reload 前强制落盘。
// 纯 Node 可测（不依赖 electron）：main.cjs 注入 write / reload 回调。
//
// 时序语义：
//   setPending(data)  —— 300ms 节流，合并高频写入为一次落盘
//   flush()           —— 立即把 pending 数据同步落盘（reload / 退出前必须调用）
//   flushAndReload()  —— 先 flush 再触发页面刷新，确保刷新前数据已持久化
//   clear()           —— 丢弃 pending（如删除数据文件时）
//
// 关键修复：任何 renderer reload 必须先 flush。页面刷新会打断节流计时器，
// 未落盘的 pending 数据会永久丢失 —— 这是本模块存在的原因。

const DEFAULT_DEBOUNCE_MS = 300

function createSyncManager({ write, reload, debounceMs = DEFAULT_DEBOUNCE_MS }) {
  if (typeof write !== 'function') throw new Error('createSyncManager: write 必须为函数')
  let pending = null
  let timer = null

  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function setPending(data) {
    pending = data
    if (!timer) timer = setTimeout(flush, debounceMs)
  }

  function flush() {
    clearTimer()
    if (pending === null) return
    const data = pending
    pending = null
    write(data)
  }

  function clear() {
    clearTimer()
    pending = null
  }

  // reload 前必须先 flush：任何页面刷新都会打断节流计时器，未落盘数据会丢失
  function flushAndReload() {
    flush()
    if (typeof reload === 'function') reload()
  }

  return {
    setPending,
    flush,
    clear,
    flushAndReload,
    get hasPending() {
      return pending !== null
    },
  }
}

module.exports = { createSyncManager }

const test = require('node:test')
const assert = require('node:assert')
const { createSyncManager } = require('./sync-manager.cjs')

// Test A：桌面产生修改 → 进入 pending → 立即触发 reload → 数据已落盘
test('Test A: 产生修改→进入pending→立即reload→数据已落盘', () => {
  const writes = []
  let reloaded = 0
  const mgr = createSyncManager({
    write: (d) => writes.push(d),
    reload: () => reloaded++,
  })
  mgr.setPending('{"tasks":[{"id":"t1","title":"写论文"}]}')
  assert.strictEqual(mgr.hasPending, true, '修改应先进入 pending')

  // 模拟平板写入触发 reload：桌面尚未等到 300ms 节流到期
  mgr.flushAndReload()

  assert.strictEqual(writes.length, 1, 'reload 前必须落盘')
  assert.strictEqual(writes[0], '{"tasks":[{"id":"t1","title":"写论文"}]}')
  assert.strictEqual(reloaded, 1, 'flush 后必须 reload')
  assert.strictEqual(mgr.hasPending, false, '落盘后 pending 清空')
})

// Test B：平板修改 + 桌面存在 pending write → 触发 reload → 数据不能丢
test('Test B: 平板修改时桌面有pending→reload→最终数据不丢', () => {
  const writes = []
  let reloaded = 0
  const mgr = createSyncManager({
    write: (d) => writes.push(d),
    reload: () => reloaded++,
  })
  // 桌面 300ms 节流窗口内连续两次修改（合并为最后一次）
  mgr.setPending('{"tasks":[]}')
  mgr.setPending('{"tasks":[],"notes":[{"id":"n1"}]}')

  // 平板写入触发 fs.watch → flushAndReload
  mgr.flushAndReload()

  assert.strictEqual(writes.length, 1, '节流窗口内多次写入应合并为一次')
  assert.strictEqual(writes[0], '{"tasks":[],"notes":[{"id":"n1"}]}', '必须写入最后一份（最新）数据')
  assert.strictEqual(reloaded, 1)
})

// 节流：debounce 窗口内多次 setPending 只落盘一次（最后一次）
test('节流：debounce 窗口内多次 setPending 合并为一次落盘', async () => {
  const writes = []
  const mgr = createSyncManager({ write: (d) => writes.push(d), debounceMs: 50 })
  mgr.setPending('a')
  mgr.setPending('b')
  mgr.setPending('c')
  await new Promise((r) => setTimeout(r, 100))
  assert.strictEqual(writes.length, 1)
  assert.strictEqual(writes[0], 'c')
})

// 无 pending 时 flush/reload 不产生副作用
test('无 pending 时 flushAndReload 仍会 reload 但不写盘', () => {
  const writes = []
  let reloaded = 0
  const mgr = createSyncManager({ write: (d) => writes.push(d), reload: () => reloaded++ })
  mgr.flushAndReload()
  assert.strictEqual(writes.length, 0)
  assert.strictEqual(reloaded, 1)
})

// clear（sync-storage-remove 场景）：丢弃 pending 不写盘
test('clear 清空 pending，不触发写盘', async () => {
  const writes = []
  const mgr = createSyncManager({ write: (d) => writes.push(d), debounceMs: 30 })
  mgr.setPending('x')
  mgr.clear()
  mgr.flush()
  assert.strictEqual(writes.length, 0)
})

// write 抛异常时不应让 reload 中断（与主进程错误处理一致）
test('write 抛错时 flush 不抛出（错误由调用方捕获）', () => {
  const mgr = createSyncManager({
    write: () => {
      throw new Error('disk full')
    },
  })
  mgr.setPending('x')
  assert.throws(() => mgr.flush())
})

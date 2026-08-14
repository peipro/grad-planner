// State Sync 辅助单元测试（Phase 1B-2）
// classifyStorageChange：fs.watch 事件分类（内容 hash 判断，非时间窗口）

const test = require('node:test')
const assert = require('node:assert')
const { classifyStorageChange } = require('./state-sync.cjs')

test('文件不存在/不可读 → skip（不广播）', () => {
  assert.deepStrictEqual(classifyStorageChange({ hash: null, lastWrittenHash: 'abc' }), { action: 'skip', reason: 'no-file' })
  assert.deepStrictEqual(classifyStorageChange({ hash: undefined, lastWrittenHash: 'abc' }), { action: 'skip', reason: 'no-file' })
})

test('hash 与自己最近写盘一致 → self-write（mutation persist 已走 state-sync 广播，跳过）', () => {
  const r = classifyStorageChange({ hash: 'h1', lastWrittenHash: 'h1' })
  assert.strictEqual(r.action, 'self-write')
})

test('hash 不同（或 lastWrittenHash 未知）→ external（需要重读权威并广播）', () => {
  assert.strictEqual(classifyStorageChange({ hash: 'h2', lastWrittenHash: 'h1' }).action, 'external')
  // lastWrittenHash 尚未初始化（启动时文件就存在但从未自写）→ 保守视为外部？不：
  // 启动时 lastWrittenHash 会被初始化为文件 hash，因此此分支只在文件启动后被外部修改时出现
  assert.strictEqual(classifyStorageChange({ hash: 'h3', lastWrittenHash: null }).action, 'external')
})

test('自写后外部再写：最后一个 hash 决定分类（覆盖写，无时间窗口）', () => {
  // 自写 W1 → hash h1；外部写 W2 → hash h2 → external
  let cls = classifyStorageChange({ hash: 'h2', lastWrittenHash: 'h1' })
  assert.strictEqual(cls.action, 'external')
  // 更新 lastWrittenHash 为 h2 后，同一内容再次事件 → self-write（防重复广播）
  cls = classifyStorageChange({ hash: 'h2', lastWrittenHash: 'h2' })
  assert.strictEqual(cls.action, 'self-write')
})

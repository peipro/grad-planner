const test = require('node:test')
const assert = require('node:assert')
const { classifyWatchEvent } = require('./sync-watch.cjs')

test('Scenario E: 自己的写盘（writeId 匹配）→ 跳过，不触发同步循环', () => {
  const fileText = JSON.stringify({ schemaVersion: 1, revision: 5, deviceId: 'desktop-1', writeId: 'w-self-1', data: {} })
  const r = classifyWatchEvent({ fileText, lastWrittenWriteId: 'w-self-1' })
  assert.strictEqual(r.external, false)
  assert.strictEqual(r.reason, 'self-write')
})

test('Scenario F: 外部写入（writeId 不同）→ 识别为外部', () => {
  const fileText = JSON.stringify({ schemaVersion: 1, revision: 6, deviceId: 'tablet-2', writeId: 'w-tablet-1', data: {} })
  const r = classifyWatchEvent({ fileText, lastWrittenWriteId: 'w-self-1' })
  assert.strictEqual(r.external, true)
  assert.strictEqual(r.reason, 'external-write')
})

test('旧格式文件（无 writeId）→ 保守视为外部写入', () => {
  const legacy = JSON.stringify({ tasks: [] })
  const r = classifyWatchEvent({ fileText: legacy, lastWrittenWriteId: 'w-self-1' })
  assert.strictEqual(r.external, true)
  assert.strictEqual(r.reason, 'unknown-write')
})

test('无文件 / 非法 JSON → 不处理', () => {
  assert.strictEqual(classifyWatchEvent({ fileText: null, lastWrittenWriteId: 'w' }).external, false)
  assert.strictEqual(classifyWatchEvent({ fileText: 'not json', lastWrittenWriteId: 'w' }).external, false)
  assert.strictEqual(classifyWatchEvent({ fileText: '', lastWrittenWriteId: 'w' }).external, false)
})

test('writeId 相同但内容来自不同写入者（随机碰撞不可能，防御）→ 跳过', () => {
  const r = classifyWatchEvent({ fileText: JSON.stringify({ writeId: 'w-x', data: {} }), lastWrittenWriteId: 'w-x' })
  assert.strictEqual(r.external, false)
})

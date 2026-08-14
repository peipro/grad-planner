// Phase 1B-3B · 同实体并发冲突检测测试（§24 Test A/B/C/D/E/G/I）
// 验证 entity.version + baseVersion 语义：stale mutation → conflict，绝不静默覆盖。

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createMutationEngine, ERROR_CODES } = require('./mutation-engine.cjs')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conflict-'))
  return path.join(dir, 'sync', 'grad-planner-storage.json')
}

function task(id, overrides = {}) {
  return { id, title: `T${id}`, priority: 'medium', status: 'todo', createdAt: 'x', version: 1, ...overrides }
}

function note(id, overrides = {}) {
  return { id, title: `N${id}`, content: 'c', tags: [], createdAt: 'x', updatedAt: 'x', version: 1, ...overrides }
}

// Test A：正常 update（baseVersion 匹配 → 成功，version + 1）
test('Test A：update baseVersion=actualVersion → 成功，newVersion = actual+1', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: task('t1', { version: 5 }) }])
  const r = engine.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: 'T1v6' }), baseVersion: 5 }])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(engine.getState().tasks[0].version, 6)
  assert.strictEqual(engine.getState().tasks[0].title, 'T1v6')
})

// Test B：stale update → conflict（不 persist、不 state-sync、不广播）
test('Test B：stale update（base=5 actual=6）→ conflict，磁盘不变，onPersisted 不回调', () => {
  const file = tmpFile()
  const persistedEvents = []
  const engine = createMutationEngine({
    storageFile: file,
    onPersisted: (st) => persistedEvents.push(st),
  })
  engine.applyMutations([{ type: 'task.create', payload: task('t1', { version: 5 }) }])
  engine.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: 'v6' }), baseVersion: 5 }]) // → version 6
  const before = fs.readFileSync(file, 'utf-8')
  persistedEvents.length = 0

  const r = engine.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: 'stale' }), baseVersion: 5 }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'conflict')
  assert.strictEqual(r.entityType, 'task')
  assert.strictEqual(r.entityId, 't1')
  assert.strictEqual(r.expectedVersion, 5)
  assert.strictEqual(r.actualVersion, 6)
  assert.ok(r.currentEntity && r.currentEntity.title === 'v6')
  // NO PERSIST / NO STATE-SYNC
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), before, 'conflict 不得写盘')
  assert.strictEqual(persistedEvents.length, 0, 'conflict 不得广播 state-sync')
  // 权威未被篡改
  assert.strictEqual(engine.getState().tasks[0].title, 'v6')
  assert.strictEqual(engine.getState().tasks[0].version, 6)
})

// Test C：同实体双客户端（Desktop v5→v6，Tablet baseVersion=5 → conflict）
test('Test C：同实体双客户端 — 先到成功，后到 conflict', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: task('t1', { version: 5 }) }])
  // Desktop 提交
  const desk = engine.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: 'desktop' }), baseVersion: 5 }])
  assert.strictEqual(desk.ok, true)
  assert.strictEqual(engine.getState().tasks[0].version, 6)
  // Tablet 基于旧版本提交
  const tab = engine.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: 'tablet' }), baseVersion: 5 }])
  assert.strictEqual(tab.ok, false)
  assert.strictEqual(tab.error, 'conflict')
  // 权威保持 Desktop 结果
  assert.strictEqual(engine.getState().tasks[0].title, 'desktop')
})

// Test D：不同实体并发 → 双方均成功（互不冲突）
test('Test D：不同实体并发（Task base=5 + Note base=8）→ 都成功', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'task.create', payload: task('t1', { version: 5 }) },
    { type: 'note.create', payload: note('n1', { version: 8 }) },
  ])
  const r = engine.applyMutations([
    { type: 'task.update', id: 't1', entity: task('t1', { title: 'T改' }), baseVersion: 5 },
    { type: 'note.update', id: 'n1', entity: note('n1', { title: 'N改' }), baseVersion: 8 },
  ])
  assert.strictEqual(r.ok, true)
  const st = engine.getState()
  assert.strictEqual(st.tasks[0].title, 'T改')
  assert.strictEqual(st.tasks[0].version, 6)
  assert.strictEqual(st.notes[0].title, 'N改')
  assert.strictEqual(st.notes[0].version, 9)
})

// Test E：delete conflict（actual=8 base=7 → conflict，不删除）
test('Test E：delete 版本检查 — stale delete → conflict，实体保留', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: task('t1', { version: 7 }) }])
  engine.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: 'v8' }), baseVersion: 7 }]) // → 8
  const before = fs.readFileSync(file, 'utf-8')
  const r = engine.applyMutations([{ type: 'task.delete', id: 't1', baseVersion: 7 }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'conflict')
  assert.strictEqual(r.actualVersion, 8)
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), before, 'conflict 不写盘')
  assert.strictEqual(engine.getState().tasks.length, 1, '实体未被删除')
})

test('delete 版本匹配（base=actual）→ 成功删除', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: task('t1', { version: 3 }) }])
  const r = engine.applyMutations([{ type: 'task.delete', id: 't1', baseVersion: 3 }])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(engine.getState().tasks.length, 0)
})

// Test G：batch 内任一 conflict → 整个 batch 不持久化（原子性保持）
test('Test G：batch 中一个 conflict → 全部不持久化', () => {
  const file = tmpFile()
  const persistedEvents = []
  const engine = createMutationEngine({ storageFile: file, onPersisted: (st) => persistedEvents.push(st) })
  engine.applyMutations([
    { type: 'task.create', payload: task('t1', { version: 3 }) },
    { type: 'note.create', payload: note('n1', { version: 3 }) },
  ])
  engine.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: 'v4' }), baseVersion: 3 }]) // t1 → 4
  const before = fs.readFileSync(file, 'utf-8')
  persistedEvents.length = 0

  // batch: [task.update(n1 成功), note.update(t1 stale → conflict)]
  const r = engine.applyMutations([
    { type: 'note.update', id: 'n1', entity: note('n1', { title: 'N改' }), baseVersion: 3 },
    { type: 'task.update', id: 't1', entity: task('t1', { title: 'stale' }), baseVersion: 3 },
  ])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'conflict')
  assert.strictEqual(r.failedIndex, 1)
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), before, 'batch 全部不写盘')
  assert.strictEqual(persistedEvents.length, 0, 'batch 全部不广播')
  assert.strictEqual(engine.getState().notes[0].title, 'Nn1', '前面的 note.update 也未持久化')
})

// Test I：旧数据 migration（无 version → 视为 1，首次 update 正常 + 版本初始化）
test('Test I：旧数据无 version → 正常读取，首次 update 成功且 version 初始化', () => {
  const file = tmpFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // 旧格式：task 无 version 字段
  fs.writeFileSync(file, JSON.stringify({ state: { tasks: [{ id: 'old1', title: '旧任务', priority: 'medium', status: 'todo', createdAt: 'x' }] }, version: 0 }))
  const engine = createMutationEngine({ storageFile: file })
  assert.strictEqual(engine.getState().tasks[0].version, undefined) // 旧数据原样（惰性迁移）
  // 首次 update（旧客户端不带 baseVersion → 无版本检查，兼容）
  const r1 = engine.applyMutations([{ type: 'task.update', id: 'old1', entity: { id: 'old1', title: '旧任务-改', priority: 'medium', status: 'doing', createdAt: 'x' } }])
  assert.strictEqual(r1.ok, true)
  // 版本初始化：缺失视为 1，update 后 version = 2
  assert.strictEqual(engine.getState().tasks[0].version, 2)
  // 之后带 baseVersion 的 update 正常工作
  const r2 = engine.applyMutations([{ type: 'task.update', id: 'old1', entity: { id: 'old1', title: '旧任务-改2', priority: 'medium', status: 'done', createdAt: 'x', version: 2 }, baseVersion: 2 }])
  assert.strictEqual(r2.ok, true)
  assert.strictEqual(engine.getState().tasks[0].version, 3)
})

test('新客户端带 baseVersion 更新旧数据（无 version 视为 1）→ base=1 成功', () => {
  const file = tmpFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ state: { tasks: [{ id: 'old1', title: '旧', priority: 'medium', status: 'todo', createdAt: 'x' }] }, version: 0 }))
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'task.update', id: 'old1', entity: { id: 'old1', title: '新', priority: 'medium', status: 'todo', createdAt: 'x' }, baseVersion: 1 }])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(engine.getState().tasks[0].version, 2)
})

test('create → version = 1（缺失时）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: { id: 't1', title: 'T', priority: 'medium', status: 'todo', createdAt: 'x' } }])
  assert.strictEqual(engine.getState().tasks[0].version, 1)
})

test('conflict 后 version 不变；validation/persistence failure 不产生假推进', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: task('t1', { version: 4 }) }])
  // conflict：不变
  engine.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: 'x' }), baseVersion: 3 }])
  assert.strictEqual(engine.getState().tasks[0].version, 4)
  // validation failure：不变
  engine.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: '' }), baseVersion: 4 }])
  assert.strictEqual(engine.getState().tasks[0].version, 4)
  // persistence failure：不产生假成功（working copy 丢弃）
  const engine2 = createMutationEngine({ storageFile: file, write: () => ({ ok: false, error: 'disk' }) })
  const r = engine2.applyMutations([{ type: 'task.update', id: 't1', entity: task('t1', { title: 'v5' }), baseVersion: 4 }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.PERSISTENCE_FAILURE)
  assert.strictEqual(engine.getState().tasks[0].version, 4) // 磁盘未变
})

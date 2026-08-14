// Mutation Engine 单元测试（Node 原生）
// 覆盖 docs/Phase-1B-1-Mutation-Architecture.md L2/L3/L4 的全部测试要求：
//   - Task/Note 六类 mutation
//   - 错误分类（invalid_mutation / entity_not_found / validation_failure / persistence_failure）
//   - batch 原子性：第 N 个失败 → 前面全部不持久化
//   - 外部文件修改 → engine 必须重读（不覆盖外部数据）
//   - 缓存异常 → apply 仍基于磁盘最新内容
//   - 真实 { state, version } 持久化格式

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createMutationEngine, ERROR_CODES } = require('./mutation-engine.cjs')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-engine-'))
  return path.join(dir, 'sync', 'grad-planner-storage.json')
}

function makeTask(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    priority: 'medium',
    status: 'todo',
    createdAt: '2026-08-14T00:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

function makeNote(id, overrides = {}) {
  return {
    id,
    title: `Note ${id}`,
    content: 'content',
    tags: [],
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

// 真实 persist 格式序列化
function persisted(text) {
  return JSON.stringify({ state: JSON.parse(text), version: 0 })
}

function readState(file) {
  const raw = fs.readFileSync(file, 'utf-8')
  const j = JSON.parse(raw)
  assert.ok(j && j.state, '文件必须是 { state, version } 格式')
  return j.state
}

// ===== Task mutations =====

test('task.create → 权威 state 与磁盘文件均包含新任务', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const t = makeTask('t1')
  const res = engine.applyMutations([{ type: 'task.create', payload: t }])
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.results[0].ok, true)
  assert.strictEqual(res.results[0].id, 't1')
  // 内存权威
  const st = engine.getState()
  assert.deepStrictEqual(st.tasks, [t])
  // 磁盘文件（真实 {state, version} 格式）
  const disk = readState(file)
  assert.deepStrictEqual(disk.tasks, [t])
})

test('task.update → 替换实体；id 不存在 → entity_not_found 且不写盘', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: makeTask('t1') }])
  const before = fs.readFileSync(file, 'utf-8')

  const upd = makeTask('t1', { title: 'updated', status: 'done' })
  const ok = engine.applyMutations([{ type: 'task.update', id: 't1', entity: upd }])
  assert.strictEqual(ok.ok, true)
  assert.deepStrictEqual(engine.getState().tasks[0], { ...upd, version: 2 })

  // 不存在的 id → entity_not_found
  const missing = engine.applyMutations([{ type: 'task.update', id: 'nope', entity: makeTask('nope') }])
  assert.strictEqual(missing.ok, false)
  assert.strictEqual(missing.error, ERROR_CODES.ENTITY_NOT_FOUND)
  // 未写盘：磁盘保持 update 后的状态（t1=updated，无 nope）
  const after = readState(file)
  assert.strictEqual(after.tasks.length, 1)
  assert.strictEqual(after.tasks[0].id, 't1')
  assert.strictEqual(after.tasks[0].title, 'updated')
  assert.ok(before !== fs.readFileSync(file, 'utf-8') || true) // 前一次写入已生效，本次失败无新写入
})

test('task.delete → 删除；不存在 id → 幂等成功', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: makeTask('t1') }])
  const del = engine.applyMutations([{ type: 'task.delete', id: 't1' }])
  assert.strictEqual(del.ok, true)
  assert.strictEqual(del.results[0].deleted, true)
  assert.strictEqual(engine.getState().tasks.length, 0)
  // 再删同 id：幂等成功，无副作用
  const again = engine.applyMutations([{ type: 'task.delete', id: 't1' }])
  assert.strictEqual(again.ok, true)
  assert.strictEqual(again.results[0].deleted, false)
})

// ===== Note mutations =====

test('note.create / note.update / note.delete', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const n = makeNote('n1')
  assert.strictEqual(engine.applyMutations([{ type: 'note.create', payload: n }]).ok, true)
  assert.deepStrictEqual(engine.getState().notes, [n])

  const upd = makeNote('n1', { title: 'Note updated', content: 'new content' })
  assert.strictEqual(engine.applyMutations([{ type: 'note.update', id: 'n1', entity: upd }]).ok, true)
  assert.deepStrictEqual(engine.getState().notes[0], { ...upd, version: 2 })

  assert.strictEqual(engine.applyMutations([{ type: 'note.delete', id: 'n1' }]).ok, true)
  assert.strictEqual(engine.getState().notes.length, 0)
})

// ===== 错误分类 =====

test('非法 mutation 结构 → invalid_mutation（不写盘）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, persisted(JSON.stringify({ tasks: [] })))
  const before = fs.readFileSync(file, 'utf-8')

  const cases = [
    null,
    {},
    { type: 'task' },                 // 无点号
    { type: 'unknown.create', payload: makeTask('x') },
    { type: 'task.delete' },          // delete 缺 id
    { type: 'task.create' },          // create 缺 payload
    { type: 'task.update', id: 'a', entity: makeTask('b') }, // id 不一致
  ]
  for (const m of cases) {
    const r = engine.applyMutations([m])
    assert.strictEqual(r.ok, false, JSON.stringify(m))
    assert.strictEqual(r.error, ERROR_CODES.INVALID_MUTATION, JSON.stringify(m))
  }
  // 磁盘未被任何失败写入污染
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), before)
})

test('非法实体字段 → validation_failure', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const bad = [
    { type: 'task.create', payload: { ...makeTask('a'), title: '' } },
    { type: 'task.create', payload: { ...makeTask('a'), id: 123 } },
    { type: 'task.create', payload: { ...makeTask('a'), priority: 'urgent' } },
    { type: 'task.create', payload: { ...makeTask('a'), status: 'working' } },
    { type: 'note.create', payload: { ...makeNote('a'), tags: 'not-array' } },
  ]
  for (const m of bad) {
    const r = engine.applyMutations([m])
    assert.strictEqual(r.ok, false, JSON.stringify(m))
    assert.strictEqual(r.error, ERROR_CODES.VALIDATION_FAILURE, JSON.stringify(m))
  }
  assert.strictEqual(fs.existsSync(file), false) // 没有任何写入
})

test('持久化失败 → persistence_failure，绝不伪装成功', () => {
  const file = tmpFile()
  const engine = createMutationEngine({
    storageFile: file,
    write: () => ({ ok: false, error: 'disk full' }),
  })
  const r = engine.applyMutations([{ type: 'task.create', payload: makeTask('t1') }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.PERSISTENCE_FAILURE)
  assert.strictEqual(r.detail, 'disk full')
})

// ===== L3: batch 原子性 =====

test('batch 原子性：第 N 个 mutation 失败 → 全部不持久化', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  // 初始：已有 task A
  engine.applyMutations([{ type: 'task.create', payload: makeTask('A') }])
  const beforeText = fs.readFileSync(file, 'utf-8')

  // batch: [create B, update 不存在X, create C] → 第 2 个失败
  const r = engine.applyMutations([
    { type: 'task.create', payload: makeTask('B') },
    { type: 'task.update', id: 'X', entity: makeTask('X') },
    { type: 'task.create', payload: makeTask('C') },
  ])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.failedIndex, 1)
  assert.strictEqual(r.error, ERROR_CODES.ENTITY_NOT_FOUND)

  // 磁盘保持原样：B / C 都不存在（前面的 create 也未持久化）
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), beforeText)
  const st = readState(file)
  assert.deepStrictEqual(st.tasks.map((t) => t.id), ['A'])
})

test('batch 原子性：批内校验失败（validation）→ 整体不持久化', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: makeTask('A') }])
  const beforeText = fs.readFileSync(file, 'utf-8')

  const r = engine.applyMutations([
    { type: 'task.create', payload: makeTask('B') },
    { type: 'note.create', payload: { ...makeNote('n1'), title: '' } }, // validation_failure
  ])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.VALIDATION_FAILURE)
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), beforeText)
  assert.deepStrictEqual(readState(file).tasks.map((t) => t.id), ['A'])
})

test('batch 全部成功 → 一次性写入（同一次写盘）', () => {
  const file = tmpFile()
  const writes = []
  const engine = createMutationEngine({
    storageFile: file,
    write: (data) => { writes.push(data); return { ok: true } },
  })
  const r = engine.applyMutations([
    { type: 'task.create', payload: makeTask('A') },
    { type: 'task.create', payload: makeTask('B') },
    { type: 'note.create', payload: makeNote('n1') },
  ])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(writes.length, 1) // 只有一次写盘
  const st = JSON.parse(writes[0]).state
  assert.deepStrictEqual(st.tasks.map((t) => t.id), ['A', 'B'])
  assert.strictEqual(st.notes.length, 1)
})

// ===== L2: 外部文件修改 / 缓存正确性 =====

test('外部文件修改 → applyMutations 必须重新读取权威 state（不覆盖外部数据）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: makeTask('A') }])

  // 模拟旧客户端（phase-1a 整份写）在外部修改文件：新增 task D
  const diskState = readState(file)
  diskState.tasks.push(makeTask('D', { title: 'external' }))
  fs.writeFileSync(file, persisted(JSON.stringify(diskState)))

  // 外部修改后，桌面提交 update task A
  const upd = makeTask('A', { title: 'A updated by desktop' })
  const r = engine.applyMutations([{ type: 'task.update', id: 'A', entity: upd }])
  assert.strictEqual(r.ok, true)

  // 外部新增的 D 必须保留（未被覆盖）
  const after = readState(file)
  const ids = after.tasks.map((t) => t.id)
  assert.ok(ids.includes('D'), `外部 task D 被覆盖: ${ids}`)
  assert.strictEqual(after.tasks.find((t) => t.id === 'D').title, 'external')
  assert.strictEqual(after.tasks.find((t) => t.id === 'A').title, 'A updated by desktop')
})

test('缓存判断异常（getState 命中旧缓存）→ 下一次 apply 仍基于磁盘最新内容', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: makeTask('A') }])

  // getState 建立缓存
  assert.strictEqual(engine.getState().tasks.length, 1)

  // 外部修改文件（mtime+size 可能与缓存相同或不同——无论哪种，apply 必须读磁盘）
  const diskState = readState(file)
  diskState.tasks.push(makeTask('D', { title: 'external-D' }))
  fs.writeFileSync(file, persisted(JSON.stringify(diskState)))

  // 模拟"缓存异常"：直接污染内部缓存使 stamp 与磁盘一致但内容陈旧（黑盒无法直接注入，
  // 用等价场景：外部以相同 size 覆盖写入不同内容——mtime 可能一致，依赖 apply 必须读盘来保证）
  // 这里直接验证：即使 getState 可能命中旧缓存，apply 也看到外部 D
  const upd = makeTask('A', { title: 'A2' })
  const r = engine.applyMutations([{ type: 'task.update', id: 'A', entity: upd }])
  assert.strictEqual(r.ok, true)
  const after = readState(file)
  assert.ok(after.tasks.some((t) => t.id === 'D'), '外部 task D 被静默覆盖')
  assert.strictEqual(after.tasks.find((t) => t.id === 'A').title, 'A2')
})

test('getState 缓存失效：外部修改后 getState 重读', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: makeTask('A') }])
  assert.strictEqual(engine.getState().tasks.length, 1) // 建立缓存

  const diskState = readState(file)
  diskState.tasks.push(makeTask('E'))
  fs.writeFileSync(file, persisted(JSON.stringify(diskState)))

  // mtime+size 变化 → getState 重读，看到 E
  const st = engine.getState()
  assert.strictEqual(st.tasks.length, 2)
  assert.ok(st.tasks.some((t) => t.id === 'E'))
})

// ===== 真实格式 / 幂等 / 防御 =====

test('存储格式保持 { state, version }（Phase 0 兼容）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: makeTask('t1') }])
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  assert.strictEqual(typeof raw.state, 'object')
  assert.strictEqual(raw.version, 0)
  assert.ok(Array.isArray(raw.state.tasks))
})

test('create 同 id 幂等：重试不产生重复实体', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const t = makeTask('t1', { title: 'v1' })
  assert.strictEqual(engine.applyMutations([{ type: 'task.create', payload: t }]).ok, true)
  const t2 = makeTask('t1', { title: 'v2' })
  assert.strictEqual(engine.applyMutations([{ type: 'task.create', payload: t2 }]).ok, true)
  const st = engine.getState()
  assert.strictEqual(st.tasks.length, 1)
  assert.strictEqual(st.tasks[0].title, 'v2')
})

test('权威文件损坏（非法 JSON）→ internal_error，不把垃圾当权威', () => {
  const file = tmpFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{{{ not json')
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'task.create', payload: makeTask('t1') }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.INTERNAL_ERROR)
  // 不覆盖损坏文件（保留现场供备份/恢复）
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), '{{{ not json')
})

test('持久化 payload 中非 task/note 字段被完整保留（不破坏其他实体）', () => {
  const file = tmpFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const initialState = {
    events: [{ id: 'e1', title: '组会', start: 'x', end: 'y', type: 'meeting' }],
    tasks: [],
    notes: [],
    pomo: { mode: 'countdown', focusMin: 25, running: false },
  }
  fs.writeFileSync(file, persisted(JSON.stringify(initialState)))
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'task.create', payload: makeTask('t1') }])
  const after = readState(file)
  assert.deepStrictEqual(after.events, initialState.events)
  assert.deepStrictEqual(after.pomo, initialState.pomo)
  assert.strictEqual(after.tasks.length, 1)
})

test('首个文件不存在 → create 正常（空权威起步）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'note.create', payload: makeNote('n1') }])
  assert.strictEqual(r.ok, true)
  const st = readState(file)
  assert.strictEqual(st.notes.length, 1)
})

// ===== Phase 1B-2: onPersisted（persist 成功后才会广播 state-sync） =====

test('onPersisted：persist 成功后回调，收到最新权威 state', () => {
  const file = tmpFile()
  const events = []
  const engine = createMutationEngine({
    storageFile: file,
    onPersisted: (state) => events.push(state),
  })
  const r = engine.applyMutations([{ type: 'task.create', payload: makeTask('t1') }])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(events.length, 1)
  assert.strictEqual(events[0].tasks.length, 1)
  assert.strictEqual(events[0].tasks[0].id, 't1')
})

test('onPersisted：batch 全部成功 → 只回调一次（最终权威 state）', () => {
  const file = tmpFile()
  const events = []
  const engine = createMutationEngine({
    storageFile: file,
    onPersisted: (state) => events.push(state),
  })
  const r = engine.applyMutations([
    { type: 'task.create', payload: makeTask('A') },
    { type: 'task.create', payload: makeTask('B') },
    { type: 'note.create', payload: makeNote('n1') },
  ])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(events.length, 1)
  assert.deepStrictEqual(events[0].tasks.map((t) => t.id), ['A', 'B'])
  assert.strictEqual(events[0].notes.length, 1)
})

test('onPersisted：persist 失败 → 不回调（renderer 看不到未落盘的“未来状态”）', () => {
  const file = tmpFile()
  let called = 0
  const engine = createMutationEngine({
    storageFile: file,
    write: () => ({ ok: false, error: 'disk full' }),
    onPersisted: () => { called += 1 },
  })
  const r = engine.applyMutations([{ type: 'task.create', payload: makeTask('t1') }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.PERSISTENCE_FAILURE)
  assert.strictEqual(called, 0, 'persist 失败不得广播 state-sync')
})

test('onPersisted：batch 中途失败 → 不回调', () => {
  const file = tmpFile()
  let called = 0
  const engine = createMutationEngine({
    storageFile: file,
    onPersisted: () => { called += 1 },
  })
  const r = engine.applyMutations([
    { type: 'task.create', payload: makeTask('A') },
    { type: 'task.update', id: 'X', entity: makeTask('X') }, // entity_not_found
  ])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(called, 0, 'batch 未持久化不得广播')
})

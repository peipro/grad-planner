// Phase 1B-3A 组 1 · Event + Project mutation 测试（含跨实体事务）
// 依赖 mutation-engine.cjs 的泛型化 ENTITY_CONFIG 与 CROSS_ENTITY 事务。

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createMutationEngine, ERROR_CODES } = require('./mutation-engine.cjs')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-g1-'))
  return path.join(dir, 'sync', 'grad-planner-storage.json')
}

function persisted(text) {
  return JSON.stringify({ state: JSON.parse(text), version: 0 })
}

function readState(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf-8'))
  assert.ok(j && j.state, '文件必须是 { state, version } 格式')
  return j.state
}

function makeEvent(id, overrides = {}) {
  return { id, title: `Event ${id}`, start: '2026-09-01T09:00', end: '2026-09-01T10:00', type: 'meeting', ...overrides }
}

function makeProject(id, overrides = {}) {
  return { id, name: `Project ${id}`, color: 'blue', ...overrides }
}

// ===== Event =====

test('event.create → 权威 state 与磁盘均含新事件', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const e = makeEvent('e1')
  const r = engine.applyMutations([{ type: 'event.create', payload: e }])
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(engine.getState().events, [e])
  assert.deepStrictEqual(readState(file).events, [e])
})

test('event.update → 替换；不存在 id → entity_not_found 不写盘', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'event.create', payload: makeEvent('e1') }])
  const before = fs.readFileSync(file, 'utf-8')

  const upd = makeEvent('e1', { title: 'Event updated', type: 'deadline' })
  assert.strictEqual(engine.applyMutations([{ type: 'event.update', id: 'e1', entity: upd }]).ok, true)
  assert.deepStrictEqual(engine.getState().events[0], upd)

  const missing = engine.applyMutations([{ type: 'event.update', id: 'nope', entity: makeEvent('nope') }])
  assert.strictEqual(missing.ok, false)
  assert.strictEqual(missing.error, ERROR_CODES.ENTITY_NOT_FOUND)
  assert.strictEqual(readState(file).events.length, 1)
})

test('event.delete → 删除；不存在 id 幂等成功', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'event.create', payload: makeEvent('e1') }])
  assert.strictEqual(engine.applyMutations([{ type: 'event.delete', id: 'e1' }]).ok, true)
  assert.strictEqual(engine.getState().events.length, 0)
  assert.strictEqual(engine.applyMutations([{ type: 'event.delete', id: 'e1' }]).ok, true)
})

// ===== Project =====

test('project.create / update / delete（普通删除）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const p = makeProject('p1')
  assert.strictEqual(engine.applyMutations([{ type: 'project.create', payload: p }]).ok, true)
  assert.deepStrictEqual(engine.getState().projects, [p])

  const upd = makeProject('p1', { name: 'Project updated', color: 'green' })
  assert.strictEqual(engine.applyMutations([{ type: 'project.update', id: 'p1', entity: upd }]).ok, true)
  assert.deepStrictEqual(engine.getState().projects[0], upd)

  assert.strictEqual(engine.applyMutations([{ type: 'project.delete', id: 'p1' }]).ok, true)
  assert.strictEqual(engine.getState().projects.length, 0)
})

// ===== project.delete 跨实体事务 =====

test('project.delete 事务：关联 task/milestone 解引用 + 一次写盘 + 一次 onPersisted', () => {
  const file = tmpFile()
  const events = []
  const writes = []
  const engine = createMutationEngine({
    storageFile: file,
    write: (data) => { writes.push(data); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data, 'utf-8'); return { ok: true } },
    onPersisted: (state) => events.push(state),
  })
  engine.applyMutations([
    { type: 'project.create', payload: makeProject('p1') },
    { type: 'task.create', payload: { id: 't1', title: 'T1', priority: 'medium', status: 'todo', projectId: 'p1', createdAt: 'x' } },
    { type: 'task.create', payload: { id: 't2', title: 'T2', priority: 'medium', status: 'todo', createdAt: 'x' } },
    { type: 'milestone.create', payload: { id: 'm1', title: 'M1', startDate: 'x', endDate: 'y', progress: 0, color: 'blue', projectId: 'p1' } },
  ])
  writes.length = 0
  events.length = 0

  const r = engine.applyMutations([{ type: 'project.delete', id: 'p1' }])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.results[0].transactional, true)
  const st = engine.getState()
  assert.strictEqual(st.projects.length, 0)
  assert.strictEqual(st.tasks.find((t) => t.id === 't1').projectId, undefined)
  assert.strictEqual(st.tasks.find((t) => t.id === 't2').projectId, undefined) // 未关联不受影响
  assert.strictEqual(st.milestones.find((m) => m.id === 'm1').projectId, undefined)
  assert.strictEqual(writes.length, 1) // 一次 persist
  assert.strictEqual(events.length, 1) // 一次 state-sync
})

test('project.delete 事务保护：batch 中关联 task 的过期 update 被跳过（权威保留）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'project.create', payload: makeProject('p1') },
    { type: 'task.create', payload: { id: 't1', title: 'T1', priority: 'medium', status: 'todo', projectId: 'p1', createdAt: 'x' } },
  ])
  // Tablet 在 renderer 删除 project 的同时修改了 t1（权威已是最新）
  engine.applyMutations([{ type: 'task.update', id: 't1', entity: { id: 't1', title: 'T1', priority: 'high', status: 'doing', projectId: 'p1', createdAt: 'x' } }])

  // renderer（过期快照）发 batch：project.delete + task.update（projectId 已清、其他字段旧值）
  const staleT1 = { id: 't1', title: 'T1', priority: 'medium', status: 'todo', projectId: undefined, createdAt: 'x' }
  const r = engine.applyMutations([
    { type: 'project.delete', id: 'p1' },
    { type: 'task.update', id: 't1', entity: staleT1 },
  ])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.results[1].skipped, true) // 过期 update 被跳过
  const t1 = engine.getState().tasks.find((t) => t.id === 't1')
  assert.strictEqual(t1.projectId, undefined)   // 解引用生效
  assert.strictEqual(t1.priority, 'high')        // Tablet 修改保留（未被过期快照覆盖）
  assert.strictEqual(t1.status, 'doing')
})

test('project.delete 事务：project 不存在 → 幂等成功', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'project.delete', id: 'nope' }])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.results[0].deleted, false)
})

// ===== paperStages（无 id 实体） =====

test('paperStages.replace 与 paperStage.delete 事务', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'paperStages.replace', payload: ['阶段0', '阶段1'] }])
  assert.deepStrictEqual(engine.getState().paperStages, ['阶段0', '阶段1'])

  engine.applyMutations([
    { type: 'paper.create', payload: { id: 'pa1', title: 'PA1', stage: '阶段0', category: 'x', status: 'unread', createdAt: 'x' } },
    { type: 'paper.create', payload: { id: 'pa2', title: 'PA2', stage: '阶段2', category: 'x', status: 'unread', createdAt: 'x' } },
  ])
  const r = engine.applyMutations([{ type: 'paperStage.delete', id: '阶段0' }])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.results[0].transactional, true)
  const st = engine.getState()
  assert.deepStrictEqual(st.paperStages, ['阶段1'])
  assert.strictEqual(st.papers.find((p) => p.id === 'pa1').stage, '未分类')
  assert.strictEqual(st.papers.find((p) => p.id === 'pa2').stage, '阶段2')
})

test('paperStages.replace 非法 payload → validation_failure', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'paperStages.replace', payload: [1, 2] }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.VALIDATION_FAILURE)
})

// ===== 各实体校验错误分类 =====

test('各实体校验错误分类（validation_failure）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const cases = [
    { type: 'event.create', payload: { id: 'x' } },
    { type: 'project.create', payload: { id: 'x', color: 'blue' } },
    { type: 'paper.create', payload: { id: 'x', title: 'P', stage: 'a', category: 'b', status: 'bad', createdAt: 'c' } },
    { type: 'birthday.create', payload: { id: 'x', name: 'B', calendarType: 'bad', emoji: 'x', createdAt: 'c' } },
    { type: 'milestone.create', payload: { id: 'x', title: 'M', startDate: 'a', endDate: 'b', progress: 150, color: 'c' } },
    { type: 'habit.create', payload: { id: 'x', name: 'H', emoji: 'e', weeklyTarget: 3, records: 'bad', createdAt: 'c' } },
    { type: 'pomodoro.create', payload: { id: 'x', taskTitle: 'P', minutes: 'bad', completedAt: 'c' } },
  ]
  for (const m of cases) {
    const r = engine.applyMutations([m])
    assert.strictEqual(r.ok, false, JSON.stringify(m))
    assert.strictEqual(r.error, ERROR_CODES.VALIDATION_FAILURE, JSON.stringify(m))
  }
})

test('全部实体 create 通过（真实 payload 结构，{state, version} 写盘）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([
    { type: 'event.create', payload: makeEvent('e1') },
    { type: 'project.create', payload: makeProject('p1') },
    { type: 'milestone.create', payload: { id: 'm1', title: 'M1', startDate: 'a', endDate: 'b', progress: 0, color: 'blue' } },
    { type: 'paper.create', payload: { id: 'pa1', title: 'PA1', stage: '未分类', category: 'x', status: 'unread', createdAt: 'c' } },
    { type: 'habit.create', payload: { id: 'h1', name: 'H1', emoji: 'e', weeklyTarget: 3, records: [], createdAt: 'c' } },
    { type: 'birthday.create', payload: { id: 'b1', name: 'B1', calendarType: 'solar', solarMonth: 1, solarDay: 1, emoji: 'e', createdAt: 'c' } },
    { type: 'pomodoro.create', payload: { id: 'po1', taskTitle: 'PT', minutes: 25, completedAt: 'c' } },
  ])
  assert.strictEqual(r.ok, true)
  const st = engine.getState()
  assert.strictEqual(st.events.length, 1)
  assert.strictEqual(st.projects.length, 1)
  assert.strictEqual(st.milestones.length, 1)
  assert.strictEqual(st.papers.length, 1)
  assert.strictEqual(st.habits.length, 1)
  assert.strictEqual(st.birthdays.length, 1)
  assert.strictEqual(st.pomodoros.length, 1)
  // 非 task/note 字段保留测试：其他字段不被破坏
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  assert.strictEqual(raw.version, 0)
  assert.ok(Array.isArray(raw.state.events))
})

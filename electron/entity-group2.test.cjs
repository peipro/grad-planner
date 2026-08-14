// Phase 1B-3A 组 2 · Milestone / Paper / Habit / Birthday / Pomodoro mutation 测试
// engine 泛型化（ENTITY_CONFIG）已覆盖全部实体，本文件补充各实体 CRUD 专项 + 交叉实体测试。

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createMutationEngine, ERROR_CODES } = require('./mutation-engine.cjs')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-g2-'))
  return path.join(dir, 'sync', 'grad-planner-storage.json')
}

function makeMilestone(id, overrides = {}) {
  return { id, title: `M${id}`, startDate: '2026-09-01', endDate: '2026-10-01', progress: 0, color: 'blue', checkpoints: [], ...overrides }
}

function makePaper(id, overrides = {}) {
  return { id, title: `P${id}`, authors: 'a', year: 2026, stage: '未分类', category: '核心', status: 'unread', createdAt: 'x', ...overrides }
}

function makeHabit(id, overrides = {}) {
  return { id, name: `H${id}`, emoji: 'e', weeklyTarget: 3, records: [], createdAt: 'x', ...overrides }
}

function makeBirthday(id, overrides = {}) {
  return { id, name: `B${id}`, calendarType: 'solar', solarMonth: 1, solarDay: 1, emoji: 'e', createdAt: 'x', ...overrides }
}

function makePomodoro(id, overrides = {}) {
  return { id, taskTitle: `Pomo ${id}`, minutes: 25, completedAt: '2026-09-01T10:00:00.000Z', ...overrides }
}

// ===== Milestone =====

test('milestone.create / update / delete', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const m = makeMilestone('m1')
  assert.strictEqual(engine.applyMutations([{ type: 'milestone.create', payload: m }]).ok, true)
  assert.deepStrictEqual(engine.getState().milestones, [m])

  const upd = makeMilestone('m1', { title: 'M1 updated', progress: 50, checkpoints: [{ id: 'c1', title: 'cp', done: false }] })
  assert.strictEqual(engine.applyMutations([{ type: 'milestone.update', id: 'm1', entity: upd }]).ok, true)
  assert.deepStrictEqual(engine.getState().milestones[0], upd)

  const missing = engine.applyMutations([{ type: 'milestone.update', id: 'nope', entity: makeMilestone('nope') }])
  assert.strictEqual(missing.ok, false)
  assert.strictEqual(missing.error, ERROR_CODES.ENTITY_NOT_FOUND)

  assert.strictEqual(engine.applyMutations([{ type: 'milestone.delete', id: 'm1' }]).ok, true)
  assert.strictEqual(engine.getState().milestones.length, 0)
})

test('milestone progress 是事实字段：越界 → validation_failure；合法值保留', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'milestone.create', payload: makeMilestone('m1', { progress: 101 }) }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.VALIDATION_FAILURE)
  assert.strictEqual(engine.applyMutations([{ type: 'milestone.create', payload: makeMilestone('m1', { progress: 42 }) }]).ok, true)
  assert.strictEqual(engine.getState().milestones[0].progress, 42)
})

// ===== Paper =====

test('paper.create / update / delete（含 stage 字段与 paperStages 关联）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'paperStages.replace', payload: ['阶段0', '阶段1'] }])
  const p = makePaper('p1', { stage: '阶段0' })
  assert.strictEqual(engine.applyMutations([{ type: 'paper.create', payload: p }]).ok, true)
  assert.deepStrictEqual(engine.getState().papers, [p])

  const upd = makePaper('p1', { stage: '阶段1', status: 'reading' })
  assert.strictEqual(engine.applyMutations([{ type: 'paper.update', id: 'p1', entity: upd }]).ok, true)
  assert.deepStrictEqual(engine.getState().papers[0], upd)

  assert.strictEqual(engine.applyMutations([{ type: 'paper.delete', id: 'p1' }]).ok, true)
  assert.strictEqual(engine.getState().papers.length, 0)
  // paperStages 不受 paper.delete 影响
  assert.deepStrictEqual(engine.getState().paperStages, ['阶段0', '阶段1'])
})

test('paper status 非法 → validation_failure', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'paper.create', payload: makePaper('p1', { status: 'bad' }) }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.VALIDATION_FAILURE)
})

test('批量 paper update（batchSetPaperStatus 语义）→ 一次 batch 原子', () => {
  const file = tmpFile()
  const writes = []
  const engine = createMutationEngine({
    storageFile: file,
    write: (data) => { writes.push(data); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data, 'utf-8'); return { ok: true } },
  })
  engine.applyMutations([
    { type: 'paper.create', payload: makePaper('a') },
    { type: 'paper.create', payload: makePaper('b') },
    { type: 'paper.create', payload: makePaper('c') },
  ])
  writes.length = 0
  const r = engine.applyMutations([
    { type: 'paper.update', id: 'a', entity: makePaper('a', { status: 'reading' }) },
    { type: 'paper.update', id: 'b', entity: makePaper('b', { status: 'reading' }) },
    { type: 'paper.update', id: 'c', entity: makePaper('c', { status: 'read' }) },
  ])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(writes.length, 1)
  assert.deepStrictEqual(engine.getState().papers.map((p) => p.status), ['reading', 'reading', 'read'])
})

// ===== Habit =====

test('habit.create / update / delete（records 数组字段）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const h = makeHabit('h1')
  assert.strictEqual(engine.applyMutations([{ type: 'habit.create', payload: h }]).ok, true)
  assert.deepStrictEqual(engine.getState().habits, [h])

  const upd = makeHabit('h1', { records: ['2026-09-01', '2026-09-02'], weeklyTarget: 5 })
  assert.strictEqual(engine.applyMutations([{ type: 'habit.update', id: 'h1', entity: upd }]).ok, true)
  assert.deepStrictEqual(engine.getState().habits[0], upd)

  assert.strictEqual(engine.applyMutations([{ type: 'habit.delete', id: 'h1' }]).ok, true)
  assert.strictEqual(engine.getState().habits.length, 0)
})

test('habit records 非法（非数组）→ validation_failure', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'habit.create', payload: makeHabit('h1', { records: 'bad' }) }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.VALIDATION_FAILURE)
})

// ===== Birthday =====

test('birthday.create / update / delete（农历/公历类型）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const b = makeBirthday('b1', { calendarType: 'lunar', lunarMonth: 8, lunarDay: 15 })
  assert.strictEqual(engine.applyMutations([{ type: 'birthday.create', payload: b }]).ok, true)
  assert.deepStrictEqual(engine.getState().birthdays, [b])

  const upd = makeBirthday('b1', { name: 'B1 改名', emoji: '🎂' })
  assert.strictEqual(engine.applyMutations([{ type: 'birthday.update', id: 'b1', entity: upd }]).ok, true)

  assert.strictEqual(engine.applyMutations([{ type: 'birthday.delete', id: 'b1' }]).ok, true)
  assert.strictEqual(engine.getState().birthdays.length, 0)
})

test('birthday calendarType 非法 → validation_failure', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'birthday.create', payload: makeBirthday('b1', { calendarType: 'bad' }) }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.VALIDATION_FAILURE)
})

// ===== Pomodoro =====

test('pomodoro.create / delete（业务无 update）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const p = makePomodoro('p1')
  assert.strictEqual(engine.applyMutations([{ type: 'pomodoro.create', payload: p }]).ok, true)
  assert.deepStrictEqual(engine.getState().pomodoros, [p])
  assert.strictEqual(engine.applyMutations([{ type: 'pomodoro.delete', id: 'p1' }]).ok, true)
  assert.strictEqual(engine.getState().pomodoros.length, 0)
})

test('pomodoro minutes 非法 → validation_failure', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([{ type: 'pomodoro.create', payload: makePomodoro('p1', { minutes: 'bad' }) }])
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, ERROR_CODES.VALIDATION_FAILURE)
})

// ===== 交叉实体（§19） =====

test('Project → Milestone：修改 Project 不影响 Milestone 关联；Milestone 引用存在 projectId 保留', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'project.create', payload: { id: 'p1', name: 'P1', color: 'blue' } },
    { type: 'milestone.create', payload: makeMilestone('m1', { projectId: 'p1' }) },
  ])
  // 改 Project 名称
  assert.strictEqual(engine.applyMutations([{ type: 'project.update', id: 'p1', entity: { id: 'p1', name: 'P1 改名', color: 'blue' } }]).ok, true)
  const st = engine.getState()
  assert.strictEqual(st.projects[0].name, 'P1 改名')
  assert.strictEqual(st.milestones[0].projectId, 'p1') // 关联仍正确
})

test('Task → Pomodoro：Pomodoro 的 taskId 引用保留', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'task.create', payload: { id: 't1', title: 'T1', priority: 'medium', status: 'todo', createdAt: 'x' } },
    { type: 'pomodoro.create', payload: makePomodoro('p1', { taskId: 't1' }) },
  ])
  assert.strictEqual(engine.getState().pomodoros[0].taskId, 't1')
})

test('Birthday → Calendar：birthday create/update 后权威状态正确（Calendar 只读展示）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([{ type: 'birthday.create', payload: makeBirthday('b1', { name: '张三' }) }])
  engine.applyMutations([{ type: 'birthday.update', id: 'b1', entity: makeBirthday('b1', { name: '张三', emoji: '🎂' }) }])
  assert.strictEqual(engine.getState().birthdays[0].name, '张三')
  assert.strictEqual(engine.getState().birthdays[0].emoji, '🎂')
})

test('Habit → Stats：records 派生统计的基础数据正确同步', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'habit.create', payload: makeHabit('h1', { records: ['2026-09-01'] }) },
    { type: 'habit.update', id: 'h1', entity: makeHabit('h1', { records: ['2026-09-01', '2026-09-02', '2026-09-03'] }) },
  ])
  const h = engine.getState().habits[0]
  assert.strictEqual(h.records.length, 3) // 统计可由 records 派生
  assert.strictEqual(h.weeklyTarget, 3)
})

test('不同实体并发：Desktop 改 Paper + Tablet 改 Milestone → 两者都保留（互不覆盖）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'paper.create', payload: makePaper('pa1') },
    { type: 'milestone.create', payload: makeMilestone('m1') },
  ])
  // Desktop（IPC 等价）改 Paper
  assert.strictEqual(engine.applyMutations([{ type: 'paper.update', id: 'pa1', entity: makePaper('pa1', { status: 'reading' }) }]).ok, true)
  // Tablet（HTTP 等价，同引擎串行）改 Milestone
  assert.strictEqual(engine.applyMutations([{ type: 'milestone.update', id: 'm1', entity: makeMilestone('m1', { progress: 80 }) }]).ok, true)
  const st = engine.getState()
  assert.strictEqual(st.papers[0].status, 'reading')
  assert.strictEqual(st.milestones[0].progress, 80)
})

test('持久化 payload 完整保留全部实体（组 2 全量写入 {state, version}）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  const r = engine.applyMutations([
    { type: 'paper.create', payload: makePaper('pa1') },
    { type: 'milestone.create', payload: makeMilestone('m1') },
    { type: 'habit.create', payload: makeHabit('h1') },
    { type: 'birthday.create', payload: makeBirthday('b1') },
    { type: 'pomodoro.create', payload: makePomodoro('po1') },
  ])
  assert.strictEqual(r.ok, true)
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  assert.strictEqual(raw.version, 0)
  assert.strictEqual(raw.state.papers.length, 1)
  assert.strictEqual(raw.state.milestones.length, 1)
  assert.strictEqual(raw.state.habits.length, 1)
  assert.strictEqual(raw.state.birthdays.length, 1)
  assert.strictEqual(raw.state.pomodoros.length, 1)
})

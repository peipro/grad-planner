// Phase 2A · 研究关系删除解引用测试
// paper.delete / project.delete / note.delete 在权威侧原子解除关系数组引用（内容保留）。

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createMutationEngine, ERROR_CODES } = require('./mutation-engine.cjs')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
  return path.join(dir, 'sync', 'grad-planner-storage.json')
}

function paper(id, o = {}) {
  return { id, title: `P${id}`, stage: '未分类', category: 'x', status: 'unread', createdAt: 'x', version: 1, ...o }
}

function note(id, o = {}) {
  return { id, title: `N${id}`, content: 'c', tags: [], createdAt: 'x', updatedAt: 'x', version: 1, ...o }
}

function project(id, o = {}) {
  return { id, name: `Proj${id}`, color: 'blue', version: 1, ...o }
}

test('删除 Paper → Note/Project 保留，paperIds 关联解除', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'paper.create', payload: paper('pa1') },
    { type: 'note.create', payload: note('n1', { paperIds: ['pa1'] }) },
    { type: 'project.create', payload: project('pj1', { paperIds: ['pa1'] }) },
  ])
  const r = engine.applyMutations([{ type: 'paper.delete', id: 'pa1', baseVersion: 1 }])
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.results[0].transactional, true)
  const st = engine.getState()
  assert.strictEqual(st.papers.length, 0)             // Paper 删除
  assert.strictEqual(st.notes.length, 1)              // Note 保留
  assert.deepStrictEqual(st.notes[0].paperIds, [])    // 关联解除
  assert.strictEqual(st.projects.length, 1)           // Project 保留
  assert.deepStrictEqual(st.projects[0].paperIds, []) // 关联解除
})

test('删除 Project → Paper/Note 保留，projectIds 关联解除（含原有 projectId 解引用）', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'project.create', payload: project('pj1') },
    { type: 'paper.create', payload: paper('pa1', { projectIds: ['pj1'] }) },
    { type: 'note.create', payload: note('n1', { projectIds: ['pj1'] }) },
    { type: 'task.create', payload: { id: 't1', title: 'T1', priority: 'medium', status: 'todo', projectId: 'pj1', createdAt: 'x' } },
  ])
  const r = engine.applyMutations([{ type: 'project.delete', id: 'pj1', baseVersion: 1 }])
  assert.strictEqual(r.ok, true)
  const st = engine.getState()
  assert.strictEqual(st.projects.length, 0)
  assert.strictEqual(st.papers.length, 1)
  assert.deepStrictEqual(st.papers[0].projectIds, [])
  assert.strictEqual(st.notes.length, 1)
  assert.deepStrictEqual(st.notes[0].projectIds, [])
  assert.strictEqual(st.tasks[0].projectId, undefined) // 原有单值解引用仍生效
})

test('删除 Note → Paper/Project 保留，noteIds 关联解除', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'note.create', payload: note('n1') },
    { type: 'paper.create', payload: paper('pa1', { noteIds: ['n1'] }) },
    { type: 'project.create', payload: project('pj1', { noteIds: ['n1'] }) },
  ])
  const r = engine.applyMutations([{ type: 'note.delete', id: 'n1', baseVersion: 1 }])
  assert.strictEqual(r.ok, true)
  const st = engine.getState()
  assert.strictEqual(st.notes.length, 0)
  assert.strictEqual(st.papers.length, 1)
  assert.deepStrictEqual(st.papers[0].noteIds, [])
  assert.strictEqual(st.projects.length, 1)
  assert.deepStrictEqual(st.projects[0].noteIds, [])
})

test('删除带版本的 Paper：baseVersion 匹配 → 删除；stale → conflict 且不解引用', () => {
  const file = tmpFile()
  const engine = createMutationEngine({ storageFile: file })
  engine.applyMutations([
    { type: 'paper.create', payload: paper('pa1') },
    { type: 'note.create', payload: note('n1', { paperIds: ['pa1'] }) },
  ])
  engine.applyMutations([{ type: 'paper.update', id: 'pa1', entity: paper('pa1', { status: 'reading' }), baseVersion: 1 }]) // v2
  const before = fs.readFileSync(file, 'utf-8')
  const r = engine.applyMutations([{ type: 'paper.delete', id: 'pa1', baseVersion: 1 }]) // stale
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'conflict')
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), before)
  assert.strictEqual(engine.getState().notes[0].paperIds.length, 1) // 未解引用
})

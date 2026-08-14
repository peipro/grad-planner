// 研途计划 · Mutation Engine（主进程权威写路径核心）
// Phase 1B-1：证明 Main Process 作为唯一 mutation authority 可可靠落地。
//
// 职责：
//   - 唯一权威 state 的读取与持久化（磁盘文件权威）
//   - 实体级 mutation 的校验 / 应用 / 批处理原子性 / 错误分类
//   - IPC 与 HTTP 两条通道共用同一个 engine 实例（单线程串行）
//
// 设计要点（docs/Phase-1B-1-Mutation-Architecture.md L2/L3/L4）：
//   - applyMutations 每次直接从磁盘读取权威 state（correctness 优先，不依赖缓存）
//   - getState 使用 mtime+size 作为读缓存失效提示（仅读优化，不影响写正确性）
//   - 一个 Mutation[] 批处理：working copy → 依次 apply → 任一失败整体不持久化 → 全部成功才一次性原子写
//   - 错误分类：invalid_mutation / entity_not_found / validation_failure / persistence_failure / internal_error
//   - 存储格式：{ state, version }（zustand persist 真实格式，Phase 0 兼容，不引入 envelope）

const fs = require('fs')
const path = require('path')
const { validateStorageShape } = require('./storage-schema.cjs')

const ERROR_CODES = {
  INVALID_MUTATION: 'invalid_mutation',
  ENTITY_NOT_FOUND: 'entity_not_found',
  VALIDATION_FAILURE: 'validation_failure',
  PERSISTENCE_FAILURE: 'persistence_failure',
  INTERNAL_ERROR: 'internal_error',
}

const TASK_PRIORITIES = ['high', 'medium', 'low']
const TASK_STATUSES = ['todo', 'doing', 'done']
const ENTITY_FIELDS = { task: 'tasks', note: 'notes' }

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}

// 实体关键字段校验（宽松：关键字段必须合法；可选字段若提供则必须类型正确）
// 与 src/types.ts 的 Task / Note 一致，不创建第二套模型。
function validateEntity(kind, entity) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return '实体必须是对象'
  if (!isNonEmptyString(entity.id)) return '实体缺少合法 id'
  if (!isNonEmptyString(entity.title)) return '实体缺少合法 title'
  if (kind === 'task') {
    if (entity.priority !== undefined && !TASK_PRIORITIES.includes(entity.priority)) return 'priority 非法'
    if (entity.status !== undefined && !TASK_STATUSES.includes(entity.status)) return 'status 非法'
    if (entity.subtasks !== undefined && !Array.isArray(entity.subtasks)) return 'subtasks 必须是数组'
  }
  if (kind === 'note') {
    if (entity.tags !== undefined && !Array.isArray(entity.tags)) return 'tags 必须是数组'
  }
  return null
}

// 原子写：tmp 文件 + rename（与 lan-server createStorageAccess 相同语义，崩溃/断电不损坏权威文件）
function atomicWrite(file, data) {
  let tmp = null
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, data, 'utf-8')
    fs.renameSync(tmp, file)
    return { ok: true }
  } catch (e) {
    if (tmp) {
      try { fs.unlinkSync(tmp) } catch {}
    }
    return { ok: false, error: String((e && e.message) || e) }
  }
}

function createMutationEngine({ storageFile, write }) {
  if (!storageFile) throw new Error('createMutationEngine: storageFile 必须提供')
  const persistWrite = typeof write === 'function' ? write : (data) => atomicWrite(storageFile, data)

  // getState 读缓存：mtime+size 作为失效提示（L2：仅读优化，写路径从不依赖缓存）
  let cache = { stamp: null, text: null }

  function statStamp() {
    try {
      const st = fs.statSync(storageFile)
      return `${st.mtimeMs}:${st.size}`
    } catch {
      return 'missing'
    }
  }

  function readDisk() {
    let text = null
    try {
      text = fs.readFileSync(storageFile, 'utf-8')
    } catch {}
    return text
  }

  // 解析 { state, version }（zustand persist 真实格式）。非法结构 → invalid:true（防御，不把垃圾当权威）
  function parsePersisted(text) {
    if (text === null || text === undefined) return { state: null, version: 0, invalid: false }
    try {
      const j = JSON.parse(text)
      if (j && typeof j === 'object' && !Array.isArray(j) && j.state && typeof j.state === 'object' && !Array.isArray(j.state)) {
        return { state: j.state, version: typeof j.version === 'number' ? j.version : 0, invalid: false }
      }
      return { state: null, version: 0, invalid: true }
    } catch {
      return { state: null, version: 0, invalid: true }
    }
  }

  function serializePersisted(state, version) {
    return JSON.stringify({ state, version })
  }

  function ensureArray(state, field) {
    if (!Array.isArray(state[field])) state[field] = []
    return state[field]
  }

  // 应用单条 mutation 到 working state（就地修改）。返回 { ok, error?, id?, entity? }
  function applyOne(state, m) {
    const dot = String(m.type).indexOf('.')
    const kind = dot > 0 ? m.type.slice(0, dot) : null
    const op = dot > 0 ? m.type.slice(dot + 1) : null
    if (kind !== 'task' && kind !== 'note') {
      return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: `未知实体类型: ${m.type}` }
    }
    if (op !== 'create' && op !== 'update' && op !== 'delete') {
      return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: `未知操作: ${m.type}` }
    }
    const field = ENTITY_FIELDS[kind]

    if (op === 'delete') {
      if (!isNonEmptyString(m.id)) return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: 'delete 缺少合法 id' }
      const arr = ensureArray(state, field)
      const idx = arr.findIndex((e) => e && e.id === m.id)
      if (idx >= 0) arr.splice(idx, 1)
      // delete 不存在 id → 幂等成功（收敛操作，重试/重复提交无副作用）
      return { ok: true, type: m.type, id: m.id, entity: null, deleted: idx >= 0 }
    }

    // create / update
    const entity = op === 'create' ? m.payload : m.entity
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: `${m.type} 缺少合法实体` }
    }
    const err = validateEntity(kind, entity)
    if (err) return { ok: false, error: ERROR_CODES.VALIDATION_FAILURE, detail: err }

    const arr = ensureArray(state, field)
    if (op === 'create') {
      // 幂等：同 id 已存在 → 覆盖（重试不产生重复实体）
      const idx = arr.findIndex((e) => e && e.id === entity.id)
      if (idx >= 0) arr[idx] = entity
      else arr.push(entity)
      return { ok: true, type: m.type, id: entity.id, entity }
    }

    // update
    if (m.id !== entity.id) return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: 'update 的 id 与 entity.id 不一致' }
    const idx = arr.findIndex((e) => e && e.id === m.id)
    if (idx < 0) return { ok: false, error: ERROR_CODES.ENTITY_NOT_FOUND, detail: `${field} 中不存在 id=${m.id}` }
    arr[idx] = entity
    return { ok: true, type: m.type, id: entity.id, entity }
  }

  // 批处理：读取权威 → working copy → 依次 apply → 全部成功 → 验证 → 一次性持久化
  // L3 原子性：任一 mutation 失败 → 整体返回失败且不写盘（working copy 丢弃，磁盘保持原样）
  function applyMutations(list) {
    if (!Array.isArray(list)) {
      return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: 'mutations 必须是数组' }
    }
    // 结构预校验
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (!m || typeof m !== 'object' || typeof m.type !== 'string' || !m.type.includes('.')) {
        return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: '非法 mutation 结构', failedIndex: i }
      }
    }
    // 读取权威（L2：总是读盘，correctness 优先）
    const text = readDisk()
    const persisted = parsePersisted(text)
    if (persisted.invalid) {
      return { ok: false, error: ERROR_CODES.INTERNAL_ERROR, detail: '权威文件不是合法持久化结构' }
    }
    const working = persisted.state === null ? {} : JSON.parse(JSON.stringify(persisted.state))
    const results = []
    for (let i = 0; i < list.length; i++) {
      const r = applyOne(working, list[i])
      results.push(r)
      if (!r.ok) {
        return { ok: false, error: r.error, failedIndex: i, detail: r.detail || '', results }
      }
    }
    // 验证最终 working state（宽松结构校验：顶层数组字段必须仍是数组）
    const v = validateStorageShape(working)
    if (!v.ok) {
      return { ok: false, error: ERROR_CODES.VALIDATION_FAILURE, detail: v.errors.join('; '), results }
    }
    // 一次性持久化（原子写）。失败 → persistence_failure，绝不伪装成功
    const out = serializePersisted(working, persisted.version)
    const w = persistWrite(out)
    if (!w || !w.ok) {
      return { ok: false, error: ERROR_CODES.PERSISTENCE_FAILURE, detail: (w && w.error) || 'write failed', results }
    }
    cache = { stamp: statStamp(), text: out }
    return { ok: true, results }
  }

  // 读权威 state（读缓存优化：mtime+size 相同且已有缓存 → 返回缓存；否则读盘）
  // 注意：缓存命中返回的是上次读盘内容，可能陈旧；仅用于读，绝不作为写依据（L2）
  function getState() {
    const stamp = statStamp()
    if (stamp === cache.stamp && cache.text !== null) {
      return parsePersisted(cache.text).state
    }
    const text = readDisk()
    cache = { stamp, text }
    return parsePersisted(text).state
  }

  // 强制重读（外部写入后调用；读缓存失效）
  function reload() {
    cache = { stamp: null, text: null }
    return getState()
  }

  return { applyMutations, getState, reload, ERROR_CODES }
}

module.exports = { createMutationEngine, atomicWrite, ERROR_CODES }

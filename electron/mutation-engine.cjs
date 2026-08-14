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
const PAPER_STATUSES = ['unread', 'reading', 'read']
const BIRTHDAY_TYPES = ['lunar', 'solar']

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}

// 实体校验器工厂：宽松（关键字段合法；可选字段若提供则类型正确）。
// 与 src/types.ts 各实体一致，不创建第二套模型。
function makeValidator({ idKey = 'id', titleKey = 'title', extra }) {
  return (e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return '实体必须是对象'
    if (!isNonEmptyString(e[idKey])) return '实体缺少合法 id'
    if (titleKey && !isNonEmptyString(e[titleKey])) return `实体缺少合法 ${titleKey}`
    if (extra) {
      const r = extra(e)
      if (r) return r
    }
    return null
  }
}

// 实体配置（Phase 1B-3A：覆盖全部持久化对象实体）
const ENTITY_CONFIG = {
  task: {
    field: 'tasks',
    validate: makeValidator({
      extra: (e) => {
        if (e.priority !== undefined && !TASK_PRIORITIES.includes(e.priority)) return 'priority 非法'
        if (e.status !== undefined && !TASK_STATUSES.includes(e.status)) return 'status 非法'
        if (e.subtasks !== undefined && !Array.isArray(e.subtasks)) return 'subtasks 必须是数组'
        return null
      },
    }),
  },
  note: {
    field: 'notes',
    validate: makeValidator({
      extra: (e) => (e.tags !== undefined && !Array.isArray(e.tags) ? 'tags 必须是数组' : null),
    }),
  },
  event: {
    field: 'events',
    validate: makeValidator({
      extra: (e) => {
        if (e.start !== undefined && !isNonEmptyString(e.start)) return 'start 非法'
        if (e.end !== undefined && !isNonEmptyString(e.end)) return 'end 非法'
        return null
      },
    }),
  },
  milestone: {
    field: 'milestones',
    validate: makeValidator({
      extra: (e) => {
        if (e.progress !== undefined && (typeof e.progress !== 'number' || e.progress < 0 || e.progress > 100)) return 'progress 非法'
        if (e.checkpoints !== undefined && !Array.isArray(e.checkpoints)) return 'checkpoints 必须是数组'
        return null
      },
    }),
  },
  pomodoro: {
    field: 'pomodoros',
    validate: makeValidator({
      titleKey: 'taskTitle',
      extra: (e) => (e.minutes !== undefined && typeof e.minutes !== 'number' ? 'minutes 非法' : null),
    }),
  },
  birthday: {
    field: 'birthdays',
    validate: makeValidator({
      titleKey: 'name',
      extra: (e) => (e.calendarType !== undefined && !BIRTHDAY_TYPES.includes(e.calendarType) ? 'calendarType 非法' : null),
    }),
  },
  habit: {
    field: 'habits',
    validate: makeValidator({
      titleKey: 'name',
      extra: (e) => (e.records !== undefined && !Array.isArray(e.records) ? 'records 必须是数组' : null),
    }),
  },
  project: {
    field: 'projects',
    validate: makeValidator({ titleKey: 'name' }),
  },
  paper: {
    field: 'papers',
    validate: makeValidator({
      extra: (e) => (e.status !== undefined && !PAPER_STATUSES.includes(e.status) ? 'status 非法' : null),
    }),
  },
}

// 跨实体事务（权威侧原子执行，防 renderer 过期快照覆盖）：
//   project.delete  → tasks/milestones.projectId 置 undefined
//   paperStage.delete → papers.stage 重设为 '未分类'
const CROSS_ENTITY = {
  project: {
    refs: [
      { field: 'tasks', refKey: 'projectId', apply: (e) => ({ ...e, projectId: undefined }) },
      { field: 'milestones', refKey: 'projectId', apply: (e) => ({ ...e, projectId: undefined }) },
    ],
  },
  paperStage: {
    refs: [{ field: 'papers', refKey: 'stage', apply: () => ({ stage: '未分类' }) }],
  },
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

function createMutationEngine({ storageFile, write, onPersisted }) {
  if (!storageFile) throw new Error('createMutationEngine: storageFile 必须提供')
  const persistWrite = typeof write === 'function' ? write : (data) => atomicWrite(storageFile, data)
  // persist 成功回调（Phase 1B-2 State Sync）：仅在持久化成功后才调用，传入最新权威 state（partialize 后）。
  // 职责分离：Mutation Engine 负责“改变事实”，State Sync（onPersisted）负责“传播事实”。
  const notifyPersisted = typeof onPersisted === 'function' ? onPersisted : null

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

  // 引用完整性（跨通道、跨 batch 兜底）：task/milestone 的 projectId 必须引用存在的 project，
  // 否则视为悬挂引用 → 权威侧原子清空（并发删除 project 后，平板迟到的 update 不会挂回已删引用）
  function enforceRefIntegrity(state, kind, entity) {
    if ((kind === 'task' || kind === 'milestone') && entity && entity.projectId !== undefined) {
      const projects = Array.isArray(state.projects) ? state.projects : []
      if (!projects.some((p) => p && p.id === entity.projectId)) {
        return { ...entity, projectId: undefined }
      }
    }
    return entity
  }

  // 应用单条 mutation 到 working state（就地修改）。返回 { ok, error?, id?, entity? }
  // ctx：batch 上下文（跨实体事务保护，见 applyMutations 预扫描）
  function applyOne(state, m, ctx) {
    const dot = String(m.type).indexOf('.')
    const kind = dot > 0 ? m.type.slice(0, dot) : null
    const op = dot > 0 ? m.type.slice(dot + 1) : null

    // paperStages：字符串数组实体（无 id），仅支持整组 replace
    if (kind === 'paperStages') {
      if (op !== 'replace') return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: 'paperStages 仅支持 replace' }
      if (!Array.isArray(m.payload) || m.payload.some((x) => typeof x !== 'string')) {
        return { ok: false, error: ERROR_CODES.VALIDATION_FAILURE, detail: 'paperStages.replace payload 必须是字符串数组' }
      }
      state.paperStages = [...m.payload]
      return { ok: true, type: m.type, id: null, entity: [...m.payload] }
    }

    // 跨实体事务删除：project.delete / paperStage.delete
    // 在权威侧原子解引用关联实体（防 renderer 基于过期快照展开覆盖权威）
    const tx = CROSS_ENTITY[kind]
    if (tx && op === 'delete') {
      if (!isNonEmptyString(m.id)) return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: 'delete 缺少合法 id' }
      const field = kind === 'project' ? 'projects' : 'paperStages'
      const arr = ensureArray(state, field)
      const idx = arr.findIndex((e) => (kind === 'project' ? e && e.id === m.id : e === m.id))
      if (idx >= 0) arr.splice(idx, 1)
      for (const ref of tx.refs) {
        if (!Array.isArray(state[ref.field])) continue
        state[ref.field] = state[ref.field].map((e) => (e && e[ref.refKey] === m.id ? { ...e, ...ref.apply(e, m.id) } : e))
      }
      return { ok: true, type: m.type, id: m.id, entity: null, deleted: idx >= 0, transactional: true }
    }

    const cfg = ENTITY_CONFIG[kind]
    if (!cfg) {
      return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: `未知实体类型: ${m.type}` }
    }
    if (op !== 'create' && op !== 'update' && op !== 'delete') {
      return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: `未知操作: ${m.type}` }
    }
    const field = cfg.field

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
    const err = cfg.validate(entity)
    if (err) return { ok: false, error: ERROR_CODES.VALIDATION_FAILURE, detail: err }
    // 引用完整性：projectId 悬挂引用 → 清空（不覆盖其他字段）
    const resolvedEntity = enforceRefIntegrity(state, kind, entity)

    const arr = ensureArray(state, field)
    if (op === 'create') {
      // 幂等：同 id 已存在 → 覆盖（重试不产生重复实体）
      const idx = arr.findIndex((e) => e && e.id === resolvedEntity.id)
      if (idx >= 0) arr[idx] = resolvedEntity
      else arr.push(resolvedEntity)
      return { ok: true, type: m.type, id: resolvedEntity.id, entity: resolvedEntity }
    }

    // update
    if (m.id !== resolvedEntity.id) return { ok: false, error: ERROR_CODES.INVALID_MUTATION, detail: 'update 的 id 与 entity.id 不一致' }
    const idx = arr.findIndex((e) => e && e.id === m.id)
    if (idx < 0) return { ok: false, error: ERROR_CODES.ENTITY_NOT_FOUND, detail: `${field} 中不存在 id=${m.id}` }
    // 跨实体事务保护：实体属于本 batch 中被删除的 project/paperStage → 跳过该过期 update
    // （关联解除已由 project.delete/paperStage.delete 在权威侧完成，避免 renderer 过期快照覆盖权威）
    // 注意：必须查原始权威（ctx.base），因为 working 可能已被本 batch 中先执行的 delete 事务解引用
    if (ctx && ctx.deletedRefIds && ctx.base) {
      const baseField = Array.isArray(ctx.base[field]) ? ctx.base[field] : []
      const baseEntity = baseField.find((e) => e && e.id === m.id)
      if (baseEntity) {
        if (ctx.deletedRefIds.get('project') && ctx.deletedRefIds.get('project').has(baseEntity.projectId)) {
          return { ok: true, type: m.type, id: m.id, entity, skipped: true, reason: 'project-deleted' }
        }
        if (ctx.deletedRefIds.get('paperStage') && ctx.deletedRefIds.get('paperStage').has(baseEntity.stage)) {
          return { ok: true, type: m.type, id: m.id, entity, skipped: true, reason: 'stage-deleted' }
        }
      }
    }
    arr[idx] = resolvedEntity
    return { ok: true, type: m.type, id: resolvedEntity.id, entity: resolvedEntity }
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
    // 预扫描：本 batch 中被跨实体事务删除的 project / paperStage id
    // （其关联实体的“仅解引用” update 由事务在权威侧完成，renderer 的过期 update 应跳过）
    const deletedRefIds = new Map()
    for (const m of list) {
      if (m.type === 'project.delete' && isNonEmptyString(m.id)) {
        if (!deletedRefIds.has('project')) deletedRefIds.set('project', new Set())
        deletedRefIds.get('project').add(m.id)
      }
      if (m.type === 'paperStage.delete' && isNonEmptyString(m.id)) {
        if (!deletedRefIds.has('paperStage')) deletedRefIds.set('paperStage', new Set())
        deletedRefIds.get('paperStage').add(m.id)
      }
    }
    // 读取权威（L2：总是读盘，correctness 优先）
    const text = readDisk()
    const persisted = parsePersisted(text)
    if (persisted.invalid) {
      return { ok: false, error: ERROR_CODES.INTERNAL_ERROR, detail: '权威文件不是合法持久化结构' }
    }
    const working = persisted.state === null ? {} : JSON.parse(JSON.stringify(persisted.state))
    const base = persisted.state === null ? {} : persisted.state // 原始权威（跨实体事务保护用，只读）
    const batchCtx = deletedRefIds.size > 0 ? { deletedRefIds, base } : null
    const results = []
    for (let i = 0; i < list.length; i++) {
      const r = applyOne(working, list[i], batchCtx)
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
    // Phase 1B-2：persist 成功后才广播（禁止 persist 前广播“未来状态”）
    if (notifyPersisted) notifyPersisted(working)
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

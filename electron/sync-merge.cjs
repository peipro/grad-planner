// 研途计划 · 服务端同步合并核心（Phase 1B Task 3-5）
// LAN PUT 与 IPC sync-storage-set 共用同一实现（保证双通道语义一致）。
//
// 职责：
//   - Storage Envelope 读写（revision / deviceId / writeId / entityVersions）
//   - 乐观并发：expectedRevision 校验，禁止旧 revision 覆盖新 revision
//   - 冲突检测（Task 4）：stale write → 409 + 双方数据
//   - 最小实体级 merge（Task 5）：不同实体并发修改自动合并，同实体冲突才 409
//
// 注意：sync-core.js 因 package.json type:module 以 ESM 加载（UMD 挂到 globalThis.SyncCore），
// 本模块（CJS）通过动态 import 获取。

let _core = null
async function core() {
  if (!_core) {
    await import('../public/sync-core.js')
    _core = globalThis.SyncCore
  }
  return _core
}

// 更新 entityVersions：changed/deleted 实体记录为最近修改的 revision
function updateEntityVersions(prev, changedIds, deletedIds, revision) {
  const next = { ...(prev || {}) }
  for (const id of changedIds || []) next[id] = revision
  for (const id of deletedIds || []) next[id] = revision
  return next
}

// 按 'type:id' 在 state 中查找实体（未命中返回 null）
function findEntityByKey(state, key) {
  const sep = key.indexOf(':')
  if (sep < 0) return null
  const field = key.slice(0, sep)
  const id = key.slice(sep + 1)
  const arr = state && Array.isArray(state[field]) ? state[field] : []
  return arr.find((e) => e && e.id === id) ?? null
}

// 在 state 中设置/删除实体（按 'type:id'）
function setEntityByKey(state, key, entity) {
  const sep = key.indexOf(':')
  if (sep < 0) return
  const field = key.slice(0, sep)
  const id = key.slice(sep + 1)
  const arr = Array.isArray(state[field]) ? state[field] : []
  if (entity === null) {
    state[field] = arr.filter((e) => !(e && e.id === id))
  } else {
    const idx = arr.findIndex((e) => e && e.id === id)
    if (idx >= 0) arr[idx] = entity
    else arr.push(entity)
    state[field] = arr
  }
}

function deepClone(obj) {
  return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj))
}

// 应用客户端提交到当前存储。返回：
//   { ok: true, envelope, revision }
//   { ok: false, status: 409, error, serverRevision, serverData, clientData, conflicts? }
//   { ok: false, error }
async function applySubmit({ currentText, submit, deviceId, writeId }) {
  const { unwrapEnvelope, buildEnvelope, collectEntities } = await core()

  const cur = unwrapEnvelope(currentText)
  if (!cur) return { ok: false, error: 'invalid current storage' }
  if (!submit || typeof submit !== 'object' || submit === null || typeof submit.data !== 'object' || submit.data === null) {
    return { ok: false, error: 'invalid submit' }
  }
  const expected = Number(submit.expectedRevision) || 0
  const changedIds = Array.isArray(submit.changedIds) ? submit.changedIds.filter((x) => typeof x === 'string') : []
  const deletedIds = Array.isArray(submit.deletedIds) ? submit.deletedIds.filter((x) => typeof x === 'string') : []
  const writerDeviceId = String(deviceId || submit.deviceId || 'unknown')
  const newRevision = cur.revision + 1

  // === 无并发：revision 一致，直接接受 ===
  if (expected === cur.revision) {
    const entityVersions = updateEntityVersions(cur.entityVersions, changedIds, deletedIds, newRevision)
    const envelope = buildEnvelope(submit.data, newRevision, writerDeviceId, writeId, entityVersions)
    return { ok: true, envelope, revision: newRevision }
  }

  // === 客户端版本异常更新（不应发生：expected 不可能 > server）===
  if (expected > cur.revision) {
    // 防御：接受客户端（它基于更新的状态），但记录
    const entityVersions = updateEntityVersions(cur.entityVersions, changedIds, deletedIds, newRevision)
    const envelope = buildEnvelope(submit.data, newRevision, writerDeviceId, writeId, entityVersions)
    return { ok: true, envelope, revision: newRevision }
  }

  // === Stale write（expected < cur.revision）：Task 4 冲突检测 ===
  const conflicts = []
  const mergedData = deepClone(cur.data)
  const clientEntities = collectEntities(submit.data)

  // 1. changedIds：客户端声明修改/新增的实体
  for (const key of changedIds) {
    const serverVersion = (cur.entityVersions || {})[key] || 0
    if (serverVersion > expected) {
      // 服务端在客户端 base 之后也改过此实体 → 真冲突
      conflicts.push({
        id: key,
        client: clientEntities[key] ?? null,
        server: findEntityByKey(cur.data, key),
      })
    } else {
      // 客户端胜出（服务端未改过此实体）
      setEntityByKey(mergedData, key, clientEntities[key] ?? null)
    }
  }

  // 2. deletedIds：客户端删除的实体
  for (const key of deletedIds) {
    const serverVersion = (cur.entityVersions || {})[key] || 0
    if (serverVersion > expected) {
      // 客户端删除 + 服务端也改过 → 不允许静默删除
      conflicts.push({
        id: key,
        client: null,
        server: findEntityByKey(cur.data, key),
        deletedByClient: true,
      })
    } else {
      setEntityByKey(mergedData, key, null)
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      status: 409,
      error: 'conflict',
      conflicts,
      serverRevision: cur.revision,
      serverData: cur.data,
      clientData: submit.data,
    }
  }

  // === 无真冲突：合并结果（不同实体并发修改自动保留双方）===
  const entityVersions = updateEntityVersions(cur.entityVersions, changedIds, deletedIds, newRevision)
  const envelope = buildEnvelope(mergedData, newRevision, writerDeviceId, writeId, entityVersions)
  return { ok: true, envelope, revision: newRevision }
}

// 构造空 envelope（存储文件不存在时的初始状态）
async function emptyEnvelope(deviceId) {
  const { buildEnvelope } = await core()
  return buildEnvelope({}, 0, deviceId || '', 'init', {})
}

module.exports = { applySubmit, emptyEnvelope }

// 研途计划 · 同步核心（UMD：浏览器 <script> 与 Node require 共用）
// 负责 Storage Envelope 的构造/解包、实体收集、客户端变更 diff。
// 服务端 merge/conflict 逻辑在 electron/sync-merge.cjs（依赖本模块）。
//
// Storage Envelope 格式（文件 / IPC / LAN 传输层）：
//   {
//     schemaVersion: 1,
//     revision: number,          // 单调递增（乐观并发）
//     deviceId: string,          // 写入者身份
//     writeId: string,           // 单次写入唯一（防同步循环）
//     updatedAt: string,         // ISO
//     entityVersions: {...},     // 'type:id' → 最近修改该实体的 revision
//     data: AppState             // Zustand persist state
//   }
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.SyncCore = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 实体数组字段（与 src/data/schema.ts / electron/storage-schema.cjs 一致）
  var ARRAY_FIELDS = [
    'events', 'tasks', 'milestones', 'notes', 'pomodoros',
    'birthdays', 'habits', 'projects', 'papers', 'paperStages',
  ]
  var SCHEMA_VERSION = 1

  // 从 AppState 提取所有实体：{ 'type:id': entity }
  function collectEntities(state) {
    var out = {}
    if (!state || typeof state !== 'object' || state === null) return out
    for (var i = 0; i < ARRAY_FIELDS.length; i++) {
      var field = ARRAY_FIELDS[i]
      var arr = state[field]
      if (!Array.isArray(arr)) continue
      for (var j = 0; j < arr.length; j++) {
        var ent = arr[j]
        if (ent && typeof ent === 'object' && typeof ent.id === 'string' && ent.id) {
          out[field + ':' + ent.id] = ent
        }
      }
    }
    return out
  }

  // envelope 解包：兼容旧格式（无 schemaVersion/revision → 视为 revision=0 的旧数据）
  // 返回 { data, revision, deviceId, writeId, entityVersions } 或 null（无法解析）
  function unwrapEnvelope(text) {
    if (typeof text !== 'string') return null
    var j
    try {
      j = JSON.parse(text)
    } catch {
      return null
    }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null
    if (typeof j.data === 'object' && j.data !== null && typeof j.revision === 'number') {
      return {
        data: j.data,
        revision: j.revision,
        deviceId: typeof j.deviceId === 'string' ? j.deviceId : '',
        writeId: typeof j.writeId === 'string' ? j.writeId : '',
        entityVersions: j.entityVersions && typeof j.entityVersions === 'object' ? j.entityVersions : {},
      }
    }
    // 旧格式：整份 state 直接是 data
    return { data: j, revision: 0, deviceId: '', writeId: '', entityVersions: {} }
  }

  // 构造 envelope
  function buildEnvelope(data, revision, deviceId, writeId, entityVersions) {
    return {
      schemaVersion: SCHEMA_VERSION,
      revision,
      deviceId: String(deviceId || ''),
      writeId: String(writeId || ''),
      updatedAt: new Date().toISOString(),
      entityVersions: entityVersions || {},
      data,
    }
  }

  // 客户端 diff：上次提交的 state vs 当前 state → { changedIds, deletedIds }（'type:id' 列表）
  // 新增/修改 → changedIds；消失 → deletedIds
  function diffEntities(prevState, nextState) {
    var prev = collectEntities(prevState)
    var next = collectEntities(nextState)
    var changedIds = []
    var deletedIds = []
    for (var k in next) {
      if (Object.prototype.hasOwnProperty.call(next, k)) {
        if (!Object.prototype.hasOwnProperty.call(prev, k)) changedIds.push(k)
        else if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) changedIds.push(k)
      }
    }
    for (var k2 in prev) {
      if (Object.prototype.hasOwnProperty.call(prev, k2) && !Object.prototype.hasOwnProperty.call(next, k2)) {
        deletedIds.push(k2)
      }
    }
    return { changedIds, deletedIds }
  }

  return { collectEntities, unwrapEnvelope, buildEnvelope, diffEntities, ARRAY_FIELDS, SCHEMA_VERSION }
})

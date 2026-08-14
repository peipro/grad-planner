// 研途计划 · 数据同步适配层（Phase 1B-1）
// 在 index.html 中以普通同步脚本加载（早于 app bundle），patch Storage.prototype，
// 将 grad-planner-storage 键读写重定向到共享数据。
//
// Phase 1B-1 变化（docs/Phase-1B-1-Mutation-Architecture.md）：
//   - 传输单位从 whole AppState 改为 entity-level Mutation（Task / Note）
//   - persist setItem → 与"上次成功提交的权威 state" diff → Mutation[] → IPC/HTTP 提交
//   - getItem 仍从权威读取（桌面 IPC syncStorageGet / 平板 GET /api/storage），失败回退本地缓存
//   - 本地 localStorage 仅作离线兜底缓存（nativeSet 直写）
//   - 提交失败 → dispatch 'sync-mutation-failed'（renderer 按错误码分类处理，见 src/App.tsx / L4）
//   - 本阶段只 diff tasks/notes；其余字段不产生 mutation（不整份上传）
;(function () {
  if (!window.localStorage) return
  var SYNC_KEY = 'grad-planner-storage'
  var isElectron = !!window.electronAPI
  var proto = window.Storage.prototype
  if (!proto) return

  // 从访问 URL 读取局域网 token，数据请求带上以通过鉴权
  var LAN_TOKEN = ''
  try {
    LAN_TOKEN = new URL(window.location.href).searchParams.get('token') || ''
  } catch {}
  var MUTATE_PATH = '/api/mutations' + (LAN_TOKEN ? '?token=' + encodeURIComponent(LAN_TOKEN) : '')
  var STORAGE_PATH = '/api/storage' + (LAN_TOKEN ? '?token=' + encodeURIComponent(LAN_TOKEN) : '')

  // 必须先在 patch 前捕获原生引用
  var nativeGet = proto.getItem
  var nativeSet = proto.setItem
  var nativeRemove = proto.removeItem

  // ===== Phase 1B-1：权威同步状态 =====
  // baseState：上次成功提交后的已知权威 state（.state 部分）；diff 基准。
  // lastDiffState：最近一次 setItem 的 state；提交成功/失败后推进 baseState（失败不重试，避免循环）。
  // pendingMutations：待提交的最新全量 diff（每次 setItem 覆盖——最新 diff 已含基准以来的全部变化）。
  var baseState = null
  var lastDiffState = null
  var pendingMutations = []
  var flushTimer = null
  var FLUSH_MS = 300
  var pollTimer = null // Phase 1B-2：平板端权威轮询

  // 解析 zustand persist 真实 payload：{ state, version }
  function parsePersist(str) {
    if (typeof str !== 'string' || !str) return null
    try {
      var j = JSON.parse(str)
      if (j && j.state && typeof j.state === 'object' && !Array.isArray(j.state)) {
        return { state: j.state, version: j.version }
      }
    } catch {}
    return null
  }

  // ===== Phase 1B-3A：全部对象实体字段（与 electron/mutation-engine.cjs ENTITY_CONFIG 对齐） =====
  var ENTITY_FIELDS = [
    { field: 'events', kind: 'event' },
    { field: 'tasks', kind: 'task' },
    { field: 'milestones', kind: 'milestone' },
    { field: 'notes', kind: 'note' },
    { field: 'pomodoros', kind: 'pomodoro' },
    { field: 'birthdays', kind: 'birthday' },
    { field: 'habits', kind: 'habit' },
    { field: 'projects', kind: 'project' },
    { field: 'papers', kind: 'paper' },
  ]

  // 实体版本（Phase 1B-3B）：baseState 中的 version 即“客户端修改前同步到的版本”（§19 来自真实权威）
  function entityVersionOf(e) {
    return e && typeof e.version === 'number' ? e.version : 1
  }

  // diff：base vs next → Mutation[]（表驱动覆盖全部对象实体 + paperStages）
  // create / update（全量 entity）/ delete，与 electron/mutation-engine.cjs 的契约一致。
  // update/delete 携带 baseVersion（来自 baseState 的实体版本）。
  function diffMutations(base, next) {
    var out = []
    for (var f = 0; f < ENTITY_FIELDS.length; f++) {
      var field = ENTITY_FIELDS[f].field
      var kind = ENTITY_FIELDS[f].kind
      var prev = {}
      var nextMap = {}
      var prevArr = base && Array.isArray(base[field]) ? base[field] : []
      var nextArr = next && Array.isArray(next[field]) ? next[field] : []
      for (var i = 0; i < prevArr.length; i++) {
        var e = prevArr[i]
        if (e && e.id) prev[e.id] = e
      }
      for (var j = 0; j < nextArr.length; j++) {
        var ne = nextArr[j]
        if (ne && ne.id) nextMap[ne.id] = ne
      }
      for (var id in nextMap) {
        if (!(id in prev)) out.push({ type: kind + '.create', payload: nextMap[id] })
        else if (JSON.stringify(prev[id]) !== JSON.stringify(nextMap[id])) {
          out.push({ type: kind + '.update', id: id, entity: nextMap[id], baseVersion: entityVersionOf(prev[id]) })
        }
      }
      for (var id2 in prev) {
        if (!(id2 in nextMap)) out.push({ type: kind + '.delete', id: id2, baseVersion: entityVersionOf(prev[id2]) })
      }
    }
    // paperStages：字符串数组（无 id），内容变化 → 整组 replace
    var prevStages = base && Array.isArray(base.paperStages) ? base.paperStages : []
    var nextStages = next && Array.isArray(next.paperStages) ? next.paperStages : []
    if (JSON.stringify(prevStages) !== JSON.stringify(nextStages)) {
      out.push({ type: 'paperStages.replace', payload: nextStages })
    }
    return out
  }

  function dispatchFailed(detail) {
    try {
      window.dispatchEvent(new CustomEvent('sync-mutation-failed', { detail: detail }))
    } catch {}
  }

  // 提交一批 mutation（IPC 或 HTTP，进入同一个 main-process mutation engine）
  function submit(batch) {
    var handle = function (res) {
      // 无论成功/失败，基准推进到最近一次 diff 的 state（失败不重试，避免无限循环）
      if (lastDiffState) baseState = lastDiffState
      if (res && res.ok) return
      var detail = { error: (res && res.error) || 'network_error' }
      // Phase 1B-3B：conflict 详情透传（§13，与 IPC/HTTP 语义一致）
      if (res && res.error === 'conflict') {
        detail.entityType = res.entityType
        detail.entityId = res.entityId
        detail.expectedVersion = res.expectedVersion
        detail.actualVersion = res.actualVersion
        detail.currentEntity = res.currentEntity
      }
      dispatchFailed(detail)
    }
    if (isElectron) {
      // 契约：IPC syncMutate 接收 Mutation[]（数组），与 main.cjs 的 Array.isArray 校验一致
      window.electronAPI.syncMutate(batch)
        .then(handle)
        .catch(function () { handle({ ok: false, error: 'network_error' }) })
    } else {
      fetch(MUTATE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mutations: batch }),
        cache: 'no-store',
        keepalive: true,
      })
        .then(function (r) {
          return r.json().catch(function () { return null })
        })
        .then(handle)
        .catch(function () { handle({ ok: false, error: 'network_error' }) })
    }
  }

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    if (pendingMutations.length === 0) return
    var batch = pendingMutations
    pendingMutations = []
    submit(batch)
  }

  // persist setItem 入口：本地缓存 + diff → 节流提交
  function enqueueFromPersist(value) {
    var p = parsePersist(value)
    if (!p) return
    var next = p.state
    if (baseState === null) baseState = {}
    lastDiffState = next
    pendingMutations = diffMutations(baseState, next) // 覆盖为最新全量 diff
    // 本地缓存（离线兜底：hydration 远端失败时回退）
    try { nativeSet.call(window.localStorage, SYNC_KEY, value) } catch {}
    if (pendingMutations.length === 0) return // 非 Task/Note 字段变化（如番茄钟 tick）不上传
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(flush, FLUSH_MS)
  }

  function remoteGet() {
    if (isElectron) {
      return window.electronAPI.syncStorageGet().then(function (res) {
        if (res && res.found) {
          var p = parsePersist(res.data)
          if (p) { baseState = p.state; lastDiffState = p.state }
          return res.data
        }
        var legacy = nativeGet.call(window.localStorage, SYNC_KEY)
        if (legacy != null) {
          var lp = parsePersist(legacy)
          if (lp) { baseState = lp.state; lastDiffState = lp.state }
        }
        return legacy
      }).catch(function () {
        // 远端失败 → 本地缓存兜底
        return nativeGet.call(window.localStorage, SYNC_KEY)
      })
    }
    return fetch(STORAGE_PATH, { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) return null
        if (r.ok) return r.text()
        return null
      })
      .then(function (text) {
        if (text == null) {
          var legacy = nativeGet.call(window.localStorage, SYNC_KEY)
          if (legacy != null) {
            var lp2 = parsePersist(legacy)
            if (lp2) { baseState = lp2.state; lastDiffState = lp2.state }
          }
          return legacy
        }
        var p2 = parsePersist(text)
        if (p2) { baseState = p2.state; lastDiffState = p2.state }
        return text
      })
      .catch(function () {
        return nativeGet.call(window.localStorage, SYNC_KEY)
      })
  }

  function remoteRemove() {
    if (isElectron) {
      return window.electronAPI.syncStorageRemove().catch(function () {})
    }
    return fetch(STORAGE_PATH, { method: 'DELETE', cache: 'no-store' }).catch(function () {})
  }

  // 页面关闭/刷新前把待写入 mutation 立即发出
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)

  // Phase 1B-2：Main authoritative state 已应用到 renderer。
  // 标记基准，使随后的 persist setItem diff 为空 → 不产生 mutation（防 state-sync → persist → mutation 循环）。
  window.__gradSyncMarkAuthoritative = function (state) {
    baseState = state || null
    lastDiffState = state || null
    pendingMutations = []
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  }

  // Phase 1B-2：平板端轻量轮询权威内容变化（无 Main 推送机制下的最小方案）。
  // 发现外部变化 → dispatch 'state-sync-external' → renderer 走与 Main state-sync 相同的 apply 路径。
  if (!isElectron) {
    var pollText = null
    var POLL_MS = 5000
    function pollAuthority() {
      fetch(STORAGE_PATH, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : null })
        .then(function (text) {
          if (text == null) return
          if (pollText !== null && text !== pollText) {
            var p = parsePersist(text)
            if (p) {
              try {
                window.dispatchEvent(new CustomEvent('state-sync-external', { detail: { state: p.state } }))
              } catch {}
            }
          }
          pollText = text
        })
        .catch(function () {})
    }
    pollTimer = setInterval(pollAuthority, POLL_MS)
  }

  function syncGet(key) {
    if (key !== SYNC_KEY) return nativeGet.call(this, key)
    return remoteGet()
  }
  function syncSet(key, value) {
    if (key !== SYNC_KEY) return nativeSet.call(this, key, value)
    return enqueueFromPersist(String(value))
  }
  function syncRemove(key) {
    if (key !== SYNC_KEY) return nativeRemove.call(this, key)
    baseState = null
    lastDiffState = null
    pendingMutations = []
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    return remoteRemove()
  }

  proto.getItem = syncGet
  proto.setItem = syncSet
  proto.removeItem = syncRemove
  if (window.localStorage.getItem !== syncGet) window.localStorage.getItem = syncGet
  if (window.localStorage.setItem !== syncSet) window.localStorage.setItem = syncSet
  if (window.localStorage.removeItem !== syncRemove) window.localStorage.removeItem = syncRemove
})()

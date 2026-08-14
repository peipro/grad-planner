// 研途计划 · 数据同步适配层（Phase 1B）
// 在 index.html 中以普通同步脚本加载（早于 app bundle），patch Storage.prototype，
// 将 grad-planner-storage 键读写重定向到共享数据：
//   - Electron 桌面版：通过 window.electronAPI（IPC → data/sync/*.json）
//   - 平板/浏览器：通过局域网服务器 /api/storage
//
// Phase 1B 变化：
//   - 存储文件为 Storage Envelope（revision/deviceId/writeId/entityVersions/data）
//   - 每次提交携带 expectedRevision（乐观并发）与 changedIds/deletedIds（实体级 diff）
//   - 串行提交队列：knownRevision 在响应后更新，避免并发提交误判 stale
//   - 409 冲突 → dispatch 'sync-conflict' 事件（renderer 提示用户，绝不静默覆盖）
//   - 暴露 window.__gradSyncFlush()（renderer flush 协议等待提交队列排空）
;(function () {
  if (!window.localStorage) return
  var SYNC_KEY = 'grad-planner-storage'
  var DEVICE_KEY = 'grad-planner-device-id'
  var isElectron = !!window.electronAPI
  var proto = window.Storage.prototype
  if (!proto) return

  var SyncCore = window.SyncCore || (typeof globalThis !== 'undefined' ? globalThis.SyncCore : null)

  // 从访问 URL 读取局域网 token，数据请求带上以通过鉴权
  var LAN_TOKEN = ''
  try {
    LAN_TOKEN = new URL(window.location.href).searchParams.get('token') || ''
  } catch {}
  var API_PATH = '/api/storage' + (LAN_TOKEN ? '?token=' + encodeURIComponent(LAN_TOKEN) : '')

  // 必须先在 patch 前捕获原生引用
  var nativeGet = proto.getItem
  var nativeSet = proto.setItem
  var nativeRemove = proto.removeItem

  // ===== 设备身份（持久化，重启不变；平板端） =====
  function deviceId() {
    var id = ''
    try { id = nativeGet.call(window.localStorage, DEVICE_KEY) } catch {}
    if (id) return id
    id = 'tablet-' + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))
    try { nativeSet.call(window.localStorage, DEVICE_KEY, id) } catch {}
    return id
  }

  // ===== revision 状态 =====
  var knownRevision = 0
  var lastSubmittedData = null // 上次提交的 data（实体级 diff 基准）
  var submitChain = Promise.resolve() // 串行提交队列

  function parseData(s) {
    try { return JSON.parse(s) } catch { return null }
  }

  // 构造提交：{ expectedRevision, deviceId, changedIds, deletedIds, data }
  function buildSubmit(dataStr) {
    var data = parseData(dataStr)
    if (!data) data = {}
    var diff = SyncCore ? SyncCore.diffEntities(lastSubmittedData, data) : { changedIds: [], deletedIds: [] }
    lastSubmittedData = data
    return { expectedRevision: knownRevision, deviceId: deviceId(), changedIds: diff.changedIds, deletedIds: diff.deletedIds, data: data }
  }

  // 处理提交结果：更新 knownRevision；409 → 冲突事件
  function handleSubmitResult(res) {
    if (!res) return
    if (typeof res.revision === 'number') knownRevision = res.revision
    if (res.ok === false && res.status === 409) {
      try {
        window.dispatchEvent(new CustomEvent('sync-conflict', {
          detail: { serverRevision: res.serverRevision, serverData: res.serverData, conflicts: res.conflicts },
        }))
      } catch {}
    }
  }

  function doSubmit(submit) {
    if (isElectron) {
      return window.electronAPI.syncStorageSet(submit).then(handleSubmitResult).catch(function () {})
    }
    return fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submit),
      cache: 'no-store',
      keepalive: true,
    })
      .then(function (r) {
        if (r.status === 409) return r.json().catch(function () { return null })
        if (!r.ok) return null
        return r.json().catch(function () { return null })
      })
      .then(function (j) {
        handleSubmitResult(j)
        return j
      })
      .catch(function () { return null })
  }

  // 串行提交：knownRevision 响应后更新，下一个提交用它
  function enqueueSubmit(submit) {
    submitChain = submitChain.then(function () { return doSubmit(submit) })
    return submitChain
  }

  function remoteGet() {
    if (isElectron) {
      return window.electronAPI.syncStorageGet().then(function (res) {
        if (res && res.found) {
          if (typeof res.revision === 'number') knownRevision = res.revision
          return res.data
        }
        // 首次：尝试从旧 localStorage 迁移
        var legacy = nativeGet.call(window.localStorage, SYNC_KEY)
        if (legacy != null) {
          enqueueSubmit(buildSubmit(legacy))
        }
        return legacy
      })
    }
    return fetch(API_PATH, { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) return null
        if (r.ok) return r.text()
        return null
      })
      .then(function (text) {
        if (text == null) return null
        // 存储为 envelope → 解包返回 data
        var env = SyncCore ? SyncCore.unwrapEnvelope(text) : null
        if (env) {
          knownRevision = env.revision
          return JSON.stringify(env.data)
        }
        return text // 旧格式
      })
      .catch(function () { return null })
  }

  function remoteSet(value) {
    // 桌面端：立即串行提交（主进程节流写盘）
    return enqueueSubmit(buildSubmit(String(value)))
  }

  // 浏览器端写入节流：高频 setState 合并为一次 PUT（500ms）
  var pendingPut = null
  var putTimer = null
  function flushPut() {
    if (putTimer) { clearTimeout(putTimer); putTimer = null }
    if (pendingPut === null) return
    var submit = pendingPut
    pendingPut = null
    enqueueSubmit(submit)
  }
  function remoteSetThrottled(value) {
    pendingPut = buildSubmit(String(value))
    if (!putTimer) putTimer = setTimeout(flushPut, 500)
  }

  function remoteRemove() {
    if (isElectron) {
      return window.electronAPI.syncStorageRemove().catch(function () {})
    }
    return fetch(API_PATH, { method: 'DELETE', cache: 'no-store' }).catch(function () {})
  }

  // 页面关闭/刷新前把待写入数据立即发出
  window.addEventListener('pagehide', flushPut)
  window.addEventListener('beforeunload', flushPut)

  function syncGet(key) {
    if (key !== SYNC_KEY) return nativeGet.call(this, key)
    return remoteGet()
  }
  function syncSet(key, value) {
    if (key !== SYNC_KEY) return nativeSet.call(this, key, value)
    return isElectron ? remoteSet(value) : remoteSetThrottled(value)
  }
  function syncRemove(key) {
    if (key !== SYNC_KEY) return nativeRemove.call(this, key)
    return remoteRemove()
  }

  // renderer flush 协议：等待已排队的提交完成（含草稿提交触发的 persist 写）
  window.__gradSyncFlush = function () {
    return submitChain.then(function () {})
  }
  window.__gradSyncKnownRevision = function () { return knownRevision }

  proto.getItem = syncGet
  proto.setItem = syncSet
  proto.removeItem = syncRemove
  if (window.localStorage.getItem !== syncGet) window.localStorage.getItem = syncGet
  if (window.localStorage.setItem !== syncSet) window.localStorage.setItem = syncSet
  if (window.localStorage.removeItem !== syncRemove) window.localStorage.removeItem = syncRemove
})()

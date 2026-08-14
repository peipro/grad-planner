// 研途计划 · 数据同步适配层
// 在 index.html 中以普通同步脚本加载（早于 app bundle），patch Storage.prototype，
// 将 grad-planner-storage 键读写重定向到共享数据：
//   - Electron 桌面版：通过 window.electronAPI（IPC → data/sync/*.json）
//   - 平板/浏览器：通过局域网服务器 /api/storage
// 首次运行时若共享数据不存在，自动从原有 localStorage 迁移。
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
  var API_PATH = '/api/storage' + (LAN_TOKEN ? '?token=' + encodeURIComponent(LAN_TOKEN) : '')

  // 必须先在 patch 前捕获原生引用
  var nativeGet = proto.getItem
  var nativeSet = proto.setItem
  var nativeRemove = proto.removeItem

  function remoteGet() {
    if (isElectron) {
      return window.electronAPI.syncStorageGet().then(function (res) {
        if (res && res.found) return res.data
        var legacy = nativeGet.call(window.localStorage, SYNC_KEY)
        if (legacy != null) {
          window.electronAPI.syncStorageSet(legacy).catch(function () {})
        }
        return legacy
      })
    }
    return fetch(API_PATH, { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return null
      if (r.ok) return r.text()
      return null
    }).catch(function () { return null })
  }
  // 浏览器端写入节流：高频 setState 时合并 PUT，避免每次状态变更都整份上传
  var pendingPut = null
  var putTimer = null
  function flushPut() {
    if (putTimer) { clearTimeout(putTimer); putTimer = null }
    if (pendingPut === null) return
    var v = pendingPut
    pendingPut = null
    fetch(API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: v,
      cache: 'no-store',
      keepalive: true,
    }).catch(function () {})
  }
  function remoteSet(value) {
    if (isElectron) {
      return window.electronAPI.syncStorageSet(String(value)).catch(function () {})
    }
    pendingPut = String(value)
    if (!putTimer) putTimer = setTimeout(flushPut, 500)
  }
  // 页面关闭/刷新前把待写入数据立即发出
  window.addEventListener('pagehide', flushPut)
  window.addEventListener('beforeunload', flushPut)
  function remoteRemove() {
    if (isElectron) {
      return window.electronAPI.syncStorageRemove().catch(function () {})
    }
    return fetch(API_PATH, { method: 'DELETE', cache: 'no-store' }).catch(function () {})
  }

  function syncGet(key) {
    if (key !== SYNC_KEY) return nativeGet.call(this, key)
    return remoteGet()
  }
  function syncSet(key, value) {
    if (key !== SYNC_KEY) return nativeSet.call(this, key, value)
    return remoteSet(value)
  }
  function syncRemove(key) {
    if (key !== SYNC_KEY) return nativeRemove.call(this, key)
    return remoteRemove()
  }

  proto.getItem = syncGet
  proto.setItem = syncSet
  proto.removeItem = syncRemove
  if (window.localStorage.getItem !== syncGet) window.localStorage.getItem = syncGet
  if (window.localStorage.setItem !== syncSet) window.localStorage.setItem = syncSet
  if (window.localStorage.removeItem !== syncRemove) window.localStorage.removeItem = syncRemove
})()

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onGlobalShortcut: (cb) => {
    ipcRenderer.on('global-shortcut', () => cb())
  },
  saveBackup: (json) => ipcRenderer.invoke('save-backup', json),
  listBackups: () => ipcRenderer.invoke('list-backups'),
  loadBackup: (name) => ipcRenderer.invoke('load-backup', name),
  setNewsConfig: (cfg) => ipcRenderer.invoke('set-news-config', cfg),
  getXCredentials: () => ipcRenderer.invoke('get-x-credentials'),
  setXCredentials: (key, secret) => ipcRenderer.invoke('set-x-credentials', key, secret),
  fetchNews: (override) => ipcRenderer.invoke('fetch-news', override),
  fetchArticle: (url) => ipcRenderer.invoke('fetch-article', url),
  translateText: (text) => ipcRenderer.invoke('translate-text', text),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  onTranslateShortcut: (cb) => {
    ipcRenderer.on('translate-shortcut', (_e, data) => cb(data))
  },
  openTranslateWindow: () => ipcRenderer.send('open-translate-window'),
  windowControl: (action) => ipcRenderer.send('translate-window-control', action),
  onPasteEvent: (cb) => {
    ipcRenderer.on('paste-from-clipboard', (_e, data) => cb(data))
  },
  onNewsAutoUpdate: (cb) => {
    ipcRenderer.on('news-auto-update', (_e, data) => cb(data))
  },
  syncStorageGet: () => ipcRenderer.invoke('sync-storage-get'),
  syncStorageSet: (data) => ipcRenderer.invoke('sync-storage-set', data),
  syncStorageRemove: () => ipcRenderer.invoke('sync-storage-remove'),
  syncMutate: (mutations) => ipcRenderer.invoke('sync-mutate', mutations),
  // Phase 1B-2：Main → Renderer state-sync 事件桥（contextBridge，不暴露 ipcRenderer；可 unsubscribe）
  onStateSync: (cb) => {
    const listener = (_e, payload) => {
      try { cb(payload) } catch {}
    }
    ipcRenderer.on('state-sync', listener)
    return () => ipcRenderer.removeListener('state-sync', listener)
  },
  lanPort: () => ipcRenderer.invoke('lan-port'),
  lanInfo: () => ipcRenderer.invoke('lan-info'),
  lanResetToken: () => ipcRenderer.invoke('lan-reset-token'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
})

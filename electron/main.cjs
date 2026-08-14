const { app, BrowserWindow, globalShortcut, ipcMain, shell, clipboard, Notification, safeStorage, session } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { fetchAllNews, fetchArticle, translateText } = require('./news.cjs')
const { startLanServer, createStorageAccess, lanAddresses } = require('./lan-server.cjs')
const { createSyncManager } = require('./sync-manager.cjs')
const { createBackupStore } = require('./backup-store.cjs')
const { createCredentialsStore } = require('./credentials-store.cjs')
const { isAllowedExternalUrl } = require('./url-security.cjs')
const { CSP } = require('./csp.cjs')

const isDev = !app.isPackaged

// 便携模式：数据目录跟随软件所在位置（软件放哪，数据就在哪的 data 子目录）
// 仅打包版生效；开发模式（npm run dev / electron .）仍用默认 userData
if (app.isPackaged) {
  try {
    const dataDir = path.join(process.resourcesPath, '..', 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    app.setPath('userData', dataDir)
  } catch (e) {
    console.error('set userData failed:', e)
  }
}

let translateWin = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: '研途计划',
    backgroundColor: '#f5f6fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // 渲染进程沙箱：preload 仅用 contextBridge/ipcRenderer，兼容
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    // 协议白名单：仅 http/https 允许打开（file:/javascript:/data: 等一律拒绝）
    if (isAllowedExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

// 独立置顶翻译小窗
function createTranslateWindow() {
  if (translateWin && !translateWin.isDestroyed()) {
    translateWin.show()
    translateWin.focus()
    translateWin.webContents.send('paste-from-clipboard')
    return translateWin
  }
  translateWin = new BrowserWindow({
    width: 380,
    height: 420,
    minWidth: 300,
    minHeight: 260,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    title: '快速翻译',
    backgroundColor: '#f5f6fa',
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev) {
    translateWin.loadURL('http://localhost:5173/translate.html')
  } else {
    translateWin.loadFile(path.join(__dirname, '../dist/translate.html'))
  }

  translateWin.on('closed', () => { translateWin = null })
  translateWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  translateWin.once('ready-to-show', () => translateWin.show())
  return translateWin
}

// 小窗窗口控制
ipcMain.on('translate-window-control', (_e, action) => {
  if (!translateWin || translateWin.isDestroyed()) return
  if (action === 'close') translateWin.close()
  else if (action === 'minimize') translateWin.minimize()
  else if (action === 'pin') translateWin.setAlwaysOnTop(!translateWin.isAlwaysOnTop())
})

// 小窗刷新剪贴板
ipcMain.on('translate-paste', () => {
  if (translateWin && !translateWin.isDestroyed()) {
    let text = ''
    try { text = clipboard.readText() } catch {}
    translateWin.webContents.send('paste-from-clipboard', { text })
  }
})

// 渲染进程请求打开翻译小窗
ipcMain.on('open-translate-window', () => {
  const win = createTranslateWindow()
  if (win) {
    setTimeout(() => {
      let text = ''
      try { text = clipboard.readText() } catch {}
      win.webContents.send('paste-from-clipboard', { text })
    }, 200)
  }
})

// 全局快捷键：应用未聚焦时也能呼出
function registerGlobalShortcut() {
  const ok1 = globalShortcut.register('CommandOrControl+Shift+K', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (!win.isVisible()) win.show()
      if (win.isMinimized()) win.restore()
      win.focus()
      win.webContents.send('global-shortcut')
    }
  })
  if (!ok1) console.warn('[shortcut] Ctrl+Shift+K 注册失败（可能被其他应用占用）')

  // 全局翻译快捷键 Ctrl+Shift+T：呼出独立置顶翻译小窗，自动带上剪贴板内容
  const ok2 = globalShortcut.register('CommandOrControl+Shift+T', () => {
    const win = createTranslateWindow()
    if (win) {
      setTimeout(() => {
        let clipText = ''
        try { clipText = clipboard.readText() } catch {}
        win.webContents.send('paste-from-clipboard', { text: clipText })
      }, 200)
    }
  })
  if (!ok2) console.warn('[shortcut] Ctrl+Shift+T 注册失败（可能被其他应用占用）')
}

// 剪贴板读取
ipcMain.handle('read-clipboard', () => {
  try { return { ok: true, text: clipboard.readText() } }
  catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) } }
})

// 自动备份目录处理（打包后存储数据到用户目录）
function ensureDataDir() {
  const dir = path.join(app.getPath('userData'), 'backups')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// 备份存储：唯一临时文件 + 原子写 + 保留最近 14 份（修复同日覆盖 / tmp 固定名冲突）
const backupStore = createBackupStore(path.join(app.getPath('userData'), 'backups'))

ipcMain.handle('backup-dir', () => ensureDataDir())
ipcMain.handle('save-backup', (_e, json) => backupStore.save(String(json)))
ipcMain.handle('list-backups', () => backupStore.list())
ipcMain.handle('load-backup', (_e, name) => backupStore.load(name))

// ===== 资讯抓取 =====
// 抓取过程中的配置缓存（由渲染进程通过 set-news-config 更新）
let newsConfig = { xKey: '', xSecret: '', includeX: false, rssKeys: null, includeHot: true }

// X 密钥经 safeStorage 加密后落盘，避免明文写入 localStorage
// 安全边界：密钥只存在于主进程；renderer 仅能查询 configured 状态（Task 2）
const xCredStore = createCredentialsStore(path.join(app.getPath('userData'), 'x-credentials.bin'), safeStorage)

ipcMain.handle('set-news-config', (_e, cfg) => {
  newsConfig = { ...newsConfig, ...cfg }
  return true
})

ipcMain.handle('get-x-credentials', () => ({ configured: xCredStore.configured() }))

ipcMain.handle('set-x-credentials', (_e, key, secret) => {
  // partial 合并写入：留空字段保留旧值（renderer 不回显密钥后的安全写语义）
  return xCredStore.savePartial(key, secret)
})

ipcMain.handle('fetch-news', async (_e, override = null) => {
  const creds = xCredStore.load()
  const opts = { ...newsConfig, xKey: creds.key, xSecret: creds.secret, ...(override || {}) }
  try {
    const items = await fetchAllNews(opts)
    return { ok: true, items, time: new Date().toISOString() }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), items: [] }
  }
})

ipcMain.handle('fetch-article', async (_e, url) => {
  return fetchArticle(url)
})

ipcMain.handle('translate-text', async (_e, text) => {
  try {
    return await translateText(text, 'zh-CN')
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
})

// 定时自动抓取：默认每天 09:00 与 15:00，向渲染进程推送
function scheduleNewsFetch() {
  const run = () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    const creds = xCredStore.load()
    fetchAllNews({ ...newsConfig, xKey: creds.key, xSecret: creds.secret })
      .then((items) => win.webContents.send('news-auto-update', { items, time: new Date().toISOString() }))
      .catch(() => {})
  }
  const timer = () => {
    const now = new Date()
    const next = new Date(now)
    const h = now.getHours()
    if (h < 9) next.setHours(9, 0, 0, 0)
    else if (h < 15) next.setHours(15, 0, 0, 0)
    else {
      // 15:00 之后排到次日 09:00（原来 setHours(24) 会变成当天午夜，产生未声明的 00:00 抓取）
      next.setDate(now.getDate() + 1)
      next.setHours(9, 0, 0, 0)
    }
    const delay = Math.max(1000, next - now)
    setTimeout(() => {
      run()
      timer()
    }, delay)
  }
  timer()
}

// ===== 局域网共享访问（平板浏览器通过它读写同一份数据） =====
let syncStorage = null
let syncWatcher = null
let syncNotifyTimer = null
let lastDesktopWrite = 0
let lanPort = null
let lanInstance = null

// 写入节流 + reload 前强制落盘（修复：reload 打断节流计时器导致未落盘数据丢失）
// 见 electron/sync-manager.cjs 的时序语义与测试
const syncManager = createSyncManager({
  write: (data) => {
    lastDesktopWrite = Date.now()
    try { syncStorage && syncStorage.write(data) } catch (e) { console.error('[sync] flush write failed:', e) }
  },
  reload: reloadRenderers,
})

function reloadRenderers() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        // 翻译小窗不参与数据刷新
        if (String(win.webContents.getURL()).includes('translate.html')) continue
        win.webContents.reload()
      } catch {}
    }
  }
}

// 生成或读取局域网访问 token（首次启动随机生成并持久化）
function ensureLanToken() {
  const file = path.join(app.getPath('userData'), 'lan-token.txt')
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim()
    if (existing) return existing
  } catch {}
  const token = crypto.randomBytes(16).toString('hex')
  try { fs.writeFileSync(file, token, 'utf-8') } catch {}
  return token
}

function startLanAccess() {
  const storageFile = path.join(app.getPath('userData'), 'sync', 'grad-planner-storage.json')
  syncStorage = createStorageAccess(storageFile)
  ipcMain.handle('sync-storage-get', () => syncStorage.read())
  ipcMain.handle('sync-storage-set', (_e, data) => {
    if (typeof data !== 'string') return { ok: false, error: 'invalid data' }
    // 写入节流：300ms 内的连续写入合并为一次落盘；reload 前会强制 flush（见 syncManager）
    syncManager.setPending(data)
    return { ok: true }
  })
  ipcMain.handle('sync-storage-remove', () => {
    syncManager.clear()
    lastDesktopWrite = Date.now()
    return syncStorage.remove()
  })
  ipcMain.handle('lan-port', () => lanPort)

  // 监控共享数据文件：平板端修改后，桌面端自动刷新页面加载最新数据
  let lastReloadHash = null
  const storageHash = () => {
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(storageFile)).digest('hex')
    } catch { return null }
  }
  try {
    fs.mkdirSync(path.dirname(storageFile), { recursive: true })
    lastReloadHash = storageHash()
    syncWatcher = fs.watch(path.dirname(storageFile), { persistent: false }, (evt, name) => {
      if (name && name.endsWith('grad-planner-storage.json')) {
        if (Date.now() - lastDesktopWrite < 800) return // 桌面端自己的写入，跳过
        clearTimeout(syncNotifyTimer)
        // 内容哈希校验：文件内容未变化时不刷新，避免无意义的整页重载
        syncNotifyTimer = setTimeout(() => {
          const h = storageHash()
          if (h === null || h === lastReloadHash) return
          lastReloadHash = h
          // 关键修复：reload 前先落盘桌面端 pending 数据，避免平板刷新打断节流写入
          syncManager.flushAndReload()
        }, 300)
      }
    })
  } catch (e) {
    console.error('[lan-server] fs.watch failed:', e)
  }

  const basePort = Number(process.env.GRAD_LAN_PORT) || 8899
  const lanToken = ensureLanToken()
  startLanServer({
    webRoot: path.join(__dirname, '../dist'),
    storageFile,
    basePort,
    token: lanToken,
  }, (info) => {
    lanPort = info.port
    lanInstance = info.lan
    const urls = info.addresses.map((a) => `http://${a}:${info.port}/?token=${lanToken}`)
    console.log('[lan-server] 局域网访问已开启:')
    urls.forEach((u) => console.log('[lan-server]   ' + u))
    if (urls.length > 0 && Notification.isSupported()) {
      try {
        new Notification({
          title: '研途计划 · 局域网访问已开启',
          body: `平板浏览器打开: ${urls[0]}`,
        }).show()
      } catch {}
    }
  })
}

// 局域网访问信息与令牌重置（设置页使用）
ipcMain.handle('lan-info', () => ({
  port: lanPort,
  token: ensureLanToken(),
  addresses: lanAddresses().map((a) => a.address),
}))

ipcMain.handle('lan-reset-token', () => {
  const token = crypto.randomBytes(16).toString('hex')
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'lan-token.txt'), token, 'utf-8') } catch {}
  if (lanInstance && typeof lanInstance.setToken === 'function') lanInstance.setToken(token)
  return { ok: true, token }
})

// 在系统默认浏览器中打开外链（应用内部不跳转网页）
// 协议白名单与 setWindowOpenHandler 一致：仅 http/https
ipcMain.handle('open-external', (_e, url) => {
  if (isAllowedExternalUrl(url)) shell.openExternal(url)
  return true
})

app.whenReady().then(() => {
  // CSP 纵深防御：生产模式注入响应头（与构建注入的 HTML meta 一致，双保险）
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP],
        },
      })
    })
  }

  createWindow()
  registerGlobalShortcut()
  scheduleNewsFetch()
  startLanAccess()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  syncManager.flush() // 退出前把节流中待写入的数据落盘
  globalShortcut.unregisterAll()
})

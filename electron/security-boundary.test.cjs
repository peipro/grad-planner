const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const mainSrc = () => fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf-8')
const preloadSrc = () => fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf-8')

// 安全边界静态回归：验证关键防护代码存在（防未来重构/误删）

test('BrowserWindow：contextIsolation + nodeIntegration:false + sandbox 全开启', () => {
  const src = mainSrc()
  assert.ok(src.includes('contextIsolation: true'))
  assert.ok(src.includes('nodeIntegration: false'))
  assert.ok(src.includes('sandbox: true'))
})

test('will-navigate 导航防护存在（外链转系统浏览器，其余拒绝）', () => {
  const src = mainSrc()
  assert.ok(src.includes('will-navigate'), '必须存在 will-navigate 监听')
  assert.ok(src.includes('guardNavigation'), '必须存在 guardNavigation 守卫函数')
  assert.ok(src.includes('event.preventDefault()'), '非自身导航必须阻止')
})

test('setWindowOpenHandler 全部接入协议白名单', () => {
  const src = mainSrc()
  const handlers = (src.match(/setWindowOpenHandler/g) || []).length
  assert.ok(handlers >= 2, `应有 >=2 处 setWindowOpenHandler（主窗+翻译窗），实际 ${handlers}`)
  assert.ok(src.includes('isAllowedExternalUrl'), 'setWindowOpenHandler 必须使用协议白名单')
})

test('read-clipboard 权限边界：仅翻译小窗可调用', () => {
  const src = mainSrc()
  assert.ok(src.includes('e.sender !== translateWin.webContents'), '必须校验 sender 为翻译小窗')
  assert.ok(src.includes("'permission denied'"), '非翻译小窗调用必须拒绝')
})

test('get-x-credentials 不向 renderer 返回密钥', () => {
  const src = mainSrc()
  assert.ok(src.includes("get-x-credentials', () => ({ configured: xCredStore.configured() })"), 'get-x-credentials 只能返回 configured')
})

test('preload：只通过 contextBridge 暴露封装方法', () => {
  const src = preloadSrc()
  assert.ok(src.includes('contextBridge.exposeInMainWorld'), '必须使用 contextBridge')
  assert.ok(!src.includes("exposeInMainWorld('ipcRenderer'"), '不得暴露原始 ipcRenderer')
})

test('外部请求（news.cjs）全部经 URL 校验入口', () => {
  const news = fs.readFileSync(path.join(__dirname, 'news.cjs'), 'utf-8')
  assert.ok(news.includes("require('./url-security.cjs')"), 'news.cjs 必须引入 url-security')
  assert.ok(news.includes('validateExternalUrl(url)'), '请求入口必须调用 validateExternalUrl')
})

test('LAN 服务器存在 Origin/CSRF 校验', () => {
  const lan = fs.readFileSync(path.join(__dirname, 'lan-server.cjs'), 'utf-8')
  assert.ok(lan.includes('originAllowed'), '必须存在 originAllowed 函数')
  assert.ok(lan.includes("'origin not allowed'"), '恶意 Origin 必须返回 403')
})

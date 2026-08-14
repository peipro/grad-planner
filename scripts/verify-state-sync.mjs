// Phase 1B-2 人工双端验收（临时诊断脚本）
// 模拟 Tablet：POST /api/mutations 创建 Task
// 验证：1) 权威文件更新  2) Desktop renderer 就地收到 state-sync（localStorage 缓存更新） 3) 无 reload（frameNavigated = 0）
import { readFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9222'
const LAN = 'http://127.0.0.1:8900'
const TOKEN = process.argv[2]
const STORAGE_FILE = process.argv[3]

let navCount = 0
const targets = await fetch(`${CDP}/json`).then((r) => r.json())
const page = targets.find((t) => t.type === 'page' && t.url.includes('5173'))
if (!page) { console.error('FAIL: 未找到主窗口 page target'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id) }
  else if (msg.method === 'Page.frameNavigated') navCount += 1
}
const send = (method, params = {}) => new Promise((resolve) => {
  const mid = ++seq
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evaluate = async (expr) => {
  // send resolve(msg.result)，所以这里 r = { result: { type, value }, exceptionDetails? }
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r && r.result ? r.result.value : undefined
}

await send('Page.enable')
await send('Runtime.enable')

// 1. 初始状态（确认应用已加载、权威文件存在）
// 注意：localStorage.getItem(SYNC_KEY) 被 sync-adapter patch 为异步（remoteGet 返回 Promise），必须 await
const beforeLs = await evaluate(`(async () => { try { const v = await localStorage.getItem('grad-planner-storage'); return v ? v.length : 0; } catch (e) { return -1 } })()`)
console.log('初始 renderer localStorage 长度:', beforeLs)

// 2. 模拟 Tablet：创建 Task
const body = {
  mutations: [{
    type: 'task.create',
    payload: { id: 'verify-task-' + Date.now(), title: '平板验证任务-' + Date.now(), priority: 'high', status: 'todo', createdAt: new Date().toISOString() },
  }],
}
const res = await fetch(`${LAN}/api/mutations?token=${TOKEN}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const j = await res.json()
console.log('POST /api/mutations ->', res.status, 'ok=' + j.ok)

// 3. 等待 state-sync 广播 + persist 本地缓存
await new Promise((r) => setTimeout(r, 1000))

// 4. 验证 renderer 就地更新（localStorage 缓存包含新任务 = state-sync → persist setItem 已执行）
const afterLs = await evaluate(`(async () => { try { const v = await localStorage.getItem('grad-planner-storage'); return v ? v.includes('平板验证任务-') : false; } catch (e) { return false } })()`)
console.log('renderer 收到 state-sync（localStorage 含新任务）:', afterLs)

// 5. 验证权威文件
let fileOk = false
try {
  const txt = readFileSync(STORAGE_FILE, 'utf-8')
  fileOk = txt.includes('平板验证任务-')
  console.log('权威文件含新任务:', fileOk)
} catch (e) {
  console.log('权威文件读取失败:', e.message)
}

// 6. 验证无 reload
console.log('frameNavigated（页面 reload）次数:', navCount)

const pass = res.ok && j.ok && afterLs && fileOk && navCount === 0
console.log(pass ? '=== 人工验收通过（A/B 双向验证完成） ===' : '=== 验收失败 ===')
ws.close()
process.exit(pass ? 0 : 1)

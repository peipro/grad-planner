const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createLanServer, createStorageAccess, resolveWebPath } = require('./lan-server.cjs')
const { createMutationEngine } = require('./mutation-engine.cjs')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lan-test-'))
}

test('resolveWebPath 正常文件与 index 回退', () => {
  const root = tmpDir()
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'index.html'), 'hi')
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'js')

  const hit1 = resolveWebPath(root, '/')
  assert.ok(hit1 && hit1.file.endsWith('index.html'))
  const hit2 = resolveWebPath(root, '/assets/app.js')
  assert.ok(hit2 && hit2.file.endsWith('app.js'))
  const hit3 = resolveWebPath(root, '/index.html')
  assert.ok(hit3)
})

test('resolveWebPath 拒绝路径穿越', () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'hi')
  assert.strictEqual(resolveWebPath(root, '/../secret'), null)
  assert.strictEqual(resolveWebPath(root, '/..%2f..%2fetc%2fpasswd'), null)
  assert.strictEqual(resolveWebPath(root, '/../../windows/win.ini'), null)
  assert.strictEqual(resolveWebPath(root, '/assets/../../index.html'), null)
})

test('createStorageAccess 读写删', () => {
  const dir = tmpDir()
  const acc = createStorageAccess(path.join(dir, 'sync', 's.json'))
  assert.deepStrictEqual(acc.read(), { found: false, data: null })
  assert.deepStrictEqual(acc.write('{"a":1}'), { ok: true })
  assert.deepStrictEqual(acc.read(), { found: true, data: '{"a":1}' })
  assert.deepStrictEqual(acc.remove(), { ok: true })
  assert.deepStrictEqual(acc.read(), { found: false, data: null })
})

test('HTTP: 静态文件、API 读写、404、405', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), '<html>ok</html>')
  fs.writeFileSync(path.join(root, 'sync-adapter.js'), 'adapter')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')

  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`

  try {
    let r = await fetch(`${base}/`)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(await r.text(), '<html>ok</html>')

    r = await fetch(`${base}/sync-adapter.js`)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(await r.text(), 'adapter')

    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 404)

    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: '{"x":1}' })
    assert.strictEqual(r.status, 200)

    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(await r.text(), '{"x":1}')

    r = await fetch(`${base}/api/storage`, { method: 'DELETE' })
    assert.strictEqual(r.status, 200)
    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 404)

    r = await fetch(`${base}/nope.html`)
    assert.strictEqual(r.status, 404)

    r = await fetch(`${base}/api/storage`, { method: 'PATCH' })
    assert.strictEqual(r.status, 405)
  } finally {
    await inst.stop()
  }
})

test('HTTP: 路径穿越请求被拒绝', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const inst = createLanServer({ webRoot: root, storageFile: path.join(tmpDir(), 's.json'), basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    const r = await fetch(`${base}/../lan-server.cjs`)
    assert.strictEqual(r.status, 404)
    const r2 = await fetch(`${base}/..%2f..%2flauncher`)
    assert.strictEqual(r2.status, 404)
  } finally {
    await inst.stop()
  }
})

test('端口占用自动顺延', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const a = createLanServer({ webRoot: root, storageFile: path.join(tmpDir(), 's.json'), basePort: 0 })
  const pa = await a.start()
  const b = createLanServer({ webRoot: root, storageFile: path.join(tmpDir(), 's2.json'), basePort: pa })
  try {
    const pb = await b.start()
    assert.notStrictEqual(pa, pb)
  } finally {
    await a.stop()
    await b.stop()
  }
})

test('HTTP: token 鉴权保护 /api/storage，静态页面开放', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0, token: 'secret123' })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    let r = await fetch(`${base}/index.html`)
    assert.strictEqual(r.status, 200)

    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 401)

    r = await fetch(`${base}/api/storage?token=wrong`)
    assert.strictEqual(r.status, 401)

    r = await fetch(`${base}/api/storage?token=secret123`)
    assert.strictEqual(r.status, 404)

    r = await fetch(`${base}/api/storage?token=secret123`, { method: 'PUT', body: '{"x":1}' })
    assert.strictEqual(r.status, 200)

    r = await fetch(`${base}/api/storage`, { headers: { Authorization: 'Bearer secret123' } })
    assert.strictEqual(r.status, 200)
  } finally {
    await inst.stop()
  }
})

test('HTTP: 访问日志不记录 token 查询串', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const dir = tmpDir()
  const storageFile = path.join(dir, 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0, token: 'leakcheck123' })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    const r = await fetch(`${base}/api/storage?token=leakcheck123`, { method: 'PUT', body: '{}' })
    assert.strictEqual(r.status, 200)
    const logText = fs.readFileSync(path.join(dir, 'sync', 'lan-access.log'), 'utf-8')
    assert.ok(logText.includes('/api/storage'), '日志应记录请求路径')
    assert.ok(!logText.includes('leakcheck123'), '日志不得包含 token')
  } finally {
    await inst.stop()
  }
})

test('HTTP: setToken 热重置令牌', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0, token: 'oldtoken' })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    let r = await fetch(`${base}/api/storage?token=oldtoken`)
    assert.strictEqual(r.status, 404) // 旧令牌有效
    inst.setToken('newtoken')
    r = await fetch(`${base}/api/storage?token=oldtoken`)
    assert.strictEqual(r.status, 401) // 旧令牌失效
    r = await fetch(`${base}/api/storage?token=newtoken`)
    assert.strictEqual(r.status, 404) // 新令牌生效
  } finally {
    await inst.stop()
  }
})

// ===== Task 2: PUT 严格校验 JSON（非法内容绝不允许写坏唯一数据源） =====

test('HTTP: 非法 JSON PUT → 400 且原文件不变', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    // 先写入一份合法数据
    let r = await fetch(`${base}/api/storage`, { method: 'PUT', body: '{"tasks":[{"id":"t1"}]}' })
    assert.strictEqual(r.status, 200)

    // 非法 JSON：必须 400，且文件保持原样
    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: '这不是JSON{{{{' })
    assert.strictEqual(r.status, 400)
    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(await r.text(), '{"tasks":[{"id":"t1"}]}', '非法 JSON 不得修改现有 storage')
  } finally {
    await inst.stop()
  }
})

test('HTTP: 顶层结构错误（字段应为数组却是其他类型）→ 400', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    let r = await fetch(`${base}/api/storage`, { method: 'PUT', body: '{"events":"not-an-array"}' })
    assert.strictEqual(r.status, 400)
    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: '{"tasks":{}}' })
    assert.strictEqual(r.status, 400)
    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: '{"paperStages":["a", 3]}' })
    assert.strictEqual(r.status, 400)
    // 根节点必须是对象
    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: '[1,2,3]' })
    assert.strictEqual(r.status, 400)
    // 原文件仍不存在（全部被拒绝）
    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 404)
  } finally {
    await inst.stop()
  }
})

test('HTTP: 合法 JSON → 200 且数据正确写入', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    const payload = JSON.stringify({
      events: [{ id: 'e1', title: '组会' }],
      tasks: [{ id: 't1', title: '写论文' }],
      milestones: [],
      notes: [],
      pomodoros: [],
      birthdays: [],
      habits: [],
      projects: [],
      papers: [],
      paperStages: ['阶段0'],
    })
    let r = await fetch(`${base}/api/storage`, { method: 'PUT', body: payload })
    assert.strictEqual(r.status, 200)
    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 200)
    const saved = JSON.parse(await r.text())
    assert.strictEqual(saved.tasks[0].title, '写论文')
    assert.strictEqual(saved.paperStages[0], '阶段0')
  } finally {
    await inst.stop()
  }
})

test('HTTP: 超大 body → 413 且不写盘', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    // 11MB 超过 MAX_BODY(10MB)
    const big = JSON.stringify({ tasks: 'x'.repeat(11 * 1024 * 1024) })
    const r = await fetch(`${base}/api/storage`, { method: 'PUT', body: big })
    assert.strictEqual(r.status, 413)
    const r2 = await fetch(`${base}/api/storage`)
    assert.strictEqual(r2.status, 404, '超大 body 不得写入文件')
  } finally {
    await inst.stop()
  }
})

test('HTTP: 并发 PUT（多客户端同时写入）不互相损坏，最后一次生效', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    const mk = (n) => JSON.stringify({ tasks: [{ id: n, title: 'T' + n }] })
    await Promise.all([
      fetch(`${base}/api/storage`, { method: 'PUT', body: mk('a') }),
      fetch(`${base}/api/storage`, { method: 'PUT', body: mk('b') }),
      fetch(`${base}/api/storage`, { method: 'PUT', body: mk('c') }),
    ])
    const r = await fetch(`${base}/api/storage`)
    const saved = JSON.parse(await r.text())
    assert.ok(['a', 'b', 'c'].includes(saved.tasks[0].id), '并发写入后文件必须是完整合法 JSON')
    assert.strictEqual(saved.tasks.length, 1, 'last-write-wins：最终只保留最后一份（已知限制，Phase 1 处理冲突）')
  } finally {
    await inst.stop()
  }
})

// ===== Task 5: LAN Origin / CSRF 防护（写操作跨站防护，不破坏合法同步） =====

test('HTTP: 合法请求（无 Origin，如 curl/CLI）不受影响', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    // GET 无 Origin
    let r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 404)
    // PUT 无 Origin（curl / CLI 场景）
    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: '{"tasks":[]}' })
    assert.strictEqual(r.status, 200)
    // DELETE 无 Origin
    r = await fetch(`${base}/api/storage`, { method: 'DELETE' })
    assert.strictEqual(r.status, 200)
  } finally {
    await inst.stop()
  }
})

test('HTTP: 合法平板同步（自身 Origin）不受影响', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  const selfOrigin = base // http://127.0.0.1:port
  try {
    // GET
    let r = await fetch(`${base}/api/storage`, { headers: { Origin: selfOrigin } })
    assert.strictEqual(r.status, 404)
    // PUT
    r = await fetch(`${base}/api/storage`, { method: 'PUT', headers: { Origin: selfOrigin }, body: '{"events":[]}' })
    assert.strictEqual(r.status, 200)
    // GET 回读
    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(await r.text(), '{"events":[]}')
    // DELETE
    r = await fetch(`${base}/api/storage`, { method: 'DELETE', headers: { Origin: selfOrigin } })
    assert.strictEqual(r.status, 200)
  } finally {
    await inst.stop()
  }
})

test('HTTP: localhost 本机变体 Origin 允许', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/storage`, { method: 'PUT', headers: { Origin: `http://localhost:${port}` }, body: '{"tasks":[]}' })
    assert.strictEqual(r.status, 200)
  } finally {
    await inst.stop()
  }
})

test('HTTP: 恶意跨站 PUT（evil Origin）→ 403 且不写盘', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    let r = await fetch(`${base}/api/storage`, { method: 'PUT', headers: { Origin: 'http://evil.com' }, body: '{"tasks":[{"id":"evil"}]}' })
    assert.strictEqual(r.status, 403)
    // 原文件未被写入
    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 404, '恶意跨站 PUT 不得写盘')
  } finally {
    await inst.stop()
  }
})

test('HTTP: 恶意跨站 DELETE（evil Origin）→ 403', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    // 先写入合法数据
    await fetch(`${base}/api/storage`, { method: 'PUT', body: '{"tasks":[]}' })
    const r = await fetch(`${base}/api/storage`, { method: 'DELETE', headers: { Origin: 'http://evil.com' } })
    assert.strictEqual(r.status, 403)
    // 数据未被删除
    const r2 = await fetch(`${base}/api/storage`)
    assert.strictEqual(r2.status, 200, '恶意跨站 DELETE 不得删除数据')
  } finally {
    await inst.stop()
  }
})

test('HTTP: 恶意非 http Origin → 403', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    for (const bad of ['null', 'file:///etc', 'http://'] ) {
      const r = await fetch(`${base}/api/storage`, { method: 'PUT', headers: { Origin: bad }, body: '{"tasks":[]}' })
      assert.strictEqual(r.status, 403, `Origin=${bad} 应被拒绝`)
    }
  } finally {
    await inst.stop()
  }
})

// ===== Phase 1B-1: POST /api/mutations（Tablet → 同一个 Mutation Engine） =====

function makeTask(id, overrides = {}) {
  return {
    id, title: `Task ${id}`, priority: 'medium', status: 'todo',
    createdAt: '2026-08-14T00:00:00.000Z', ...overrides,
  }
}

function makeNote(id, overrides = {}) {
  return {
    id, title: `Note ${id}`, content: 'c', tags: [],
    createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', ...overrides,
  }
}

test('HTTP: POST /api/mutations → 200 + results（Tablet task.create）', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const engine = createMutationEngine({ storageFile })
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0, mutationEngine: engine })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    const r = await fetch(`${base}/api/mutations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations: [{ type: 'task.create', payload: makeTask('t1') }] }),
    })
    assert.strictEqual(r.status, 200)
    const j = await r.json()
    assert.strictEqual(j.ok, true)
    assert.strictEqual(j.results[0].id, 't1')
    // 引擎权威 state 与磁盘文件均已更新
    assert.strictEqual(engine.getState().tasks.length, 1)
    assert.strictEqual(JSON.parse(fs.readFileSync(storageFile, 'utf-8')).state.tasks.length, 1)
  } finally {
    await inst.stop()
  }
})

test('HTTP: POST /api/mutations 非法 body / 非法 mutation → 400', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const engine = createMutationEngine({ storageFile })
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0, mutationEngine: engine })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    // 非法 JSON
    let r = await fetch(`${base}/api/mutations`, { method: 'POST', body: 'not-json' })
    assert.strictEqual(r.status, 400)
    // 缺 mutations 字段
    r = await fetch(`${base}/api/mutations`, { method: 'POST', body: '{}' })
    assert.strictEqual(r.status, 400)
    // mutations 非数组
    r = await fetch(`${base}/api/mutations`, { method: 'POST', body: JSON.stringify({ mutations: 'x' }) })
    assert.strictEqual(r.status, 400)
    // 未知 mutation 类型 → 400 + error 码
    r = await fetch(`${base}/api/mutations`, {
      method: 'POST',
      body: JSON.stringify({ mutations: [{ type: 'bogus.create', payload: {} }] }),
    })
    assert.strictEqual(r.status, 400)
    const j = await r.json()
    assert.strictEqual(j.ok, false)
    assert.strictEqual(j.error, 'invalid_mutation')
    // 引擎未被污染
    assert.strictEqual(engine.getState(), null)
  } finally {
    await inst.stop()
  }
})

test('HTTP: POST /api/mutations 无 token → 401；evil Origin → 403', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const engine = createMutationEngine({ storageFile })
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0, token: 'tok123', mutationEngine: engine })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  const body = JSON.stringify({ mutations: [{ type: 'task.create', payload: makeTask('t1') }] })
  try {
    let r = await fetch(`${base}/api/mutations`, { method: 'POST', body })
    assert.strictEqual(r.status, 401)
    r = await fetch(`${base}/api/mutations?token=wrong`, { method: 'POST', body })
    assert.strictEqual(r.status, 401)
    r = await fetch(`${base}/api/mutations?token=tok123`, { method: 'POST', headers: { Origin: 'http://evil.com' }, body })
    assert.strictEqual(r.status, 403)
    // 引擎无写入
    assert.strictEqual(engine.getState(), null)
  } finally {
    await inst.stop()
  }
})

test('双通道同一引擎：IPC 直接调用与 HTTP POST 交错 → 两个修改都保留（无 lost update）', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  // 模拟 main.cjs：IPC 与 LAN 共用同一个 engine 实例
  const engine = createMutationEngine({ storageFile })
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0, mutationEngine: engine })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    // 桌面端（IPC 路径）：创建 Task A
    const r1 = engine.applyMutations([{ type: 'task.create', payload: makeTask('A') }])
    assert.strictEqual(r1.ok, true)
    // 平板端（HTTP 路径）：创建 Note B
    const r2 = await fetch(`${base}/api/mutations`, {
      method: 'POST',
      body: JSON.stringify({ mutations: [{ type: 'note.create', payload: makeNote('B') }] }),
    })
    assert.strictEqual(r2.status, 200)
    // 桌面端（IPC 路径）再改 Task A
    const r3 = engine.applyMutations([{ type: 'task.update', id: 'A', entity: makeTask('A', { title: 'A2' }) }])
    assert.strictEqual(r3.ok, true)
    // 最终：Task A ✅ Note B ✅（正是 Phase 1B-0 报告 §5 场景 5 的 lost update 场景）
    const st = engine.getState()
    assert.deepStrictEqual(st.tasks.map((t) => t.id), ['A'])
    assert.strictEqual(st.tasks[0].title, 'A2')
    assert.deepStrictEqual(st.notes.map((n) => n.id), ['B'])
    // 磁盘与内存一致
    const disk = JSON.parse(fs.readFileSync(storageFile, 'utf-8')).state
    assert.deepStrictEqual(disk.tasks.map((t) => t.id), ['A'])
    assert.deepStrictEqual(disk.notes.map((n) => n.id), ['B'])
  } finally {
    await inst.stop()
  }
})

test('双通道同一引擎：未注入 mutationEngine 时 POST /api/mutations → 500', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 }) // 无 mutationEngine
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    const r = await fetch(`${base}/api/mutations`, {
      method: 'POST',
      body: JSON.stringify({ mutations: [{ type: 'task.create', payload: makeTask('t1') }] }),
    })
    assert.strictEqual(r.status, 500)
  } finally {
    await inst.stop()
  }
})

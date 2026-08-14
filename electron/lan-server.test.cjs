const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createLanServer, createStorageAccess, resolveWebPath } = require('./lan-server.cjs')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lan-test-'))
}

// Phase 1B：PUT 提交为 submit 结构（expectedRevision/deviceId/changedIds/deletedIds/data）
const mkSubmit = (data, over = {}) => ({ expectedRevision: 0, deviceId: 'test-dev', changedIds: [], deletedIds: [], data, ...over })

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

test('HTTP: 静态文件、404、405', async () => {
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

    r = await fetch(`${base}/api/storage?token=secret123`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: [] })) })
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
    const r = await fetch(`${base}/api/storage?token=leakcheck123`, { method: 'PUT', body: JSON.stringify(mkSubmit({})) })
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
    assert.strictEqual(r.status, 404)
    inst.setToken('newtoken')
    r = await fetch(`${base}/api/storage?token=oldtoken`)
    assert.strictEqual(r.status, 401)
    r = await fetch(`${base}/api/storage?token=newtoken`)
    assert.strictEqual(r.status, 404)
  } finally {
    await inst.stop()
  }
})

// ===== Phase 1B: PUT 提交（envelope + revision） =====

test('HTTP: 合法 submit → 200 + revision，GET 返回 envelope', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    const r = await fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: [{ id: 't1', title: '写论文' }] }, { changedIds: ['tasks:t1'] })) })
    assert.strictEqual(r.status, 200)
    const body = await r.json()
    assert.strictEqual(body.ok, true)
    assert.strictEqual(body.revision, 1)

    const r2 = await fetch(`${base}/api/storage`)
    assert.strictEqual(r2.status, 200)
    const env = await r2.json()
    assert.strictEqual(env.schemaVersion, 1)
    assert.strictEqual(env.revision, 1)
    assert.strictEqual(env.data.tasks[0].title, '写论文')
    assert.ok(env.deviceId.length > 0, 'envelope 必须携带写入者 deviceId')
    assert.ok(env.writeId.length > 0, 'envelope 必须携带 writeId')
  } finally {
    await inst.stop()
  }
})

test('HTTP: 非法 JSON → 400 且原文件不变', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    let r = await fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: [] })) })
    assert.strictEqual(r.status, 200)

    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: '这不是JSON{{{{' })
    assert.strictEqual(r.status, 400)
    r = await fetch(`${base}/api/storage`)
    const env = await r.json()
    assert.strictEqual(env.revision, 1, '非法 JSON 不得修改现有 storage')
  } finally {
    await inst.stop()
  }
})

test('HTTP: submit 结构错误（data 非对象 / 缺 data）→ 400', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    let r = await fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify({ expectedRevision: 0 }) })
    assert.strictEqual(r.status, 400)
    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit('not-object')) })
    assert.strictEqual(r.status, 400)
    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: 'not-array' })) })
    assert.strictEqual(r.status, 400)
    // 原文件仍不存在
    r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 404)
  } finally {
    await inst.stop()
  }
})

test('HTTP: stale write（旧 revision）→ 409，不覆盖新数据', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    // 第一次提交（revision 0 → 1）
    let r = await fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: [{ id: 't1', title: '新数据' }] }, { changedIds: ['tasks:t1'] })) })
    assert.strictEqual(r.status, 200)
    // 用旧 revision 0 提交（stale）→ 409
    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: [{ id: 't1', title: '旧数据' }] }, { expectedRevision: 0, changedIds: ['tasks:t1'] })) })
    assert.strictEqual(r.status, 409)
    const body = await r.json()
    assert.strictEqual(body.status, 409)
    assert.strictEqual(body.serverData.tasks[0].title, '新数据', '服务端数据必须保持不变')
    // 文件仍是最新数据
    const r2 = await fetch(`${base}/api/storage`)
    const env = await r2.json()
    assert.strictEqual(env.data.tasks[0].title, '新数据')
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
    const big = JSON.stringify(mkSubmit({ tasks: 'x'.repeat(11 * 1024 * 1024) }))
    const r = await fetch(`${base}/api/storage`, { method: 'PUT', body: big })
    assert.strictEqual(r.status, 413)
    const r2 = await fetch(`${base}/api/storage`)
    assert.strictEqual(r2.status, 404, '超大 body 不得写入文件')
  } finally {
    await inst.stop()
  }
})

test('HTTP: 并发 PUT 保持文件完整合法（revision 单调递增，无冲突时都接受）', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    // 两个并发提交，各自期望 revision 0：一个成功（revision 1），另一个 stale（无 changedIds → merge 接受或 409）
    const results = await Promise.all([
      fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: [{ id: 'a', title: 'A' }] }, { changedIds: ['tasks:a'] })) }),
      fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: [{ id: 'b', title: 'B' }] }, { changedIds: ['tasks:b'] })) }),
    ])
    const statuses = results.map((r) => r.status)
    assert.ok(statuses.includes(200), '至少一个成功')
    // 文件必须是完整合法 envelope
    const r = await fetch(`${base}/api/storage`)
    const env = await r.json()
    assert.strictEqual(typeof env.revision, 'number')
    assert.ok(env.revision >= 1, 'revision 单调递增')
  } finally {
    await inst.stop()
  }
})

// ===== Task 5: LAN Origin / CSRF 防护 =====

test('HTTP: 合法请求（无 Origin，如 curl/CLI）不受影响', async () => {
  const root = tmpDir()
  fs.writeFileSync(path.join(root, 'index.html'), 'ok')
  const storageFile = path.join(tmpDir(), 'sync', 'grad.json')
  const inst = createLanServer({ webRoot: root, storageFile, basePort: 0 })
  const port = await inst.start()
  const base = `http://127.0.0.1:${port}`
  try {
    let r = await fetch(`${base}/api/storage`)
    assert.strictEqual(r.status, 404)
    r = await fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: [] })) })
    assert.strictEqual(r.status, 200)
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
  const selfOrigin = base
  try {
    let r = await fetch(`${base}/api/storage`, { headers: { Origin: selfOrigin } })
    assert.strictEqual(r.status, 404)
    r = await fetch(`${base}/api/storage`, { method: 'PUT', headers: { Origin: selfOrigin }, body: JSON.stringify(mkSubmit({ events: [] })) })
    assert.strictEqual(r.status, 200)
    r = await fetch(`${base}/api/storage`)
    const env = await r.json()
    assert.strictEqual(env.revision, 1)
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
    const r = await fetch(`http://127.0.0.1:${port}/api/storage`, { method: 'PUT', headers: { Origin: `http://localhost:${port}` }, body: JSON.stringify(mkSubmit({ tasks: [] })) })
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
    let r = await fetch(`${base}/api/storage`, { method: 'PUT', headers: { Origin: 'http://evil.com' }, body: JSON.stringify(mkSubmit({ tasks: [{ id: 'evil' }] })) })
    assert.strictEqual(r.status, 403)
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
    await fetch(`${base}/api/storage`, { method: 'PUT', body: JSON.stringify(mkSubmit({ tasks: [] })) })
    const r = await fetch(`${base}/api/storage`, { method: 'DELETE', headers: { Origin: 'http://evil.com' } })
    assert.strictEqual(r.status, 403)
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
    for (const bad of ['null', 'file:///etc', 'http://']) {
      const r = await fetch(`${base}/api/storage`, { method: 'PUT', headers: { Origin: bad }, body: JSON.stringify(mkSubmit({ tasks: [] })) })
      assert.strictEqual(r.status, 403, `Origin=${bad} 应被拒绝`)
    }
  } finally {
    await inst.stop()
  }
})

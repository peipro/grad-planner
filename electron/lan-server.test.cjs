const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createLanServer, createStorageAccess, resolveWebPath } = require('./lan-server.cjs')

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

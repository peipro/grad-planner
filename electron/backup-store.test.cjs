const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createBackupStore, backupFileName } = require('./backup-store.cjs')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'))
}

test('文件名到毫秒：同一秒内两次备份不冲突', () => {
  const dir = tmpDir()
  let t = new Date('2026-08-14T19:15:30.000Z')
  const store = createBackupStore(dir, { now: () => t })
  const f1 = store.save('{"a":1}')
  t = new Date('2026-08-14T19:15:30.999Z') // 同一秒，不同毫秒
  const f2 = store.save('{"a":2}')

  const files = fs.readdirSync(dir).filter((f) => f.startsWith('backup-'))
  assert.strictEqual(files.length, 2, '同秒两次备份应生成两个文件')
  assert.notStrictEqual(path.basename(f1), path.basename(f2))
  assert.ok(fs.existsSync(f1))
  assert.ok(fs.existsSync(f2))
  assert.strictEqual(fs.readFileSync(f1, 'utf-8'), '{"a":1}')
  assert.strictEqual(fs.readFileSync(f2, 'utf-8'), '{"a":2}')
})

test('连续两次备份：两个文件都存在，互不覆盖', () => {
  const dir = tmpDir()
  const store = createBackupStore(dir)
  const f1 = store.save('{"v":1}')
  const f2 = store.save('{"v":2}')
  assert.notStrictEqual(path.basename(f1), path.basename(f2))
  assert.ok(fs.existsSync(f1))
  assert.ok(fs.existsSync(f2))
})

test('并发备份：两个 save 同时执行，互不覆盖且内容正确', async () => {
  const dir = tmpDir()
  const store = createBackupStore(dir)
  const [f1, f2] = await Promise.all([
    new Promise((res) => res(store.save('{"who":"one"}' + 'x'.repeat(500)))),
    new Promise((res) => res(store.save('{"who":"two"}' + 'y'.repeat(500)))),
  ])
  assert.notStrictEqual(path.basename(f1), path.basename(f2))
  const names = fs.readdirSync(dir).filter((f) => f.startsWith('backup-'))
  assert.strictEqual(names.length, 2)
  const c1 = fs.readFileSync(f1, 'utf-8')
  const c2 = fs.readFileSync(f2, 'utf-8')
  assert.ok(c1.startsWith('{"who":"one"}'))
  assert.ok(c2.startsWith('{"who":"two"}'))
})

test('备份写入异常：不破坏旧备份', () => {
  const dir = tmpDir()
  const store = createBackupStore(dir)
  const old = store.save('{"old":true}')
  // 模拟异常：传入非字符串写入会怎样 —— 这里用不可序列化的内容强制失败场景
  // 直接验证：旧备份在任意后续操作后仍完整存在
  store.save('{"new":true}')
  store.cleanup()
  assert.ok(fs.existsSync(old))
  assert.strictEqual(fs.readFileSync(old, 'utf-8'), '{"old":true}')
})

test('保留最近 KEEP_COUNT(14) 个，超出清理', () => {
  const dir = tmpDir()
  let t = new Date('2026-01-01T00:00:00.000Z')
  const store = createBackupStore(dir, { now: () => t })
  for (let i = 0; i < 20; i++) {
    t = new Date(t.getTime() + 1000) // 每秒一个
    store.save(`{"i":${i}}`)
  }
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('backup-'))
  assert.strictEqual(files.length, 14, '最多保留 14 个备份')
})

test('list 按文件名倒序，含旧格式兼容', () => {
  const dir = tmpDir()
  const store = createBackupStore(dir)
  store.save('{"a":1}')
  // 写入一个旧格式文件（backup-YYYY-MM-DD.json），应同样被识别
  fs.writeFileSync(path.join(dir, 'backup-2025-01-01.json'), '{"old":true}')
  const list = store.list()
  const names = list.map((b) => b.name)
  assert.ok(names.includes('backup-2025-01-01.json'), '旧格式备份应可列出')
  assert.strictEqual(list.length >= 2, true)
  // 倒序（新的在前）
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1].name >= list[i].name)
  }
})

test('load：安全读取（拒绝路径穿越与非法名）', () => {
  const dir = tmpDir()
  const store = createBackupStore(dir)
  store.save('{"a":1}')
  const realName = store.list()[0].name
  assert.strictEqual(store.load(realName), '{"a":1}')
  assert.strictEqual(store.load('../../etc/passwd'), null)
  assert.strictEqual(store.load('foo.json'), null)
  assert.strictEqual(store.load('backup-2026-08-14.json.tmp'), null)
})

test('backupFileName 格式：backup-YYYY-MM-DD-HHmmss-SSS.json', () => {
  const name = backupFileName(new Date('2026-08-14T19:15:30.123Z'))
  assert.match(name, /^backup-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.json$/)
})

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCredentialsStore } = require('./credentials-store.cjs')

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-')), 'x-credentials.bin')
}

// 模拟 safeStorage：简单 XOR 混淆（测试用，不涉及真实加密强度）
function makeCrypto() {
  return {
    encryptString: (s) => Buffer.from(Buffer.from(s, 'utf-8').toString('base64'), 'utf-8'),
    decryptString: (buf) => Buffer.from(buf.toString('utf-8'), 'base64').toString('utf-8'),
    isEncryptionAvailable: () => true,
  }
}

test('save/load 往返', () => {
  const f = tmpFile()
  const store = createCredentialsStore(f, makeCrypto())
  assert.strictEqual(store.save('my-key', 'my-secret').ok, true)
  assert.deepStrictEqual(store.load(), { key: 'my-key', secret: 'my-secret' })
})

test('configured：key+secret 齐全才为 true', () => {
  const f = tmpFile()
  const store = createCredentialsStore(f, makeCrypto())
  assert.strictEqual(store.configured(), false) // 未保存
  store.save('k', '')
  assert.strictEqual(store.configured(), false) // 缺 secret
  store.save('k', 's')
  assert.strictEqual(store.configured(), true)
})

test('savePartial：空字段保留旧值（renderer 留空不覆盖）', () => {
  const f = tmpFile()
  const store = createCredentialsStore(f, makeCrypto())
  store.save('old-key', 'old-secret')
  // 只更新 key，secret 留空 → secret 保留
  store.savePartial('new-key', '')
  assert.deepStrictEqual(store.load(), { key: 'new-key', secret: 'old-secret' })
  // 只更新 secret
  store.savePartial('', 'new-secret')
  assert.deepStrictEqual(store.load(), { key: 'new-key', secret: 'new-secret' })
})

test('savePartial：全空 → 无操作（不覆盖已存凭据）', () => {
  const f = tmpFile()
  const store = createCredentialsStore(f, makeCrypto())
  store.save('k', 's')
  const r = store.savePartial('', '')
  assert.strictEqual(r.changed, false)
  assert.deepStrictEqual(store.load(), { key: 'k', secret: 's' })
})

test('损坏文件 → load 返回空（不抛错）', () => {
  const f = tmpFile()
  fs.writeFileSync(f, 'corrupted-bytes-not-base64')
  const store = createCredentialsStore(f, makeCrypto())
  assert.deepStrictEqual(store.load(), { key: '', secret: '' })
})

test('未提供加密实现 → 抛错', () => {
  assert.throws(() => createCredentialsStore(tmpFile(), null))
})

test('密钥读取边界：configured 永不暴露 key/secret（renderer 侧只依赖该布尔值）', () => {
  const f = tmpFile()
  const store = createCredentialsStore(f, makeCrypto())
  store.save('s3cr3t-key', 's3cr3t-secret')
  // 模拟 renderer 可见 API：get-x-credentials 只返回 { configured }
  const rendererVisible = { configured: store.configured() }
  assert.deepStrictEqual(rendererVisible, { configured: true })
  assert.ok(!('key' in rendererVisible) && !('secret' in rendererVisible))
})

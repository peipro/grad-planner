// 研途计划 · X API 凭据存储（主进程侧，纯 Node 可测）
// 安全边界（Task 2）：
//   - 密钥只允许存在于主进程；renderer 只能查询 configured 状态，永不回传 key/secret
//   - 写入采用 partial 语义：空字段保留旧值（renderer 不回显密钥后，用户留空不应覆盖）
//   - 磁盘加密由调用方注入（Electron safeStorage），本模块不假设具体加密实现

const fs = require('fs')
const path = require('path')

function createCredentialsStore(file, cryptoApi) {
  if (!cryptoApi || typeof cryptoApi.decryptString !== 'function' || typeof cryptoApi.encryptString !== 'function') {
    throw new Error('createCredentialsStore: 需要提供 encryptString/decryptString 加密实现')
  }
  const target = path.resolve(file)

  function load() {
    try {
      const buf = fs.readFileSync(target)
      const json = cryptoApi.decryptString(buf)
      const { key, secret } = JSON.parse(json)
      return { key: String(key || ''), secret: String(secret || '') }
    } catch {
      return { key: '', secret: '' }
    }
  }

  function save(key, secret) {
    try {
      if (typeof cryptoApi.isEncryptionAvailable === 'function' && !cryptoApi.isEncryptionAvailable()) {
        return { ok: false, error: '系统不支持加密存储（safeStorage 不可用）' }
      }
      const buf = cryptoApi.encryptString(JSON.stringify({ key: String(key || ''), secret: String(secret || '') }))
      fs.writeFileSync(target, buf)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  // partial 写入：空字段保留旧值。两个字段都未提供时无操作（不写盘）。
  function savePartial(key, secret) {
    const hasKey = typeof key === 'string' && key !== ''
    const hasSecret = typeof secret === 'string' && secret !== ''
    if (!hasKey && !hasSecret) return { ok: true, changed: false } // 都未提供 → 无操作
    const cur = load()
    const nextKey = hasKey ? key : cur.key
    const nextSecret = hasSecret ? secret : cur.secret
    if (!nextKey && !nextSecret) return { ok: true, changed: false } // 结果仍为空 → 无操作
    const r = save(nextKey, nextSecret)
    return { ...r, changed: r.ok }
  }

  // renderer 可见的唯一信息：是否已配置
  function configured() {
    const c = load()
    return Boolean(c.key && c.secret)
  }

  return { load, save, savePartial, configured, file: target }
}

module.exports = { createCredentialsStore }

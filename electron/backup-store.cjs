// 研途计划 · 备份文件存储（主进程侧，纯 Node 可测）
// 设计要点（对应审计 P0#9）：
//   - 文件名 backup-YYYY-MM-DD-HHmmss-SSS.json（到毫秒，同秒同毫秒也不冲突）
//   - 临时文件唯一 backup-*.json.tmp-<pid>-<ts>-<random>，并发备份不互相覆盖
//   - 原子写：写唯一临时文件 → rename
//   - 保留最近 KEEP_COUNT 个备份（默认 14）
// 向后兼容：旧格式 backup-YYYY-MM-DD.json 仍能被 list / load 识别。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const BACKUP_RE = /^backup-[\d-]+\.json$/
const KEEP_COUNT = 14

function pad(n) {
  return String(n).padStart(2, '0')
}

// 本地时间文件名：backup-2026-08-14-191530-123.json
function backupFileName(date = new Date()) {
  const p = (n) => pad(n)
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}-${ms}.json`
}

function createBackupStore(dir, options = {}) {
  const root = path.resolve(dir)
  const now = typeof options.now === 'function' ? options.now : () => new Date()

  function ensure() {
    fs.mkdirSync(root, { recursive: true })
    return root
  }

  // 原子写：唯一临时文件 + rename；异常时清理临时文件并抛出
  function save(json, date) {
    ensure()
    const file = path.join(root, backupFileName(date || now()))
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    try {
      fs.writeFileSync(tmp, json, 'utf-8')
      fs.renameSync(tmp, file)
    } catch (e) {
      try {
        fs.unlinkSync(tmp)
      } catch {}
      throw e
    }
    cleanup()
    return file
  }

  function list() {
    ensure()
    try {
      return fs
        .readdirSync(root)
        .filter((f) => BACKUP_RE.test(f))
        .map((f) => {
          const p = path.join(root, f)
          const st = fs.statSync(p)
          return { name: f, size: st.size, mtime: st.mtime.toISOString() }
        })
        .sort((a, b) => b.name.localeCompare(a.name))
    } catch {
      return []
    }
  }

  // 安全读取：拒绝目录外路径与非备份文件名
  function load(name) {
    ensure()
    const n = String(name)
    if (!BACKUP_RE.test(n)) return null
    const file = path.join(root, n)
    if (path.dirname(file) !== root) return null
    try {
      return fs.readFileSync(file, 'utf-8')
    } catch {
      return null
    }
  }

  // 保留最近 KEEP_COUNT 个（按文件名排序，含毫秒可精确排序）
  function cleanup() {
    try {
      const files = fs.readdirSync(root).filter((f) => BACKUP_RE.test(f)).sort().reverse()
      files.slice(KEEP_COUNT).forEach((f) => {
        try {
          fs.unlinkSync(path.join(root, f))
        } catch {}
      })
    } catch {}
  }

  return { dir: () => root, save, list, load, cleanup, backupFileName }
}

module.exports = { createBackupStore, backupFileName }

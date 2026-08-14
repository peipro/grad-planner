// 研途计划 · 局域网服务器
// 提供：静态前端（平板浏览器访问）+ /api/storage 数据读写（与桌面端共享同一份数据）
// 不依赖 electron，可在纯 Node 下运行与测试

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { validateStorageShape } = require('./storage-schema.cjs')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

const MAX_BODY = 10 * 1024 * 1024 // 10MB

// 共享数据文件访问（桌面端 IPC 与 HTTP API 共用）
function createStorageAccess(storageFile) {
  const file = path.resolve(storageFile)
  return {
    read() {
      try {
        return { found: true, data: fs.readFileSync(file, 'utf-8') }
      } catch (e) {
        if (e && e.code === 'ENOENT') return { found: false, data: null }
        return { found: false, data: null, error: String((e && e.message) || e) }
      }
    },
    write(data) {
      let tmp = null
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        // 原子写：先写临时文件再重命名，避免中途崩溃/断电损坏数据文件
        tmp = `${file}.tmp-${process.pid}-${Date.now()}`
        fs.writeFileSync(tmp, data, 'utf-8')
        fs.renameSync(tmp, file)
        return { ok: true }
      } catch (e) {
        if (tmp) { try { fs.unlinkSync(tmp) } catch {} }
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
    remove() {
      try {
        fs.rmSync(file, { force: true })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    },
  }
}

// 静态路径解析（防路径穿越）
// 返回 { file, isDir } 或 null
function resolveWebPath(webRoot, urlPath) {
  let rel
  try {
    rel = decodeURIComponent(urlPath.split('?')[0])
  } catch {
    return null
  }
  if (rel === '/' || rel === '') rel = '/index.html'
  const fp = path.normalize(path.join(webRoot, rel))
  if (fp !== webRoot && !fp.startsWith(webRoot + path.sep)) return null
  let st
  try {
    st = fs.statSync(fp)
  } catch {
    return null
  }
  if (st.isDirectory()) {
    const idx = path.join(fp, 'index.html')
    try {
      if (fs.statSync(idx).isFile()) return { file: idx, isDir: true }
    } catch {}
    return null
  }
  return { file: fp, isDir: false }
}

// 收集本机局域网 IPv4 地址（供提示用）
function lanAddresses() {
  const out = []
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue
      if (ni.address.startsWith('169.254.')) continue // APIPA
      out.push({ name, address: ni.address })
    }
  }
  return out
}

// 鉴权：配置了 token 时必须匹配 query(?token=)或 Authorization 头，否则拒绝
function authorize(req, token) {
  if (!token) return true
  try {
    const u = new URL(req.url, 'http://localhost')
    if (u.searchParams.get('token') === token) return true
  } catch {}
  const auth = String(req.headers['authorization'] || '')
  return auth === `Bearer ${token}`
}

// CSRF 防护：带 Origin 的请求必须来自本服务自身（或 localhost/127.0.0.1 本机）。
// 设计原则：不拒绝无 Origin 请求（curl/CLI/部分同源 fetch 无 Origin），
// 由 token 鉴权兜底；恶意网页跨站写请求会带 Origin: http://evil.com → 403。
function originAllowed(req, origin) {
  if (!origin || typeof origin !== 'string') return true // 无 Origin：非浏览器客户端，依赖 token
  let u
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = String(req.headers['host'] || '')
  if (!host) return false // 无 Host 头却带 Origin → 拒绝
  if (u.host === host) return true // 自身地址（含端口）
  // 本机变体：localhost / 127.0.0.1，端口一致
  if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
    const port = host.includes(':') ? host.split(':')[1] : (u.protocol === 'https:' ? '443' : '80')
    if (u.port === port || (u.port === '' && (port === '80' || port === '443'))) return true
  }
  return false
}

// 创建服务器；返回 { server, storage, start }
// mutationEngine：可选注入（Phase 1B-1）。提供时开放 POST /api/mutations（与 IPC 共用同一实例）。
function createLanServer({ webRoot, storageFile, basePort = 8899, token = '', mutationEngine = null }) {
  const root = path.resolve(webRoot)
  const storage = createStorageAccess(storageFile)
  let state = { running: false, port: null, error: null }
  // 令牌可热更新（重置令牌后无需重启服务）
  let tokenRef = token

  const accessLogFile = path.join(path.dirname(path.resolve(storageFile)), 'lan-access.log')
  function reqIp(req) {
    const addr = req.socket && req.socket.remoteAddress
    return addr ? String(addr).replace(/^::ffff:/, '') : '?'
  }
  function log(method, url, status, req) {
    // 只记录路径，去掉查询串（避免 ?token=... 落入日志造成令牌泄露）
    const pathOnly = String(url).split('?')[0]
    console.log(`[lan-server] ${method} ${pathOnly} -> ${status}`)
    try {
      fs.appendFileSync(accessLogFile, `${new Date().toISOString()} ${reqIp(req)} ${method} ${pathOnly} -> ${status}\n`)
    } catch {}
  }

  const server = http.createServer((req, res) => {
    const method = req.method || 'GET'
    const url = req.url || '/'

    // 数据接口鉴权（静态页面保持开放，仅保护 /api/storage 与 /api/mutations）+ CSRF Origin 校验
    if (url.startsWith('/api/storage') || url.startsWith('/api/mutations')) {
      if (!authorize(req, tokenRef)) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('unauthorized')
        log(method, url, res.statusCode, req)
        return
      }
      if (!originAllowed(req, req.headers['origin'])) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('origin not allowed')
        log(method, url, res.statusCode, req)
        return
      }
    }

    if (method === 'GET' && url.startsWith('/api/storage')) {
      const r = storage.read()
      if (r.found) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(r.data)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
      }
      log(method, url, res.statusCode, req)
      return
    }

    if (method === 'PUT' && url.startsWith('/api/storage')) {
      const chunks = []
      let size = 0
      let tooLarge = false
      req.on('data', (c) => {
        if (tooLarge) return
        size += c.length
        if (size > MAX_BODY) {
          tooLarge = true
          chunks.length = 0 // 释放已收集的 body，避免内存持续增长
          res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('too large')
          // 不 destroy：让 413 响应完整送达客户端；后续 data 因 tooLarge 直接丢弃
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        if (tooLarge) return // 已返回 413，不再写入
        const body = Buffer.concat(chunks).toString('utf-8')
        // 严格校验：非法 JSON / 结构不正确 → 400，绝对不能修改现有 storage
        let parsed
        try {
          parsed = JSON.parse(body)
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('invalid json')
          log(method, url, res.statusCode, req)
          return
        }
        const v = validateStorageShape(parsed)
        if (!v.ok) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(v.errors.join('; '))
          log(method, url, res.statusCode, req)
          return
        }
        const r = storage.write(body)
        if (r.ok) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end('{"ok":true}')
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(r.error || 'write failed')
        }
        log(method, url, res.statusCode, req)
      })
      return
    }

    if (method === 'POST' && url.startsWith('/api/mutations')) {
      const chunks = []
      let size = 0
      let tooLarge = false
      req.on('data', (c) => {
        if (tooLarge) return
        size += c.length
        if (size > MAX_BODY) {
          tooLarge = true
          chunks.length = 0
          res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('too large')
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        if (tooLarge) return
        let body = null
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('invalid json')
          log(method, url, res.statusCode, req)
          return
        }
        if (!mutationEngine) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('mutation engine not available')
          log(method, url, res.statusCode, req)
          return
        }
        const mutations = body && Array.isArray(body.mutations) ? body.mutations : null
        if (!mutations) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('invalid mutations')
          log(method, url, res.statusCode, req)
          return
        }
        // Phase 1B-1：Tablet → 同一个 Mutation Engine（与 IPC 同进程同实例，单线程串行）
        const r = mutationEngine.applyMutations(mutations)
        if (r.ok) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, results: r.results }))
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({
            ok: false,
            error: r.error || 'mutation failed',
            detail: r.detail || '',
            failedIndex: typeof r.failedIndex === 'number' ? r.failedIndex : null,
          }))
        }
        log(method, url, res.statusCode, req)
      })
      return
    }

    if (method === 'DELETE' && url.startsWith('/api/storage')) {
      const r = storage.remove()
      res.writeHead(r.ok ? 200 : 500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(r.ok ? '{"ok":true}' : (r.error || 'delete failed'))
      log(method, url, res.statusCode, req)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      log(method, url, res.statusCode, req)
      return
    }

    const hit = resolveWebPath(root, url)
    if (!hit) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
      log(method, url, res.statusCode, req)
      return
    }
    const ext = path.extname(hit.file).toLowerCase()
    let body
    try {
      body = fs.readFileSync(hit.file)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
      log(method, url, res.statusCode, req)
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(body)
    log(method, url, res.statusCode, req)
  })

  server.on('error', (e) => {
    state.error = String((e && e.message) || e)
  })

  // 尝试 basePort 起逐个端口监听
  function start() {
    return new Promise((resolve, reject) => {
      const tryListen = (port) => {
        server.once('error', (e) => {
          if (e.code === 'EADDRINUSE' && port < basePort + 10) {
            tryListen(port + 1)
          } else {
            state.error = String((e && e.message) || e)
            reject(e)
          }
        })
        server.listen(port, '0.0.0.0', () => {
          state.running = true
          state.port = server.address().port
          state.error = null
          resolve(state.port)
        })
      }
      tryListen(basePort)
    })
  }

  function stop() {
    return new Promise((resolve) => {
      state.running = false
      server.close(() => resolve())
    })
  }

  return { server, storage, start, stop, state, webRoot: root, storageFile: path.resolve(storageFile), setToken: (t) => { tokenRef = String(t || '') } }
}

// 便捷启动：绑定固定或自动端口，就绪后回调
async function startLanServer(opts, onReady) {
  const inst = createLanServer(opts)
  try {
    const port = await inst.start()
    const addrs = lanAddresses().map((a) => a.address)
    onReady && onReady({ port, addresses: addrs, lan: inst })
    return inst
  } catch (e) {
    console.error('[lan-server] start failed:', e)
    return null
  }
}

module.exports = { createLanServer, startLanServer, createStorageAccess, lanAddresses, resolveWebPath }

// 研途计划 · 局域网服务器
// 提供：静态前端（平板浏览器访问）+ /api/storage 数据读写（与桌面端共享同一份数据）
// 不依赖 electron，可在纯 Node 下运行与测试

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

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

// 创建服务器；返回 { server, storage, start }
function createLanServer({ webRoot, storageFile, basePort = 8899, token = '' }) {
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

    // 数据接口鉴权（静态页面保持开放，仅保护 /api/storage）
    if (url.startsWith('/api/storage') && !authorize(req, tokenRef)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('unauthorized')
      log(method, url, res.statusCode, req)
      return
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
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY) {
          res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('too large')
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        const r = storage.write(Buffer.concat(chunks).toString('utf-8'))
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

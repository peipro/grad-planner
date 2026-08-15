const test = require('node:test')
const assert = require('node:assert')
const http = require('http')
const { validateExternalUrl, isAllowedExternalUrl, isPrivateIP } = require('./url-security.cjs')

// ===== 私网 / 保留地址拒绝（§14） =====

test('SSRF: 环回与本地地址 REJECT', async () => {
  for (const u of ['http://127.0.0.1', 'http://127.0.0.1:8899/api/storage', 'http://localhost', 'http://0.0.0.0', 'http://255.255.255.255']) {
    const r = await validateExternalUrl(u)
    assert.strictEqual(r.ok, false, `${u} 应被拒绝`)
  }
})

test('SSRF: RFC1918 私网地址 REJECT', async () => {
  for (const u of ['http://10.0.0.1', 'http://10.255.255.255', 'http://172.16.0.1', 'http://172.31.255.255', 'http://192.168.1.1', 'http://192.168.0.254']) {
    const r = await validateExternalUrl(u)
    assert.strictEqual(r.ok, false, `${u} 应被拒绝`)
  }
})

test('SSRF: 链路本地（云元数据）REJECT', async () => {
  const r = await validateExternalUrl('http://169.254.169.254/latest/meta-data/')
  assert.strictEqual(r.ok, false)
})

test('SSRF: IPv6 环回/ULA/链路本地 REJECT', async () => {
  for (const u of ['http://[::1]/', 'http://[::]/', 'http://[fc00::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/']) {
    const r = await validateExternalUrl(u)
    assert.strictEqual(r.ok, false, `${u} 应被拒绝`)
  }
})

test('SSRF: 非 http/https 协议 REJECT', async () => {
  for (const u of ['file:///C:/Windows/win.ini', 'ftp://example.com/file', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'chrome://settings', 'chrome-extension://abc', 'about:blank', 'blob:https://example.com/x', 'ws://example.com', 'wss://example.com']) {
    const r = await validateExternalUrl(u)
    assert.strictEqual(r.ok, false, `${u} 应被拒绝`)
  }
})

test('SSRF: 畸形 URL / 空 / 超长 REJECT', async () => {
  assert.strictEqual((await validateExternalUrl('')).ok, false)
  assert.strictEqual((await validateExternalUrl('not a url')).ok, false)
  assert.strictEqual((await validateExternalUrl('http://')).ok, false)
  assert.strictEqual((await validateExternalUrl('http://' + 'a'.repeat(70000) + '.com/')).ok, false)
})

test('SSRF: 公网地址 ALLOW（IP 字面量，无 DNS 依赖）', async () => {
  for (const u of ['http://8.8.8.8/', 'https://1.1.1.1/']) {
    const r = await validateExternalUrl(u)
    assert.strictEqual(r.ok, true, `${u} 应被允许`)
  }
})

test('SSRF: 公网域名 ALLOW（DNS 解析到公网）', async () => {
  const r = await validateExternalUrl('https://example.com/')
  assert.strictEqual(r.ok, true, 'example.com 应解析到公网地址并被允许')
})

test('SSRF: 域名解析到私网（DNS rebinding 防护）REJECT', async () => {
  // 本地起 HTTP server 拿一个 127.0.0.1 地址，然后用域名形式指向它不可行（域名解析是系统级的），
  // 这里验证的是解析逻辑本身：dns.lookup('localhost') 必须解析到环回 → 拒绝
  const r = await validateExternalUrl('http://localhost:8899/')
  assert.strictEqual(r.ok, false, 'localhost 解析到环回地址应被拒绝')
})

test('isPrivateIP: 边界判断', () => {
  assert.strictEqual(isPrivateIP('127.0.0.1'), true)
  assert.strictEqual(isPrivateIP('10.1.2.3'), true)
  assert.strictEqual(isPrivateIP('172.20.0.1'), true)
  assert.strictEqual(isPrivateIP('172.32.0.1'), false) // 172.32 不在 172.16/12
  assert.strictEqual(isPrivateIP('192.168.5.5'), true)
  assert.strictEqual(isPrivateIP('169.254.1.1'), true)
  assert.strictEqual(isPrivateIP('8.8.8.8'), false)
  assert.strictEqual(isPrivateIP('1.1.1.1'), false)
  assert.strictEqual(isPrivateIP('::1'), true)
  assert.strictEqual(isPrivateIP('fc00::1'), true)
  assert.strictEqual(isPrivateIP('fe80::1'), true)
  assert.strictEqual(isPrivateIP('2606:4700::1111'), false) // Cloudflare 公网
  assert.strictEqual(isPrivateIP('not-an-ip'), true) // 无法识别 → 保守拒绝
})

// ===== 外部协议白名单（§23） =====

test('External URL 协议白名单', () => {
  assert.strictEqual(isAllowedExternalUrl('https://example.com/'), true)
  assert.strictEqual(isAllowedExternalUrl('http://example.com/'), true)
  assert.strictEqual(isAllowedExternalUrl('file:///C:/secret.txt'), false)
  assert.strictEqual(isAllowedExternalUrl('javascript:alert(1)'), false)
  assert.strictEqual(isAllowedExternalUrl('data:text/html,<script>x</script>'), false)
  assert.strictEqual(isAllowedExternalUrl('ftp://example.com/'), false)
  assert.strictEqual(isAllowedExternalUrl('chrome://settings'), false)
  assert.strictEqual(isAllowedExternalUrl('chrome-extension://abc'), false)
  assert.strictEqual(isAllowedExternalUrl('about:blank'), false)
  assert.strictEqual(isAllowedExternalUrl(''), false)
  assert.strictEqual(isAllowedExternalUrl('not a url'), false)
  assert.strictEqual(isAllowedExternalUrl('HTTP://EXAMPLE.COM/'), true) // 大小写不敏感
})

// ===== redirect → 私网（§15，端到端，经本地 server） =====
// 说明：fetchUrl 入口本身拒绝私网地址，因此直接对本地 server 发起即被拒，
// 证明入口校验生效。redirect 场景由 fetchUrl 递归重新校验保证（见 news.cjs）。

test('SSRF: fetchArticle 对本地 server 地址在发起前即拒绝', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:1/' })
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  t.after(() => server.close())

  // renderer 唯一入口：fetch-article IPC → fetchArticle(url)（url 来自外部可控的 RSS item.link）
  const { fetchArticle } = require('./news.cjs')
  const r = await fetchArticle(`http://127.0.0.1:${port}/`)
  assert.strictEqual(r.ok, false, '本地地址请求必须在发起前被拒绝')
  assert.ok(r.error && (r.error.includes('校验失败') || r.error.includes('私网') || r.error.includes('保留')), `拒绝原因应明确，实际: ${r.error}`)
})

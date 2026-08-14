const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { CSP } = require('./csp.cjs')

test('CSP 策略：最小权限，无 unsafe-eval / 无通配符', () => {
  assert.ok(CSP.includes("script-src 'self'"), 'script 必须仅同源')
  assert.ok(CSP.includes("object-src 'none'"))
  assert.ok(CSP.includes("base-uri 'self'"))
  assert.ok(CSP.includes("frame-src 'none'"))
  assert.ok(CSP.includes("connect-src 'self'"))
  assert.ok(!CSP.includes('unsafe-eval'), '生产 CSP 禁止 unsafe-eval')
  assert.ok(!CSP.includes("'*'"), '生产 CSP 禁止通配符')
  assert.ok(!CSP.includes('unsafe-inline') === false || /style-src[^;]*'unsafe-inline'/.test(CSP), 'style-src 允许 inline（React 必需），但 script-src 不得含 unsafe-inline')
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(CSP), 'script-src 不得含 unsafe-inline（无 inline script）')
})

test('CSP 策略：关键指令齐全（default/script/style/img/font/connect/object/base/frame）', () => {
  for (const d of ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'object-src', 'base-uri', 'frame-src', 'frame-ancestors']) {
    assert.ok(CSP.includes(`${d} `), `缺少指令 ${d}`)
  }
})

// 构建产物验证：dist HTML 必须包含 CSP meta（build 后运行）
test('构建产物（dist）包含 CSP meta', (t) => {
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html')
  const distTranslate = path.join(__dirname, '..', 'dist', 'translate.html')
  if (!fs.existsSync(distIndex)) {
    t.skip('dist 不存在，请先运行 npm run build 后重跑')
    return
  }
  for (const f of [distIndex, distTranslate]) {
    assert.ok(fs.existsSync(f), `${f} 应存在`)
    const html = fs.readFileSync(f, 'utf-8')
    assert.ok(html.includes('Content-Security-Policy'), `${f} 应包含 CSP meta`)
    assert.ok(html.includes("script-src 'self'"), `${f} CSP 应含 script-src 'self'`)
    assert.ok(html.includes("object-src 'none'"), `${f} CSP 应含 object-src 'none'`)
  }
})

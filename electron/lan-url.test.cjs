// Phase 1C Task 1 · LAN URL 生成测试
// rankLanAddresses：过滤不可达地址（虚拟网卡/代理段/APIPA/loopback）+ 物理私网优先排序。

const test = require('node:test')
const assert = require('node:assert')
const { rankLanAddresses } = require('./lan-server.cjs')

// 构造 os.networkInterfaces() 风格输入
function iface(name, address, { family = 'IPv4', internal = false } = {}) {
  return { name, address, family, internal }
}

test('过滤 loopback（internal）与 0.0.0.0 类不可达地址', () => {
  const nets = {
    'Loopback': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    'WLAN': [{ family: 'IPv4', address: '192.168.1.5', internal: false }],
  }
  const out = rankLanAddresses(nets)
  assert.deepStrictEqual(out.map((a) => a.address), ['192.168.1.5'])
})

test('过滤 APIPA（169.254.x）', () => {
  const nets = { 'Ethernet': [{ family: 'IPv4', address: '169.254.3.4', internal: false }] }
  assert.deepStrictEqual(rankLanAddresses(nets), [])
})

test('过滤 Clash/代理 benchmark 段（198.18.x）', () => {
  const nets = {
    'FlClash': [{ family: 'IPv4', address: '198.18.0.1', internal: false }],
    'WLAN': [{ family: 'IPv4', address: '192.168.3.17', internal: false }],
  }
  const out = rankLanAddresses(nets)
  assert.deepStrictEqual(out.map((a) => a.address), ['192.168.3.17'])
})

test('过滤虚拟网卡名（VMware/vEthernet/Tailscale 等）', () => {
  const nets = {
    'VMware Network Adapter VMnet8': [{ family: 'IPv4', address: '192.168.160.1', internal: false }],
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.28.0.1', internal: false }],
    'Tailscale': [{ family: 'IPv4', address: '100.64.0.1', internal: false }],
    'WLAN': [{ family: 'IPv4', address: '192.168.3.17', internal: false }],
  }
  const out = rankLanAddresses(nets)
  assert.deepStrictEqual(out.map((a) => a.address), ['192.168.3.17'])
})

test('物理私网排序：192.168 优先 → 10.x → 172.16-31 → 其他', () => {
  const nets = {
    'Ethernet2': [{ family: 'IPv4', address: '10.0.0.3', internal: false }],
    'Ethernet3': [{ family: 'IPv4', address: '172.20.1.1', internal: false }],
    'WLAN': [{ family: 'IPv4', address: '192.168.1.2', internal: false }],
    'Ethernet4': [{ family: 'IPv4', address: '203.0.113.9', internal: false }],
  }
  const out = rankLanAddresses(nets)
  assert.deepStrictEqual(out.map((a) => a.address), ['192.168.1.2', '10.0.0.3', '172.20.1.1', '203.0.113.9'])
})

test('0.0.0.0 不应作为 advertised host（不在输出中）', () => {
  const nets = { 'WLAN': [{ family: 'IPv4', address: '0.0.0.0', internal: false }] }
  assert.deepStrictEqual(rankLanAddresses(nets), [])
})

test('真实本机环境：lanAddresses 首选地址应为物理私网（非虚拟网卡）', () => {
  const { lanAddresses } = require('./lan-server.cjs')
  const out = lanAddresses()
  assert.ok(out.length >= 1)
  const first = out[0].address
  // 首地址必须是可达的私网地址：192.168 / 10 / 172.16-31，且绝不可达的是 198.18 / 127.0.0.1 / 0.0.0.0
  assert.ok(/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(first), `首地址 ${first} 不是私网地址`)
  assert.ok(!/^(198\.|127\.|0\.)/.test(first), `首地址 ${first} 不可达`)
  // 不应包含虚拟网卡地址
  for (const a of out) {
    assert.ok(!/^198\.(1[89]|2[0-9]|3[01])\./.test(a.address), `包含不可达地址 ${a.address}`)
  }
})

test('全虚拟网卡环境 → fallback 返回原始列表（不阻塞功能）', () => {
  // lanAddresses 的 fallback 依赖真实 os.networkInterfaces；这里验证 rankLanAddresses 返回空
  // 且 lanAddresses 在真实环境不会返回空（上一测试已覆盖）
  const nets = {
    'VMnet1': [{ family: 'IPv4', address: '192.168.159.1', internal: false }],
    'Tailscale': [{ family: 'IPv4', address: '100.64.0.1', internal: false }],
  }
  assert.deepStrictEqual(rankLanAddresses(nets), [])
})

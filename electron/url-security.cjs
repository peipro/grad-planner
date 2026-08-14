// 研途计划 · 外部 URL 安全校验层（主进程侧，纯 Node 可测）
// 用途：SSRF 防护 / 外部协议白名单 / 外链打开校验 统一入口。
// 防护目标：
//   1. 协议白名单（仅 http/https）
//   2. 私网 / 保留 / 环回 / 链路本地 IP 拒绝（IPv4 + IPv6）
//   3. DNS rebinding 防护：解析 hostname，任何解析结果命中私网即拒绝
// 使用方：
//   - news.cjs fetchUrl / proxiedRequest / proxiedHttpsRequest（SSRF）
//   - main.cjs shell.openExternal 协议白名单（Task 3）

const dns = require('dns')
const net = require('net')

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_URL_LENGTH = 2048

function stripBrackets(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8（本网络）
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8（环回）
  if (a === 169 && b === 254) return true // 169.254.0.0/16（链路本地/APIPA）
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 255) return true // 255.255.255.255（广播）
  return false
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true // 环回 / 未指定
  // IPv4-mapped（::ffff:127.0.0.1 等）
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7)
    return isPrivateIPv4(mapped)
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7（ULA）
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true // fe80::/10（链路本地）
  return false
}

// 判断 IP 是否为私网 / 保留 / 环回 / 链路本地
function isPrivateIP(ip) {
  const kind = net.isIP(ip)
  if (kind === 4) return isPrivateIPv4(ip)
  if (kind === 6) return isPrivateIPv6(ip)
  return true // 无法识别为合法 IP → 保守拒绝
}

// DNS 解析并检查所有结果：任何一个解析到私网地址即不安全（防 DNS rebinding）
function resolveAndCheck(hostname) {
  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        resolve({ safe: false, error: `域名解析失败: ${hostname}` })
        return
      }
      for (const a of addresses) {
        if (isPrivateIP(a.address)) {
          resolve({ safe: false, error: `域名解析到私网/保留地址: ${a.address}` })
          return
        }
      }
      resolve({ safe: true, addresses })
    })
  })
}

// 校验外部 URL（协议 + 主机 + DNS）。返回 { ok, url, addresses? } 或 { ok:false, error }
async function validateExternalUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return { ok: false, error: 'URL 为空' }
  if (url.length > MAX_URL_LENGTH) return { ok: false, error: 'URL 过长' }
  let u
  try {
    u = new URL(url)
  } catch {
    return { ok: false, error: 'URL 格式非法' }
  }
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    return { ok: false, error: `协议不允许: ${u.protocol}` }
  }
  const hostname = stripBrackets(u.hostname)
  if (!hostname) return { ok: false, error: '缺少主机名' }

  // 字面 IP
  const kind = net.isIP(hostname)
  if (kind === 4 || kind === 6) {
    if (isPrivateIP(hostname)) return { ok: false, error: '目标地址为私网/保留地址' }
    return { ok: true, url: u.href, addresses: [{ address: hostname }] }
  }

  // 主机名：DNS 解析检查（防 rebinding）
  const r = await resolveAndCheck(hostname)
  if (!r.safe) return { ok: false, error: r.error }
  return { ok: true, url: u.href, addresses: r.addresses }
}

// 外部协议白名单（shell.openExternal / window.open 等）：仅 http/https
function isAllowedExternalUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) return false
  try {
    const u = new URL(url)
    return ALLOWED_PROTOCOLS.has(u.protocol)
  } catch {
    return false
  }
}

module.exports = { validateExternalUrl, isAllowedExternalUrl, isPrivateIP }

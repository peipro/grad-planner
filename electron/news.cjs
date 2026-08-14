const https = require('https')
const http = require('http')
const net = require('net')
const { XMLParser } = require('fast-xml-parser')

// 代理配置（X API 与国外源需要代理访问）
// 自动探测常见 Clash 代理端口（端口可能随配置变化，如 7897 / 7890 等）
const PROXY_DEFAULT = process.env.HTTPS_PROXY || '127.0.0.1:7897'
const PROXY_CANDIDATES = ['127.0.0.1:7897', '127.0.0.1:7890', '127.0.0.1:7891', '127.0.0.1:7899', '127.0.0.1:1080', '127.0.0.1:2080', '127.0.0.1:10808', '127.0.0.1:8888']
let proxyAddr = PROXY_DEFAULT
let proxyProbePromise = null

function testProxy(addr) {
  return new Promise((resolve) => {
    const [h, p] = addr.split(':')
    const s = net.connect(Number(p), h)
    let done = false
    const fin = (ok) => {
      if (!done) { done = true; try { s.destroy() } catch {} resolve(ok) }
    }
    s.on('connect', () => fin(true))
    s.on('error', () => fin(false))
    setTimeout(() => fin(false), 1000)
  })
}

// 首次使用时探测可用代理端口（结果缓存）
function probeProxy() {
  if (!proxyProbePromise) {
    proxyProbePromise = (async () => {
      for (const c of PROXY_CANDIDATES) {
        if (c === PROXY_DEFAULT && (await testProxy(c))) { proxyAddr = c; return }
      }
      for (const c of PROXY_CANDIDATES) {
        if (await testProxy(c)) { proxyAddr = c; return }
      }
    })()
  }
  return proxyProbePromise
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

// ============ RSS 源配置（聚焦大模型 / Agent / 技术突破） ============
const RSS_SOURCES = [
  // 中文 AI 媒体（直连）
  { key: 'qbitai', name: '量子位', category: 'llm', url: 'https://www.qbitai.com/feed', viaProxy: false, max: 10 },
  { key: 'infoq', name: 'InfoQ AI', category: 'llm', url: 'https://www.infoq.cn/feed', viaProxy: false, max: 10 },
  // 官方博客（代理）
  { key: 'openai', name: 'OpenAI', category: 'llm', url: 'https://openai.com/news/rss.xml', viaProxy: true, max: 8 },
  { key: 'deepmind', name: 'Google DeepMind', category: 'llm', url: 'https://deepmind.google/blog/rss.xml', viaProxy: true, max: 8 },
  { key: 'huggingface', name: 'Hugging Face', category: 'llm', url: 'https://huggingface.co/blog/feed.xml', viaProxy: true, max: 8 },
  { key: 'langchain', name: 'LangChain', category: 'agent', url: 'https://blog.langchain.dev/rss.xml', viaProxy: true, max: 6 },
  // 英文 AI 媒体（代理）
  { key: 'techcrunch-ai', name: 'TechCrunch AI', category: 'llm', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', viaProxy: true, max: 8 },
  { key: 'venturebeat', name: 'VentureBeat AI', category: 'llm', url: 'https://venturebeat.com/category/ai/feed/', viaProxy: true, max: 8 },
  { key: 'marktechpost', name: 'MarkTechPost', category: 'llm', url: 'https://www.marktechpost.com/feed/', viaProxy: true, max: 8 },
  { key: 'gradient', name: 'The Gradient', category: 'llm', url: 'https://thegradient.pub/rss/', viaProxy: true, max: 6 },
  // 学术 / 聚合（代理）
  { key: 'mit', name: 'MIT News AI', category: 'llm', url: 'https://news.mit.edu/rss/topic/artificial-intelligence2', viaProxy: true, max: 6 },
  { key: 'hn', name: 'Hacker News', category: 'tech', url: 'https://news.ycombinator.com/rss', viaProxy: true, max: 10, aiOnly: true },
]

// ============ 代理隧道请求（CONNECT） ============
async function proxiedRequest(url, timeout = 15000, redirects = 0) {
  await probeProxy()
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const u = new URL(url)
    const [host, port] = proxyAddr.split(':')
    const proxyPort = Number(port || 7890)

    const connectReq = http.request({
      host,
      port: proxyPort,
      method: 'CONNECT',
      path: `${u.hostname}:443`,
    })

    const timeoutId = setTimeout(() => connectReq.destroy(new Error('Proxy timeout')), timeout)

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        clearTimeout(timeoutId)
        socket.destroy()
        reject(new Error(`Proxy CONNECT ${res.statusCode}`))
        return
      }
      clearTimeout(timeoutId)
      const req = https.request({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        socket,
        agent: false,
      }, (resp) => {
        let data = ''
        resp.setEncoding('utf-8')
        resp.on('data', (c) => (data += c))
        resp.on('end', () => {
          if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
            if (redirects >= 5) { reject(new Error('Too many redirects')); return }
            proxiedRequest(new URL(resp.headers.location, url).href, timeout, redirects + 1).then(resolve).catch(reject)
            return
          }
          if (resp.statusCode !== 200) {
            reject(new Error(`HTTP ${resp.statusCode}`))
            return
          }
          resolve(data)
        })
      })
      req.on('error', reject)
      req.end()
    })
    connectReq.on('error', reject)
    connectReq.end()
  })
}

// ============ HTTP 请求工具（支持直连/代理回退） ============
function fetchUrl(url, timeout = 12000, viaProxy = false, redirects = 0) {
  const attemptDirect = () => new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects >= 5) { reject(new Error('Too many redirects')); res.resume(); return }
        fetchUrl(new URL(res.headers.location, url).href, timeout, viaProxy, redirects + 1).then(resolve).catch(reject)
        res.resume()
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        res.resume()
        return
      }
      let data = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(timeout, () => req.destroy(new Error('Timeout')))
  })

  if (viaProxy) return proxiedRequest(url, timeout)
  // 直连失败时回退代理
  return attemptDirect().catch(() => proxiedRequest(url, timeout))
}

// ============ RSS 解析 ============
function parseRSS(xml, source) {
  try {
    const j = parser.parse(xml)
    const channel = j.rss?.channel ?? j.feed ?? null
    let items = []
    if (channel) {
      const raw = channel.item ?? channel.entry ?? []
      items = Array.isArray(raw) ? raw : [raw]
    }
    return items
      .map((it) => {
        const title = it.title?.__cdata ?? it.title ?? ''
        const link = it.link?.['@_href'] ?? it.link ?? it.guid?.__cdata ?? it.guid ?? ''
        const content = it.description?.__cdata ?? it.description ?? it.summary?.__cdata ?? it.summary ?? ''
        const pub = it.pubDate ?? it.published ?? it.date ?? ''
        return {
          title: String(title).trim(),
          link: String(link).trim(),
          summary: stripHtml(String(content)).slice(0, 180),
          pubTime: pub,
          source: source.name,
          sourceKey: source.key,
          category: source.category,
        }
      })
      .filter((it) => it.title && it.link)
  } catch {
    return []
  }
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function parseDate(s) {
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// ============ 抓取所有 RSS ============
async function fetchRSS(enabledKeys = null) {
  const sources = enabledKeys ? RSS_SOURCES.filter((s) => enabledKeys.includes(s.key)) : RSS_SOURCES
  if (sources.length === 0) return []
  const results = await Promise.allSettled(
    sources.map(async (src) => {
      const xml = await fetchUrl(src.url, 15000, src.viaProxy)
      const items = parseRSS(xml, src)
      // 每源限制条数
      return src.max ? items.slice(0, src.max) : items
    }),
  )
  const items = []
  results.forEach((r) => {
    if (r.status === 'fulfilled') items.push(...r.value)
  })
  return items
}

// ============ 微博热搜 ============
async function fetchWeiboHot() {
  try {
    const json = await fetchUrl('https://weibo.com/ajax/side/hotSearch')
    const data = JSON.parse(json)
    const list = data?.data?.realtime ?? []
    return list
      .filter((it) => it.word)
      .map((it) => ({
        title: it.word,
        link: `https://s.weibo.com/weibo?q=${encodeURIComponent(it.word)}`,
        summary: `热搜${it.num ?? ''}`.trim(),
        pubTime: '',
        source: '微博热搜',
        sourceKey: 'weibo-hot',
        category: 'tech',
      }))
  } catch {
    return []
  }
}

// ============ 知乎热榜 ============
async function fetchZhihuHot() {
  try {
    const json = await fetchUrl('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50')
    const data = JSON.parse(json)
    const list = data?.data ?? []
    return list
      .filter((it) => it.target?.title)
      .map((it) => ({
        title: it.target.title,
        link: `https://www.zhihu.com/question/${it.target.id}`,
        summary: `热度 ${it.detail_text ?? ''}`.trim(),
        pubTime: '',
        source: '知乎热榜',
        sourceKey: 'zhihu-hot',
        category: 'tech',
      }))
  } catch {
    return []
  }
}

// ============ X API（可选，经代理） ============
function encodeBasic(key, secret) {
  return Buffer.from(`${key}:${secret}`).toString('base64')
}

// 经 HTTP 代理建立 CONNECT 隧道后，发起 HTTPS 请求
async function proxiedHttpsRequest({ method = 'GET', hostname, path, headers = {}, body }, timeout = 15000) {
  await probeProxy()
  return new Promise((resolve, reject) => {
    const [host, port] = proxyAddr.split(':')
    const proxyPort = Number(port || 7897)

    const connectReq = http.request({
      host,
      port: proxyPort,
      method: 'CONNECT',
      path: `${hostname}:443`,
    })

    const timeoutId = setTimeout(() => {
      connectReq.destroy(new Error('Proxy timeout'))
    }, timeout)

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`))
        return
      }
      clearTimeout(timeoutId)
      const req = https.request({
        hostname,
        path,
        method,
        headers,
        socket,
        agent: false,
      }, (resp) => {
        let data = ''
        resp.setEncoding('utf-8')
        resp.on('data', (c) => (data += c))
        resp.on('end', () => {
          if (resp.statusCode !== 200) reject(new Error(`HTTP ${resp.statusCode}`))
          else resolve(data)
        })
      })
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })

    connectReq.on('error', reject)
    connectReq.end()
  })
}

async function fetchXBearerToken(key, secret) {
  const body = 'grant_type=client_credentials'
  const data = await proxiedHttpsRequest({
    method: 'POST',
    hostname: 'api.twitter.com',
    path: '/oauth2/token',
    headers: {
      Authorization: `Basic ${encodeBasic(key, secret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  })
  const j = JSON.parse(data)
  if (!j.access_token) throw new Error(`X token 获取失败: ${data.slice(0, 120)}`)
  return j.access_token
}

async function fetchXNews(key, secret) {
  try {
    const bearer = await fetchXBearerToken(key, secret)
    const query = '(AI OR 大模型 OR LLM OR GPT) lang:zh OR lang:en -is:retweet'
    const path = `/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=created_at&user.fields=name&expansions=author_id`
    const finalJson = await proxiedHttpsRequest({
      hostname: 'api.twitter.com',
      path,
      headers: {
        Authorization: `Bearer ${bearer}`,
        'User-Agent': 'Mozilla/5.0',
      },
    })
    const j = JSON.parse(finalJson)
    const users = Object.fromEntries((j.includes?.users ?? []).map((u) => [u.id, u.name]))
    return (j.data ?? []).map((t) => ({
      title: t.text.slice(0, 100),
      link: `https://x.com/${users[t.author_id] ? users[t.author_id] : 'i'}/status/${t.id}`,
      summary: t.text.slice(0, 160),
      pubTime: t.created_at ?? '',
      source: `X @${users[t.author_id] ?? 'user'}`,
      sourceKey: 'x',
      category: 'llm',
    }))
  } catch (e) {
    console.error('[X API]', e.message)
    return []
  }
}

// ============ AI 相关过滤 ============
const AI_KEYWORDS = [
  'ai', '大模型', 'gpt', 'llm', '人工智能', 'deepseek', 'openai', 'grok', 'claude', 'chatgpt',
  '机器学习', '多模态', '智能体', 'agent', '神经网络', 'transformer', '推理', 'scaling',
  '模型发布', '开源模型', 'qlora', 'llama', 'gemini', 'gpt-4', 'gpt-5', 'o1', 'o3',
  '机器人', '具身智能', 'embodied', 'diffusion', '扩散模型', 'langchain', 'agentic', 'agent开发',
  'rag', '检索增强', '强化学习', 'rlhf', '对齐', 'safety', '基准', 'benchmark', 'api', 'mcp',
  '模型部署', '蒸馏', '蒸馏模型', '参数', 'billion', 'context', '上下文', 'function calling', '工具调用',
  'vlm', '视觉语言', '音频模型', 'world model', '世界模型', 'reasoning', '推理模型',
]

function isAIRelated(text) {
  const t = text.toLowerCase()
  return AI_KEYWORDS.some((k) => t.includes(k.toLowerCase()))
}

// ============ 主入口 ============
async function fetchAllNews(opts = {}) {
  const { xKey, xSecret, includeX = false, rssKeys = null, includeHot = true } = opts
  let items = []
  const tasks = [fetchRSS(rssKeys)]
  if (includeHot) {
    tasks.push(fetchWeiboHot(), fetchZhihuHot())
  }
  const results = await Promise.all(tasks)
  results.forEach((r) => (items = items.concat(r)))

  if (includeX && xKey && xSecret) {
    items = items.concat(await fetchXNews(xKey, xSecret))
  }

  // 标记 AI 相关，过滤掉空内容
  items = items
    .filter((it) => it.title)
    .map((it) => ({ ...it, ai: isAIRelated(it.title + ' ' + it.summary) }))

  // aiOnly 源（如 Hacker News）：只保留 AI 相关
  const aiOnlyKeys = new Set(RSS_SOURCES.filter((s) => s.aiOnly).map((s) => s.key))
  if (aiOnlyKeys.size > 0) {
    items = items.filter((it) => !aiOnlyKeys.has(it.sourceKey) || it.ai)
  }

  // 聚焦近期：保留最近 7 天内容（无时间的保留）
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000
  items = items.filter((it) => {
    if (!it.pubTime) return true
    const d = new Date(it.pubTime)
    return !isNaN(d.getTime()) && d.getTime() >= cutoff
  })

  // 排序：优先 AI 相关 + 时间倒序
  items.sort((a, b) => {
    const da = parseDate(a.pubTime)
    const db = parseDate(b.pubTime)
    if (da && db) return db - da
    return Number(b.ai) - Number(a.ai)
  })

  // 去除标题重复
  const seen = new Set()
  items = items.filter((it) => {
    const k = it.title.toLowerCase().slice(0, 40)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return items
}

// ============ 文章正文提取 ============
function extractArticleText(html) {
  // 移除脚本、样式、导航等
  let doc = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  // 优先提取 <p> 段落
  let paragraphs = []
  const pRe = /<p[\s>][\s\S]*?<\/p>/gi
  let m
  while ((m = pRe.exec(doc))) {
    const text = m[0]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length > 15) paragraphs.push(text)
  }

  // 段落太少时回退：提取 <article>/<main> 区域文本
  if (paragraphs.length < 3) {
    const region = doc.match(/<article[\s\S]*?<\/article>/i) || doc.match(/<main[\s\S]*?<\/main>/i) || doc.match(/<body[\s\S]*?<\/body>/i) || doc
    let text = String(region)
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 20)
    paragraphs = text
  }

  // 去重 + 合并
  const seen = new Set()
  const result = paragraphs.filter((p) => {
    const key = p.slice(0, 30)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // 截断到合理长度
  let joined = result.join('\n\n')
  if (joined.length > 6000) joined = joined.slice(0, 6000) + '\n……'
  return joined
}

async function fetchArticle(url) {
  try {
    const html = await fetchUrl(url, 15000)
    const text = extractArticleText(html)
    if (!text) return { ok: false, error: '未能提取到正文内容' }
    return { ok: true, content: text }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// ============ 翻译（Google 免费接口，经代理） ============
async function translateText(text, target = 'zh-CN') {
  if (!text || !text.trim()) return { ok: false, error: '内容为空' }
  // 超长分段翻译（单次上限约 4500 字符）
  // 按句子边界分段，避免从单词/句子中间截断导致译文粘连
  const chunks = []
  let rest = text.trim()
  const MAX = 4000
  while (rest.length > MAX) {
    const head = rest.slice(0, MAX)
    let cut = -1
    for (const ch of ['。', '！', '？', '!', '?', '；', ';', '\n']) {
      const idx = head.lastIndexOf(ch)
      if (idx > cut) cut = idx
    }
    if (cut < MAX * 0.6) cut = MAX - 1 // 找不到合适断点则按长度硬切
    chunks.push(rest.slice(0, cut + 1))
    rest = rest.slice(cut + 1)
  }
  if (rest.length > 0) chunks.push(rest)

  const translated = []
  for (const chunk of chunks) {
    let res
    try {
      res = await Promise.race([
        proxiedRequest(
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(chunk)}`,
          15000,
        ),
        new Promise((_, rej) => setTimeout(() => rej(new Error('翻译超时')), 16000)),
      ])
    } catch (e) {
      const msg = String(e && e.message ? e.message : e)
      if (msg.includes('超时') || msg.includes('timeout') || msg.includes('socket')) {
        return { ok: false, error: '翻译服务连接超时，请检查代理（Clash）节点是否可用' }
      }
      return { ok: false, error: `翻译失败：${msg}` }
    }
    const j = JSON.parse(res)
    const segs = (j[0] ?? []).filter((s) => s && s[0]).map((s) => s[0])
    translated.push(segs.join(''))
  }

  if (translated.length === 0) return { ok: false, error: '翻译结果为空' }
  return { ok: true, content: translated.join('') }
}

module.exports = { fetchAllNews, RSS_SOURCES, fetchArticle, translateText }

// Phase 1C Task 3 · News → Note 保存正文测试
// 正文获取成功 → 保存完整正文结构；失败 → 明确提示并保存摘要版。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NewsView from './NewsView'
import { useStore } from '../store'

const newsItem = {
  title: 'Test News Title',
  link: 'https://example.com/article/1',
  summary: 'Summary text',
  pubTime: '2026-08-15T08:00:00.000Z',
  source: 'ExampleSource',
  sourceKey: 'example',
  category: 'tech',
  ai: false,
}

function setup(fetchArticleImpl?: () => any) {
  ;(window as any).electronAPI = {
    fetchNews: async () => ({ ok: true, items: [newsItem], time: '2026-08-15T08:00:00.000Z' }),
    fetchArticle: fetchArticleImpl || (async () => ({ ok: true, content: '这是文章正文内容。\n\n第二段正文。' })),
    translateText: async (text: string) => ({ ok: true, content: text }),
    setNewsConfig: async () => true,
  }
}

describe('NewsView saveAsNote（Phase 1C Task 3）', () => {
  beforeEach(() => {
    window.localStorage.removeItem('grad-planner-news-cache')
    useStore.setState({ newsConfig: { xKey: '', xSecret: '', includeX: false, rssKeys: null, includeHot: true }, notes: [], tasks: [] } as any)
  })

  it('正文获取成功 → 笔记包含完整正文结构', async () => {
    setup()
    render(<NewsView />)
    await screen.findByText('Test News Title')
    await userEvent.click(screen.getByTitle('存为笔记'))
    await new Promise((r) => setTimeout(r, 50))
    const note = useStore.getState().notes[0]
    expect(note).toBeTruthy()
    expect(note.title).toContain('Test News Title')
    expect(note.content).toContain('# Test News Title')
    expect(note.content).toContain('## 正文')
    expect(note.content).toContain('这是文章正文内容。')
    expect(note.content).toContain('> 来源：ExampleSource')
    expect(note.content).toContain('> 原文：https://example.com/article/1')
    expect(note.content).toContain('## 我的笔记')
    expect(note.tags).toContain('资讯')
  })

  it('正文获取失败 → 明确提示 + 保存摘要版（不静默）', async () => {
    const alertSpy = vi.fn()
    window.alert = alertSpy as any
    setup(async () => ({ ok: false, error: '未能提取到正文内容' }))
    render(<NewsView />)
    await screen.findByText('Test News Title')
    await userEvent.click(screen.getByTitle('存为笔记'))
    await new Promise((r) => setTimeout(r, 50))
    // 明确提示用户保存的是摘要版
    expect(alertSpy).toHaveBeenCalled()
    expect(String(alertSpy.mock.calls[0][0])).toContain('无法获取原文正文')
    expect(String(alertSpy.mock.calls[0][0])).toContain('摘要')
    const note = useStore.getState().notes[0]
    expect(note).toBeTruthy()
    expect(note.content).toContain('摘要：Summary text')
    expect(note.content).toContain('来源：ExampleSource')
    expect(note.content).toContain('原文链接')
    // 摘要版不含"正文"节
    expect(note.content).not.toContain('## 正文')
  })

  it('无桌面 API（平板 Web 模式）→ 页面正常渲染，无资讯时无保存入口', async () => {
    ;(window as any).electronAPI = undefined
    render(<NewsView />)
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTitle('存为笔记')).toBeNull() // 无资讯 → 无保存入口
    expect(useStore.getState().notes).toHaveLength(0)
  })
})

// ===== Phase 1C Task 4：News Cache（TTL + 缓存优先 + 手动刷新 + 失败保留） =====

describe('NewsView cache（Phase 1C Task 4）', () => {
  const CACHE_KEY = 'grad-planner-news-cache'

  beforeEach(() => {
    window.localStorage.removeItem(CACHE_KEY)
    useStore.setState({ newsConfig: { xKey: '', xSecret: '', includeX: false, rssKeys: null, includeHot: true }, notes: [], tasks: [] } as any)
  })

  it('无缓存 → 首次 fetch + loading', async () => {
    let fetchCalls = 0
    ;(window as any).electronAPI = {
      fetchNews: async () => { fetchCalls += 1; return { ok: true, items: [newsItem], time: '2026-08-15T08:00:00.000Z' } },
      translateText: async (t: string) => ({ ok: true, content: t }),
      setNewsConfig: async () => true,
    }
    render(<NewsView />)
    await screen.findByText('Test News Title')
    expect(fetchCalls).toBe(1)
    // 缓存已写入
    expect(window.localStorage.getItem(CACHE_KEY)).toBeTruthy()
  })

  it('缓存新鲜（TTL 内）→ 不 fetch，立即显示缓存', async () => {
    let fetchCalls = 0
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ items: [newsItem], time: '2026-08-15T08:00:00.000Z', savedAt: Date.now() }))
    ;(window as any).electronAPI = {
      fetchNews: async () => { fetchCalls += 1; return { ok: true, items: [newsItem], time: '2026-08-15T09:00:00.000Z' } },
      setNewsConfig: async () => true,
    }
    render(<NewsView />)
    await screen.findByText('Test News Title')
    expect(fetchCalls).toBe(0) // 新鲜缓存不抓取
  })

  it('缓存过期 → 立即显示缓存 + 后台 fetch 更新', async () => {
    let fetchCalls = 0
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ items: [newsItem], time: '2026-08-15T00:00:00.000Z', savedAt: Date.now() - 31 * 60 * 1000 }))
    ;(window as any).electronAPI = {
      fetchNews: async () => { fetchCalls += 1; return { ok: true, items: [{ ...newsItem, title: '刷新后的新标题' }], time: '2026-08-15T09:00:00.000Z' } },
      setNewsConfig: async () => true,
    }
    render(<NewsView />)
    await screen.findByText('Test News Title') // 先显示缓存
    await screen.findByText('刷新后的新标题') // 后台刷新后更新
    expect(fetchCalls).toBe(1)
  })

  it('手动刷新（点“刷新”）→ 强制 fetch', async () => {
    let fetchCalls = 0
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ items: [newsItem], time: '2026-08-15T08:00:00.000Z', savedAt: Date.now() }))
    ;(window as any).electronAPI = {
      fetchNews: async () => { fetchCalls += 1; return { ok: true, items: [newsItem], time: '2026-08-15T09:00:00.000Z' } },
      setNewsConfig: async () => true,
    }
    render(<NewsView />)
    await screen.findByText('Test News Title')
    expect(fetchCalls).toBe(0) // 缓存新鲜未抓取
    await userEvent.click(screen.getByRole('button', { name: /刷新/ }))
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchCalls).toBe(1) // 手动强制刷新
  })

  it('fetch 失败 → 旧缓存保留 + 明确提示', async () => {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ items: [newsItem], time: '2026-08-15T00:00:00.000Z', savedAt: Date.now() - 31 * 60 * 1000 }))
    ;(window as any).electronAPI = {
      fetchNews: async () => ({ ok: false, error: '网络错误' }),
      setNewsConfig: async () => true,
    }
    render(<NewsView />)
    await screen.findByText('Test News Title') // 缓存仍显示
    await screen.findByText(/更新失败/) // 明确提示
    expect(screen.getByText('Test News Title')).toBeTruthy() // 旧缓存未被清除
  })
})

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { RefreshCw, ExternalLink, Newspaper, Zap, Flame, Cpu, X, Loader2, BookOpen, Languages, ListTodo, StickyNote } from 'lucide-react'
import { useStore, uid } from '../store'
import { NewsItem } from '../types'
import { useToast } from '../lib/toast'

type Filter = 'all' | 'ai' | 'agent' | 'official'

// 判断是否英文内容（无中文字符且含较多英文字母）
function isEnglishText(s: string) {
  if (!s) return false
  const hasCJK = /[\u4e00-\u9fff]/.test(s)
  if (hasCJK) return false
  const letters = (s.match(/[a-zA-Z]/g) || []).length
  return letters > 8
}

export default function NewsView() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastTime, setLastTime] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const [reading, setReading] = useState<NewsItem | null>(null)
  const [article, setArticle] = useState('')
  const [articleLoading, setArticleLoading] = useState(false)
  const [articleError, setArticleError] = useState('')

  // 翻译状态：key = 卡片唯一标识，value = 译文
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translating, setTranslating] = useState<string | null>(null)
  // 阅读弹窗内正文翻译
  const [articleTranslated, setArticleTranslated] = useState('')
  const [articleTranslating, setArticleTranslating] = useState(false)

  const hasElectronApi = !!(window as any).electronAPI
  const newsConfig = useStore((s) => s.newsConfig)
  const addTask = useStore((s) => s.addTask)
  const addNote = useStore((s) => s.addNote)
  const gotoView = useStore((s) => s.setView)
  const toast = useToast((s) => s.show)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const api = (window as any).electronAPI
      if (api?.fetchNews) {
        // 同步当前配置到主进程，再抓取（密钥由主进程安全存储，不在此传递）
        if (api.setNewsConfig && newsConfig) {
          const { xKey: _xKey, xSecret: _xSecret, ...cfg } = newsConfig
          await api.setNewsConfig(cfg)
        }
        const res = await api.fetchNews(null)
        if (res?.ok) {
          setItems(res.items ?? [])
          setLastTime(res.time)
        } else {
          setError(res?.error || '抓取失败')
        }
      } else {
        // Web 模式降级：无 electronAPI，提示
        setError('资讯功能需要桌面版运行。请使用 Electron 版（npm run desktop 或打包后的 exe）。')
      }
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [newsConfig])

  useEffect(() => {
    load(true)
    const api = (window as any).electronAPI
    if (api?.onNewsAutoUpdate) {
      api.onNewsAutoUpdate((data: { items: NewsItem[]; time: string }) => {
        setItems(data.items ?? [])
        setLastTime(data.time)
      })
    }
  }, [load])

  const openArticle = async (it: NewsItem) => {
    setReading(it)
    setArticle('')
    setArticleError('')
    setArticleLoading(true)
    const api = (window as any).electronAPI
    if (api?.fetchArticle) {
      try {
        const res = await api.fetchArticle(it.link)
        if (res?.ok) setArticle(res.content)
        else setArticleError(res?.error || '正文获取失败')
      } catch (e: any) {
        setArticleError(String(e?.message || e))
      }
    } else {
      setArticleError('需要桌面版才能获取正文')
    }
    setArticleLoading(false)
  }

  const openLink = (url: string) => {
    const api = (window as any).electronAPI
    if (api?.openExternal) api.openExternal(url)
    else window.open(url, '_blank')
  }

  // 英文内容自动翻译成中文（存待办/笔记时附带中文）
  const translateIfNeeded = async (text: string): Promise<string> => {
    if (!text || !isEnglishText(text)) return text
    const api = (window as any).electronAPI
    if (!api?.translateText) return text
    try {
      const res = await api.translateText(text)
      if (res?.ok && res.content) return res.content
    } catch {}
    return text
  }

  // 资讯 → 待办 / 笔记联动（英文自动附中文）
  const saveAsTask = async (it: NewsItem) => {
    const zhTitle = await translateIfNeeded(it.title)
    const title = zhTitle.slice(0, 80)
    addTask({ id: uid(), title, priority: 'medium', status: 'todo', subtasks: [], createdAt: new Date().toISOString() })
    toast(`已存为待办「${title.slice(0, 18)}${title.length > 18 ? '…' : ''}」`, {
      actionLabel: '查看',
      onAction: () => gotoView('todo'),
    })
  }

  const saveAsNote = async (it: NewsItem) => {
    const zhTitle = await translateIfNeeded(it.title)
    const zhSummary = await translateIfNeeded(it.summary || '')
    const title = zhTitle.slice(0, 80)
    const meta = [it.source, it.pubTime && formatTime(it.pubTime)].filter(Boolean).join(' · ')
    const parts: string[] = []
    if (zhSummary) parts.push(`摘要：${zhSummary}`)
    if (zhTitle !== it.title) parts.push(`原文标题：${it.title}`)
    if (it.summary && zhSummary !== it.summary) parts.push(`原文摘要：${it.summary}`)
    parts.push(`来源：${meta}`, `原文链接：${it.link}`)
    addNote({
      id: uid(),
      title,
      content: parts.join('\n\n'),
      tags: ['资讯'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    toast(`已存为笔记「${title.slice(0, 18)}${title.length > 18 ? '…' : ''}」`, {
      actionLabel: '查看',
      onAction: () => gotoView('notes'),
    })
  }

  const translateCard = async (it: NewsItem, key: string) => {
    if (translations[key]) { delete translations[key]; setTranslations({ ...translations }); return }
    if (translating === key) return
    setTranslating(key)
    const api = (window as any).electronAPI
    try {
      if (api?.translateText) {
        const src = `${it.title}${it.summary ? '\n' + it.summary : ''}`
        const res = await api.translateText(src)
        setTranslations((t) => ({ ...t, [key]: res?.ok ? res.content : `（翻译失败：${res?.error || ''}）` }))
      } else {
        setTranslations((t) => ({ ...t, [key]: '需要桌面版才能翻译' }))
      }
    } catch (e: any) {
      setTranslations((t) => ({ ...t, [key]: `（翻译失败：${String(e?.message || e)}）` }))
    } finally {
      setTranslating(null)
    }
  }

  const translateArticle = async () => {
    if (!reading) return
    if (articleTranslated) { setArticleTranslated(''); return }
    if (articleTranslating) return
    setArticleTranslating(true)
    const api = (window as any).electronAPI
    try {
      const src = article || reading.title + (reading.summary ? '\n' + reading.summary : '')
      if (api?.translateText) {
        const res = await api.translateText(src)
        setArticleTranslated(res?.ok ? res.content : `（翻译失败：${res?.error || ''}）`)
      } else {
        setArticleTranslated('需要桌面版才能翻译')
      }
    } catch (e: any) {
      setArticleTranslated(`（翻译失败：${String(e?.message || e)}）`)
    } finally {
      setArticleTranslating(false)
    }
  }

  const filtered = useMemo(() => {
    let list = items
    if (filter === 'ai') list = list.filter((it) => it.ai)
    else if (filter === 'agent') list = list.filter((it) => it.category === 'agent' || /agent|智能体|工具调用|mcp/i.test(it.title + ' ' + it.summary))
    else if (filter === 'official') list = list.filter((it) => ['openai', 'deepmind', 'huggingface', 'langchain', 'mit'].includes(it.sourceKey))
    return list
  }, [items, filter])

  const aiCount = items.filter((it) => it.ai).length

  const sourceEmoji = (key: string) => {
    if (key === 'weibo-hot') return '🔥'
    if (key === 'zhihu-hot') return '📈'
    if (key === 'x') return '𝕏'
    return '📰'
  }

  const filterTabs: { id: Filter; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: '全部', icon: <Newspaper size={14} /> },
    { id: 'ai', label: 'AI 相关', icon: <Cpu size={14} /> },
    { id: 'agent', label: 'Agent', icon: <Zap size={14} /> },
    { id: 'official', label: '官方发布', icon: <Flame size={14} /> },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">资讯</div>
          <div className="page-sub">
            今日 AI / 科技资讯 · 共 {items.length} 条 · AI 相关 {aiCount} 条
            {lastTime && ` · 更新于 ${format(new Date(lastTime), 'HH:mm')}`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          {loading ? '抓取中…' : '刷新'}
        </button>
      </div>

      {error && (
        <div className="news-error card">
          {error}
          {!hasElectronApi && <div style={{ marginTop: 6, fontSize: 12 }}>提示：请在桌面版中使用资讯功能</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {filterTabs.map((t) => (
          <button key={t.id} className={`btn btn-sm ${filter === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading && !items.length ? (
        <div className="card"><div className="empty"><div className="empty-icon">⏳</div>正在抓取今日资讯…</div></div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty"><div className="empty-icon">📭</div>暂无资讯，点击右上角「刷新」获取</div></div>
      ) : (
        <div className="news-list">
          {filtered.map((it, idx) => {
            const cardKey = `${it.sourceKey}-${idx}`
            const isEn = isEnglishText(it.title)
            const tr = translations[cardKey]
            return (
              <div key={cardKey} className="card news-item" onClick={() => openArticle(it)}>
                <div className="news-badge">{sourceEmoji(it.sourceKey)}</div>
                <div className="news-body">
                  <div className="news-title">
                    {it.title}
                    {it.ai && <span className="ai-tag">AI</span>}
                  </div>
                  {tr ? (
                    <div className="news-translation">{tr}</div>
                  ) : (
                    it.summary && <div className="news-summary">{it.summary}</div>
                  )}
                  <div className="news-meta">
                    <span className="news-source">{it.source}</span>
                    {it.pubTime && <span className="news-time">{formatTime(it.pubTime)}</span>}
                    {isEn && (
                      <button
                        className="translate-btn"
                        onClick={(e) => { e.stopPropagation(); translateCard(it, cardKey) }}
                      >
                        {translating === cardKey ? <Loader2 size={12} className="spin" /> : <Languages size={12} />}
                        {translating === cardKey ? '翻译中…' : (tr ? '收起译文' : '翻译')}
                      </button>
                    )}
                    <span className="news-read-hint"><BookOpen size={12} /> 点击阅读</span>
                    <button
                      className="news-save-btn news-ext"
                      onClick={(e) => { e.stopPropagation(); saveAsTask(it) }}
                      title="存为待办"
                    >
                      <ListTodo size={12} /> 存待办
                    </button>
                    <button
                      className="news-save-btn news-ext"
                      onClick={(e) => { e.stopPropagation(); saveAsNote(it) }}
                      title="存为笔记"
                    >
                      <StickyNote size={12} /> 存笔记
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {reading && (
        <div className="modal-overlay" onClick={() => setReading(null)}>
          <div className="modal news-reader" onClick={(e) => e.stopPropagation()}>
            <div className="reader-header">
              <div className="reader-source">{sourceEmoji(reading.sourceKey)} {reading.source}</div>
              <button className="icon-btn" onClick={() => setReading(null)}><X size={18} /></button>
            </div>
            <h2 className="reader-title">{reading.title}</h2>
            <div className="reader-meta">
              {reading.pubTime && <span>{formatTime(reading.pubTime)}</span>}
              {reading.ai && <span className="ai-tag">AI 相关</span>}
            </div>
            <div className="reader-body">
              {articleLoading ? (
                <div className="reader-status"><Loader2 size={20} className="spin" /> 正在获取正文…</div>
              ) : articleTranslated ? (
                <div className="reader-content reader-translated">
                  {articleTranslated.split('\n').map((line, i) => <p key={i}>{line}</p>)}
                  <div className="reader-trans-note">— 机器翻译 · 如需阅读原文请点「在浏览器打开」</div>
                </div>
              ) : article ? (
                <div className="reader-content">{article.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>
              ) : (
                <div className="reader-status">
                  {articleError ? <div className="reader-err">{articleError}</div> : <div>无正文</div>}
                  <div className="reader-fallback">摘要：{reading.summary || '（无摘要）'}</div>
                </div>
              )}
            </div>
            <div className="reader-footer">
              {isEnglishText(reading.title) && (
                <button className="btn btn-sm reader-trans-btn" onClick={translateArticle} disabled={articleTranslating}>
                  {articleTranslating ? <Loader2 size={14} className="spin" /> : <Languages size={14} />}
                  {articleTranslating ? '翻译中…' : articleTranslated ? '显示原文' : '全文翻译'}
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => openLink(reading.link)}>
                <ExternalLink size={14} /> 在浏览器打开原文
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .news-error { padding: 14px 18px; margin-bottom: 14px; font-size: 13px; color: #e5484d; }
        .news-list { display: flex; flex-direction: column; gap: 10px; }
        .news-item {
          display: flex; gap: 14px; padding: 14px 16px; cursor: pointer;
          transition: all 0.15s ease;
        }
        .news-item:hover { box-shadow: var(--shadow-lg); transform: translateY(-1px); }
        .news-badge {
          width: 38px; height: 38px; border-radius: 9px; background: var(--bg-hover);
          display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;
        }
        .news-body { flex: 1; min-width: 0; }
        .news-title { font-size: 14px; font-weight: 600; line-height: 1.5; display: flex; align-items: flex-start; gap: 8px; }
        .ai-tag {
          background: var(--accent); color: #fff; font-size: 10px; font-weight: 700;
          padding: 2px 6px; border-radius: 5px; flex-shrink: 0; margin-top: 2px;
        }
        .news-summary { font-size: 12px; color: var(--text-2); margin-top: 5px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .news-meta { display: flex; align-items: center; gap: 10px; margin-top: 7px; font-size: 11px; color: var(--text-3); }
        .news-source { font-weight: 600; color: var(--accent-text); }
        .news-translation {
          font-size: 13px; color: var(--accent-text); margin-top: 6px; line-height: 1.7;
          background: var(--accent-soft); padding: 8px 12px; border-radius: 8px;
        }
        .translate-btn {
          display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
          color: var(--accent-text); background: var(--accent-soft); padding: 3px 8px; border-radius: 6px;
          transition: all 0.15s ease;
        }
        .translate-btn:hover { filter: brightness(0.95); }
        .news-save-btn {
          display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
          color: var(--text-2); background: var(--bg-hover); padding: 3px 8px; border-radius: 6px;
          transition: all 0.15s ease;
        }
        .news-save-btn:hover { color: var(--accent-text); background: var(--accent-soft); }
        .news-read-hint { display: flex; align-items: center; gap: 4px; color: var(--accent-text); font-weight: 600; }
        .reader-trans-btn {
          display: inline-flex; align-items: center; gap: 6px; margin-right: auto;
          background: var(--accent); color: #fff;
        }
        .reader-translated { color: var(--accent-text); }
        .reader-trans-note { font-size: 11px; color: var(--text-3); margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--border); }
        .news-ext { opacity: 0; transition: opacity 0.15s ease; }
        .news-item:hover .news-ext { opacity: 1; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* 阅读弹窗 */
        .news-reader { width: 720px; max-width: 94vw; display: flex; flex-direction: column; max-height: 86vh; padding: 20px 24px; }
        .reader-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .reader-source { font-size: 12px; font-weight: 700; color: var(--accent-text); }
        .reader-title { font-size: 18px; font-weight: 700; line-height: 1.5; margin-bottom: 6px; }
        .reader-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-3); margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
        .reader-body { flex: 1; overflow-y: auto; min-height: 200px; }
        .reader-content { font-size: 14px; line-height: 1.9; color: var(--text-1); }
        .reader-content p { margin: 0 0 12px; }
        .reader-status { text-align: center; color: var(--text-3); font-size: 13px; padding: 30px 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .reader-err { color: #e5484d; }
        .reader-fallback { font-size: 13px; color: var(--text-2); text-align: left; padding: 12px; background: var(--bg-hover); border-radius: 8px; max-width: 100%; }
        .reader-footer { display: flex; justify-content: flex-end; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
      `}</style>
    </div>
  )
}

function formatTime(s: string) {
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `今天 ${format(d, 'HH:mm')}`
  return format(d, 'M月d日 HH:mm')
}

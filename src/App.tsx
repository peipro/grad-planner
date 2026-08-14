import { useEffect, useState } from 'react'
import { Calendar, CheckSquare, GitBranch, FileText, Timer, BarChart2, Settings, Newspaper, Languages, Cake, Flame, Search, BookOpen } from 'lucide-react'
import { useStore } from './store'
import { isHttpUrl } from './lib/external'
import { performPrepareFlush } from './lib/reload-flush'
import { useToast } from './lib/toast'
import CalendarView from './views/CalendarView'
import TodoView from './views/TodoView'
import MilestoneView from './views/MilestoneView'
import NotesView from './views/NotesView'
import PomodoroView from './views/PomodoroView'
import BirthdayView from './views/BirthdayView'
import HabitView from './views/HabitView'
import StatsView from './views/StatsView'
import NewsView from './views/NewsView'
import TranslateView from './views/TranslateView'
import SettingsView from './views/SettingsView'
import LiteratureView from './views/LiteratureView'
import QuickCapture from './components/QuickCapture'
import GlobalSearch from './components/GlobalSearch'
import ToastContainer from './components/Toast'
import { usePomodoroTicker } from './lib/pomodoro'
import { useReminderTicker } from './lib/reminder'

const nav = [
  { id: 'calendar', label: '日历', icon: Calendar },
  { id: 'birthday', label: '生日', icon: Cake },
  { id: 'habit', label: '习惯', icon: Flame },
  { id: 'todo', label: '待办', icon: CheckSquare },
  { id: 'milestone', label: '里程碑', icon: GitBranch },
  { id: 'literature', label: '文献', icon: BookOpen },
  { id: 'notes', label: '笔记', icon: FileText },
  { id: 'pomodoro', label: '番茄钟', icon: Timer },
  { id: 'news', label: '资讯', icon: Newspaper },
  { id: 'translate', label: '翻译', icon: Languages },
  { id: 'stats', label: '统计', icon: BarChart2 },
  { id: 'settings', label: '设置', icon: Settings },
]

const viewMap: Record<string, React.ComponentType> = {
  calendar: CalendarView,
  birthday: BirthdayView,
  habit: HabitView,
  todo: TodoView,
  milestone: MilestoneView,
  literature: LiteratureView,
  notes: NotesView,
  pomodoro: PomodoroView,
  stats: StatsView,
  news: NewsView,
  translate: TranslateView,
  settings: SettingsView,
}

export default function App() {
  const activeView = useStore((s) => s.activeView)
  const theme = useStore((s) => s.theme)
  const [quickOpen, setQuickOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated())

  useEffect(() => {
    const unsub = useStore.persist.onFinishHydration(() => setHydrated(true))
    setHydrated(useStore.persist.hasHydrated())
    return unsub
  }, [])

  // Renderer Flush Protocol：主进程 reload 前，提交草稿 + 等待提交队列 + ACK
  useEffect(() => {
    const api = (window as any).electronAPI
    if (api?.onPrepareReload && api?.flushAck) {
      api.onPrepareReload(() => {
        performPrepareFlush(api).catch(() => {
          // 兜底：flush 失败也 ACK，避免主进程等待超时（主进程另有 3s 超时兜底）
          api.flushAck().catch(() => {})
        })
      })
    }
  }, [])

  // 同步冲突提示：sync-adapter 提交被服务端 409 拒绝时触发（绝不静默覆盖，提示用户）
  useEffect(() => {
    const onConflict = (e: Event) => {
      const detail = (e as CustomEvent<{ conflicts?: unknown[] }>).detail
      const count = Array.isArray(detail?.conflicts) ? detail.conflicts.length : 0
      const msg = count > 0
        ? `检测到同步冲突（${count} 处内容与本机同时被修改）：本机修改未保存，远程数据保持不变`
        : '检测到同步冲突：本机修改未保存，远程数据保持不变'
      useToast.getState().show(msg, { actionLabel: '重新加载', onAction: () => window.location.reload() })
    }
    window.addEventListener('sync-conflict', onConflict)
    return () => window.removeEventListener('sync-conflict', onConflict)
  }, [])

  usePomodoroTicker()
  useReminderTicker()

  // 打开独立置顶翻译小窗（桌面版），Web 模式降级为翻译页面
  const openTranslateWindow = () => {
    const api = (window as any).electronAPI
    if (api?.openTranslateWindow) api.openTranslateWindow()
    else useStore.getState().setView('translate')
  }

  // 全局快捷键：Ctrl+Shift+K 快速记录 · Ctrl+K / Ctrl+F 全局搜索
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQuickOpen((v) => !v)
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)

    // Electron 桌面版：应用失焦时由主进程触发
    const api = (window as any).electronAPI
    if (api?.onGlobalShortcut) {
      api.onGlobalShortcut(() => setQuickOpen((v) => !v))
    }
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const isDark =
      theme.mode === 'dark' ||
      (theme.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.body.className = isDark ? `theme-dark accent-${theme.accent}` : `theme-light accent-${theme.accent}`
  }, [theme])

  // 修复 Electron 下输入框点击偶尔无法聚焦输入的问题：
  // 窗口失焦后切回、被置顶小窗抢焦点等场景，首次点击 input 可能只激活窗口而未聚焦输入框
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const box = target?.closest?.('input, textarea, select') as HTMLInputElement | null
      if (!box) return
      requestAnimationFrame(() => {
        if (!document.hasFocus() || document.activeElement !== box) {
          window.focus()
          box.focus()
        }
      })
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
  }, [])

  // 拦截应用内所有外链点击：不在应用窗口内跳转网页，改为系统默认浏览器打开
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href') || ''
      if (!isHttpUrl(href)) return // 非 http(s) 交给默认行为（主进程 setWindowOpenHandler 白名单兜底）
      e.preventDefault()
      e.stopPropagation()
      const api = (window as any).electronAPI
      if (api?.openExternal) api.openExternal(href)
      else if (isHttpUrl(href)) window.open(href, '_blank')
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  const View = viewMap[activeView] ?? CalendarView
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  if (!hydrated) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, color: 'var(--text-3)' }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800 }}>研</div>
        <div style={{ fontSize: 14 }}>加载中…</div>
      </div>
    )
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-badge">研</div>
          <span>研途计划</span>
        </div>
        <nav>
          <button
            className="nav-item"
            style={{ background: 'var(--accent)', color: '#fff', marginBottom: 8, justifyContent: 'center' }}
            onClick={() => setSearchOpen(true)}
          >
            <Search size={16} />
            搜索
            <span style={{ fontSize: 10, opacity: 0.8, marginLeft: 'auto' }}>Ctrl+K</span>
          </button>
          <button
            className="nav-item"
            style={{ marginBottom: 8 }}
            onClick={openTranslateWindow}
          >
            <Languages size={16} />
            快速翻译
            <span style={{ fontSize: 10, opacity: 0.8, marginLeft: 'auto' }}>Ctrl+Shift+T</span>
          </button>
          {nav.slice(0, 7).map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                onClick={() => useStore.getState().setView(item.id)}
              >
                <Icon size={17} />
                {item.label}
              </button>
            )
          })}
          <div className="nav-group-title">系统</div>
          {nav.slice(7).map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                onClick={() => useStore.getState().setView(item.id)}
              >
                <Icon size={17} />
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <div style={{ fontSize: 12, color: 'var(--text-3)', paddingLeft: 10 }}>{today}</div>
        </div>
      </aside>
      <main className="main">
        <View />
      </main>
      {quickOpen && <QuickCapture onClose={() => setQuickOpen(false)} />}
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
      <ToastContainer />
    </div>
  )
}

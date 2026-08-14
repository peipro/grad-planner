import { useEffect, useState } from 'react'
import { Calendar, CheckSquare, GitBranch, FileText, Timer, BarChart2, Settings, Newspaper, Languages, Cake, Flame, Search, BookOpen } from 'lucide-react'
import { useStore } from './store'
import { isHttpUrl } from './lib/external'
import { refreshFromAuthority, REFRESH_ON_ERROR, applyAuthoritativeState } from './lib/mutations'
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

  usePomodoroTicker()
  useReminderTicker()

  // Phase 1B-2：State Sync —— 外部变化 → 就地更新 Zustand（绝不 reload / 不重新 hydration）
  //   Electron：Main 推送（onStateSync）
  //   平板：轻量轮询 → 'state-sync-external' 事件（sync-adapter 触发）
  // 两者进入同一个 applyAuthoritativeState 路径（保留 renderer-only state、防 mutation 循环）
  useEffect(() => {
    const apply = (state: unknown) => applyAuthoritativeState(state)
    const api = (window as any).electronAPI
    let unsub: (() => void) | undefined
    if (api?.onStateSync) {
      unsub = api.onStateSync((payload: { state?: unknown }) => apply(payload && payload.state))
    }
    const onExternal = (e: Event) => {
      const detail = (e as CustomEvent<{ state?: unknown }>).detail
      apply(detail && detail.state)
    }
    window.addEventListener('state-sync-external', onExternal)
    return () => {
      if (unsub) unsub()
      window.removeEventListener('state-sync-external', onExternal)
    }
  }, [])

  // Phase 1B-1：mutation 提交失败分类处理（docs L4）
  //   persistence_failure → 回权威（磁盘不可写）
  //   其余错误（invalid/not_found/validation/network/internal）→ 只提示，绝不刷新整个 state
  //   （避免用户正在编辑 Note 时，一个无关 Task mutation 失败触发整页刷新覆盖编辑内容）
  useEffect(() => {
    const onMutationFailed = (e: Event) => {
      const detail = (e as CustomEvent<{ error?: string }>).detail || {}
      const err = detail.error || 'network_error'
      if (REFRESH_ON_ERROR.has(err)) {
        useToast.getState().show('数据保存失败（磁盘写入错误），已恢复为已保存的数据')
        refreshFromAuthority()
      } else if (err === 'network_error') {
        useToast.getState().show('网络不可用，本次修改未同步（将在下次操作时重新尝试）')
      } else if (err === 'invalid_mutation' || err === 'validation_failure' || err === 'entity_not_found') {
        useToast.getState().show('同步失败：本次修改未通过校验，未写入')
      } else {
        useToast.getState().show('同步异常，本次修改未同步')
      }
    }
    window.addEventListener('sync-mutation-failed', onMutationFailed)
    return () => window.removeEventListener('sync-mutation-failed', onMutationFailed)
  }, [])

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

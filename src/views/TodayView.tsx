import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Sun, Square, CheckSquare, Calendar as CalendarIcon, Timer, Plus } from 'lucide-react'
import { useStore, uid } from '../store'
import { parseQuickAdd } from '../lib/natural'
import { formatMinutes } from '../lib/format'
import {
  localDateKey, todayItems, overdueTasks, todayFocusMinutes,
  AREA_LABELS, AREA_COLORS, TodayItem,
} from '../lib/today'
import { EventType, Task } from '../types'

const EVENT_COLORS: Record<EventType, string> = {
  course: '#4f6ef7',
  meeting: '#8b5cf6',
  deadline: '#e5484d',
  personal: '#2f9e6e',
}
const EVENT_LABELS: Record<EventType, string> = {
  course: '课程',
  meeting: '组会',
  deadline: '截止',
  personal: '生活',
}

export default function TodayView() {
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const habits = useStore((s) => s.habits)
  const pomodoros = useStore((s) => s.pomodoros)
  const pomo = useStore((s) => s.pomo)
  const gotoView = useStore((s) => s.setView)
  const updateTask = useStore((s) => s.updateTask)
  const addTask = useStore((s) => s.addTask)
  const toggleHabitDate = useStore((s) => s.toggleHabitDate)
  const setPomodoro = useStore((s) => s.setPomodoro)

  const [quickOpen, setQuickOpen] = useState(false)
  const [quickInput, setQuickInput] = useState('')

  const dateKey = useMemo(() => localDateKey(), [])
  const dateLabel = format(new Date(), 'M月d日 EEEE', { locale: zhCN })

  const { allDay, timed } = useMemo(() => todayItems(tasks, events, dateKey), [tasks, events, dateKey])
  const overdue = useMemo(() => overdueTasks(tasks, dateKey), [tasks, dateKey])
  const focusMin = useMemo(() => todayFocusMinutes(pomodoros, dateKey), [pomodoros, dateKey])

  const todayTaskItems = allDay.concat(timed.filter((i) => i.kind === 'task'))
  const openCount = todayTaskItems.filter((i) => !i.done).length
  const doneCount = todayTaskItems.filter((i) => i.done).length
  const eventCount = timed.filter((i) => i.kind === 'event').length
  const habitDone = habits.filter((h) => h.records.includes(dateKey)).length

  // 现在时间 HH:mm（时间线里已过去的时段弱化显示）
  const nowHm = useMemo(() => {
    const n = new Date()
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
  }, [])

  const toggleDone = (t: Task) => {
    updateTask({ ...t, status: t.status === 'done' ? 'todo' : 'done' })
  }

  const quickSave = () => {
    const raw = quickInput.trim()
    if (!raw) return
    const parsed = parseQuickAdd(raw)
    addTask({
      id: uid(),
      title: parsed.title || raw,
      priority: parsed.priority ?? 'medium',
      status: 'todo',
      // 未写日期 → 默认今天 12:00，让「今天要做什么」直接落进时间线
      due: parsed.date ? `${parsed.date}T12:00:00` : `${dateKey}T12:00:00`,
      area: parsed.area,
      createdAt: new Date().toISOString(),
    })
    setQuickInput('')
    setQuickOpen(false)
  }

  const quickPomodoro = () => {
    const s = useStore.getState()
    if (s.pomo.running) {
      gotoView('pomodoro')
      return
    }
    setPomodoro({ mode: 'countdown', phase: 'focus', remaining: s.pomo.focusMin * 60, running: true })
  }

  const mmss = `${String(Math.floor(pomo.remaining / 60)).padStart(2, '0')}:${String(pomo.remaining % 60).padStart(2, '0')}`

  const renderTaskRow = (it: TodayItem) => {
    const t = it.raw as Task
    const color = AREA_COLORS[it.area ?? 'other']
    const muted = it.done || (it.time !== 'all-day' && it.time < nowHm)
    return (
      <div key={it.id} className="tl-row" style={{ opacity: muted ? 0.5 : 1 }}>
        <span className="tl-time">{it.time === 'all-day' ? '全天' : it.time}</span>
        <button
          className="tl-check"
          title={it.done ? '标记为未完成' : '完成'}
          onClick={() => toggleDone(t)}
          style={{ color: it.done ? 'var(--accent)' : 'var(--text-3)' }}
        >
          {it.done ? <CheckSquare size={17} /> : <Square size={17} />}
        </button>
        <span className="tl-title" style={it.done ? { textDecoration: 'line-through' } : {}}>{it.title}</span>
        <span className="tl-tag" style={{ background: `${color}1a`, color }}>{AREA_LABELS[it.area ?? 'other']}</span>
      </div>
    )
  }

  const renderEventRow = (it: TodayItem) => {
    const color = EVENT_COLORS[it.type ?? 'personal']
    const muted = it.time < nowHm
    return (
      <div key={it.id} className="tl-row" style={{ opacity: muted ? 0.5 : 1 }}>
        <span className="tl-time">{it.time}</span>
        <span className="tl-dot" style={{ background: color }} />
        <span className="tl-title">{it.title}</span>
        <span className="tl-tag" style={{ background: `${color}1a`, color }}>{EVENT_LABELS[it.type ?? 'personal']}</span>
      </div>
    )
  }

  const hasPlan = allDay.length + timed.length + overdue.length > 0

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sun size={20} color="var(--accent)" /> 今日
          </div>
          <div className="page-sub">{dateLabel} · 打开就知道今天要做什么</div>
        </div>
      </div>

      {/* 顶部轻量数字概览 */}
      <div className="today-stats">
        <div className="ts-card" data-stat="todo">
          <div className="ts-num">{openCount}<span className="ts-num-sub"> 项待办</span></div>
          <div className="ts-label">完成 {doneCount} · 逾期 {overdue.length}</div>
        </div>
        <div className="ts-card" data-stat="event">
          <div className="ts-num">{eventCount}<span className="ts-num-sub"> 项日程</span></div>
          <div className="ts-label">会议 / 课程 / 截止</div>
        </div>
        <div className="ts-card" data-stat="habit">
          <div className="ts-num">{habitDone}/{habits.length}<span className="ts-num-sub"> 已打卡</span></div>
          <div className="ts-label">今日习惯</div>
        </div>
        <div className="ts-card" data-stat="focus">
          <div className="ts-num">{formatMinutes(focusMin)}</div>
          <div className="ts-label">今日专注</div>
        </div>
      </div>

      <div className="today-grid">
        {/* 主栏：时间线 */}
        <div className="card today-main">
          {!hasPlan ? (
            <div className="empty" style={{ padding: '40px 20px' }}>
              <div className="empty-icon">🌅</div>
              今天还没有安排<br />
              <span style={{ fontSize: 12 }}>在下方快速添加一件事，或去待办页规划今天的任务</span>
            </div>
          ) : (
            <>
              {allDay.length > 0 && (
                <>
                  <div className="tl-section-title">全天</div>
                  {allDay.map(renderTaskRow)}
                </>
              )}
              {timed.length > 0 && (
                <>
                  <div className="tl-section-title">时间线</div>
                  {timed.map((it) => (it.kind === 'task' ? renderTaskRow(it) : renderEventRow(it)))}
                </>
              )}
            </>
          )}
        </div>

        {/* 侧栏：今日习惯 + 逾期 */}
        <div className="today-side">
          <div className="card side-card">
            <div className="side-title">今日习惯</div>
            {habits.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>暂无习惯 · 去习惯页创建一个</div>
            ) : (
              habits.map((h) => {
                const done = h.records.includes(dateKey)
                return (
                  <div key={h.id} className="habit-row">
                    <span className="habit-emoji">{h.emoji}</span>
                    <span className="habit-name">{h.name}</span>
                    <button
                      className={`btn btn-sm ${done ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => toggleHabitDate(h.id, dateKey)}
                      title={done ? '取消打卡' : '打卡'}
                    >
                      {done ? '✓ 已打卡' : '打卡'}
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <div className="card side-card">
            <div className="side-title">逾期 {overdue.length > 0 && <span className="side-count">{overdue.length}</span>}</div>
            {overdue.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>没有逾期任务 🎉</div>
            ) : (
              overdue.map((t) => {
                const days = Math.floor((new Date(dateKey).getTime() - new Date(t.due!.slice(0, 10)).getTime()) / 86400000)
                return (
                  <div key={t.id} className="od-row">
                    <span className="od-title">{t.title}</span>
                    <span className="od-days" title={`截止 ${t.due!.slice(0, 10)}`}>逾期 {days} 天</span>
                    <button className="icon-btn" title="完成" onClick={() => toggleDone(t)} style={{ color: 'var(--text-3)' }}>
                      <CheckSquare size={15} />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* 底部轻操作：番茄 / 待办 / 日历 */}
      <div className="today-bar">
        <button className="bar-btn" onClick={quickPomodoro} title={pomo.running ? '打开番茄钟' : '开始一段专注'}>
          <Timer size={15} />
          {pomo.running ? `🍅 ${mmss}` : '开始专注'}
        </button>
        <button className="bar-btn" onClick={() => { setQuickOpen((v) => !v); setQuickInput('') }}>
          <Plus size={15} /> 添加待办
        </button>
        <button className="bar-btn" onClick={() => gotoView('calendar')}>
          <CalendarIcon size={15} /> 日历
        </button>
        {quickOpen && (
          <input
            className="bar-input"
            autoFocus
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') quickSave()
              if (e.key === 'Escape') setQuickOpen(false)
            }}
            placeholder='例如："生活 买洗衣液" / "科研 读LSTM论文" / "明天交实验报告"'
          />
        )}
      </div>

      <style>{`
        .today-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
        .ts-card {
          background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
          padding: 12px 16px; box-shadow: var(--shadow);
        }
        .ts-num { font-size: 20px; font-weight: 700; }
        .ts-num-sub { font-size: 13px; font-weight: 600; color: var(--text-2); }
        .ts-label { font-size: 12px; color: var(--text-3); margin-top: 2px; }

        .today-grid { display: grid; grid-template-columns: 1fr 300px; gap: 16px; align-items: start; }
        .today-main { padding: 14px 16px; min-height: 240px; }
        .today-side { display: flex; flex-direction: column; gap: 16px; }

        .tl-section-title {
          font-size: 11px; font-weight: 700; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em;
          padding: 8px 4px 6px; border-bottom: 1px solid var(--border); margin-bottom: 4px;
        }
        .tl-section-title:first-child { padding-top: 0; }
        .tl-row {
          display: flex; align-items: center; gap: 10px; padding: 7px 6px; border-radius: 8px;
          transition: background 0.12s ease;
        }
        .tl-row:hover { background: var(--bg-hover); }
        .tl-time { font-size: 12px; font-weight: 700; color: var(--text-2); min-width: 42px; font-variant-numeric: tabular-nums; }
        .tl-check { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .tl-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; margin: 0 4px; }
        .tl-title { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tl-tag { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; flex-shrink: 0; }

        .side-card { padding: 14px 16px; }
        .side-title { font-size: 13px; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
        .side-count { background: #fdecec; color: #e5484d; border-radius: 999px; font-size: 11px; padding: 1px 7px; }
        .theme-dark .side-count { background: #442124; color: #ff8a8d; }

        .habit-row { display: flex; align-items: center; gap: 8px; padding: 6px 2px; }
        .habit-emoji { font-size: 18px; }
        .habit-name { flex: 1; min-width: 0; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .od-row { display: flex; align-items: center; gap: 8px; padding: 6px 2px; }
        .od-title { flex: 1; min-width: 0; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .od-days { font-size: 11px; color: #e5484d; font-weight: 600; flex-shrink: 0; }
        .theme-dark .od-days { color: #ff8a8d; }

        .today-bar {
          position: sticky; bottom: 0; margin-top: 16px; display: flex; gap: 8px; align-items: center;
          background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
          padding: 10px 12px; box-shadow: var(--shadow-lg);
        }
        .bar-btn {
          display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px;
          font-size: 13px; font-weight: 600; color: var(--text-2); transition: all 0.15s ease; flex-shrink: 0;
        }
        .bar-btn:hover { background: var(--bg-hover); color: var(--text-1); }
        .bar-input {
          flex: 1; min-width: 0; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px;
          background: var(--bg); color: var(--text-1); font-size: 13.5px;
        }
        .bar-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); outline: none; }

        @media (max-width: 1100px) {
          .today-grid { grid-template-columns: 1fr; }
          .today-stats { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  )
}

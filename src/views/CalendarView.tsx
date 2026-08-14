import { useMemo, useState } from 'react'
import {
  addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addWeeks, format, isSameMonth, isSameDay, isToday,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus, X, Calendar as CalendarIcon } from 'lucide-react'
import { useStore, uid } from '../store'
import { CalEvent, EventType, Task } from '../types'
import { nextBirthdayDate, birthdayDesc } from '../lib/birthday'
import { eventSpansDay } from '../lib/event'
import { useToast } from '../lib/toast'

const typeMeta: Record<EventType, { label: string; color: string }> = {
  course: { label: '课程', color: '#4f6ef7' },
  meeting: { label: '组会', color: '#8b5cf6' },
  deadline: { label: '截止', color: '#e5484d' },
  personal: { label: '生活', color: '#2f9e6e' },
}

const BIRTHDAY_COLOR = '#f472b6'
const TASK_COLOR = '#0ea5e9'

type CalView = 'month' | 'week' | 'day'
const HOURS = Array.from({ length: 14 }, (_, i) => i + 8) // 8:00 - 21:00
const DATE_ONLY = (d: Date) => format(d, 'yyyy-MM-dd')

export default function CalendarView() {
  const [view, setView] = useState<CalView>('month')
  const [anchor, setAnchor] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [hoverDay, setHoverDay] = useState<Date | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [modalOpen, setModalOpen] = useState(false)
  const [editEvent, setEditEvent] = useState<CalEvent | null>(null)
  const [form, setForm] = useState({ title: '', type: 'personal' as EventType, start: '', end: '', note: '' })

  const events = useStore((s) => s.events)
  const addEvent = useStore((s) => s.addEvent)
  const updateEvent = useStore((s) => s.updateEvent)
  const deleteEvent = useStore((s) => s.deleteEvent)
  const birthdays = useStore((s) => s.birthdays)
  const milestones = useStore((s) => s.milestones)
  const tasks = useStore((s) => s.tasks)
  const gotoView = useStore((s) => s.setView)

  // 该日期上的生日(按当年农历换算)
  const dayBirthdays = (day: Date) => birthdays.filter((b) => {
    const d = nextBirthdayDate(b, day)
    return !!d && d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate()
  })

  // 该日期上的里程碑(结束日期)
  const dayMilestones = (day: Date) => milestones.filter((m) => m.endDate === DATE_ONLY(day))

  // 该日期上的到期任务(未完成)—— 待办与日历联动
  const dayDueTasks = (day: Date) => tasks.filter((t) => t.due && t.due.startsWith(DATE_ONLY(day)) && t.status !== 'done')

  const bdayEvent = (b: NonNullable<ReturnType<typeof dayBirthdays>[number]>, day: Date) => ({
    id: 'bday-' + b.id,
    title: `${b.emoji} ${b.name}生日`,
    type: 'personal' as EventType,
    start: DATE_ONLY(day) + 'T09:00',
    end: DATE_ONLY(day) + 'T10:00',
    note: birthdayDesc(b),
  })

  const msEvent = (m: NonNullable<ReturnType<typeof dayMilestones>[number]>, day: Date) => ({
    id: 'ms-' + m.id,
    title: `🏁 ${m.title}`,
    type: 'deadline' as EventType,
    start: DATE_ONLY(day) + 'T09:00',
    end: DATE_ONLY(day) + 'T10:00',
    note: '里程碑结束',
  })

  const taskEvent = (t: Task, day: Date) => ({
    id: 'task-' + t.id,
    title: `📌 ${t.title}`,
    type: 'deadline' as EventType,
    start: DATE_ONLY(day) + 'T09:00',
    end: DATE_ONLY(day) + 'T10:00',
    note: t.priority === 'high' ? '高优先级任务到期' : '任务到期',
  })

  // ===== 视图数据 =====
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 })
    const out: Date[] = []
    let d = start
    while (d <= end) { out.push(d); d = addDays(d, 1) }
    return out
  }, [anchor])

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchor, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [anchor])

  const dayEvents = (day: Date) => events
    .filter((e) => e.start.startsWith(DATE_ONLY(day)))
    .sort((a, b) => a.start.localeCompare(b.start))

  // 当天所有可见条目(普通事件 + 生日 + 里程碑 + 到期任务)
  const visibleItems = (day: Date) => {
    const evs = dayEvents(day)
    const bdays = dayBirthdays(day)
    const mss = dayMilestones(day)
    const dueTasks = dayDueTasks(day)
    let items = evs
    if (bdays.length > 0) items = [...items, ...bdays.map((b) => bdayEvent(b, day))]
    if (mss.length > 0) items = [...items, ...mss.map((m) => msEvent(m, day))]
    if (dueTasks.length > 0) items = [...items, ...dueTasks.map((t) => taskEvent(t, day))]
    return items
  }

  // 月视图专用：额外包含跨天日程(事件区间覆盖当天)
  const monthVisibleItems = (day: Date) => {
    const evs = events
      .filter((e) => eventSpansDay(e, DATE_ONLY(day)))
      .sort((a, b) => a.start.localeCompare(b.start))
    const bdays = dayBirthdays(day)
    const mss = dayMilestones(day)
    const dueTasks = dayDueTasks(day)
    let items = evs
    if (bdays.length > 0) items = [...items, ...bdays.map((b) => bdayEvent(b, day))]
    if (mss.length > 0) items = [...items, ...mss.map((m) => msEvent(m, day))]
    if (dueTasks.length > 0) items = [...items, ...dueTasks.map((t) => taskEvent(t, day))]
    return items
  }

  const isBdayItem = (e: { id: string }) => e.id.startsWith('bday-')
  const isMsItem = (e: { id: string }) => e.id.startsWith('ms-')
  const isTaskItem = (e: { id: string }) => e.id.startsWith('task-')

  const onItemClick = (e: { id: string }) => {
    if (isBdayItem(e)) { gotoView('birthday'); return }
    if (isMsItem(e)) { gotoView('milestone'); return }
    if (isTaskItem(e)) { gotoView('todo'); return }
    const real = events.find((x) => x.id === e.id)
    if (real) openEdit(real)
  }

  // ===== 导航 =====
  const nav = (dir: 1 | -1) => {
    if (view === 'month') setAnchor((a) => addMonths(a, dir))
    else if (view === 'week') setAnchor((a) => addWeeks(a, dir))
    else setAnchor((a) => addDays(a, dir))
  }

  const rangeLabel =
    view === 'month' ? format(anchor, 'yyyy年 M月', { locale: zhCN })
    : view === 'week' ? `${format(weekDays[0], 'M月d日')} — ${format(weekDays[6], 'M月d日')}`
    : format(anchor, 'yyyy年 M月 d日 EEEE', { locale: zhCN })

  // ===== 弹窗 =====
  const openAdd = (date: Date) => {
    setEditEvent(null)
    setSelectedDate(date)
    setForm({ title: '', type: 'personal', start: DATE_ONLY(date) + 'T09:00', end: DATE_ONLY(date) + 'T10:00', note: '' })
    setModalOpen(true)
  }

  const openEdit = (e: CalEvent) => {
    setEditEvent(e)
    setSelectedDate(new Date(e.start))
    setForm({ title: e.title, type: e.type, start: e.start.slice(0, 16), end: e.end.slice(0, 16), note: e.note ?? '' })
    setModalOpen(true)
  }

  const save = () => {
    if (!form.title.trim()) return
    const endTime = form.end || form.start
    if (editEvent) {
      updateEvent({ ...editEvent, title: form.title, type: form.type, start: form.start, end: endTime, note: form.note })
    } else {
      addEvent({ id: uid(), title: form.title, type: form.type, start: form.start, end: endTime, note: form.note })
    }
    setModalOpen(false)
  }

  // ===== 月视图单元格 =====
  const renderChips = (evs: ReturnType<typeof visibleItems>) => evs.map((e) => (
    <div
      key={e.id}
      className={`cal-chip ${isBdayItem(e) ? 'chip-birthday' : ''} ${isMsItem(e) ? 'chip-milestone' : ''} ${isTaskItem(e) ? 'chip-task' : ''}`}
      style={{ background: isBdayItem(e) ? BIRTHDAY_COLOR : isMsItem(e) ? '#f08c00' : isTaskItem(e) ? TASK_COLOR : typeMeta[(e as CalEvent).type].color }}
      onClick={(ev) => { ev.stopPropagation(); onItemClick(e) }}
    >
      {e.title}
    </div>
  ))

  const hoverEvs = hoverDay ? monthVisibleItems(hoverDay) : []

  // ===== 时间轴视图（周/日通用） =====
  const renderTimeline = (days: Date[]) => {
    return (
      <div className="timeline-scroll">
        <div className="tl-grid">
          {/* 时间列 */}
          <div className="tl-time-col">
            <div className="tl-corner" />
            {HOURS.map((h) => <div key={h} className="tl-hour-label">{h}:00</div>)}
          </div>
          {/* 日期列 */}
          {days.map((day) => {
            const items = visibleItems(day)
            return (
              <div key={day.toISOString()} className="tl-day-col" onClick={() => { setSelectedDate(day); setAnchor(day) }}>
                <div className={`tl-day-header ${isToday(day) ? 'today' : ''}`}>
                  {view === 'week' ? format(day, 'EEE', { locale: zhCN }) : ''}
                  {format(day, 'd日')}
                </div>
                {HOURS.map((h) => (
                  <div key={h} className="tl-hour-slot" onDoubleClick={() => openAdd(new Date(DATE_ONLY(day) + 'T' + String(h).padStart(2, '0') + ':00'))} />
                ))}
                {/* 事件覆盖层 */}
                {items.filter((e) => e.start.slice(11, 16)).map((e) => {
                  const startH = Number(e.start.slice(11, 13)) + Number(e.start.slice(14, 16)) / 60
                  const endH = Number(e.end.slice(11, 13)) + Number(e.end.slice(14, 16)) / 60
                  const top = ((startH - 8) / (HOURS.length)) * 100
                  const hgt = Math.max(((endH - startH) / (HOURS.length)) * 100, 3.2)
                  return (
                    <div
                      key={e.id}
                      className={`tl-event ${isBdayItem(e) ? 'tl-birthday' : ''} ${isMsItem(e) ? 'tl-milestone' : ''} ${isTaskItem(e) ? 'tl-task' : ''}`}
                      style={{ top: `${top}%`, height: `${hgt}%`, background: isBdayItem(e) ? BIRTHDAY_COLOR : isMsItem(e) ? '#f08c00' : isTaskItem(e) ? TASK_COLOR : typeMeta[(e as CalEvent).type].color }}
                      onClick={(ev) => { ev.stopPropagation(); onItemClick(e) }}
                      title={e.title}
                    >
                      <span className="tl-event-time">{e.start.slice(11, 16)}</span> {e.title}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">日历</div>
          <div className="page-sub">{rangeLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, marginRight: 6 }}>
            {(['month', 'week', 'day'] as CalView[]).map((v) => (
              <button key={v} className={`btn btn-sm ${view === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView(v)}>
                {{ month: '月', week: '周', day: '日' }[v]}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(new Date())}>今天</button>
          <button className="btn btn-ghost btn-sm" onClick={() => nav(-1)}><ChevronLeft size={15} /></button>
          <button className="btn btn-ghost btn-sm" onClick={() => nav(1)}><ChevronRight size={15} /></button>
          <button className="btn btn-primary" onClick={() => openAdd(view === 'day' ? anchor : selectedDate)}><Plus size={15} /> 新建日程</button>
        </div>
      </div>

      {view === 'month' ? (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="cal-week">
            {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
              <div key={d} className="cal-week-cell">周{d}</div>
            ))}
          </div>
          <div className="cal-grid">
            {monthDays.map((day) => {
              const evs = monthVisibleItems(day)
              const isCur = isSameMonth(day, anchor)
              const isSel = isSameDay(day, selectedDate)
              return (
                <div
                  key={day.toISOString()}
                  className={`cal-cell ${isCur ? '' : 'muted'} ${isSel ? 'selected' : ''} ${isToday(day) ? 'today' : ''}`}
                  onClick={() => setSelectedDate(day)}
                  onDoubleClick={() => openAdd(day)}
                  onMouseEnter={(e) => { if (evs.length > 3) { setHoverDay(day); setMousePos({ x: e.clientX, y: e.clientY }) } }}
                  onMouseMove={(e) => evs.length > 3 && setMousePos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHoverDay((d) => (d && d.getTime() === day.getTime() ? null : d))}
                >
                  <div className="cal-cell-num">{format(day, 'd')}</div>
                  <div className="cal-cell-events">
                    {renderChips(evs.slice(0, 3))}
                    {evs.length > 3 && <div className="cal-more">+{evs.length - 3} 更多 · 悬停查看全部</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        renderTimeline(view === 'week' ? weekDays : [anchor])
      )}

      {hoverDay && hoverEvs.length > 3 && (
        <div className="cal-hover-card card" onMouseLeave={() => setHoverDay(null)}
          style={{ left: Math.min(mousePos.x + 14, window.innerWidth - 300), top: Math.min(mousePos.y + 10, window.innerHeight - 380) }}>
          <div className="cal-hover-title">{format(hoverDay, 'M月d日 EEEE', { locale: zhCN })} · 共 {hoverEvs.length} 项</div>
          <div className="cal-hover-list">
            {hoverEvs.map((e) => (
              <div key={e.id} className="cal-hover-item" onClick={() => onItemClick(e)}>
                <span className="cal-hover-dot" style={{ background: isBdayItem(e) ? BIRTHDAY_COLOR : isMsItem(e) ? '#f08c00' : isTaskItem(e) ? TASK_COLOR : typeMeta[(e as CalEvent).type].color }} />
                <span className="cal-hover-time">{e.start.slice(11, 16)}</span>
                <span className="cal-hover-title-text">{e.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="page-sub" style={{ marginTop: 14, display: 'flex', gap: 16, alignItems: 'center' }}>
        <span>选中日期：{format(selectedDate, 'yyyy年 M月 d日 EEEE', { locale: zhCN })}</span>
        <span>· 双击空白格快速添加</span>
        <span>· 图例：📌 待办到期 · 🏁 里程碑 · 🎂 生日</span>
        {view !== 'month' && <span>· 双击时间槽按该时段创建</span>}
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CalendarIcon size={18} color="var(--accent)" />
              {editEvent ? '编辑日程' : '新建日程'}
            </div>
            <div className="field">
              <label>标题</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：组会汇报 / 文献阅读" autoFocus />
            </div>
            <div className="field">
              <label>类型</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EventType })}>
                {Object.entries(typeMeta).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label>开始时间</label>
                <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </div>
              <div className="field">
                <label>结束时间</label>
                <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>备注</label>
              <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="可选备注…" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              {editEvent ? (
                <button className="btn" style={{ color: '#e5484d' }} onClick={() => {
                  const del = editEvent
                  deleteEvent(del.id)
                  setModalOpen(false)
                  useToast.getState().show(`已删除日程「${del.title}」`, { actionLabel: '撤销', onAction: () => addEvent(del) })
                }}>
                  <X size={15} /> 删除
                </button>
              ) : <div />}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>取消</button>
                <button className="btn btn-primary" onClick={save} disabled={!form.title.trim()}>保存</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .cal-week { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid var(--border); }
        .cal-week-cell { padding: 10px; text-align: center; font-size: 12px; color: var(--text-3); font-weight: 600; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
        .cal-cell {
          min-height: 92px; min-width: 0; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);
          padding: 6px 7px; cursor: pointer; transition: background 0.12s ease;
        }
        .cal-cell:nth-child(7n) { border-right: none; }
        .cal-cell:hover { background: var(--bg-hover); }
        .cal-cell.muted { opacity: 0.4; }
        .cal-cell.selected { background: var(--accent-soft); }
        .cal-cell-num { font-size: 13px; font-weight: 600; color: var(--text-1); width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 6px; margin-bottom: 3px; }
        .cal-cell.today .cal-cell-num { background: var(--accent); color: #fff; }
        .cal-chip {
          font-size: 11px; color: #fff; border-radius: 5px; padding: 2px 6px; margin-bottom: 3px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; max-width: 100%;
        }
        .chip-birthday { box-shadow: 0 1px 4px rgba(244, 114, 182, 0.4); }
        .chip-milestone { box-shadow: 0 1px 4px rgba(240, 140, 0, 0.4); }
        .chip-task { box-shadow: 0 1px 4px rgba(14, 165, 233, 0.4); }
        .tl-birthday { box-shadow: 0 1px 4px rgba(244, 114, 182, 0.4); }
        .tl-milestone { box-shadow: 0 1px 4px rgba(240, 140, 0, 0.4); }
        .tl-task { box-shadow: 0 1px 4px rgba(14, 165, 233, 0.4); }
        .cal-more { font-size: 11px; color: var(--text-3); padding-left: 4px; }

        /* 悬浮卡片 */
        .cal-hover-card {
          position: fixed; z-index: 60; width: 280px; padding: 14px;
          box-shadow: var(--shadow-lg); animation: popIn 0.15s ease;
        }
        .cal-hover-title { font-size: 13px; font-weight: 700; margin-bottom: 8px; color: var(--text-1); }
        .cal-hover-list { max-height: 300px; overflow-y: auto; }
        .cal-hover-item {
          display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 7px;
          cursor: pointer; font-size: 13px;
        }
        .cal-hover-item:hover { background: var(--bg-hover); }
        .cal-hover-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
        .cal-hover-time { font-size: 11px; color: var(--text-3); font-weight: 600; min-width: 40px; }
        .cal-hover-title-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* 时间轴 */
        .timeline-scroll { overflow: auto; max-height: calc(100vh - 210px); border-radius: var(--radius); background: var(--bg-card); border: 1px solid var(--border); }
        .tl-grid { display: flex; min-width: 640px; }
        .tl-time-col { flex-shrink: 0; width: 52px; border-right: 1px solid var(--border); background: var(--bg-card); position: sticky; left: 0; z-index: 2; }
        .tl-corner { height: 44px; border-bottom: 1px solid var(--border); }
        .tl-hour-label { height: 64px; font-size: 11px; color: var(--text-3); text-align: right; padding-right: 8px; transform: translateY(-6px); }
        .tl-day-col { flex: 1; min-width: 0; position: relative; border-right: 1px solid var(--border); }
        .tl-day-col:last-child { border-right: none; }
        .tl-day-header { height: 44px; text-align: center; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg-card); z-index: 1; }
        .tl-day-header.today { color: var(--accent-text); }
        .tl-hour-slot { height: 64px; border-bottom: 1px dashed var(--border); cursor: pointer; }
        .tl-day-col:hover .tl-hour-slot { background: var(--bg-hover); }
        .tl-event {
          position: absolute; left: 4px; right: 4px; z-index: 3; border-radius: 7px;
          padding: 3px 7px; color: #fff; font-size: 11px; overflow: hidden;
          cursor: pointer; box-shadow: var(--shadow); white-space: nowrap; text-overflow: ellipsis;
        }
        .tl-event:hover { filter: brightness(1.1); }
        .tl-event-time { font-weight: 700; margin-right: 4px; }
      `}</style>
    </div>
  )
}

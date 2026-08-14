import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Plus, Trash2, BookOpen, Upload, FileDown, CheckSquare, Calendar as CalendarIcon, CalendarCheck, PencilLine, Layers } from 'lucide-react'
import { useStore, uid } from '../store'
import { Paper, PaperStatus, Priority, EventType } from '../types'
import { parseImportJson, papersFromImport, papersTemplateJson, tasksFromImport, eventsFromImport, ImportPreview } from '../lib/import'
import { useToast } from '../lib/toast'
import PromptModal from '../components/PromptModal'
import DatePicker from '../components/DatePicker'

const PALETTE = ['#f59f00', '#4f6ef7', '#2f9e6e', '#e5484d', '#8b5cf6', '#0ea5e9', '#d6336c', '#f08c00', '#12b886', '#7048e8']

const STATUS_META: Record<PaperStatus, { label: string; cls: string }> = {
  unread: { label: '未读', cls: 's-todo' },
  reading: { label: '在读', cls: 's-doing' },
  read: { label: '已读', cls: 's-done' },
}

const statusOrder: PaperStatus[] = ['unread', 'reading', 'read']

const PRIORITY_META: Record<Priority, string> = { high: '高', medium: '中', low: '低' }
const EVENT_TYPE_META: Record<EventType, string> = {
  course: '课程',
  meeting: '组会',
  deadline: '截止',
  personal: '生活',
}

const stageIndex = (name: string, stages: string[]) => {
  const i = stages.indexOf(name)
  return i >= 0 ? i : stages.length
}
const stageColor = (name: string, stages: string[]) => PALETTE[stageIndex(name, stages) % PALETTE.length]

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface TaskConfirmState {
  paper: Paper
  title: string
  date: string
  priority: Priority
}
interface EventConfirmState {
  paper: Paper
  title: string
  date: string
  type: EventType
}

export default function LiteratureView() {
  const papers = useStore((s) => s.papers)
  const tasks = useStore((s) => s.tasks)
  const paperStages = useStore((s) => s.paperStages)
  const addPaperStage = useStore((s) => s.addPaperStage)
  const deletePaperStage = useStore((s) => s.deletePaperStage)
  const importPapers = useStore((s) => s.importPapers)
  const importTasks = useStore((s) => s.importTasks)
  const importEvents = useStore((s) => s.importEvents)
  const updatePaper = useStore((s) => s.updatePaper)
  const deletePaper = useStore((s) => s.deletePaper)
  const addTask = useStore((s) => s.addTask)
  const updateTask = useStore((s) => s.updateTask)
  const addEvent = useStore((s) => s.addEvent)

  const [filter, setFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<PaperStatus | 'all'>('all')
  const [planView, setPlanView] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ title: '', authors: '', year: '', venue: '', stage: '', category: '其他', plannedDate: '', note: '' })
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [editingTitle, setEditingTitle] = useState<Paper | null>(null)
  const [stageMgrOpen, setStageMgrOpen] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [taskConfirm, setTaskConfirm] = useState<TaskConfirmState | null>(null)
  const [eventConfirm, setEventConfirm] = useState<EventConfirmState | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 动态阶段列表：配置的 stage + 数据中实际出现的 stage，按出现顺序
  const stages = useMemo(() => {
    const list = [...paperStages]
    papers.forEach((p) => {
      if (!list.includes(p.stage)) list.push(p.stage)
    })
    if (list.length === 0) list.push('未分类')
    return list
  }, [paperStages, papers])

  const onPickFile = (f: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        setPreview(parseImportJson(reader.result as string))
      } catch (err) {
        alert((err as Error).message)
      }
    }
    reader.readAsText(f)
  }

  const grouped = useMemo(() => {
    const list = papers.filter((p) => {
      if (filter !== 'all' && p.stage !== filter) return false
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      return true
    })
    const map = new Map<string, Paper[]>()
    list.forEach((p) => {
      if (!map.has(p.stage)) map.set(p.stage, [])
      map.get(p.stage)!.push(p)
    })
    return stages.filter((s) => map.has(s)).map((s) => ({ stage: s, items: map.get(s)! }))
  }, [papers, filter, statusFilter, stages])

  // 阅读计划视图：按计划日期分组（尊重当前筛选）
  const planGroups = useMemo(() => {
    const list = papers.filter((p) => {
      if (filter !== 'all' && p.stage !== filter) return false
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      return true
    })
    const map = new Map<string, Paper[]>()
    const without: Paper[] = []
    list.forEach((p) => {
      if (!p.plannedDate) { without.push(p); return }
      if (!map.has(p.plannedDate)) map.set(p.plannedDate, [])
      map.get(p.plannedDate)!.push(p)
    })
    const withDate = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, items]) => ({ date, items }))
    return { withDate, without }
  }, [papers, filter, statusFilter])

  const planDateLabel = (date: string) => {
    const today = new Date()
    const d = new Date(date)
    const todayStrLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const diff = Math.round((d.getTime() - new Date(todayStrLocal).getTime()) / 86400000)
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
    if (diff === 0) return '今天'
    if (diff === 1) return '明天'
    if (diff === -1) return '昨天'
    if (diff > 1 && diff < 7) return `星期${week}`
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  // 一键同步：未读/在读且有计划日期的文献 → 待办（按标题去重，存在则更新日期）
  const syncAllToTasks = () => {
    const targets = papers.filter((p) => p.plannedDate && p.status !== 'read')
    if (targets.length === 0) {
      alert('没有可同步的文献（需要有计划日期，且状态非「已读」）')
      return
    }
    let added = 0
    let updated = 0
    for (const p of targets) {
      const title = `[文献] ${p.title}`
      const due = `${p.plannedDate}T09:00:00`
      const existed = tasks.find((t) => t.title === title)
      if (existed) {
        if (existed.due !== due) {
          updateTask({ ...existed, due })
          updated++
        }
      } else {
        addTask({
          id: uid(),
          title,
          priority: 'medium',
          status: 'todo',
          due,
          subtasks: [],
          createdAt: new Date().toISOString(),
        })
        added++
      }
    }
    alert(`已同步：新增待办 ${added} 条${updated ? `，更新日期 ${updated} 条` : ''}。可在「待办」中查看。`)
  }

  const renderFocusBadge = (p: Paper) => {
    if (p.focus === 'core') {
      return <span className="priority-badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>精读</span>
    }
    if (p.focus === 'skim') {
      return <span className="priority-badge" style={{ background: 'var(--bg-hover)', color: 'var(--text-3)' }}>略读</span>
    }
    return null
  }

  const renderPlanCard = (p: Paper) => {
    const meta = STATUS_META[p.status]
    return (
      <div key={p.id} className="card lit-item" style={{ borderLeft: `3px solid ${stageColor(p.stage, stages)}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: p.status === 'read' ? 'var(--text-3)' : 'var(--text-1)' }}>{p.title}</span>
            {renderFocusBadge(p)}
            <span className="priority-badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>{p.category}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
            {[p.authors, p.year ? String(p.year) : '', p.venue].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span className={`status-badge ${meta.cls}`} style={{ cursor: 'pointer' }} title="点击切换状态" onClick={() => cycleStatus(p)}>{meta.label}</span>
          <DatePicker value={p.plannedDate} placeholder="未排期" onChange={(v) => updatePaper({ ...p, plannedDate: v })} />
        </div>
      </div>
    )
  }

  const total = papers.length
  const readCount = papers.filter((p) => p.status === 'read').length
  const progress = total ? Math.round((readCount / total) * 100) : 0

  const confirmImport = () => {
    if (!preview) return
    if (preview.count === 0) {
      alert('没有找到有效条目（需要至少包含 title 字段）')
      return
    }
    if (preview.module === 'papers') {
      const list = papersFromImport(preview)
      importPapers(list)
      alert(`已导入 ${list.length} 篇文献（重复标题自动跳过）`)
    } else if (preview.module === 'tasks') {
      const list = tasksFromImport(preview)
      importTasks(list)
      alert(`已导入 ${list.length} 条待办（重复标题自动跳过）`)
    } else if (preview.module === 'events') {
      const list = eventsFromImport(preview)
      importEvents(list)
      alert(`已导入 ${list.length} 条日程（重复标题自动跳过）`)
    } else {
      alert(`模块 "${preview.title}" 的导入暂未支持，请使用文献（papers）模块`)
    }
    setPreview(null)
  }

  const downloadTemplate = () => {
    const blob = new Blob([papersTemplateJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'literature-template.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const cycleStatus = (p: Paper) => {
    const idx = statusOrder.indexOf(p.status)
    updatePaper({ ...p, status: statusOrder[(idx + 1) % statusOrder.length] })
  }

  const openTaskConfirm = (p: Paper) => {
    setTaskConfirm({
      paper: p,
      title: `[文献] ${p.title}`,
      date: p.plannedDate ?? todayStr(),
      priority: 'medium',
    })
  }

  const confirmTask = () => {
    if (!taskConfirm) return
    addTask({
      id: uid(),
      title: taskConfirm.title,
      priority: taskConfirm.priority,
      status: 'todo',
      due: `${taskConfirm.date}T09:00:00`,
      subtasks: [],
      createdAt: new Date().toISOString(),
    })
    updatePaper({ ...taskConfirm.paper, status: 'reading' })
    setTaskConfirm(null)
  }

  const openEventConfirm = (p: Paper) => {
    setEventConfirm({
      paper: p,
      title: `读文献：${p.title}`,
      date: p.plannedDate ?? todayStr(),
      type: 'personal',
    })
  }

  const confirmEvent = () => {
    if (!eventConfirm) return
    addEvent({
      id: uid(),
      title: eventConfirm.title,
      start: `${eventConfirm.date}T09:00:00`,
      end: `${eventConfirm.date}T10:30:00`,
      type: eventConfirm.type,
      note: eventConfirm.paper.note,
    })
    setEventConfirm(null)
  }

  const save = () => {
    if (!form.title.trim()) return
    const stage = form.stage || '未分类'
    if (form.stage && !paperStages.includes(form.stage)) addPaperStage(form.stage)
    importPapers([{
      id: uid(),
      title: form.title.trim(),
      authors: form.authors.trim() || undefined,
      year: form.year ? Number(form.year) : undefined,
      venue: form.venue.trim() || undefined,
      stage,
      category: form.category.trim() || '其他',
      plannedDate: form.plannedDate || undefined,
      note: form.note.trim() || undefined,
      status: 'unread',
      createdAt: new Date().toISOString(),
    }])
    setModalOpen(false)
    setForm({ title: '', authors: '', year: '', venue: '', stage: '', category: '其他', plannedDate: '', note: '' })
  }

  const addStage = () => {
    const n = newStageName.trim()
    if (!n) return
    addPaperStage(n)
    setNewStageName('')
  }

  const fmtDate = (d: string) => {
    const dt = new Date(d)
    return `${dt.getMonth() + 1}月${dt.getDate()}日（${['日', '一', '二', '三', '四', '五', '六'][dt.getDay()]}）`
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">文献阅读</div>
          <div className="page-sub">
            {total} 篇文献 · 已读 {readCount} 篇 · 完成率 {progress}%
          </div>
          <div style={{ width: 260, marginTop: 8, background: 'var(--bg-hover)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', width: `${progress}%`, borderRadius: 6, transition: 'width .3s ease' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={downloadTemplate}><FileDown size={15} /> AI 模板</button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={15} /> 导入 JSON</button>
          <button className="btn btn-ghost" onClick={() => setStageMgrOpen(true)}><Layers size={15} /> 管理阶段</button>
          <button className={planView ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setPlanView(!planView)}><CalendarCheck size={15} /> 阅读计划</button>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> 新建文献</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`chip ${filter === 'all' ? 'chip-active' : ''}`} onClick={() => setFilter('all')}>全部</button>
        {stages.map((s) => (
          <button key={s} className={`chip ${filter === s ? 'chip-active' : ''}`} onClick={() => setFilter(filter === s ? 'all' : s)}>
            <span className="lit-stage-dot" style={{ background: stageColor(s, stages), display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} />
            {s}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {(['all', ...statusOrder] as const).map((st) => (
          <button key={st} className={`chip ${statusFilter === st ? 'chip-active' : ''}`} onClick={() => setStatusFilter(statusFilter === st ? 'all' : st)}>
            {st === 'all' ? '全部状态' : STATUS_META[st].label}
          </button>
        ))}
      </div>

      {papers.length === 0 && (
        <div className="empty">
          <div className="empty-icon"><BookOpen size={40} /></div>
          还没有文献。<br />
          可以点击右上角「AI 模板」下载 JSON 模板，让 AI 按模板生成阅读计划后「导入 JSON」；
          <br />也可以直接「新建文献」手动添加。
        </div>
      )}

      {planView ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
              已安排 {planGroups.withDate.reduce((n, g) => n + g.items.length, 0)} 篇 · 未排期 {planGroups.without.length} 篇
            </span>
            <button className="btn btn-primary" onClick={syncAllToTasks}><CheckSquare size={15} /> 同步到待办</button>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              修改日期即时保存 · 同步后待办中出现「[文献] xxx」（截止=计划日 09:00），重复同步自动更新不重复
            </span>
          </div>

          {planGroups.withDate.map((g) => {
            const today = todayStr()
            const isOverdue = g.date < today
            return (
              <div key={g.date} style={{ marginBottom: 16 }}>
                <div className="lit-stage-header">
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{planDateLabel(g.date)}</span>
                  <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{g.date}</span>
                  {isOverdue && <span className="priority-badge p-high">已逾期</span>}
                  <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{g.items.length} 篇</span>
                </div>
                <div className="lit-list">{g.items.map(renderPlanCard)}</div>
              </div>
            )
          })}

          {planGroups.without.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="lit-stage-header">
                <span style={{ fontWeight: 700, fontSize: 15 }}>未排期</span>
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{planGroups.without.length} 篇</span>
              </div>
              <div className="lit-list">{planGroups.without.map(renderPlanCard)}</div>
            </div>
          )}
        </div>
      ) : (
      grouped.map((g) => (
        <div key={g.stage} style={{ marginBottom: 18 }}>
          <div className="lit-stage-header">
            <span className="lit-stage-dot" style={{ background: stageColor(g.stage, stages) }} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>{g.stage}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{g.items.filter((p) => p.status === 'read').length}/{g.items.length}</span>
          </div>
          <div className="lit-list">
            {g.items.map((p) => {
              const meta = STATUS_META[p.status]
              const today = todayStr()
              const overdue = p.status !== 'read' && !!p.plannedDate && p.plannedDate < today
              return (
                <div key={p.id} className="card lit-item" style={{ borderLeft: `3px solid ${stageColor(p.stage, stages)}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: p.status === 'read' ? 'var(--text-3)' : 'var(--text-1)' }}>{p.title}</span>
                      {renderFocusBadge(p)}
                      <span className="priority-badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>{p.category}</span>
                      {overdue && <span className="priority-badge p-high">已逾期</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                      {[p.authors, p.year ? String(p.year) : '', p.venue].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {p.note && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{p.note}</div>}
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                      {p.plannedDate ? `计划 ${format(new Date(p.plannedDate), 'M月d日')}` : '未排期'}
                      {p.link && <span style={{ marginLeft: 10 }}><a href={p.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)' }}>原文链接</a></span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span className={`status-badge ${meta.cls}`} style={{ cursor: 'pointer' }} title="点击切换状态" onClick={() => cycleStatus(p)}>{meta.label}</span>
                    <button className="icon-btn" title="转待办" onClick={() => openTaskConfirm(p)}><CheckSquare size={15} /></button>
                    <button className="icon-btn" title="转日历日程" onClick={() => openEventConfirm(p)}><CalendarIcon size={15} /></button>
                    <button className="icon-btn" title="编辑标题" onClick={() => setEditingTitle(p)}><PencilLine size={15} /></button>
                    <button className="icon-btn danger" title="删除" onClick={() => { deletePaper(p.id); useToast.getState().show(`已删除文献「${p.title}」`, { actionLabel: '撤销', onAction: () => importPapers([p]) }) }}><Trash2 size={15} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))
      )}

      {/* 导入确认 */}
      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">确认导入</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
              检测到 <b>{preview.title}</b> 模块，共 <b>{preview.count}</b> 条有效条目。
              <br />重复标题会自动跳过，其余将添加到当前列表。
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>取消</button>
              <button className="btn btn-primary" onClick={confirmImport}>导入</button>
            </div>
          </div>
        </div>
      )}

      {/* 转待办确认 */}
      {taskConfirm && (
        <div className="modal-overlay" onClick={() => setTaskConfirm(null)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">转待办确认</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 14 }}>
              该任务将出现在 <b>「待办」模块</b> 的 <b>列表 / 看板 / 四象限</b> 视图中，
              <br />同时自动关联阅读进度（本篇文献标记为「在读」）。
            </div>
            <div className="field">
              <label>任务标题</label>
              <input value={taskConfirm.title} onChange={(e) => setTaskConfirm({ ...taskConfirm, title: e.target.value })} />
            </div>
            <div className="field-row">
              <div className="field">
                <label>截止日期（将显示在待办中）</label>
                <DatePicker value={taskConfirm.date} onChange={(v) => setTaskConfirm({ ...taskConfirm, date: v ?? '' })} />
              </div>
              <div className="field">
                <label>优先级</label>
                <select value={taskConfirm.priority} onChange={(e) => setTaskConfirm({ ...taskConfirm, priority: e.target.value as Priority })}>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
              确认后将在 <b>{fmtDate(taskConfirm.date)}</b> 生成待办：{taskConfirm.title}（优先级{PRIORITY_META[taskConfirm.priority]}）
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setTaskConfirm(null)}>取消</button>
              <button className="btn btn-primary" onClick={confirmTask} disabled={!taskConfirm.title.trim() || !taskConfirm.date}>确认生成</button>
            </div>
          </div>
        </div>
      )}

      {/* 转日历确认 */}
      {eventConfirm && (
        <div className="modal-overlay" onClick={() => setEventConfirm(null)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">转日历日程确认</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 14 }}>
              该日程将出现在 <b>「日历」模块</b> 的对应日期中（月 / 周 / 日视图均可看到），
              <br />时间段为 <b>09:00 – 10:30</b>。
            </div>
            <div className="field">
              <label>日程标题</label>
              <input value={eventConfirm.title} onChange={(e) => setEventConfirm({ ...eventConfirm, title: e.target.value })} />
            </div>
            <div className="field-row">
              <div className="field">
                <label>日期（将出现在日历的这一天）</label>
                <DatePicker value={eventConfirm.date} onChange={(v) => setEventConfirm({ ...eventConfirm, date: v ?? '' })} />
              </div>
              <div className="field">
                <label>类型</label>
                <select value={eventConfirm.type} onChange={(e) => setEventConfirm({ ...eventConfirm, type: e.target.value as EventType })}>
                  <option value="personal">生活</option>
                  <option value="course">课程</option>
                  <option value="meeting">组会</option>
                  <option value="deadline">截止</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
              确认后将在日历 <b>{fmtDate(eventConfirm.date)}</b> 生成日程：{eventConfirm.title}（{EVENT_TYPE_META[eventConfirm.type]}类型，09:00–10:30）
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setEventConfirm(null)}>取消</button>
              <button className="btn btn-primary" onClick={confirmEvent} disabled={!eventConfirm.title.trim() || !eventConfirm.date}>确认生成</button>
            </div>
          </div>
        </div>
      )}

      {/* 阶段管理 */}
      {stageMgrOpen && (
        <div className="modal-overlay" onClick={() => setStageMgrOpen(false)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">管理阶段</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              阶段数量可自由扩展。删除阶段后，该阶段下的文献会移到「未分类」。
            </div>
            <div className="lit-list" style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 14 }}>
              {stages.map((s) => {
                const count = papers.filter((p) => p.stage === s).length
                return (
                  <div key={s} className="card lit-item" style={{ padding: '8px 12px', alignItems: 'center' }}>
                    <span className="lit-stage-dot" style={{ background: stageColor(s, stages), width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{s}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{count} 篇</span>
                    <button className="icon-btn danger" title="删除阶段" onClick={() => {
                      if (count > 0 && !confirm(`删除阶段「${s}」？其中 ${count} 篇文献将移到「未分类」`)) return
                      deletePaperStage(s)
                    }}><Trash2 size={14} /></button>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ flex: 1, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg)', color: 'var(--text-1)', fontSize: 14 }}
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') addStage() }}
                placeholder="新阶段名称，如：阶段4 论文写作"
              />
              <button className="btn btn-primary" onClick={addStage} disabled={!newStageName.trim()}>添加</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => setStageMgrOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])} />

      {editingTitle && (
        <PromptModal
          title="编辑标题"
          initial={editingTitle.title}
          onCancel={() => setEditingTitle(null)}
          onConfirm={(v) => {
            updatePaper({ ...editingTitle, title: v })
            setEditingTitle(null)
          }}
        />
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">新建文献</div>
            <div className="field">
              <label>标题 *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：Influence Function Based Data Poisoning Attacks" autoFocus />
            </div>
            <div className="field-row">
              <div className="field">
                <label>作者</label>
                <input value={form.authors} onChange={(e) => setForm({ ...form, authors: e.target.value })} placeholder="作者1, 作者2" />
              </div>
              <div className="field" style={{ flex: 0.4 }}>
                <label>年份</label>
                <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="2024" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>会议/期刊</label>
                <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="例如：WWW 2020" />
              </div>
              <div className="field" style={{ flex: 0.6 }}>
                <label>类别</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="例如：启发式 / GAN / 大模型" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>阶段（也可直接输入新阶段）</label>
                <input
                  list="paper-stages"
                  value={form.stage}
                  onChange={(e) => setForm({ ...form, stage: e.target.value })}
                  placeholder="选择或输入新阶段名称"
                />
                <datalist id="paper-stages">
                  {stages.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="field" style={{ flex: 0.6 }}>
                <label>计划日期</label>
                <DatePicker value={form.plannedDate || undefined} onChange={(v) => setForm({ ...form, plannedDate: v ?? '' })} />
              </div>
            </div>
            <div className="field">
              <label>阅读要点</label>
              <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="一句话：这篇论文的核心是什么、为什么要读" rows={2} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.title.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

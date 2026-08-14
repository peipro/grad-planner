import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Plus, Trash2, CheckSquare, Square, Loader, ChevronRight, ChevronDown, PencilLine, StickyNote, BookOpen } from 'lucide-react'
import { useStore, uid, Project } from '../store'
import { useToast } from '../lib/toast'
import { parseQuickAdd } from '../lib/natural'
import { classifyQuadrant, overdueDays } from '../lib/task'
import { Priority, Task, TaskStatus } from '../types'
import PromptModal from '../components/PromptModal'
import DatePicker from '../components/DatePicker'
import {
  papersOfProject, notesOfProject,
  linkPaperProject, unlinkPaperProject,
  linkNoteProject, unlinkNoteProject,
  createProjectNote,
} from '../lib/relations'

const tabs: { id: 'list' | 'quadrant' | 'board'; label: string }[] = [
  { id: 'list', label: '列表' },
  { id: 'board', label: '看板' },
  { id: 'quadrant', label: '四象限' },
]

const filters: { id: 'all' | 'todo' | 'doing' | 'done' | 'today' | 'week' | 'overdue'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'today', label: '今天' },
  { id: 'overdue', label: '已逾期' },
  { id: 'week', label: '本周' },
  { id: 'todo', label: '待办' },
  { id: 'doing', label: '进行中' },
  { id: 'done', label: '已完成' },
]

const PROJECT_COLORS = ['#4f6ef7', '#8b5cf6', '#2f9e6e', '#f08c00', '#e5484d', '#0ea5e9']

export default function TodoView() {
  const [tab, setTab] = useState<'list' | 'quadrant' | 'board'>('list')
  const [filter, setFilter] = useState<'all' | 'todo' | 'doing' | 'done' | 'today' | 'week' | 'overdue'>('all')
  const [quickInput, setQuickInput] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [projectModal, setProjectModal] = useState(false)
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', priority: 'medium' as Priority, due: '', status: 'todo' as TaskStatus, projectId: '', subtask: '' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newProject, setNewProject] = useState({ name: '', color: PROJECT_COLORS[0] })
  const [subTarget, setSubTarget] = useState<Task | null>(null)

  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const milestones = useStore((s) => s.milestones)
  // Phase 2A：项目关联面板
  const notes = useStore((s) => s.notes)
  const papers = useStore((s) => s.papers)
  const [relPaperAdd, setRelPaperAdd] = useState('')
  const [relNoteAdd, setRelNoteAdd] = useState('')
  const addTask = useStore((s) => s.addTask)
  const updateTask = useStore((s) => s.updateTask)
  const deleteTask = useStore((s) => s.deleteTask)
  const addProject = useStore((s) => s.addProject)
  const updateMilestone = useStore((s) => s.updateMilestone)

  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name
  const projectColor = (id?: string) => projects.find((p) => p.id === id)?.color ?? '#9aa1b0'

  const filtered = useMemo(
    () => tasks.filter((t) => {
      if (activeProject && t.projectId !== activeProject) return false
      if (filter === 'all') return true
      if (filter === 'overdue') return t.status !== 'done' && !!t.due && overdueDays(t.due) > 0
      if (filter === 'today') {
        if (!t.due) return false
        const key = t.due.slice(0, 10)
        const now = new Date()
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        return t.status !== 'done' && key === todayKey
      }
      if (filter === 'week') {
        if (!t.due) return false
        const now = new Date()
        const due = new Date(t.due.slice(0, 10))
        const weekEnd = new Date(now)
        weekEnd.setDate(now.getDate() + (7 - now.getDay()) % 7) // 本周日
        weekEnd.setHours(23, 59, 59, 999)
        return t.status !== 'done' && due >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && due <= weekEnd
      }
      if (filter === 'todo' || filter === 'doing') {
        const isOverdue = t.due ? overdueDays(t.due) > 0 : false
        return t.status === filter && !isOverdue
      }
      return t.status === filter
    }),
    [tasks, filter, activeProject],
  )

  const sorted = useMemo(
    () => [...filtered].sort((a: Task, b: Task) => {
      const prio: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
      return prio[a.priority] - prio[b.priority] || (a.due ?? '9999').localeCompare(b.due ?? '9999')
    }),
    [filtered],
  )

  const quickAdd = () => {
    const raw = quickInput.trim()
    if (!raw) return
    const parsed = parseQuickAdd(raw)
    addTask({
      id: uid(), title: parsed.title || raw,
      priority: parsed.priority ?? 'medium',
      status: 'todo',
      due: parsed.date ? `${parsed.date}T12:00:00` : undefined,
      projectId: activeProject ?? undefined,
      subtasks: [],
      createdAt: new Date().toISOString(),
    })
    setQuickInput('')
  }

  const save = () => {
    if (!form.title.trim()) return
    const subtasks = form.subtask.trim() ? form.subtask.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ id: uid(), title: t, done: false })) : undefined
    if (editingTask) {
      updateTask({
        ...editingTask,
        title: form.title,
        priority: form.priority,
        due: form.due || undefined,
        status: form.status,
        projectId: form.projectId || undefined,
        subtasks: subtasks ?? editingTask.subtasks ?? [],
      })
    } else {
      addTask({ id: uid(), title: form.title, priority: form.priority, due: form.due || undefined, status: form.status, projectId: form.projectId || undefined, subtasks, createdAt: new Date().toISOString() })
    }
    setModalOpen(false)
    setEditingTask(null)
    setForm({ title: '', priority: 'medium', due: '', status: 'todo', projectId: '', subtask: '' })
  }

  const openEdit = (t: Task) => {
    setEditingTask(t)
    setForm({
      title: t.title,
      priority: t.priority,
      due: t.due ? t.due.slice(0, 10) : '',
      status: t.status,
      projectId: t.projectId ?? '',
      subtask: (t.subtasks ?? []).map((s) => s.title).join('\n'),
    })
    setModalOpen(true)
  }

  const saveProject = () => {
    if (!newProject.name.trim()) return
    addProject({ id: uid(), name: newProject.name.trim(), color: newProject.color })
    setProjectModal(false)
    setNewProject({ name: '', color: PROJECT_COLORS[0] })
  }

  const removeTask = (t: Task) => {
    deleteTask(t.id)
    useToast.getState().show(`已删除「${t.title}」`, {
      actionLabel: '撤销',
      onAction: () => addTask(t),
    })
  }

  const removeProject = (p: Project) => {
    const snapTasks = tasks.filter((t) => t.projectId === p.id)
    const snapMiles = milestones.filter((m) => m.projectId === p.id)
    useStore.getState().deleteProject(p.id)
    useToast.getState().show(`已删除项目「${p.name}」`, {
      actionLabel: '撤销',
      onAction: () => {
        addProject(p)
        snapTasks.forEach((t) => updateTask(t))
        snapMiles.forEach((m) => updateMilestone(m))
      },
    })
  }

  const toggleStatus = (t: Task) => {
    const next: TaskStatus = t.status === 'done' ? 'todo' : t.status === 'todo' ? 'doing' : 'done'
    updateTask({ ...t, status: next })
  }

  const toggleSubtask = (t: Task, sid: string) => {
    const subtasks = (t.subtasks ?? []).map((st) => (st.id === sid ? { ...st, done: !st.done } : st))
    updateTask({ ...t, subtasks })
  }

  const addSubtask = (t: Task) => {
    setSubTarget(t)
  }

  const confirmSubtask = (title: string) => {
    if (subTarget) updateTask({ ...subTarget, subtasks: [...(subTarget.subtasks ?? []), { id: uid(), title, done: false }] })
    setSubTarget(null)
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const taskCard = (t: Task) => {
    const subs = t.subtasks ?? []
    const doneSubs = subs.filter((s) => s.done).length
    const hasSubs = subs.length > 0
    const isOpen = expanded.has(t.id)
    const od = t.status !== 'done' && t.due ? overdueDays(t.due) : 0
    const isOverdue = od > 0
    return (
      <div key={t.id} className="todo-item" style={t.status === 'done' ? { opacity: 0.55 } : {}}>
        <button className="todo-check" onClick={() => toggleStatus(t)} title="点击切换状态">
          {t.status === 'done' ? <CheckSquare size={19} color="var(--accent)" /> : t.status === 'doing' ? <Loader size={19} color="#f08c00" /> : <Square size={19} color="var(--text-3)" />}
        </button>
        <div className="todo-body">
          <div className="todo-title" style={t.status === 'done' ? { textDecoration: 'line-through' } : {}}>
            {hasSubs && (
              <button className="icon-btn" style={{ padding: 2, marginRight: 4 }} onClick={() => toggleExpand(t.id)}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
            {t.title}
          </div>
          <div className="todo-meta">
            {t.projectId && (
              <span className="project-badge" style={{ background: `${projectColor(t.projectId)}1a`, color: projectColor(t.projectId) }}>
                {projectName(t.projectId)}
              </span>
            )}
            <span className={`priority-badge p-${t.priority}`}>
              {{ high: '高', medium: '中', low: '低' }[t.priority]}优先级
            </span>
            {isOverdue ? (
              <span className="overdue-badge" title={`截止 ${format(new Date(t.due!), 'yyyy-MM-dd')}`}>
                ⚠ 已逾期 {od} 天
              </span>
            ) : (
              <>
                <span className={`status-badge s-${t.status}`}>
                  {{ todo: '待办', doing: '进行中', done: '已完成' }[t.status]}
                </span>
                {t.due && <span className="todo-due">{format(new Date(t.due), 'M月d日')}</span>}
              </>
            )}
            {hasSubs && <span className="todo-due">{doneSubs}/{subs.length} 子任务</span>}
          </div>
          {isOpen && hasSubs && (
            <div className="subtask-list">
              {subs.map((st) => (
                <div key={st.id} className="subtask-item" onClick={() => toggleSubtask(t, st.id)}>
                  {st.done ? <CheckSquare size={14} color="var(--accent)" /> : <Square size={14} color="var(--text-3)" />}
                  <span style={st.done ? { textDecoration: 'line-through', color: 'var(--text-3)' } : {}}>{st.title}</span>
                </div>
              ))}
              <button className="subtask-add" onClick={() => addSubtask(t)}><Plus size={12} /> 添加子任务</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button className="icon-btn" onClick={() => openEdit(t)} title="编辑"><PencilLine size={15} /></button>
          <button className="icon-btn" onClick={() => removeTask(t)} title="删除"><Trash2 size={15} /></button>
        </div>
      </div>
    )
  }

  // 四象限规则：
  //   重要 = 优先级 高/中
  //   紧急 = 有截止日期且截止 <= 明天
  //   已完成任务不参与象限
  const quadrantTasks = (urgent: boolean, important: boolean) =>
    tasks.filter((t) => {
      const q = classifyQuadrant(t)
      return q !== null && q.urgent === urgent && q.important === important
    })

  const boardCols: { id: TaskStatus; label: string; color: string }[] = [
    { id: 'todo', label: '待办', color: '#9aa1b0' },
    { id: 'doing', label: '进行中', color: '#f08c00' },
    { id: 'done', label: '已完成', color: '#2f9e6e' },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">待办</div>
          <div className="page-sub">共 {tasks.length} 项 · 已完成 {tasks.filter((t) => t.status === 'done').length} 项</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setProjectModal(true)}><Plus size={15} /> 项目</button>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> 新建任务</button>
        </div>
      </div>

      {/* 项目筛选 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn btn-sm ${activeProject === null ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveProject(null)}>全部</button>
        {projects.map((p) => (
          <button key={p.id} className={`btn btn-sm ${activeProject === p.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveProject(activeProject === p.id ? null : p.id)}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 3, background: p.color, marginRight: 5 }} />
            {p.name}
          </button>
        ))}
      </div>

      {/* Phase 2A：项目关联面板（相关论文 / 相关笔记） */}
      {activeProject && (() => {
        const curProject = projects.find((p) => p.id === activeProject)
        if (!curProject) return null
        const relPapers = papersOfProject(activeProject)
        const relNotes = notesOfProject(activeProject)
        return (
          <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: curProject.color }} />
              <b style={{ fontSize: 13 }}>{curProject.name}</b>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>相关论文 {relPapers.length} · 相关笔记 {relNotes.length}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px', minWidth: 240 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}><BookOpen size={12} /> 相关论文</div>
                {relPapers.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>暂无</div>}
                {relPapers.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 12.5 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                    <button className="icon-btn danger" title="解除" onClick={() => unlinkPaperProject(p.id, activeProject)}><Trash2 size={12} /></button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <select value={relPaperAdd} onChange={(e) => setRelPaperAdd(e.target.value)} style={{ flex: 1, fontSize: 12 }}>
                    <option value="">关联论文…</option>
                    {papers.filter((p) => !relPapers.some((x) => x.id === p.id)).map((p) => (
                      <option key={p.id} value={p.id}>{p.title.slice(0, 40)}</option>
                    ))}
                  </select>
                  <button className="btn btn-ghost btn-sm" disabled={!relPaperAdd} onClick={() => { linkPaperProject(relPaperAdd, activeProject); setRelPaperAdd('') }}>关联</button>
                </div>
              </div>
              <div style={{ flex: '1 1 260px', minWidth: 240 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}><StickyNote size={12} /> 相关笔记</div>
                {relNotes.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>暂无</div>}
                {relNotes.map((n) => (
                  <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 12.5 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                    <button className="icon-btn danger" title="解除" onClick={() => unlinkNoteProject(n.id, activeProject)}><Trash2 size={12} /></button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => { createProjectNote(curProject); useStore.getState().setView('notes'); setActiveProject(null) }}>
                    <Plus size={12} /> 创建项目笔记
                  </button>
                  <select value={relNoteAdd} onChange={(e) => setRelNoteAdd(e.target.value)} style={{ flex: 1, fontSize: 12 }}>
                    <option value="">关联已有笔记…</option>
                    {notes.filter((n) => !relNotes.some((x) => x.id === n.id)).map((n) => (
                      <option key={n.id} value={n.id}>{n.title.slice(0, 40)}</option>
                    ))}
                  </select>
                  <button className="btn btn-ghost btn-sm" disabled={!relNoteAdd} onClick={() => { linkNoteProject(relNoteAdd, activeProject); setRelNoteAdd('') }}>关联</button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      <div className="card" style={{ padding: '12px 14px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="quick-input-wrap">
            <input
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') quickAdd() }}
              placeholder="快速添加：支持「明天交报告」「紧急 读完第三章」…"
              style={{ flex: 1 }}
            />
          </div>
          <button className="btn btn-ghost" onClick={quickAdd}>添加</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'list' ? (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {filters.map((f) => (
              <button key={f.id} className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          <div className="card" style={{ padding: 6 }}>
            {sorted.length === 0 && <div className="empty"><div className="empty-icon">📋</div>还没有任务，先添加一个吧</div>}
            {sorted.map(taskCard)}
          </div>
        </>
      ) : tab === 'board' ? (
        <div className="board-grid">
          {boardCols.map((col) => (
            <div key={col.id} className="card board-col">
              <div className="board-col-title" style={{ color: col.color }}>
                {col.label} <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{tasks.filter((t) => t.status === col.id && (!activeProject || t.projectId === activeProject)).length}</span>
              </div>
              {tasks.filter((t) => t.status === col.id && (!activeProject || t.projectId === activeProject)).map(taskCard)}
              {col.id !== 'done' && (
                <button className="board-add" onClick={() => { setForm({ ...form, status: col.id }); setModalOpen(true) }}>
                  <Plus size={14} /> 添加任务
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="quad-legend card">
            <span>规则：</span>
            <span><b style={{ color: '#e5484d' }}>重要</b> = 优先级为高/中</span>
            <span>·</span>
            <span><b style={{ color: '#f08c00' }}>紧急</b> = 截止日期在今天或明天</span>
            <span>·</span>
            <span style={{ color: 'var(--text-3)' }}>快速添加时输入「紧急/重要/尽快」自动设为高优先级</span>
          </div>
          <div className="quadrant-grid">
            <div className="card quad-cell quad-1"><div className="quad-title">重要 · 紧急 <span style={{ color: '#e5484d' }}>▮</span></div>{quadrantTasks(true, true).map(taskCard)}</div>
            <div className="card quad-cell quad-2"><div className="quad-title">重要 · 不紧急 <span style={{ color: '#f08c00' }}>▮</span></div>{quadrantTasks(false, true).map(taskCard)}</div>
            <div className="card quad-cell quad-3"><div className="quad-title">不重要 · 紧急 <span style={{ color: '#0ea5e9' }}>▮</span></div>{quadrantTasks(true, false).map(taskCard)}</div>
            <div className="card quad-cell quad-4"><div className="quad-title">不重要 · 不紧急 <span style={{ color: '#9aa1b0' }}>▮</span></div>{quadrantTasks(false, false).map(taskCard)}</div>
          </div>
        </>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{editingTask ? '编辑任务' : '新建任务'}</div>
            <div className="field">
              <label>任务内容</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：读完《XXX》第三章" autoFocus />
            </div>
            <div className="field-row">
              <div className="field">
                <label>优先级</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </div>
              <div className="field">
                <label>状态</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>
                  <option value="todo">待办</option>
                  <option value="doing">进行中</option>
                  <option value="done">已完成</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>截止日期（可选）</label>
                <DatePicker value={form.due} placeholder="不设置" onChange={(v) => setForm({ ...form, due: v ?? '' })} />
              </div>
              <div className="field">
                <label>所属项目</label>
                <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                  <option value="">无</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>子任务（每行一个，可选）</label>
              <textarea rows={3} value={form.subtask} onChange={(e) => setForm({ ...form, subtask: e.target.value })} placeholder={'例如：\n查资料\n写初稿\n修改'} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.title.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}

      {projectModal && (
        <div className="modal-overlay" onClick={() => setProjectModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">新建项目</div>
            <div className="field">
              <label>项目名称</label>
              <input value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} placeholder="例如：毕业论文 / 深度学习 / 英语学习" autoFocus />
            </div>
            <div className="field">
              <label>颜色</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {PROJECT_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewProject({ ...newProject, color: c })}
                    style={{ width: 26, height: 26, borderRadius: 7, background: c, border: newProject.color === c ? '2px solid var(--text-1)' : 'none' }} />
                ))}
              </div>
            </div>
            {projects.length > 0 && (
              <div className="field">
                <label>已有项目（删除会解除任务关联）</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {projects.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, padding: '6px 10px', borderRadius: 6, background: 'var(--bg-hover)' }}>
                      <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 3, background: p.color, marginRight: 6 }} />{p.name}</span>
                      <button className="icon-btn" style={{ color: '#e5484d' }} onClick={() => removeProject(p)}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setProjectModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={saveProject} disabled={!newProject.name.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .todo-item {
          display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; border-radius: 8px;
          transition: background 0.12s ease;
        }
        .todo-item:hover { background: var(--bg-hover); }
        .todo-check { flex-shrink: 0; display: flex; align-items: center; margin-top: 2px; }
        .todo-body { flex: 1; min-width: 0; }
        .todo-title { font-size: 14px; font-weight: 500; margin-bottom: 4px; display: flex; align-items: center; }
        .todo-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .todo-due { font-size: 12px; color: var(--text-3); }
        .overdue-badge { font-size: 11px; font-weight: 700; color: #e5484d; background: #fdecec; padding: 2px 8px; border-radius: 20px; }
        .theme-dark .overdue-badge { background: #442124; color: #ff8a8d; }
        .project-badge { font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; }
        .icon-btn { padding: 6px; border-radius: 6px; color: var(--text-3); }
        .icon-btn:hover { background: var(--bg-hover); color: #e5484d; }
        .quick-input-wrap { flex: 1; }
        .quick-input-wrap input {
          width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 9px;
          background: var(--bg); color: var(--text-1); font-size: 14px;
        }
        .quick-input-wrap input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        .quadrant-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .quad-legend { padding: 10px 14px; margin-bottom: 12px; font-size: 12px; color: var(--text-2); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .quad-cell { padding: 12px; min-height: 180px; }
        .quad-1 { border-top: 3px solid #e5484d; }
        .quad-2 { border-top: 3px solid #f08c00; }
        .quad-3 { border-top: 3px solid #0ea5e9; }
        .quad-4 { border-top: 3px solid #9aa1b0; }
        .quad-title { font-size: 13px; font-weight: 700; color: var(--text-2); margin-bottom: 8px; padding-left: 4px; }

        /* 看板 */
        .board-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
        .board-col { padding: 12px; min-height: 200px; }
        .board-col-title { font-size: 13px; font-weight: 700; margin-bottom: 8px; padding: 0 4px; }
        .board-add {
          width: 100%; margin-top: 8px; padding: 8px; border-radius: 8px; border: 1px dashed var(--border);
          color: var(--text-3); font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 4px;
          transition: all 0.12s ease;
        }
        .board-add:hover { border-color: var(--accent); color: var(--accent-text); background: var(--accent-soft); }

        /* 子任务 */
        .subtask-list { margin: 6px 0 2px 6px; padding-left: 8px; border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: 3px; }
        .subtask-item { display: flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 3px 6px; border-radius: 5px; cursor: pointer; color: var(--text-2); }
        .subtask-item:hover { background: var(--bg-hover); }
        .subtask-add {
          align-self: flex-start; display: flex; align-items: center; gap: 4px; font-size: 11.5px;
          color: var(--text-3); padding: 3px 6px; border-radius: 5px;
        }
        .subtask-add:hover { color: var(--accent-text); background: var(--bg-hover); }
      `}</style>

      {subTarget && (
        <PromptModal
          title={`为「${subTarget.title}」添加子任务`}
          placeholder="子任务内容…"
          onConfirm={confirmSubtask}
          onCancel={() => setSubTarget(null)}
        />
      )}
    </div>
  )
}

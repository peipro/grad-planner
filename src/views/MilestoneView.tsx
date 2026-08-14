import { useState } from 'react'
import { format, isAfter, startOfToday, isBefore, differenceInCalendarDays } from 'date-fns'
import { Plus, Trash2, GitBranch, CheckSquare, Square, ListChecks, PencilLine } from 'lucide-react'
import { useStore, uid } from '../store'
import { Milestone } from '../types'
import { milestoneProgress } from '../lib/task'
import { useToast } from '../lib/toast'
import PromptModal from '../components/PromptModal'
import DatePicker from '../components/DatePicker'

const colors = ['#4f6ef7', '#8b5cf6', '#2f9e6e', '#f08c00', '#e5484d', '#0ea5e9']

export default function MilestoneView() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [cpTarget, setCpTarget] = useState<Milestone | null>(null)
  const [form, setForm] = useState({ title: '', description: '', startDate: '', endDate: '', color: colors[0], projectId: '' })

  const milestones = useStore((s) => s.milestones)
  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const addMilestone = useStore((s) => s.addMilestone)
  const updateMilestone = useStore((s) => s.updateMilestone)
  const deleteMilestone = useStore((s) => s.deleteMilestone)

  const sorted = [...milestones].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const today = startOfToday()

  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name

  const relatedTasks = (m: Milestone) => m.projectId ? tasks.filter((t) => t.projectId === m.projectId && t.status !== 'done') : []

  /** 进度：检查点 + 关联任务完成度 综合计算 */
  const autoProgress = (m: Milestone): number => milestoneProgress(m, tasks)

  const statusOf = (m: Milestone) => {
    const p = autoProgress(m)
    if (p >= 100) return { label: '已完成', cls: 'done' }
    if (isAfter(today, new Date(m.endDate))) return { label: '已逾期', cls: 'late' }
    if (!isBefore(today, new Date(m.startDate))) return { label: '进行中', cls: 'doing' }
    return { label: '未开始', cls: 'todo' }
  }

  const toggleCheckpoint = (m: Milestone, cid: string) => {
    const checkpoints = (m.checkpoints ?? []).map((c) => (c.id === cid ? { ...c, done: !c.done } : c))
    updateMilestone({ ...m, checkpoints })
  }

  const addCheckpoint = (m: Milestone) => {
    setCpTarget(m)
  }

  const confirmCheckpoint = (title: string) => {
    if (cpTarget) updateMilestone({ ...cpTarget, checkpoints: [...(cpTarget.checkpoints ?? []), { id: uid(), title, done: false }] })
    setCpTarget(null)
  }

  const save = () => {
    if (!form.title.trim() || !form.startDate) return
    const endDate = form.endDate || form.startDate
    if (editing) {
      updateMilestone({ ...editing, title: form.title, description: form.description, startDate: form.startDate, endDate, color: form.color, projectId: form.projectId || undefined })
    } else {
      addMilestone({ id: uid(), title: form.title, description: form.description, startDate: form.startDate, endDate, progress: 0, color: form.color, projectId: form.projectId || undefined, checkpoints: [] })
    }
    setModalOpen(false)
    setEditing(null)
    setForm({ title: '', description: '', startDate: '', endDate: '', color: colors[0], projectId: '' })
  }

  const openEdit = (m: Milestone) => {
    setEditing(m)
    setForm({
      title: m.title,
      description: m.description ?? '',
      startDate: m.startDate,
      endDate: m.endDate,
      color: m.color,
      projectId: m.projectId ?? '',
    })
    setModalOpen(true)
  }

  const openAdd = () => {
    setEditing(null)
    setForm({ title: '', description: '', startDate: '', endDate: '', color: colors[0], projectId: '' })
    setModalOpen(true)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">里程碑</div>
          <div className="page-sub">阶段目标管理 · 开题 / 中期 / 预答辩 / 答辩</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}><Plus size={15} /> 新建里程碑</button>
      </div>

      {sorted.length === 0 ? (
        <div className="card"><div className="empty"><div className="empty-icon">🗓️</div>还没有里程碑<br /><span style={{ fontSize: 12 }}>例如：研一结束前完成课程学分 · 开题报告 · 发表第一篇论文</span></div></div>
      ) : (
        <div className="timeline">
          {sorted.map((m) => {
            const st = statusOf(m)
            const p = autoProgress(m)
            const cps = m.checkpoints ?? []
            const rt = relatedTasks(m)
            return (
              <div key={m.id} className="tl-item">
                <div className="tl-marker" style={{ background: m.color }}>
                  <GitBranch size={14} color="#fff" />
                </div>
                <div className={`card tl-card ${st.cls === 'late' ? 'late' : ''}`} style={{ borderTop: `3px solid ${st.cls === 'late' ? '#e5484d' : m.color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="tl-title">
                        {m.title}
                        {m.projectId && <span className="project-badge" style={{ background: `${m.color}1a`, color: m.color, marginLeft: 8 }}>{projectName(m.projectId)}</span>}
                      </div>
                      <div className="tl-dates">
                        {format(new Date(m.startDate), 'yyyy年 M月 d日')} — {format(new Date(m.endDate), 'yyyy年 M月 d日')}
                        {st.cls === 'late' && (
                          <span style={{ color: '#e5484d', marginLeft: 8 }}>
                            ⚠ 已逾期 {Math.abs(differenceInCalendarDays(today, new Date(m.endDate)))} 天
                          </span>
                        )}
                        {st.cls !== 'late' && st.cls !== 'done' && (
                          <span style={{ color: 'var(--accent-text)', marginLeft: 8, fontWeight: 600 }}>
                            {(() => {
                              const left = differenceInCalendarDays(new Date(m.endDate), today)
                              return left <= 0 ? '⏳ 今天到期' : `⏳ 剩余 ${left} 天`
                            })()}
                          </span>
                        )}
                      </div>
                      {m.description && <div className="tl-desc">{m.description}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <span className={`status-badge s-${st.cls}`}>{st.label}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="icon-btn" title="编辑" onClick={() => openEdit(m)}><PencilLine size={14} /></button>
                        <button className="icon-btn" onClick={() => {
                          if (!confirm(`删除里程碑「${m.title}」？`)) return
                          deleteMilestone(m.id)
                          useToast.getState().show(`已删除里程碑「${m.title}」`, { actionLabel: '撤销', onAction: () => addMilestone(m) })
                        }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>

                  <div className="progress-row">
                    <div className="progress-bar" style={{ background: 'var(--bg-hover)' }}>
                      <div className="progress-fill" style={{ width: `${p}%`, background: m.color }} />
                    </div>
                    <span className="progress-text">{p}%</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    进度由检查点和未完成任务自动计算{cps.length === 0 && rt.length === 0 ? '（可手动拖动下方滑块调整）' : ''}
                  </div>

                  {/* 检查点 */}
                  <div className="cp-list">
                    {cps.map((c) => (
                      <div key={c.id} className="cp-item" onClick={() => toggleCheckpoint(m, c.id)}>
                        {c.done ? <CheckSquare size={14} color="var(--accent)" /> : <Square size={14} color="var(--text-3)" />}
                        <span style={c.done ? { textDecoration: 'line-through', color: 'var(--text-3)' } : {}}>{c.title}</span>
                      </div>
                    ))}
                    {rt.length > 0 && (
                      <div className="cp-item" style={{ color: 'var(--text-3)' }}>
                        <ListChecks size={14} /> 关联未完成任务 {rt.filter((t) => t.status === 'doing').length + rt.filter((t) => t.status === 'todo').length} 项
                      </div>
                    )}
                    <button className="cp-add" onClick={() => addCheckpoint(m)}><Plus size={12} /> 添加检查点</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{editing ? '编辑里程碑' : '新建里程碑'}</div>
            <div className="field">
              <label>名称</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：毕业论文开题" autoFocus />
            </div>
            <div className="field">
              <label>描述（可选）</label>
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="field">
              <label>关联项目（可选）</label>
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">无</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label>开始日期</label>
                <DatePicker value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v ?? '' })} />
              </div>
              <div className="field">
                <label>结束日期</label>
                <DatePicker value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v ?? '' })} />
              </div>
            </div>
            <div className="field">
              <label>颜色</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {colors.map((c) => (
                  <button key={c} onClick={() => setForm({ ...form, color: c })}
                    style={{ width: 26, height: 26, borderRadius: 7, background: c, border: form.color === c ? '2px solid var(--text-1)' : 'none' }} />
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              💡 里程碑关联项目后，进度会随该项目的任务完成情况自动更新
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.title.trim() || !form.startDate}>保存</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .timeline { position: relative; padding-left: 30px; }
        .timeline::before {
          content: ''; position: absolute; left: 9px; top: 6px; bottom: 6px; width: 2px;
          background: var(--border); border-radius: 1px;
        }
        .tl-item { position: relative; margin-bottom: 18px; }
        .tl-marker {
          position: absolute; left: -30px; top: 18px; width: 22px; height: 22px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow);
        }
        .tl-card { padding: 16px; }
        .tl-card.late { box-shadow: 0 0 0 1px #e5484d55, var(--shadow); }
        .tl-title { font-size: 15px; font-weight: 700; display: flex; align-items: center; }
        .tl-dates { font-size: 12px; color: var(--text-3); margin-top: 3px; }
        .tl-desc { font-size: 13px; color: var(--text-2); margin-top: 8px; }
        .project-badge { font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; }
        .progress-row { display: flex; align-items: center; margin-top: 12px; }
        .progress-bar { flex: 1; height: 8px; border-radius: 4px; overflow: hidden; }
        .progress-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
        .progress-text { font-size: 12px; color: var(--text-2); margin-left: 8px; min-width: 40px; }
        .s-late { background: #fdecec; color: #e5484d; }
        .theme-dark .s-late { background: #442124; color: #ff8a8d; }

        /* 检查点 */
        .cp-list { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 3px; }
        .cp-item { display: flex; align-items: center; gap: 7px; font-size: 12.5px; padding: 4px 6px; border-radius: 5px; cursor: pointer; color: var(--text-2); }
        .cp-item:hover { background: var(--bg-hover); }
        .cp-add {
          align-self: flex-start; display: flex; align-items: center; gap: 4px; font-size: 11.5px;
          color: var(--text-3); padding: 3px 6px; border-radius: 5px;
        }
        .cp-add:hover { color: var(--accent-text); background: var(--bg-hover); }
      `}</style>

      {cpTarget && (
        <PromptModal
          title={`为「${cpTarget.title}」添加检查点`}
          placeholder="例如：完成文献综述 / 提交初稿"
          onConfirm={confirmCheckpoint}
          onCancel={() => setCpTarget(null)}
        />
      )}
    </div>
  )
}

import { useMemo, useState, useEffect, useRef } from 'react'
import { Search, X, CheckSquare, Calendar, FileText, Cake, GitBranch, CornerDownLeft, BookOpen, Flame , FolderGit2 } from 'lucide-react'
import { useStore } from '../store'

interface Hit {
  id: string
  kind: 'task' | 'event' | 'note' | 'paper' | 'milestone' | 'birthday' | 'habit' | 'project'
  title: string
  subtitle: string
  view: string
}

const GROUPS: { kind: Hit['kind']; label: string; icon: typeof CheckSquare; color: string }[] = [
  { kind: 'task', label: '待办', icon: CheckSquare, color: '#4f6ef7' },
  { kind: 'event', label: '日程', icon: Calendar, color: '#2f9e6e' },
  { kind: 'note', label: '笔记', icon: FileText, color: '#8b5cf6' },
  { kind: 'paper', label: '文献', icon: BookOpen, color: '#12b886' },
  { kind: 'milestone', label: '里程碑', icon: GitBranch, color: '#f08c00' },
  { kind: 'birthday', label: '生日', icon: Cake, color: '#f472b6' },
  { kind: 'habit', label: '习惯', icon: Flame, color: '#e5484d' },
  { kind: 'project', label: '项目', icon: FolderGit2, color: '#4f6ef7' },
]

const GROUP_ORDER = GROUPS.map((g) => g.kind)

function Highlight({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <>{text}</>
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'transparent', color: 'var(--accent-text)', fontWeight: 700 }}>{text.slice(idx, idx + keyword.length)}</mark>
      {text.slice(idx + keyword.length)}
    </>
  )
}

export default function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const notes = useStore((s) => s.notes)
  const birthdays = useStore((s) => s.birthdays)
  const milestones = useStore((s) => s.milestones)
  const papers = useStore((s) => s.papers)
  const projects = useStore((s) => s.projects)
  const habits = useStore((s) => s.habits)
  const setView = useStore((s) => s.setView)

  useEffect(() => { inputRef.current?.focus() }, [])

  const hits = useMemo(() => {
    const keyword = q.trim().toLowerCase()
    if (!keyword) return []
    const out: Hit[] = []
    const push = (kind: Hit['kind'], id: string, title: string, subtitle: string, view: string) => {
      if (title.toLowerCase().includes(keyword)) out.push({ kind, id, title, subtitle, view })
    }
    tasks.forEach((t) => push('task', t.id, t.title, `待办 · ${t.status === 'done' ? '已完成' : t.status === 'doing' ? '进行中' : '待办'}`, 'todo'))
    events.forEach((e) => push('event', e.id, e.title, `日历 · ${e.start.slice(0, 10)}`, 'calendar'))
    notes.forEach((n) => {
      // Phase 2A：笔记显示关系上下文（来源论文 / 所属项目）
      const srcPapers = papers.filter((p) => (p.noteIds || []).includes(n.id)).map((p) => p.title)
      const srcProjects = projects.filter((pr) => (pr.noteIds || []).includes(n.id)).map((pr) => pr.name)
      const ctx = [...srcPapers.slice(0, 2), ...srcProjects.slice(0, 2)].join(' · ')
      push('note', n.id, n.title, `笔记${n.tags.length ? ' · ' + n.tags.join(' / ') : ''}${ctx ? ' · 来源：' + ctx : ''}`, 'notes')
    })
    papers.forEach((p) => {
      const relProjects = projects.filter((pr) => (pr.paperIds || []).includes(p.id)).map((pr) => pr.name)
      const relNotes = notes.filter((n) => (n.paperIds || []).includes(p.id)).length
      const ctx = relProjects.length ? ` · 项目：${relProjects.slice(0, 2).join(' / ')}` : ''
      const noteCtx = relNotes ? ` · 笔记 ${relNotes} 篇` : ''
      push('paper', p.id, p.title, `文献 · ${[p.venue, p.year ? String(p.year) : ''].filter(Boolean).join(' · ') || p.stage}${ctx}${noteCtx}`, 'literature')
    })
    projects.forEach((pr) => push('project', pr.id, pr.name, `项目 · 论文 ${(pr.paperIds || []).length} · 笔记 ${(pr.noteIds || []).length}`, 'todo'))
    milestones.forEach((m) => push('milestone', m.id, m.title, `里程碑 · ${m.endDate}`, 'milestone'))
    birthdays.forEach((b) => push('birthday', b.id, `${b.emoji} ${b.name}`, '生日', 'birthday'))
    habits.forEach((h) => push('habit', h.id, `${h.emoji} ${h.name}`, '习惯', 'habit'))
    out.sort((a, b) => GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind))
    return out.slice(0, 30)
  }, [q, tasks, events, notes, papers, milestones, birthdays, habits, projects])

  const go = (h: Hit) => {
    setView(h.view)
    onClose()
  }

  const grouped = useMemo(() => {
    const m = new Map<string, Hit[]>()
    hits.forEach((h) => {
      if (!m.has(h.kind)) m.set(h.kind, [])
      m.get(h.kind)!.push(h)
    })
    return GROUPS.filter((g) => m.has(g.kind)).map((g) => ({ ...g, items: m.get(g.kind)! }))
  }, [hits])

  const keyword = q.trim()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          <Search size={18} color="var(--text-3)" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              if (e.key === 'Enter' && hits[sel]) go(hits[sel])
              if (e.key === 'Escape') onClose()
            }}
            placeholder="搜索任务 / 日程 / 笔记 / 文献 / 里程碑 / 生日 / 习惯…"
            style={{ flex: 1, border: 'none', background: 'none', fontSize: 15, outline: 'none', color: 'var(--text-1)' }}
          />
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>

        <div style={{ maxHeight: 380, overflowY: 'auto', marginTop: 8 }}>
          {keyword && hits.length === 0 && (
            <div className="empty" style={{ padding: '24px 0' }}>没有找到「{keyword}」相关内容</div>
          )}
          {grouped.map((g) => {
            const Icon = g.icon
            return (
              <div key={g.kind} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon size={12} color={g.color} /> {g.label}
                </div>
                {g.items.map((h) => {
                  const i = hits.indexOf(h)
                  return (
                    <div
                      key={h.kind + h.id}
                      className={`gs-item ${i === sel ? 'active' : ''}`}
                      onMouseEnter={() => setSel(i)}
                      onClick={() => go(h)}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="gs-title"><Highlight text={h.title} keyword={keyword} /></div>
                        <div className="gs-sub">{h.subtitle}</div>
                      </div>
                      <span className="gs-enter"><CornerDownLeft size={13} /></span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-3)', borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10, display: 'flex', gap: 14 }}>
          <span>↑↓ 选择</span><span>Enter 跳转</span><span>Esc 关闭</span>
        </div>
      </div>

      <style>{`
        .gs-item {
          display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px;
          cursor: pointer; margin-bottom: 2px;
        }
        .gs-item.active { background: var(--accent-soft); }
        .gs-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gs-sub { font-size: 11.5px; color: var(--text-3); margin-top: 1px; }
        .gs-enter { color: var(--text-3); opacity: 0; }
        .gs-item.active .gs-enter { opacity: 1; }
      `}</style>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Plus, Trash2, FileText, Search, Eye, PencilLine } from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useStore, uid } from '../store'
import { Note } from '../types'
import { useToast } from '../lib/toast'

marked.setOptions({ gfm: true, breaks: true })

// 渲染 Markdown 并消毒 HTML，防止笔记内容里的 <script>/onerror/javascript: 等注入
const renderMarkdown = (md: string) => DOMPurify.sanitize(marked.parse(md || '*(空笔记)*') as string)

export default function NotesView() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [preview, setPreview] = useState(false)

  const notes: Note[] = useStore((s) => s.notes)
  const addNote = useStore((s) => s.addNote)
  const updateNote = useStore((s) => s.updateNote)
  const deleteNote = useStore((s) => s.deleteNote)

  const selected = notes.find((n) => n.id === selectedId)

  const allTags = useMemo(() => {
    const map = new Map<string, number>()
    notes.forEach((n) => n.tags.forEach((t) => map.set(t, (map.get(t) ?? 0) + 1)))
    return Array.from(map.entries())
  }, [notes])

  const filtered = useMemo(
    () => notes.filter((n) => {
      const matchSearch = !search || n.title.toLowerCase().includes(search.toLowerCase()) || n.content.toLowerCase().includes(search.toLowerCase())
      const matchTag = !activeTag || n.tags.includes(activeTag)
      return matchSearch && matchTag
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes, search, activeTag],
  )

  const createNote = () => {
    const n: Note = { id: uid(), title: '未命名笔记', content: '', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    addNote(n)
    setSelectedId(n.id)
    setContent('')
    setTitleDraft('未命名笔记')
    setTagsDraft('')
  }

  const openNote = (n: Note) => {
    setSelectedId(n.id)
    setContent(n.content)
    setTitleDraft(n.title)
    setTagsDraft(n.tags.join(', '))
  }

  const persistContent = () => {
    if (selected && content !== selected.content) updateNote({ ...selected, content, updatedAt: new Date().toISOString() })
  }

  const persistTitle = () => {
    if (selected) updateNote({ ...selected, title: titleDraft.trim() || '未命名笔记', updatedAt: new Date().toISOString() })
  }

  const persistTags = () => {
    if (selected) updateNote({ ...selected, tags: tagsDraft.split(/[,，]/).map((t) => t.trim()).filter(Boolean), updatedAt: new Date().toISOString() })
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">笔记</div>
          <div className="page-sub">Markdown 笔记 · 共 {notes.length} 篇</div>
        </div>
        <button className="btn btn-primary" onClick={createNote}><Plus size={15} /> 新建笔记</button>
      </div>

      <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 170px)' }}>
        {/* 笔记列表 */}
        <div className="card note-list">
          <div className="note-search">
            <Search size={14} style={{ color: 'var(--text-3)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索笔记…" />
          </div>
          <div className="note-tags">
            <button className={`tag-chip ${activeTag === null ? 'active' : ''}`} onClick={() => setActiveTag(null)}>全部</button>
            {allTags.map(([tag, count]) => (
              <button key={tag} className={`tag-chip ${activeTag === tag ? 'active' : ''}`} onClick={() => setActiveTag(activeTag === tag ? null : tag)}>
                #{tag} {count}
              </button>
            ))}
          </div>
          <div className="note-items">
            {filtered.length === 0 && <div className="empty"><div className="empty-icon">📝</div>暂无笔记</div>}
            {filtered.map((n) => (
              <div key={n.id} className={`note-item ${n.id === selectedId ? 'active' : ''}`} onClick={() => openNote(n)}>
                <FileText size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="note-item-title">{n.title}</div>
                  <div className="note-item-date">{format(new Date(n.updatedAt), 'M月d日 HH:mm')}</div>
                </div>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); if (!confirm(`删除笔记「${n.title}」？`)) return; deleteNote(n.id); if (selectedId === n.id) setSelectedId(null); useToast.getState().show(`已删除笔记「${n.title}」`, { actionLabel: '撤销', onAction: () => addNote(n) }) }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>

        {/* 编辑器 */}
        <div className="card note-editor">
          {selected ? (
            <>
              <input className="note-title-input" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onBlur={persistTitle} />
              <input className="note-tag-input" value={tagsDraft} onChange={(e) => setTagsDraft(e.target.value)} onBlur={persistTags} placeholder="标签，逗号分隔（如：文献, 组会）" />
              <div className="note-mode-tabs">
                <button className={`note-mode-tab ${!preview ? 'active' : ''}`} onClick={() => setPreview(false)}><PencilLine size={14} /> 编辑</button>
                <button className={`note-mode-tab ${preview ? 'active' : ''}`} onClick={() => setPreview(true)}><Eye size={14} /> 预览</button>
              </div>
              {preview ? (
                <div className="note-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
              ) : (
                <textarea
                  className="note-textarea"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onBlur={persistContent}
                  placeholder={'支持 Markdown 语法：# 标题\n- 列表\n**加粗**\n\n在此输入内容…'}
                />
              )}
              <div className="note-hint">支持 Markdown · 点击「预览」查看渲染效果</div>
            </>
          ) : (
            <div className="empty" style={{ flex: 1 }}><div className="empty-icon">📖</div>选择左侧笔记，或点击"新建笔记"开始记录</div>
          )}
        </div>
      </div>

      <style>{`
        .note-list { width: 300px; display: flex; flex-direction: column; overflow: hidden; }
        .note-search { display: flex; align-items: center; gap: 8px; padding: 12px; border-bottom: 1px solid var(--border); }
        .note-search input { flex: 1; border: none; background: none; font-size: 13px; color: var(--text-1); }
        .note-tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
        .tag-chip { font-size: 11px; padding: 3px 8px; border-radius: 20px; background: var(--bg-hover); color: var(--text-2); }
        .tag-chip.active { background: var(--accent); color: #fff; }
        .note-items { flex: 1; overflow-y: auto; }
        .note-item { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--border); }
        .note-item:hover { background: var(--bg-hover); }
        .note-item.active { background: var(--accent-soft); }
        .note-item-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .note-item-date { font-size: 11px; color: var(--text-3); margin-top: 2px; }
        .note-editor { flex: 1; display: flex; flex-direction: column; padding: 18px 22px; overflow: hidden; }
        .note-title-input { border: none; font-size: 20px; font-weight: 700; background: none; color: var(--text-1); padding: 4px 0 8px; }
        .note-tag-input { border: none; font-size: 12px; color: var(--accent-text); background: none; padding: 0 0 12px; }
        .note-textarea { flex: 1; border: none; resize: none; font-size: 14px; line-height: 1.7; background: none; color: var(--text-1); padding-top: 8px; }
        .note-hint { font-size: 11px; color: var(--text-3); padding-top: 8px; border-top: 1px solid var(--border); }
        .note-mode-tabs { display: flex; gap: 4px; margin-bottom: 10px; background: var(--bg-hover); border-radius: 8px; padding: 3px; width: fit-content; }
        .note-mode-tab { display: flex; align-items: center; gap: 5px; padding: 5px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; color: var(--text-2); }
        .note-mode-tab.active { background: var(--bg-card); color: var(--accent-text); box-shadow: var(--shadow); }
        .note-preview {
          flex: 1; overflow-y: auto; font-size: 14px; line-height: 1.8; color: var(--text-1);
          padding: 12px 4px 24px; word-break: break-word;
        }
        .note-preview h1 { font-size: 24px; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin: 16px 0 10px; }
        .note-preview h2 { font-size: 20px; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin: 14px 0 8px; }
        .note-preview h3 { font-size: 17px; margin: 12px 0 6px; }
        .note-preview h4 { font-size: 15px; margin: 10px 0 4px; }
        .note-preview p { margin: 8px 0; }
        .note-preview ul, .note-preview ol { padding-left: 24px; margin: 8px 0; }
        .note-preview li { margin: 4px 0; }
        .note-preview code {
          background: var(--bg-hover); padding: 2px 6px; border-radius: 5px; font-size: 13px;
          font-family: 'Cascadia Code', Consolas, monospace;
        }
        .note-preview pre { background: var(--bg-hover); padding: 12px; border-radius: 8px; overflow-x: auto; margin: 10px 0; }
        .note-preview pre code { background: none; padding: 0; }
        .note-preview blockquote { border-left: 3px solid var(--accent); padding-left: 12px; color: var(--text-2); margin: 10px 0; }
        .note-preview table { border-collapse: collapse; margin: 10px 0; width: 100%; }
        .note-preview th, .note-preview td { border: 1px solid var(--border); padding: 6px 12px; font-size: 13px; }
        .note-preview th { background: var(--bg-hover); }
        .note-preview a { color: var(--accent-text); }
        .note-preview hr { border: none; border-top: 1px solid var(--border); margin: 14px 0; }
      `}</style>
    </div>
  )
}

import { useState, useEffect, useMemo } from 'react'
import { Zap, X } from 'lucide-react'
import { useStore, uid } from '../store'
import { useToast } from '../lib/toast'
import {
  combineDateTime, addHoursToDatetime, taskDueOf,
  resolveCapturePlan, quickCapturePreview, QuickCaptureMode,
} from '../lib/natural'
import { EventType, TaskStatus } from '../types'

export default function QuickCapture({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<QuickCaptureMode>('auto')
  const addTask = useStore((s) => s.addTask)
  const addEvent = useStore((s) => s.addEvent)
  const addNote = useStore((s) => s.addNote)

  useEffect(() => {
    const el = document.getElementById('qc-input')
    el?.focus()
  }, [])

  // 保存前预览：与 parse() 共用 resolveCapturePlan，所见即所存
  const plan = useMemo(() => resolveCapturePlan(input.trim(), mode), [input, mode])
  const preview = useMemo(() => quickCapturePreview(plan), [plan])

  const parse = () => {
    const text = input.trim()
    if (!text) return
    // 单一决策来源：显式选择类型优先，auto 按日期解析结果判定
    const p = resolveCapturePlan(text, mode)

    if (p.kind === 'note') {
      addNote({ id: uid(), title: p.parsed.title || text, content: text, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      useToast.getState().show('已保存为笔记')
      onClose()
      return
    }

    if (p.kind === 'event') {
      const start = combineDateTime(p.parsed.date, p.parsed.time)
      const end = addHoursToDatetime(start, 1)
      addEvent({ id: uid(), title: p.parsed.title, type: (p.parsed.type ?? 'personal') as EventType, start, end })
      useToast.getState().show('已保存为日程')
    } else {
      // Task：日期时间不丢失（与 Today / TodoView 共用 taskDueOf）
      const due = taskDueOf(p.parsed)
      addTask({
        id: uid(), title: p.parsed.title,
        priority: p.parsed.priority ?? 'medium',
        status: 'todo' as TaskStatus,
        due,
        area: p.parsed.area,
        createdAt: new Date().toISOString(),
      })
      useToast.getState().show(p.dateHintFailed ? '未能识别日期，已保存为任务（未设日期）' : '已保存为任务')
    }
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={18} color="var(--accent)" /> 快速记录
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400, marginLeft: 'auto' }}>
            支持自然语言：<code>下周三下午组会</code> · <code>半个月后交报告</code> · <code>科研 读论文</code>
          </span>
        </div>

        <div className="field">
          <input
            id="qc-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') parse() }}
            placeholder='例如："下周三下午组会" / "生活 买洗衣液" / "记录一下刚才的想法"'
            style={{ padding: '11px 14px', fontSize: 15 }}
          />
        </div>

        {/* 保存前解析预览：类型 · 日期 · 时间 · area（解析失败明确提示，不静默） */}
        {input.trim() && (
          <div className="qc-preview">
            <span className="qc-kind">{preview.kind}</span>
            {preview.detail && <span className="qc-detail">{preview.detail}</span>}
            {preview.warning && <span className="qc-warn">⚠ {preview.warning}</span>}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>保存为：</span>
          {[
            { id: 'auto', label: '自动识别' },
            { id: 'task', label: '任务' },
            { id: 'event', label: '日程' },
            { id: 'note', label: '笔记' },
          ].map((m) => (
            <button
              key={m.id}
              className={`btn btn-sm ${mode === m.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setMode(m.id as QuickCaptureMode)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}><X size={15} /> 取消</button>
          <button className="btn btn-primary" onClick={parse} disabled={!input.trim()}>保存</button>
        </div>
      </div>

      <style>{`
        .qc-preview {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          font-size: 12.5px; background: var(--bg-hover); border-radius: 8px;
          padding: 7px 12px; margin: -6px 0 12px;
        }
        .qc-kind { font-weight: 700; color: var(--accent-text); }
        .qc-detail { color: var(--text-2); }
        .qc-warn { color: #e5484d; font-weight: 600; margin-left: auto; }
      `}</style>
    </div>
  )
}

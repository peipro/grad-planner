import { useState, useEffect } from 'react'
import { Zap, X } from 'lucide-react'
import { useStore, uid } from '../store'
import { parseQuickAdd, combineDateTime, hasDateHint, addHoursToDatetime } from '../lib/natural'
import { EventType, TaskStatus } from '../types'

export default function QuickCapture({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'auto' | 'task' | 'event'>('auto')
  const addTask = useStore((s) => s.addTask)
  const addEvent = useStore((s) => s.addEvent)

  useEffect(() => {
    const el = document.getElementById('qc-input')
    el?.focus()
  }, [])

  const parse = () => {
    const text = input.trim()
    if (!text) return

    const parsed = parseQuickAdd(text)
    const isEvent = mode === 'event' || (mode === 'auto' && hasDateHint(text))

    if (isEvent) {
      const start = combineDateTime(parsed.date, parsed.time)
      const end = addHoursToDatetime(start, 1)
      addEvent({
        id: uid(), title: parsed.title, type: (parsed.type ?? 'personal') as EventType,
        start, end,
      })
    } else {
      addTask({
        id: uid(), title: parsed.title,
        priority: parsed.priority ?? 'medium',
        status: 'todo' as TaskStatus,
        due: parsed.date ? `${parsed.date}T12:00:00` : undefined,
        createdAt: new Date().toISOString(),
      })
    }
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={18} color="var(--accent)" /> 快速记录
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400, marginLeft: 'auto' }}>
            支持自然语言：<code>明天下午3点组会</code> · <code>高优先级 交报告</code>
          </span>
        </div>

        <div className="field">
          <input
            id="qc-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') parse() }}
            placeholder='例如："下周三组会" / "明早9点交实验报告" / "读第三章文献（高优先）"'
            style={{ padding: '11px 14px', fontSize: 15 }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>保存为：</span>
          {[
            { id: 'auto', label: '自动识别' },
            { id: 'task', label: '任务' },
            { id: 'event', label: '日程' },
          ].map((m) => (
            <button
              key={m.id}
              className={`btn btn-sm ${mode === m.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setMode(m.id as 'auto' | 'task' | 'event')}
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
    </div>
  )
}

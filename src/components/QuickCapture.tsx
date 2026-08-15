import { useState, useEffect } from 'react'
import { Zap, X } from 'lucide-react'
import { useStore, uid } from '../store'
import { useToast } from '../lib/toast'
import { parseQuickAdd, combineDateTime, hasDateHint, addHoursToDatetime, taskDueOf } from '../lib/natural'
import { EventType, TaskStatus } from '../types'

type Mode = 'auto' | 'task' | 'event' | 'note'

export default function QuickCapture({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<Mode>('auto')
  const addTask = useStore((s) => s.addTask)
  const addEvent = useStore((s) => s.addEvent)
  const addNote = useStore((s) => s.addNote)

  useEffect(() => {
    const el = document.getElementById('qc-input')
    el?.focus()
  }, [])

  const parse = () => {
    const text = input.trim()
    if (!text) return
    const parsed = parseQuickAdd(text)

    // 显式选择 Note → 优先级最高
    if (mode === 'note') {
      const title = parsed.title || text
      addNote({ id: uid(), title, content: text, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      useToast.getState().show('已保存为笔记')
      onClose()
      return
    }

    // 类型判定：显式选择 > auto 规则
    //   auto：日期提示词 + 日期成功解析 → Event；解析失败 → 安全回落 Task 并反馈
    const hint = hasDateHint(text)
    const isEvent = mode === 'event' || (mode === 'auto' && hint && !!parsed.date)

    if (isEvent) {
      const start = combineDateTime(parsed.date, parsed.time)
      const end = addHoursToDatetime(start, 1)
      addEvent({ id: uid(), title: parsed.title, type: (parsed.type ?? 'personal') as EventType, start, end })
      useToast.getState().show('已保存为日程')
    } else {
      // Task：日期时间不丢失（date+time 组合；仅时间 → 今天该时段；仅日期 → 12:00 产品默认）
      // 与 Today / TodoView 共用同一套 taskDueOf，禁止各自造 due 逻辑
      const due = taskDueOf(parsed)
      addTask({
        id: uid(), title: parsed.title,
        priority: parsed.priority ?? 'medium',
        status: 'todo' as TaskStatus,
        due,
        area: parsed.area,
        createdAt: new Date().toISOString(),
      })
      const failedHint = mode === 'auto' && hint && !parsed.date
      useToast.getState().show(failedHint ? '未能识别日期，已保存为任务（未设日期）' : '已保存为任务')
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
              onClick={() => setMode(m.id as Mode)}
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

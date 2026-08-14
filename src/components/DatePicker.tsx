import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_CN = '日一二三四五六'

interface DatePickerProps {
  value?: string
  onChange: (v: string | undefined) => void
  placeholder?: string
}

const toStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function DatePicker({ value, onChange, placeholder = '选择日期' }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const today = new Date()
  const todayStr = toStr(today)
  const [view, setView] = useState(() => {
    const base = value ? new Date(value) : today
    return { y: base.getFullYear(), m: base.getMonth() }
  })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1)
    const startOffset = (first.getDay() + 6) % 7 // 周一为 0
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
    const prevDays = new Date(view.y, view.m, 0).getDate()
    const arr: { day: number; date: string; current: boolean }[] = []
    for (let i = startOffset - 1; i >= 0; i--) arr.push({ day: prevDays - i, date: '', current: false })
    for (let d = 1; d <= daysInMonth; d++) {
      arr.push({ day: d, date: `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, current: true })
    }
    let pad = 1
    while (arr.length % 7 !== 0) {
      arr.push({ day: pad++, date: '', current: false })
    }
    return arr
  }, [view])

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const m = v.m + delta
      return m < 0 ? { y: v.y - 1, m: 11 } : m > 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m }
    })
  }

  const label = value
    ? (() => {
        const d = new Date(value)
        return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_CN[d.getDay()]}`
      })()
    : placeholder

  const pick = (date: string) => {
    onChange(date)
    setOpen(false)
  }
  const pickOffset = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    pick(toStr(d))
  }
  const clear = () => {
    onChange(undefined)
    setOpen(false)
  }

  return (
    <div className="dp" ref={ref}>
      <button type="button" className={`dp-trigger ${value ? '' : 'dp-empty'}`} onClick={() => setOpen((o) => !o)} title={value ?? placeholder}>
        <CalendarDays size={14} />
        <span>{label}</span>
      </button>
      {open && (
        <div className="dp-panel">
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={() => shiftMonth(-1)} title="上个月"><ChevronLeft size={14} /></button>
            <span className="dp-title">{view.y}年{view.m + 1}月</span>
            <button type="button" className="dp-nav" onClick={() => shiftMonth(1)} title="下个月"><ChevronRight size={14} /></button>
          </div>
          <div className="dp-grid">
            {WEEK.map((w) => (
              <div key={w} className="dp-week">{w}</div>
            ))}
            {cells.map((c, i) =>
              c.date ? (
                <button
                  key={i}
                  type="button"
                  className={`dp-cell ${c.date === value ? 'dp-sel' : ''} ${c.date === todayStr ? 'dp-today' : ''}`}
                  onClick={() => pick(c.date)}
                >
                  {c.day}
                </button>
              ) : (
                <div key={i} className="dp-cell dp-ghost">{c.day}</div>
              ),
            )}
          </div>
          <div className="dp-foot">
            <button type="button" onClick={() => pick(todayStr)}>今天</button>
            <button type="button" onClick={() => pickOffset(1)}>明天</button>
            {value && <button type="button" onClick={clear}>清除</button>}
          </div>
        </div>
      )}
    </div>
  )
}

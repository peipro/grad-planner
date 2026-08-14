import { useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Plus, Trash2, Flame, PencilLine } from 'lucide-react'
import { useStore, uid } from '../store'
import { Habit } from '../types'

const EMOJIS = ['📚', '🏃', '🧠', '💪', '🛌', '🥗', '💧', '🧘', '✍️', '🎯', '📖', '☕']

const emptyForm = { name: '', emoji: EMOJIS[0], weeklyTarget: 5 }

export default function HabitView() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Habit | null>(null)
  const [form, setForm] = useState(emptyForm)

  const habits = useStore((s) => s.habits)
  const addHabit = useStore((s) => s.addHabit)
  const updateHabit = useStore((s) => s.updateHabit)
  const deleteHabit = useStore((s) => s.deleteHabit)
  const toggleHabitDate = useStore((s) => s.toggleHabitDate)

  const today = useMemo(() => new Date(), [])
  const todayKey = format(today, 'yyyy-MM-dd')

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = subDays(today, 6 - i)
      return { key: format(d, 'yyyy-MM-dd'), label: format(d, 'EEE', { locale: zhCN }) }
    })
  }, [today])

  const weekCount = (h: Habit) => days.filter((d) => h.records.includes(d.key)).length

  const streakOf = (h: Habit): number => {
    let streak = 0
    for (let i = 0; i < 365; i++) {
      if (h.records.includes(format(subDays(today, i), 'yyyy-MM-dd'))) streak++
      else break
    }
    return streak
  }

  const save = () => {
    if (!form.name.trim()) return
    if (editing) {
      updateHabit({ ...editing, name: form.name.trim(), emoji: form.emoji, weeklyTarget: form.weeklyTarget })
    } else {
      addHabit({ id: uid(), name: form.name.trim(), emoji: form.emoji, weeklyTarget: form.weeklyTarget, records: [], createdAt: new Date().toISOString() })
    }
    setModalOpen(false)
    setEditing(null)
    setForm(emptyForm)
  }

  const openEdit = (h: Habit) => {
    setEditing(h)
    setForm({ name: h.name, emoji: h.emoji, weeklyTarget: h.weeklyTarget })
    setModalOpen(true)
  }

  const toggleToday = (h: Habit) => toggleHabitDate(h.id, todayKey)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">习惯</div>
          <div className="page-sub">每日打卡 · 养成健康的学习节奏</div>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setForm(emptyForm); setModalOpen(true) }}><Plus size={15} /> 新建习惯</button>
      </div>

      {habits.length === 0 ? (
        <div className="card"><div className="empty"><div className="empty-icon">🔥</div>还没有习惯<br /><span style={{ fontSize: 12 }}>例如：读文献 · 运动 · 早睡 · 英语单词</span></div></div>
      ) : (
        <div className="habit-list">
          {habits.map((h) => {
            const count = weekCount(h)
            const doneToday = h.records.includes(todayKey)
            const streak = streakOf(h)
            return (
              <div key={h.id} className="card habit-card">
                <div className="habit-avatar">{h.emoji}</div>
                <div className="habit-info">
                  <div className="habit-name">{h.name}</div>
                  <div className="habit-meta">本周 {count}/{h.weeklyTarget} 次 · 🔥 连续 {streak} 天</div>
                  <div className="habit-week">
                    {days.map((d) => (
                      <button
                        key={d.key}
                        className={`habit-day ${h.records.includes(d.key) ? 'done' : ''} ${d.key === todayKey ? 'today' : ''}`}
                        onClick={() => toggleHabitDate(h.id, d.key)}
                        title={`${d.label} ${h.records.includes(d.key) ? '已完成' : '未完成'}`}
                      >
                        {d.label.slice(0, 1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <button className={`btn btn-sm ${doneToday ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggleToday(h)}>
                    <Flame size={14} /> {doneToday ? '已打卡' : '打卡'}
                  </button>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="icon-btn" title="编辑" onClick={() => openEdit(h)}><PencilLine size={14} /></button>
                    <button className="icon-btn" style={{ color: '#e5484d' }} onClick={() => { if (confirm(`删除习惯「${h.name}」？`)) deleteHabit(h.id) }}><Trash2 size={14} /></button>
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
            <div className="modal-title">{editing ? '编辑习惯' : '新建习惯'}</div>
            <div className="field">
              <label>习惯名称</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：读文献 / 运动 / 早睡" autoFocus />
            </div>
            <div className="field">
              <label>Emoji</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {EMOJIS.map((e) => (
                  <button key={e} onClick={() => setForm({ ...form, emoji: e })}
                    style={{
                      width: 34, height: 34, fontSize: 18, borderRadius: 8, cursor: 'pointer',
                      background: form.emoji === e ? 'var(--accent-soft)' : 'var(--bg-hover)',
                      border: form.emoji === e ? '2px solid var(--accent)' : '1px solid var(--border)',
                    }}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>每周目标：{form.weeklyTarget} 次</label>
              <input type="range" min={1} max={14} value={form.weeklyTarget} onChange={(e) => setForm({ ...form, weeklyTarget: Number(e.target.value) })} style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .habit-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
        .habit-card { display: flex; align-items: center; gap: 14px; padding: 16px; }
        .habit-avatar {
          width: 46px; height: 46px; border-radius: 12px; background: var(--accent-soft);
          display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0;
        }
        .habit-info { flex: 1; min-width: 0; }
        .habit-name { font-size: 15px; font-weight: 700; }
        .habit-meta { font-size: 12px; color: var(--text-3); margin-top: 3px; }
        .habit-week { display: flex; gap: 5px; margin-top: 10px; }
        .habit-day {
          width: 28px; height: 28px; border-radius: 8px; font-size: 12px; font-weight: 600;
          background: var(--bg-hover); color: var(--text-3); cursor: pointer;
          transition: all 0.12s ease;
        }
        .habit-day.done { background: var(--accent); color: #fff; }
        .habit-day.today { box-shadow: 0 0 0 2px var(--accent); }
        .habit-day:hover { transform: scale(1.1); }
      `}</style>
    </div>
  )
}

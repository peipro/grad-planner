import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Plus, Trash2, PencilLine, Cake } from 'lucide-react'
import { useStore, uid } from '../store'
import { Birthday } from '../types'
import { daysUntilBirthday, nextBirthdayDate, birthdayDesc, lunarCn, sortByUpcoming } from '../lib/birthday'

const EMOJIS = ['🎂', '🎁', '🎀', '🎈', '🎊', '🎉', '🌟', '🧁', '🎆', '💝']

const emptyForm = {
  name: '',
  calendarType: 'lunar' as 'lunar' | 'solar',
  lunarMonth: 1,
  lunarDay: 1,
  isLeapMonth: false,
  solarMonth: 1,
  solarDay: 1,
  note: '',
  emoji: EMOJIS[0],
  originalInput: '',
}

export default function BirthdayView() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Birthday | null>(null)
  const [form, setForm] = useState(emptyForm)

  const birthdays = useStore((s) => s.birthdays)
  const addBirthday = useStore((s) => s.addBirthday)
  const updateBirthday = useStore((s) => s.updateBirthday)
  const deleteBirthday = useStore((s) => s.deleteBirthday)

  const today = useMemo(() => new Date(), [])
  const sorted = useMemo(() => sortByUpcoming(birthdays, today), [birthdays, today])

  const upcoming = sorted.slice(0, 6)

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (b: Birthday) => {
    setEditing(b)
    setForm({
      name: b.name,
      calendarType: b.calendarType,
      lunarMonth: b.lunarMonth ?? 1,
      lunarDay: b.lunarDay ?? 1,
      isLeapMonth: !!b.isLeapMonth,
      solarMonth: b.solarMonth ?? 1,
      solarDay: b.solarDay ?? 1,
      note: b.note ?? '',
      emoji: b.emoji || EMOJIS[0],
      originalInput: b.originalInput ?? '',
    })
    setModalOpen(true)
  }

  const save = () => {
    if (!form.name.trim()) return
    const payload: Birthday = {
      id: editing?.id ?? uid(),
      name: form.name.trim(),
      calendarType: form.calendarType,
      emoji: form.emoji,
      note: form.note.trim(),
      originalInput: form.originalInput.trim(),
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    }
    if (form.calendarType === 'lunar') {
      payload.lunarMonth = form.lunarMonth
      payload.lunarDay = form.lunarDay
      payload.isLeapMonth = form.isLeapMonth
    } else {
      payload.solarMonth = form.solarMonth
      payload.solarDay = form.solarDay
    }
    if (editing) updateBirthday(payload)
    else addBirthday(payload)
    setModalOpen(false)
  }

  const dayLabel = (b: Birthday) => {
    if (b.calendarType === 'solar') return `${b.solarMonth}月${b.solarDay}日`
    return lunarCn(b.lunarMonth ?? 1, b.lunarDay ?? 1, !!b.isLeapMonth)
  }

  const nextLabel = (b: Birthday) => {
    const d = nextBirthdayDate(b, today)
    return d ? format(d, 'yyyy年 M月 d日') : '—'
  }

  const daysLabel = (b: Birthday) => {
    const n = daysUntilBirthday(b, today)
    if (n === null) return '—'
    if (n === 0) return '今天！'
    return `${n} 天后`
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">生日</div>
          <div className="page-sub">亲友生日提醒 · 支持农历 / 阳历,每年自动更新</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}><Plus size={15} /> 添加生日</button>
      </div>

      {/* 即将到来的生日 */}
      {sorted.length > 0 && (
        <div className="bday-upcoming-row">
          {upcoming.map((b) => {
            const n = daysUntilBirthday(b, today)
            const soon = n !== null && n <= 7
            return (
              <div key={b.id} className={`card bday-upcoming ${soon ? 'soon' : ''}`} onClick={() => openEdit(b)}>
                <div className="bday-up-emoji">{b.emoji}</div>
                <div className="bday-up-name">{b.name}</div>
                <div className="bday-up-date">{dayLabel(b)}</div>
                <div className="bday-up-days">{daysLabel(b)}</div>
                <div className="bday-up-next">{nextLabel(b)}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* 全部生日列表 */}
      {sorted.length === 0 ? (
        <div className="card"><div className="empty"><div className="empty-icon">🎂</div>还没有生日记录<br /><span style={{ fontSize: 12 }}>添加亲友的生日,支持农历与阳历,每年自动在日历上提醒</span></div></div>
      ) : (
        <div className="bday-list">
          {sorted.map((b) => (
            <div key={b.id} className="card bday-card">
              <div className="bday-avatar">{b.emoji}</div>
              <div className="bday-info">
                <div className="bday-name">
                  {b.name}
                  {b.note && <span className="bday-note"> · {b.note}</span>}
                </div>
                <div className="bday-meta">
                  {birthdayDesc(b)}
                  {b.calendarType === 'solar' && b.originalInput && <span> · 出生于 {b.originalInput}</span>}
                </div>
                <div className="bday-meta">下次生日：{nextLabel(b)}（{daysLabel(b)}）</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="icon-btn" onClick={() => openEdit(b)}><PencilLine size={14} /></button>
                <button className="icon-btn" style={{ color: '#e5484d' }} onClick={() => { if (confirm(`删除 ${b.name} 的生日记录？`)) deleteBirthday(b.id) }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Cake size={18} color="var(--accent)" />
              {editing ? '编辑生日' : '添加生日'}
            </div>

            <div className="field">
              <label>名字</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：妈妈 / 小明" autoFocus />
            </div>

            <div className="field">
              <label>历法</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['lunar', 'solar'] as const).map((t) => (
                  <button key={t} className={`btn btn-sm ${form.calendarType === t ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setForm({ ...form, calendarType: t })}>
                    {t === 'lunar' ? '农历' : '阳历'}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label>{form.calendarType === 'lunar' ? '农历月份' : '阳历月份'}</label>
                <select
                  value={form.calendarType === 'lunar' ? form.lunarMonth : form.solarMonth}
                  onChange={(e) => form.calendarType === 'lunar'
                    ? setForm({ ...form, lunarMonth: Number(e.target.value) })
                    : setForm({ ...form, solarMonth: Number(e.target.value) })}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m} 月</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{form.calendarType === 'lunar' ? '农历日期' : '阳历日期'}</label>
                <select
                  value={form.calendarType === 'lunar' ? form.lunarDay : form.solarDay}
                  onChange={(e) => form.calendarType === 'lunar'
                    ? setForm({ ...form, lunarDay: Number(e.target.value) })
                    : setForm({ ...form, solarDay: Number(e.target.value) })}
                >
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d} 日</option>
                  ))}
                </select>
              </div>
            </div>

            {form.calendarType === 'lunar' && (
              <label style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <input type="checkbox" checked={form.isLeapMonth} onChange={(e) => setForm({ ...form, isLeapMonth: e.target.checked })} />
                闰月生日（当年无闰月时按平月计算）
              </label>
            )}

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
              <label>备注（可选）</label>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例如：老婆 / 爷爷 / 闺蜜" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={save} disabled={!form.name.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .bday-upcoming-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .bday-upcoming { padding: 14px; cursor: pointer; text-align: center; transition: transform 0.12s ease, box-shadow 0.12s ease; }
        .bday-upcoming:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg); }
        .bday-upcoming.soon { border: 1px solid var(--accent); }
        .bday-up-emoji { font-size: 26px; }
        .bday-up-name { font-size: 14px; font-weight: 700; margin-top: 4px; }
        .bday-up-date { font-size: 12px; color: var(--text-3); margin-top: 2px; }
        .bday-up-days { font-size: 16px; font-weight: 800; color: var(--accent); margin-top: 6px; }
        .bday-up-next { font-size: 11px; color: var(--text-3); margin-top: 2px; }

        .bday-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
        .bday-card { display: flex; align-items: center; gap: 14px; padding: 16px; }
        .bday-avatar {
          width: 46px; height: 46px; border-radius: 50%; background: var(--accent-soft);
          display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0;
        }
        .bday-info { flex: 1; min-width: 0; }
        .bday-name { font-size: 15px; font-weight: 700; }
        .bday-note { font-size: 12px; color: var(--text-3); font-weight: 400; }
        .bday-meta { font-size: 12px; color: var(--text-2); margin-top: 3px; }
      `}</style>
    </div>
  )
}

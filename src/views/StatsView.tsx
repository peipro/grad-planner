import { useMemo } from 'react'
import { format, subDays, startOfYear, addDays } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { CheckCircle2, Circle, ListTodo, Timer, Flame } from 'lucide-react'
import { useStore } from '../store'
import { formatMinutes, round1 } from '../lib/format'

// 年活跃度热力图颜色（GitHub style）
const HEAT_COLORS = ['var(--bg-hover)', '#9be9a8', '#40c463', '#30a14e', '#216e39']
const HEAT_LEVELS = [0, 2, 5, 10]

export default function StatsView() {
  const tasks = useStore((s) => s.tasks)
  const pomodoros = useStore((s) => s.pomodoros)
  const events = useStore((s) => s.events)
  const habits = useStore((s) => s.habits)

  const done = tasks.filter((t) => t.status === 'done').length
  const total = tasks.length
  const rate = total ? Math.round((done / total) * 100) : 0

  const totalFocusMin = pomodoros.reduce((s, p) => s + p.minutes, 0)

  // 近7天番茄专注时长柱状图
  const last7 = useMemo(() => {
    const days: { day: string; minutes: number; count: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = subDays(new Date(), i)
      const key = format(d, 'yyyy-MM-dd')
      const list = pomodoros.filter((p) => format(new Date(p.completedAt), 'yyyy-MM-dd') === key)
      days.push({
        day: format(d, 'M/d'),
        minutes: round1(list.reduce((s, p) => s + p.minutes, 0)),
        count: list.length,
      })
    }
    return days
  }, [pomodoros])

  // 任务状态分布
  const statusDist = [
    { name: '待办', value: tasks.filter((t) => t.status === 'todo').length, color: '#9aa1b0' },
    { name: '进行中', value: tasks.filter((t) => t.status === 'doing').length, color: '#f08c00' },
    { name: '已完成', value: done, color: '#2f9e6e' },
  ]

  // 今日安排
  const todayKey = format(new Date(), 'yyyy-MM-dd')
  const todayEvents = events.filter((e) => e.start.startsWith(todayKey))

  // 按任务汇总番茄专注
  const taskFocus = useMemo(() => {
    const map = new Map<string, { name: string; count: number; minutes: number }>()
    for (const p of pomodoros) {
      const key = p.taskId || p.taskTitle
      const cur = map.get(key) ?? { name: p.taskTitle, count: 0, minutes: 0 }
      cur.count += 1
      cur.minutes += p.minutes
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.minutes - a.minutes)
  }, [pomodoros])
  const maxFocusMin = taskFocus.reduce((m, t) => Math.max(m, t.minutes), 1)

  // 习惯数据：今日完成数 / 今日打卡数
  const todayKey2 = format(new Date(), 'yyyy-MM-dd')
  const habitTodayDone = habits.filter((h) => h.records.includes(todayKey2)).length
  const habitTotal = habits.length

  // 年度活跃度热力图：以最近 52 周为窗口
  const heatDays = useMemo(() => {
    const today = new Date()
    const start = startOfYear(today)
    const days: { key: string; label: string; count: number }[] = []
    let d = start
    while (d <= today) {
      const key = format(d, 'yyyy-MM-dd')
      const pomoCount = pomodoros.filter((p) => format(new Date(p.completedAt), 'yyyy-MM-dd') === key).length
      const habitCount = habits.filter((h) => h.records.includes(key)).length
      days.push({ key, label: key, count: pomoCount + habitCount })
      d = addDays(d, 1)
    }
    return days
  }, [pomodoros, habits])

  const heatColor = (count: number) => {
    let level = 0
    for (let i = 0; i < HEAT_LEVELS.length; i++) {
      if (count >= HEAT_LEVELS[i]) level = i
    }
    return HEAT_COLORS[Math.min(level, HEAT_COLORS.length - 1)]
  }

  const statCards = [
    { label: '任务总数', value: total, icon: <ListTodo size={18} />, color: '#4f6ef7' },
    { label: '已完成', value: done, icon: <CheckCircle2 size={18} />, color: '#2f9e6e' },
    { label: '完成率', value: `${rate}%`, icon: <Circle size={18} />, color: '#f08c00' },
    { label: '专注时长(总)', value: formatMinutes(totalFocusMin), icon: <Timer size={18} />, color: '#8b5cf6' },
    { label: '习惯打卡', value: habitTotal ? `${habitTodayDone}/${habitTotal}` : '—', icon: <Flame size={18} />, color: '#f58d2a' },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">统计</div>
          <div className="page-sub">学习投入与任务完成情况</div>
        </div>
      </div>

      <div className="stat-grid">
        {statCards.map((s) => (
          <div key={s.label} className="card stat-card">
            <div className="stat-icon" style={{ background: `${s.color}1a`, color: s.color }}>{s.icon}</div>
            <div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 20, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Flame size={17} color="#f58d2a" /> 年度活跃度热力图
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>每天 = 番茄数 + 习惯打卡数</span>
        </div>
        <div className="heatmap">
          {heatDays.map((d) => (
            <div
              key={d.key}
              className="heat-cell"
              style={{ background: heatColor(d.count) }}
              title={`${d.label} · ${d.count} 次活动`}
            />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
          少
          {HEAT_COLORS.map((c) => <span key={c} style={{ width: 11, height: 11, borderRadius: 3, background: c, display: 'inline-block' }} />)}
          多
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, marginTop: 20 }}>
        <div className="card" style={{ flex: 1.4, padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>近7天专注时长（分钟）</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={last7}>
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: 'var(--text-3)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'var(--bg-hover)' }}
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
                formatter={(value: number) => [`${round1(value)} 分钟`, '专注']}
              />
              <Bar dataKey="minutes" radius={[6, 6, 0, 0]} fill="var(--accent)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card" style={{ flex: 1, padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>任务状态分布</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusDist} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                {statusDist.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
            {statusDist.map((s) => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
                {s.name} {s.value}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>今日安排</div>
        {todayEvents.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>今天没有日程安排</div>
        ) : (
          todayEvents.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', fontSize: 14 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: e.type === 'course' ? '#4f6ef7' : e.type === 'meeting' ? '#8b5cf6' : e.type === 'deadline' ? '#e5484d' : '#2f9e6e' }} />
              <span style={{ color: 'var(--text-2)', fontSize: 13, minWidth: 90 }}>
                {format(new Date(e.start), 'HH:mm')} — {format(new Date(e.end), 'HH:mm')}
              </span>
              <span style={{ fontWeight: 500 }}>{e.title}</span>
            </div>
          ))
        )}
      </div>

      <div className="card" style={{ marginTop: 20, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>任务专注汇总（番茄钟）</div>
        {taskFocus.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>还没有番茄记录，去番茄钟开始第一个专注吧</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {taskFocus.map((t) => (
              <div key={t.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{t.name}</span>
                  <span style={{ color: 'var(--text-3)' }}>{t.count} 个 · {formatMinutes(t.minutes)}</span>
                </div>
                <div className="progress-bar" style={{ background: 'var(--bg-hover)' }}>
                  <div className="progress-fill" style={{ width: `${(t.minutes / maxFocusMin) * 100}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; }
        .stat-card { padding: 18px; display: flex; align-items: center; gap: 14px; }
        .stat-icon { width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
        .stat-value { font-size: 22px; font-weight: 800; }
        .stat-label { font-size: 12px; color: var(--text-3); margin-top: 2px; }
        .heatmap { display: grid; grid-template-columns: repeat(53, 1fr); gap: 3px; }
        .heat-cell { aspect-ratio: 1; border-radius: 2px; }
      `}</style>
    </div>
  )
}

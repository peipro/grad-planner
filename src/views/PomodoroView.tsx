import { format } from 'date-fns'
import { Play, Pause, RotateCcw, Trash2, Timer, Save } from 'lucide-react'
import { useStore, uid } from '../store'
import { formatMinutes, round1 } from '../lib/format'

const durations = [15, 25, 45, 60]
const breaks = [5, 10]

export default function PomodoroView() {
  const pomo = useStore((s) => s.pomo)
  const setPomodoro = useStore((s) => s.setPomodoro)
  const resetPomodoro = useStore((s) => s.resetPomodoro)
  const pomodoros = useStore((s) => s.pomodoros)
  const deletePomodoro = useStore((s) => s.deletePomodoro)
  const clearPomodoros = useStore((s) => s.clearPomodoros)
  const tasks = useStore((s) => s.tasks)

  const { mode, focusMin, breakMin, remaining, running, phase, taskTitle, taskId, swSec, swRunning } = pomo

  const switchMode = (m: 'countdown' | 'stopwatch') => {
    setPomodoro({ mode: m, running: false, swRunning: false })
    if (m === 'countdown') {
      setPomodoro({ phase: 'focus', remaining: (useStore.getState().pomo.focusMin) * 60 })
    }
  }

  const selectFocus = (m: number) => {
    setPomodoro({ focusMin: m, remaining: m * 60, running: false, phase: 'focus' })
  }

  const selectBreak = (m: number) => {
    setPomodoro({ breakMin: m })
    if (phase === 'break') setPomodoro({ remaining: m * 60, running: false })
  }

  const saveStopwatch = () => {
    if (swSec <= 0) return
    const minutes = round1(swSec / 60)
    useStore.getState().addPomodoro({ id: uid(), taskTitle: taskTitle || '专注', minutes, completedAt: new Date().toISOString(), taskId: pomo.taskId })
    setPomodoro({ swSec: 0 })
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('计时完成 ⏱', { body: `本次专注 ${formatMinutes(minutes)}` })
    }
  }

  const todayPomodoros = pomodoros.filter((p) => format(new Date(p.completedAt), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd'))
  const totalTodayMin = todayPomodoros.reduce((sum, p) => sum + p.minutes, 0)

  const cdTime = remaining

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">番茄钟</div>
          <div className="page-sub">今日已完成 {todayPomodoros.length} 个 · 专注 {formatMinutes(totalTodayMin)}</div>
        </div>
        <button className="btn btn-ghost" onClick={() => clearPomodoros()}><Trash2 size={15} /> 清空记录</button>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="card pomo-card" style={{ flex: 1, maxWidth: 420 }}>
          {/* 模式切换 */}
          <div className="pomo-mode-tabs">
            <button className={`pomo-mode-tab ${mode === 'countdown' ? 'active' : ''}`} onClick={() => switchMode('countdown')}>
              ⏳ 倒计时
            </button>
            <button className={`pomo-mode-tab ${mode === 'stopwatch' ? 'active' : ''}`} onClick={() => switchMode('stopwatch')}>
              ⏱ 正计时
            </button>
          </div>

          {mode === 'countdown' ? (
            <>
              <div className="pomo-phase" style={{ color: phase === 'focus' ? 'var(--accent-text)' : '#2f9e6e' }}>
                {phase === 'focus' ? '🍅 专注时间' : '☕ 休息时间'}
              </div>
              <div className="pomo-ring">
                <div className="pomo-time" style={{ color: phase === 'focus' ? 'var(--accent-text)' : '#2f9e6e' }}>
                  {formatTime(cdTime)}
                </div>
                <div className="pomo-phase-label">{phase === 'focus' ? '专注' : '休息'}</div>
              </div>
              <div className="pomo-options">
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>专注时长</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {durations.map((d) => (
                    <button key={d} className={`btn btn-sm ${focusMin === d && phase === 'focus' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => selectFocus(d)}>{d}min</button>
                  ))}
                </div>
              </div>
              <div className="pomo-options">
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>休息时长</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {breaks.map((d) => (
                    <button key={d} className={`btn btn-sm ${breakMin === d && phase === 'break' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => selectBreak(d)}>{d}min</button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="pomo-phase" style={{ color: 'var(--accent-text)' }}>⏱ 正向计时</div>
              <div className="pomo-ring">
                <div className="pomo-time" style={{ color: 'var(--accent-text)' }}>
                  {formatSwTime(swSec)}
                </div>
                <div className="pomo-phase-label">已进行</div>
              </div>
            </>
          )}

          <div className="pomo-input">
            <select
              value={taskId ?? ''}
              onChange={(e) => {
                const id = e.target.value
                const t = tasks.find((x) => x.id === id)
                setPomodoro({ taskId: id || undefined, taskTitle: t?.title ?? '' })
              }}
            >
              <option value="">不关联任务 · 自由专注</option>
              {tasks.filter((t) => t.status !== 'done').map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
            {!taskId && (
              <input
                value={taskTitle}
                onChange={(e) => setPomodoro({ taskTitle: e.target.value })}
                placeholder="自由专注名称（可选）"
                style={{ marginTop: 8 }}
              />
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
            {mode === 'countdown' ? (
              <>
                <button className="btn btn-primary" style={{ padding: '10px 28px' }} onClick={() => setPomodoro({ running: !running })}>
                  {running ? <><Pause size={17} /> 暂停</> : <><Play size={17} /> 开始</>}
                </button>
                <button className="btn btn-ghost" onClick={resetPomodoro}><RotateCcw size={17} /> 重置</button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" style={{ padding: '10px 28px' }} onClick={() => setPomodoro({ swRunning: !swRunning })}>
                  {swRunning ? <><Pause size={17} /> 暂停</> : <><Play size={17} /> 开始</>}
                </button>
                {swSec > 0 && (
                  <button className="btn btn-ghost" onClick={saveStopwatch}>
                    <Save size={17} /> 保存记录
                  </button>
                )}
                <button className="btn btn-ghost" onClick={resetPomodoro}><RotateCcw size={17} /> 重置</button>
              </>
            )}
          </div>
        </div>

        <div className="card" style={{ flex: 1.2, padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Timer size={17} color="var(--accent)" /> 专注记录
          </div>
          {pomodoros.length === 0 ? (
            <div className="empty"><div className="empty-icon">🍅</div>还没有记录，开始第一个番茄吧</div>
          ) : (
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {[...pomodoros].reverse().map((p) => (
                <div key={p.id} className="pomo-record">
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.taskTitle}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{format(new Date(p.completedAt), 'yyyy-MM-dd HH:mm')}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="pomo-min-badge">{formatMinutes(p.minutes)}</div>
                    <button className="icon-btn" style={{ color: 'var(--text-3)' }} title="删除该条记录" onClick={() => { if (confirm('删除这条专注记录？')) deletePomodoro(p.id) }}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .pomo-card { padding: 28px; text-align: center; }
        .pomo-mode-tabs {
          display: inline-flex; gap: 4px; background: var(--bg-hover); border-radius: 10px;
          padding: 4px; margin-bottom: 20px;
        }
        .pomo-mode-tab { padding: 6px 16px; border-radius: 7px; font-size: 13px; font-weight: 600; color: var(--text-2); transition: all 0.15s ease; }
        .pomo-mode-tab.active { background: var(--bg-card); color: var(--accent-text); box-shadow: var(--shadow); }
        .pomo-phase { font-size: 13px; font-weight: 600; margin-bottom: 12px; }
        .pomo-ring {
          width: 180px; height: 180px; border-radius: 50%; margin: 0 auto 18px;
          border: 8px solid var(--accent-soft); display: flex; flex-direction: column;
          align-items: center; justify-content: center; position: relative;
        }
        .pomo-ring::before {
          content: ''; position: absolute; inset: -8px; border-radius: 50%;
          border: 3px solid var(--accent); border-top-color: transparent;
        }
        .pomo-time { font-size: 38px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .pomo-phase-label { font-size: 12px; color: var(--text-3); margin-top: 2px; }
        .pomo-input { margin: 0 auto 16px; max-width: 320px; }
        .pomo-input select {
          width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 9px;
          background: var(--bg); color: var(--text-1); font-size: 13px; text-align: center;
        }
        .pomo-input input {
          width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 9px;
          background: var(--bg); color: var(--text-1); font-size: 13px; text-align: center;
        }
        .pomo-options { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 10px; }
        .pomo-record {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 12px; border-radius: 8px; margin-bottom: 6px;
        }
        .pomo-record:hover { background: var(--bg-hover); }
        .pomo-min-badge { font-size: 12px; font-weight: 700; color: var(--accent-text); background: var(--accent-soft); padding: 4px 10px; border-radius: 20px; }
      `}</style>
    </div>
  )
}

function formatTime(total: number) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatSwTime(total: number) {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

import { useEffect, useRef } from 'react'
import { useStore, uid } from '../store'

const TICK_MS = 250

/** 全局番茄钟计时器：挂载在 App 顶层，切换页面不丢失。
 *  倒计时基于结束时间戳 endAt 计算，避免后台/失焦时 setInterval 被节流导致的漂移。 */
export function usePomodoroTicker() {
  const running = useStore((s) => s.pomo.running)
  const phase = useStore((s) => s.pomo.phase)
  const focusMin = useStore((s) => s.pomo.focusMin)
  const breakMin = useStore((s) => s.pomo.breakMin)
  const taskTitle = useStore((s) => s.pomo.taskTitle)
  const swRunning = useStore((s) => s.pomo.swRunning)
  const swSec = useStore((s) => s.pomo.swSec)
  const remaining = useStore((s) => s.pomo.remaining)
  const addPomodoro = useStore((s) => s.addPomodoro)

  const timerRef = useRef<number | null>(null)
  const swRef = useRef<number | null>(null)

  // 倒计时：以 endAt 时间戳为准计算剩余秒数
  useEffect(() => {
    if (!running) {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
      // 暂停/停止时清除 endAt，便于下次重新开始按当前 remaining 计时
      if (useStore.getState().pomo.endAt) {
        useStore.getState().setPomodoro({ endAt: undefined })
      }
      return
    }

    const s = useStore.getState()
    if (!s.pomo.endAt) {
      s.setPomodoro({ endAt: Date.now() + s.pomo.remaining * 1000 })
    }

    timerRef.current = window.setInterval(() => {
      const st = useStore.getState()
      const endAt = st.pomo.endAt
      if (!endAt) return
      const remain = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))

      if (remain <= 0) {
        const p = st.pomo.phase
        if (p === 'focus') {
          addPomodoro({
            id: uid(),
            taskTitle: st.pomo.taskTitle || '专注',
            minutes: st.pomo.focusMin,
            completedAt: new Date().toISOString(),
            taskId: st.pomo.taskId,
          })
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('番茄完成 🍅', { body: '休息一下吧！' })
          }
        }
        st.setPomodoro({
          running: false,
          phase: p === 'focus' ? 'break' : 'focus',
          remaining: (p === 'focus' ? st.pomo.breakMin : st.pomo.focusMin) * 60,
          endAt: undefined,
        })
        return
      }
      if (remain !== st.pomo.remaining) st.setPomodoro({ remaining: remain })
    }, TICK_MS)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [running, phase, focusMin, breakMin, taskTitle, addPomodoro])

  // 正计时：以 swStartedAt 时间戳为准累计秒数
  useEffect(() => {
    if (!swRunning) {
      if (swRef.current) clearInterval(swRef.current)
      swRef.current = null
      if (useStore.getState().pomo.swStartedAt) {
        useStore.getState().setPomodoro({ swStartedAt: undefined })
      }
      return
    }

    const s = useStore.getState()
    if (!s.pomo.swStartedAt) {
      s.setPomodoro({ swStartedAt: Date.now() - s.pomo.swSec * 1000 })
    }

    swRef.current = window.setInterval(() => {
      const st = useStore.getState()
      const startedAt = st.pomo.swStartedAt
      if (!startedAt) return
      const sec = Math.floor((Date.now() - startedAt) / 1000)
      if (sec !== st.pomo.swSec) st.setPomodoro({ swSec: sec })
    }, TICK_MS)

    return () => {
      if (swRef.current) clearInterval(swRef.current)
      swRef.current = null
    }
  }, [swRunning])

  // 通知权限
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // 窗口标题实时倒计时
  useEffect(() => {
    const fmt = (t: number) => {
      const m = Math.floor(t / 60)
      const s = t % 60
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    }
    if (running) document.title = `⏱ ${fmt(remaining)} · 研途计划`
    else if (swRunning) {
      const h = Math.floor(swSec / 3600)
      const m = Math.floor((swSec % 3600) / 60)
      const s = swSec % 60
      document.title = `⏱ ${h > 0 ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} · 研途计划`
    } else document.title = '研途计划'
  }, [running, remaining, swRunning, swSec])
}

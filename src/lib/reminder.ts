import { useEffect } from 'react'
import { useStore } from '../store'
import { nextBirthdayDate, daysUntilBirthday } from './birthday'

const SENT_KEY = 'grad-planner-reminders-sent'

/** 本地时区的今天日期(避免 toISOString 在 UTC+8 凌晨偏移成昨天) */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadSent(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SENT_KEY) || '{}') } catch { return {} }
}

function markSent(id: string) {
  const sent = loadSent()
  const today = localToday()
  sent[id + '|' + today] = Date.now()
  // 只保留最近 30 天的记录，防止无限增长
  const cutoff = Date.now() - 30 * 86400000
  for (const k of Object.keys(sent)) {
    if (sent[k] < cutoff) delete sent[k]
  }
  try { localStorage.setItem(SENT_KEY, JSON.stringify(sent)) } catch { /* ignore */ }
}

function wasSent(id: string): boolean {
  const today = localToday()
  return id + '|' + today in loadSent()
}

function notify(title: string, body: string) {
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  try { new Notification(title, { body }) } catch { /* ignore */ }
}

/** 全局提醒器：挂载在 App 顶层，每分钟扫描日历事件与生日 */
export function useReminderTicker() {
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const scan = () => {
      const s = useStore.getState()
      if (!s.reminders.enabled) return
      const now = new Date()

      // 1. 日历事件提前提醒
      for (const e of s.events) {
        const start = new Date(e.start)
        if (isNaN(start.getTime()) || start <= now) continue
        const diffMin = (start.getTime() - now.getTime()) / 60000
        if (diffMin <= s.reminders.eventLeadMin && !wasSent('evt-' + e.id)) {
          markSent('evt-' + e.id)
          notify(`📅 即将开始：${e.title}`, `${start.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 开始`)
        }
      }

      // 2. 生日提前提醒（按天）
      for (const b of s.birthdays) {
        const next = nextBirthdayDate(b, now)
        if (!next) continue
        const days = daysUntilBirthday(b, now)
        if (days === null) continue
        if (days >= 0 && days < s.reminders.birthdayLeadDays && !wasSent('bday-' + b.id)) {
          markSent('bday-' + b.id)
          const when = days === 0 ? '今天' : `${days} 天后`
          notify(`🎂 ${b.emoji} ${b.name}生日`, `${when}（${next.toLocaleDateString('zh-CN')}）`)
        }
      }

      // 3. 任务到期提醒（到期当天 + 逾期，各只提醒一次）
      const today = localToday()
      for (const t of s.tasks) {
        if (t.status === 'done' || !t.due) continue
        const due = new Date(t.due)
        if (isNaN(due.getTime())) continue
        const dueDay = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`
        const isOverdue = dueDay < today
        const isDueToday = dueDay === today
        const daysToDue = Math.round((due.getTime() - now.getTime()) / 86400000)
        // 提前提醒窗口（taskLeadDays 天内，含当天）
        const inWindow = daysToDue >= 0 && daysToDue <= s.reminders.taskLeadDays
        if (((isDueToday || isOverdue) || inWindow) && !wasSent('task-' + t.id)) {
          markSent('task-' + t.id)
          const body = isOverdue ? '已逾期，请尽快完成' : isDueToday ? '今天截止' : `${daysToDue} 天后截止`
          notify(`📌 任务到期：${t.title}`, body)
        }
      }
    }

    scan()
    const id = window.setInterval(scan, 60 * 1000)
    return () => window.clearInterval(id)
  }, [])
}

// 研途计划 · Today 2.0 聚合逻辑（纯函数，便于测试）
// 原则：同一 Task 只出现一次；任务按 due 时间入时间线，无时间视为全天；
// 逾期任务独立列出（Today 侧栏），不混入时间线。

import { Task, CalEvent, EventType, TaskArea } from '../types'

/** 本地时区的日期键 yyyy-MM-dd（避免 toISOString 在 UTC+8 凌晨偏移成昨天） */
export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface TodayItem {
  kind: 'task' | 'event'
  /** 唯一展示 id（'tsk-' / 'evt-' 前缀），保证同一 Task 不重复 */
  id: string
  title: string
  /** 时间线时间 'HH:mm'；全天任务为 'all-day' */
  time: string
  done: boolean
  area?: TaskArea
  type?: EventType
  raw: Task | CalEvent
}

export const AREA_LABELS: Record<string, string> = {
  research: '科研',
  study: '学习',
  life: '生活',
  other: '其他',
}

export const AREA_COLORS: Record<string, string> = {
  research: '#4f6ef7',
  study: '#8b5cf6',
  life: '#2f9e6e',
  other: '#9aa1b0',
}

/** 任务是否为今天到期的「全天」任务：due 只有日期，或时间为 00:00（兼容 HH:mm 与 HH:mm:00） */
export function isAllDayDue(t: Task, dateKey: string): boolean {
  if (!t.due || !t.due.startsWith(dateKey)) return false
  const rest = t.due.slice(10)
  return !rest || rest === 'T00:00' || rest === 'T00:00:00'
}

/**
 * 聚合今日时间线：
 *  - 任务：仅 due 以今天开头的任务（全天 → allDay 组，其余按 due 时间入时间线）
 *  - 日程：仅今天开始的事件（跨天事件归其开始日，避免把昨天的开始时间放进今天）
 *  - 时间线按时间升序合并排序
 */
export function todayItems(
  tasks: Task[],
  events: CalEvent[],
  dateKey: string,
): { allDay: TodayItem[]; timed: TodayItem[] } {
  const allDay: TodayItem[] = []
  const timed: TodayItem[] = []
  for (const t of tasks) {
    if (!t.due || !t.due.startsWith(dateKey)) continue
    const item: TodayItem = {
      kind: 'task',
      id: 'tsk-' + t.id,
      title: t.title,
      time: 'all-day',
      done: t.status === 'done',
      area: t.area,
      raw: t,
    }
    if (isAllDayDue(t, dateKey)) {
      allDay.push(item)
    } else {
      item.time = t.due.slice(11, 16)
      timed.push(item)
    }
  }
  for (const e of events) {
    if (!e.start.startsWith(dateKey)) continue
    timed.push({
      kind: 'event',
      id: 'evt-' + e.id,
      title: e.title,
      time: e.start.slice(11, 16),
      done: false,
      type: e.type,
      raw: e,
    })
  }
  const sortKey = (a: TodayItem) => (a.time === 'all-day' ? '00:00' : a.time)
  timed.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  return { allDay, timed }
}

/** 逾期任务：未完成且截止日期早于今天（按截止日期升序） */
export function overdueTasks(tasks: Task[], dateKey: string): Task[] {
  return tasks
    .filter((t) => t.status !== 'done' && !!t.due && t.due.slice(0, 10) < dateKey)
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
}

/**
 * 今天已完成的专注分钟数。
 * completedAt 为 UTC ISO（toISOString），必须换算成本地日期再比对 dateKey——
 * 历史 bug：直接 startsWith(dateKey) 会把本地凌晨 00:00-08:00（UTC+8）的番茄记到前一天。
 */
export function todayFocusMinutes(pomodoros: { completedAt?: string; minutes: number }[], dateKey: string): number {
  return pomodoros
    .filter((p) => {
      if (!p.completedAt) return false
      const d = new Date(p.completedAt)
      if (isNaN(d.getTime())) return false
      return localDateKey(d) === dateKey
    })
    .reduce((sum, p) => sum + p.minutes, 0)
}

/**
 * 某任务的专注聚合（优先 taskId，兼容旧记录按标题匹配）。
 * dateKey 可选：传入则只统计该本地日期（用本地时区换算 completedAt，杜绝 UTC 混用）。
 */
export function focusMinutesForTask(
  pomodoros: { taskId?: string; taskTitle: string; minutes: number; completedAt: string }[],
  taskId: string | undefined,
  taskTitle: string,
  dateKey?: string,
): { count: number; minutes: number } {
  let count = 0
  let minutes = 0
  for (const p of pomodoros) {
    // 有 taskId：匹配同 id 新记录 + 无 id 旧记录（标题一致）；无 taskId：仅按标题
    const match = taskId
      ? p.taskId === taskId || (!p.taskId && p.taskTitle === taskTitle)
      : p.taskTitle === taskTitle
    if (!match) continue
    if (dateKey) {
      const d = new Date(p.completedAt)
      if (isNaN(d.getTime())) continue
      const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (local !== dateKey) continue
    }
    count += 1
    minutes += p.minutes
  }
  return { count, minutes }
}

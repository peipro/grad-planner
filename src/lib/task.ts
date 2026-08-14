import { Task, Milestone } from '../types'

export interface Quadrant {
  urgent: boolean
  important: boolean
}

/** 逾期天数(截止日期早于今天为逾期,返回正数) */
export function overdueDays(due: string | undefined): number {
  if (!due) return 0
  const [y, m, d] = due.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return 0
  const dueDate = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor((today.getTime() - dueDate.getTime()) / 86400000)
}

/**
 * 四象限分类:
 *   - 已完成任务不参与(返回 null)
 *   - 重要 = 优先级 高/中
 *   - 紧急 = 有截止日期且截止在明天 24 点之前
 */
export function classifyQuadrant(t: Task, now: Date = new Date()): Quadrant | null {
  if (t.status === 'done') return null
  const important = t.priority === 'high' || t.priority === 'medium'
  const dueMs = t.due ? new Date(t.due).getTime() : NaN
  const urgent = !isNaN(dueMs) && dueMs <= now.getTime() + 86400000
  return { urgent, important }
}

/**
 * 里程碑进度：检查点 + 关联项目任务完成度综合计算。
 *   - 检查点完成记 1 分
 *   - 任务：done 记 1 分、doing 记 0.5 分、todo 记 0 分
 * 无检查点也无关联任务时，回退到手动设置的 progress。
 */
export function milestoneProgress(m: Milestone, tasks: Task[]): number {
  const cps = m.checkpoints ?? []
  let done = 0
  let total = 0
  for (const cp of cps) {
    total++
    if (cp.done) done++
  }
  if (m.projectId) {
    for (const t of tasks) {
      if (t.projectId !== m.projectId) continue
      total++
      if (t.status === 'done') done += 1
      else if (t.status === 'doing') done += 0.5
    }
  }
  if (total === 0) return m.progress
  return Math.round((done / total) * 100)
}

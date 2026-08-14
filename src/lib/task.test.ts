import { describe, it, expect } from 'vitest'
import { format, addDays } from 'date-fns'
import { classifyQuadrant, overdueDays, milestoneProgress } from './task'
import { Task, Milestone } from '../types'

const makeTask = (over: Partial<Task>): Task => ({
  id: 't1',
  title: 'test',
  priority: 'medium',
  status: 'todo',
  createdAt: new Date().toISOString(),
  ...over,
})

describe('overdueDays', () => {
  it('无截止日期返回 0', () => {
    expect(overdueDays(undefined)).toBe(0)
  })

  it('过期 3 天返回 3', () => {
    const due = format(addDays(new Date(), -3), 'yyyy-MM-dd') + 'T12:00:00'
    expect(overdueDays(due)).toBe(3)
  })

  it('未来日期返回负数', () => {
    const due = format(addDays(new Date(), 2), 'yyyy-MM-dd') + 'T12:00:00'
    expect(overdueDays(due)).toBeLessThan(0)
  })
})

describe('classifyQuadrant', () => {
  it('已完成任务返回 null', () => {
    expect(classifyQuadrant(makeTask({ status: 'done' }))).toBeNull()
  })

  it('高优先级 + 明天截止 = 重要且紧急', () => {
    const due = addDays(new Date(), 1).toISOString()
    expect(classifyQuadrant(makeTask({ priority: 'high', due }))).toEqual({ urgent: true, important: true })
  })

  it('低优先级 + 无截止 = 不重要且不紧急', () => {
    expect(classifyQuadrant(makeTask({ priority: 'low' }))).toEqual({ urgent: false, important: false })
  })

  it('高优先级 + 远期截止 = 重要但不紧急', () => {
    const due = addDays(new Date(), 30).toISOString()
    expect(classifyQuadrant(makeTask({ priority: 'high', due }))).toEqual({ urgent: false, important: true })
  })
})

describe('milestoneProgress', () => {
  const ms = (over: Partial<Milestone>): Milestone => ({
    id: 'm1',
    title: 'x',
    startDate: '2025-01-01',
    endDate: '2025-06-01',
    progress: 0,
    color: '#000',
    ...over,
  })

  it('无检查点无任务时回退手动 progress', () => {
    expect(milestoneProgress(ms({ progress: 40 }), [])).toBe(40)
  })

  it('检查点完成度', () => {
    const m = ms({ checkpoints: [{ id: 'c1', title: 'a', done: true }, { id: 'c2', title: 'b', done: false }] })
    expect(milestoneProgress(m, [])).toBe(50)
  })

  it('已完成任务计入进度(不会因完成而下降)', () => {
    const m = ms({ projectId: 'p1', checkpoints: [] })
    const tasks = [
      { ...makeTask({ id: 't1', status: 'done', projectId: 'p1' }) },
      { ...makeTask({ id: 't2', status: 'todo', projectId: 'p1' }) },
    ]
    expect(milestoneProgress(m, tasks)).toBe(50)
  })

  it('doing 记 0.5 分', () => {
    const m = ms({ projectId: 'p1' })
    const tasks = [{ ...makeTask({ id: 't1', status: 'doing', projectId: 'p1' }) }]
    expect(milestoneProgress(m, tasks)).toBe(50)
  })

  it('任务完成进度不下降', () => {
    const m = ms({ projectId: 'p1' })
    const doing = [{ ...makeTask({ id: 't1', status: 'doing', projectId: 'p1' }) }]
    const done = [{ ...makeTask({ id: 't1', status: 'done', projectId: 'p1' }) }]
    expect(milestoneProgress(m, done)).toBeGreaterThan(milestoneProgress(m, doing))
  })
})

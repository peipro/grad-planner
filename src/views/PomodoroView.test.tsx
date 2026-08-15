// Phase 3 #4 · Pomodoro ↔ Task：选择任务开始专注（数据模型已支持 taskId/taskTitle）

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PomodoroView from './PomodoroView'
import { useStore } from '../store'

beforeEach(() => {
  useStore.setState({
    tasks: [
      { id: 't1', title: '读LSTM论文', priority: 'medium', status: 'todo', createdAt: '' },
      { id: 't2', title: '已完成任务', priority: 'medium', status: 'done', createdAt: '' },
    ],
    pomodoros: [],
    pomo: { mode: 'countdown', focusMin: 25, breakMin: 5, remaining: 1500, running: false, phase: 'focus', taskTitle: '', taskId: undefined, swSec: 0, swRunning: false },
  } as any)
})

describe('番茄钟任务关联（Phase 3 #4）', () => {
  it('下拉选择任务 → pomo.taskId / taskTitle 绑定', () => {
    render(<PomodoroView />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } })
    const s = useStore.getState().pomo
    expect(s.taskId).toBe('t1')
    expect(s.taskTitle).toBe('读LSTM论文')
  })

  it('已完成任务不出现在选择列表', () => {
    render(<PomodoroView />)
    const options = Array.from((screen.getByRole('combobox') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(options).toContain('读LSTM论文')
    expect(options).not.toContain('已完成任务')
  })
})

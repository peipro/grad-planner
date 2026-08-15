// Phase 3 原则回归：Task 时间不丢失 —— 待办页显示截止时间，编辑任务保留时间
// （历史 bug：表单只回填日期，保存时把 HH:mm 静默抹掉）

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TodoView from './TodoView'
import { useStore } from '../store'

beforeEach(() => {
  useStore.setState({
    tasks: [{
      id: 't1', title: '完成实验报告', priority: 'high', status: 'todo',
      due: '2026-08-16T15:00:00', area: 'research', subtasks: [], createdAt: '2026-08-15T00:00:00',
    }],
    projects: [], milestones: [], notes: [], papers: [], pomodoros: [],
  } as any)
})

describe('TodoView 任务时间显示与保留（V1.0 验收修复）', () => {
  it('列表显示截止日期 + 时间', () => {
    render(<TodoView />)
    expect(screen.getByText('8月16日 15:00')).toBeTruthy()
  })

  it('编辑任务保留时间（历史 bug：保存时静默抹掉 HH:mm）', () => {
    render(<TodoView />)
    fireEvent.click(screen.getByTitle('编辑'))
    fireEvent.click(screen.getByText('保存'))
    expect(useStore.getState().tasks[0].due).toBe('2026-08-16T15:00:00')
  })

  it('编辑时可修改时间并生效', () => {
    render(<TodoView />)
    fireEvent.click(screen.getByTitle('编辑'))
    const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement
    fireEvent.change(timeInput, { target: { value: '09:30' } })
    fireEvent.click(screen.getByText('保存'))
    expect(useStore.getState().tasks[0].due).toBe('2026-08-16T09:30:00')
  })

  it('纯日期任务（全天）不带时间显示', () => {
    useStore.setState({ tasks: [{ id: 't2', title: '去医院体检', priority: 'low', status: 'todo', due: '2026-08-15', subtasks: [], createdAt: '2026-08-15T00:00:00' }] } as any)
    render(<TodoView />)
    expect(screen.getByText('8月15日')).toBeTruthy()
    expect(screen.queryByText(/8月15日 \d\d:\d\d/)).toBeNull()
  })
})

// Phase 1B-2 · NotesView draft 保留测试（§23 Test C/D）
// 场景：state-sync 就地更新 store 时，用户正在编辑的 Note draft 不得被覆盖。
// 机制：NotesView 的 content/titleDraft/tagsDraft 是 React 本地 state，
//       仅在 openNote/createNote 时设置；store 更新（含 state-sync）不会重置 draft。

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NotesView from './NotesView'
import { useStore } from '../store'
import type { Note, Task } from '../types'

function makeNote(id: string, o: Partial<Note> = {}): Note {
  return { id, title: `Note ${id}`, content: '', tags: [], createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', ...o }
}

function makeTask(id: string, o: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, priority: 'medium', status: 'todo', createdAt: '2026-08-14T00:00:00.000Z', ...o }
}

// 等价 state-sync 的 store 更新（applyAuthoritativeState 的 merge 已由 mutations.test.ts 覆盖，
// 这里直接 setState 模拟"权威已合并到 store"后的渲染行为）
function simulateStateSync(partial: Partial<typeof useStore.getState>) {
  act(() => { useStore.setState(partial as any) })
}

describe('NotesView draft 保留（Phase 1B-2 state-sync）', () => {
  beforeEach(() => {
    useStore.setState({ notes: [], tasks: [] } as any)
    window.confirm = () => true
  })

  it('Test C：外部更新不同实体（Task）→ 当前 Note draft 保留', async () => {
    useStore.setState({ notes: [makeNote('n1', { content: '服务器已有内容' })] } as any)
    render(<NotesView />)
    await userEvent.click(screen.getByText('Note n1'))
    const ta = screen.getByPlaceholderText(/支持 Markdown/) as HTMLTextAreaElement
    expect(ta.value).toBe('服务器已有内容')
    // 用户正在输入（未 blur，draft 在 React state）
    await userEvent.type(ta, '【本地输入中】')
    // Tablet 修改 Task（不同实体）→ state-sync 更新 store
    simulateStateSync({ tasks: [makeTask('t1', { title: '平板新任务' })] })
    // 编辑器仍显示用户 draft
    expect(ta.value).toContain('【本地输入中】')
  })

  it('Test D：外部更新同一实体（Note A）→ 本地未提交 draft 不被覆盖', async () => {
    useStore.setState({ notes: [makeNote('n1', { content: 'v1' })] } as any)
    render(<NotesView />)
    await userEvent.click(screen.getByText('Note n1'))
    const ta = screen.getByPlaceholderText(/支持 Markdown/) as HTMLTextAreaElement
    await userEvent.type(ta, '【我的草稿】')
    // Tablet 修改同一 Note → state-sync 更新 store（服务端版本）
    simulateStateSync({ notes: [makeNote('n1', { content: '平板服务端版本' })] })
    // 本地 draft 不被静默覆盖（冲突 UI 留 Phase 1B-3）
    expect(ta.value).toContain('【我的草稿】')
    expect(ta.value).not.toContain('平板服务端版本')
  })

  it('外部更新后 blur → 本地 draft 提交（本地胜出，LWW 语义）', async () => {
    useStore.setState({ notes: [makeNote('n1', { content: 'v1' })] } as any)
    render(<NotesView />)
    await userEvent.click(screen.getByText('Note n1'))
    const ta = screen.getByPlaceholderText(/支持 Markdown/) as HTMLTextAreaElement
    await userEvent.type(ta, '【我的草稿】')
    simulateStateSync({ notes: [makeNote('n1', { content: '平板版本' })] })
    // blur 提交本地 draft → store 中该 note 更新为本地内容（本地修改不会被丢弃）
    await userEvent.tab()
    expect(useStore.getState().notes[0].content).toContain('【我的草稿】')
  })
})

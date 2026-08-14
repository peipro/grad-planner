import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import NotesView from './NotesView'
import { useStore } from '../store'
import { PREPARE_FLUSH_EVENT } from '../lib/reload-flush'

// Case A：Note 正在编辑（未 blur）→ prepare-flush → 草稿必须保留
describe('NotesView × Renderer Flush Protocol', () => {
  beforeEach(() => {
    // 清空 store 数据（jsdom localStorage 隔离由测试框架保证）
    useStore.setState({ notes: [] })
  })

  afterEach(() => {
    cleanup() // 卸载组件，避免 DOM 残留影响 querySelector
  })

  it('Case A: 编辑正文未 blur，flush 事件后内容已提交到 store', () => {
    const { getByText, getByPlaceholderText } = render(<NotesView />)
    fireEvent.click(getByText('新建笔记'))
    const textarea = getByPlaceholderText(/支持 Markdown/)
    fireEvent.change(textarea, { target: { value: '正在输入的重要内容' } })

    // 未 blur：store 中仍无内容（onBlur 才提交）
    expect(useStore.getState().notes[0].content).toBe('')

    // 主进程 prepare-reload → dispatch flush 事件
    window.dispatchEvent(new CustomEvent(PREPARE_FLUSH_EVENT))

    // 草稿已提交：reload 后不会丢失
    expect(useStore.getState().notes[0].content).toBe('正在输入的重要内容')
  })

  it('Case A2: 标题未 blur，flush 事件后已提交', () => {
    const { getByText } = render(<NotesView />)
    fireEvent.click(getByText('新建笔记'))
    // 标题输入框无 placeholder，用 className 定位
    const titleInput = document.querySelector('.note-title-input') as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: '论文标题草稿' } })

    expect(useStore.getState().notes[0].title).toBe('未命名笔记') // 未 blur

    window.dispatchEvent(new CustomEvent(PREPARE_FLUSH_EVENT))

    expect(useStore.getState().notes[0].title).toBe('论文标题草稿')
  })

  it('Case C: 无编辑时 flush 无副作用（notes 不变，不新增）', () => {
    render(<NotesView />)
    const before = useStore.getState().notes.length
    window.dispatchEvent(new CustomEvent(PREPARE_FLUSH_EVENT))
    expect(useStore.getState().notes.length).toBe(before)
  })
})

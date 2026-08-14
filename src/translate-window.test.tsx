// Phase 1C Task 2 · 翻译窗口剪贴板行为测试
// 打开窗口不自动读取剪贴板；仅用户点击“从剪贴板导入”才读取。

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslateWindow } from './translate-window'

describe('TranslateWindow 剪贴板行为（Phase 1C Task 2）', () => {
  let readClipboardCalls: number
  let translateCalls: string[]

  beforeEach(() => {
    readClipboardCalls = 0
    translateCalls = []
    ;(window as any).electronAPI = {
      translateText: async (text: string) => { translateCalls.push(text); return { ok: true, content: `译:${text}` } },
      readClipboard: async () => { readClipboardCalls += 1; return { ok: true, text: '剪贴板中的内容' } },
      windowControl: () => {},
      onPasteEvent: () => () => {},
    }
  })

  it('打开窗口 → 不读取剪贴板、输入框为空', async () => {
    render(<TranslateWindow />)
    await new Promise((r) => setTimeout(r, 50))
    expect(readClipboardCalls).toBe(0) // 打开不自动读取
    const ta = screen.getByPlaceholderText('粘贴要翻译的内容…') as HTMLTextAreaElement
    expect(ta.value).toBe('') // 输入框为空
  })

  it('点击“从剪贴板导入”→ 读取剪贴板 + 文本进入输入框并翻译', async () => {
    render(<TranslateWindow />)
    await new Promise((r) => setTimeout(r, 50))
    expect(readClipboardCalls).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: /从剪贴板导入/ }))
    await new Promise((r) => setTimeout(r, 50))
    expect(readClipboardCalls).toBe(1) // 点击导入才读取
    const ta = screen.getByPlaceholderText('粘贴要翻译的内容…') as HTMLTextAreaElement
    expect(ta.value).toBe('剪贴板中的内容') // 文本进入输入框
    expect(translateCalls).toEqual(['剪贴板中的内容']) // 自动翻译
  })

  it('剪贴板为空 → 不修改输入框', async () => {
    ;(window as any).electronAPI.readClipboard = async () => ({ ok: true, text: '' })
    render(<TranslateWindow />)
    await userEvent.click(screen.getByRole('button', { name: /从剪贴板导入/ }))
    await new Promise((r) => setTimeout(r, 50))
    const ta = screen.getByPlaceholderText('粘贴要翻译的内容…') as HTMLTextAreaElement
    expect(ta.value).toBe('')
  })
})

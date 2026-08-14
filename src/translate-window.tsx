import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Languages, Loader2, Copy, Check, Minus, X, RotateCcw, Pin, Clipboard } from 'lucide-react'

declare global {
  interface Window {
    electronAPI?: {
      translateText: (text: string) => Promise<{ ok: boolean; content?: string; error?: string }>
      readClipboard: () => Promise<{ ok: boolean; text?: string }>
      windowControl: (action: 'close' | 'minimize' | 'pin') => void
      onPasteEvent: (cb: (data: { text: string }) => void) => void
    }
  }
}

export function TranslateWindow() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [pinned, setPinned] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Phase 1C Task 2：打开窗口不再自动读取剪贴板（输入框为空，隐私优先）
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

  // 用户主动点击“从剪贴板导入”才读取剪贴板
  const importFromClipboard = async () => {
    const api = window.electronAPI
    if (!api) return
    try {
      const clip = await api.readClipboard()
      if (clip?.ok && clip.text?.trim()) {
        setInput(clip.text.trim())
        doTranslate(clip.text.trim())
      }
    } catch {}
  }

  const doTranslate = async (text?: string) => {
    const src = (text ?? input).trim()
    if (!src) return
    setLoading(true)
    setError('')
    const api = window.electronAPI
    try {
      if (api?.translateText) {
        const res = await api.translateText(src)
        if (res?.ok) setOutput(res.content || '')
        else setError(res?.error || '翻译失败')
      }
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const copyOut = () => {
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="tw">
      {/* 标题栏（可拖拽） */}
      <div className="tw-titlebar">
        <div className="tw-title"><Languages size={13} /> 快速翻译</div>
        <div className="tw-title-actions">
          <button className="tw-btn" title="翻译剪贴板" onClick={() => doTranslate()}><RotateCcw size={13} /></button>
          <button className="tw-btn" title="置顶" style={{ color: pinned ? 'var(--accent)' : 'inherit' }} onClick={() => { setPinned((p) => !p); window.electronAPI?.windowControl('pin') }}><Pin size={13} /></button>
          <button className="tw-btn" title="最小化" onClick={() => window.electronAPI?.windowControl('minimize')}><Minus size={13} /></button>
          <button className="tw-btn" title="关闭" onClick={() => window.electronAPI?.windowControl('close')}><X size={13} /></button>
        </div>
      </div>

      <textarea
        ref={inputRef}
        className="tw-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doTranslate() }}
        placeholder="粘贴要翻译的内容…"
      />

      <div className="tw-actions">
        <span className="tw-hint">Ctrl+Enter 翻译</span>
        <button className="tw-import" onClick={importFromClipboard} title="从剪贴板导入" disabled={loading}>
          <Clipboard size={13} /> 从剪贴板导入
        </button>
        <button className="tw-go" onClick={() => doTranslate()} disabled={loading || !input.trim()}>
          {loading ? <Loader2 size={13} className="spin" /> : <Languages size={13} />}
          {loading ? '…' : '翻译'}
        </button>
      </div>

      {error && <div className="tw-error">{error}</div>}

      {output && (
        <div className="tw-output-wrap">
          <div className="tw-output-head">
            <span>译文</span>
            <button className="tw-copy" onClick={copyOut}>{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? '已复制' : '复制'}</button>
          </div>
          <div className="tw-output">{output}</div>
        </div>
      )}

      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', 'Segoe UI', 'Microsoft YaHei', sans-serif; background: var(--bg, #f5f6fa); color: var(--text-1, #1f2430); overflow: hidden; -webkit-user-select: none; }
        .tw { display: flex; flex-direction: column; height: 100vh; padding: 6px 10px 10px; }
        .tw-titlebar { display: flex; align-items: center; justify-content: space-between; padding: 4px 2px; -webkit-app-region: drag; flex-shrink: 0; }
        .tw-title { font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 5px; color: var(--text-2); }
        .tw-title-actions { display: flex; gap: 2px; -webkit-app-region: no-drag; }
        .tw-btn { width: 22px; height: 22px; border-radius: 5px; display: flex; align-items: center; justify-content: center; color: var(--text-3); }
        .tw-btn:hover { background: var(--bg-hover); }
        .tw-input {
          width: 100%; margin-top: 4px; padding: 8px 10px; border: 1px solid var(--border, #e6e8ef);
          border-radius: 8px; background: #fff; color: inherit; font-size: 13px; line-height: 1.6;
          resize: none; min-height: 56px; -webkit-app-region: no-drag; outline: none;
        }
        .tw-input:focus { border-color: #4f6ef7; }
        .tw-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
        .tw-hint { font-size: 10px; color: #9aa1b0; }
        .tw-import { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border: 1px solid var(--border, #e3e6ef); border-radius: 8px; background: var(--bg-card, #fff); color: var(--text-2, #5a6072); font-size: 12px; cursor: pointer; }
        .tw-import:hover { border-color: var(--accent, #4f6ef7); color: var(--accent, #4f6ef7); }
        .tw-go {
          display: flex; align-items: center; gap: 4px; padding: 4px 12px; border-radius: 6px;
          border: none; background: #4f6ef7; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer;
        }
        .tw-go:hover { filter: brightness(1.08); }
        .tw-go:disabled { opacity: 0.6; cursor: default; }
        .tw-error { color: #e5484d; font-size: 11px; margin-top: 6px; }
        .tw-output-wrap { margin-top: 8px; border-top: 1px solid var(--border, #e6e8ef); padding-top: 6px; }
        .tw-output-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #5c6474; font-weight: 600; }
        .tw-copy { display: flex; align-items: center; gap: 3px; border: none; background: none; color: #4f6ef7; font-size: 11px; cursor: pointer; }
        .tw-output { margin-top: 4px; font-size: 13px; line-height: 1.7; color: #1f2430; background: #eef1fb; border-radius: 8px; padding: 8px 10px; max-height: 240px; overflow-y: auto; white-space: pre-wrap; -webkit-app-region: no-drag; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: #c9cdd6; border-radius: 3px; }
      `}</style>
    </div>
  )
}

const rootEl = document.getElementById('translate-root')
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <TranslateWindow />
    </React.StrictMode>,
  )
}

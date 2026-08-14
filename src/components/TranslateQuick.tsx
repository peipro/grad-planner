import { useEffect, useRef, useState } from 'react'
import { Languages, X, Loader2, Copy, Check, RotateCcw } from 'lucide-react'

export default function TranslateQuick({ initialText, onClose }: { initialText?: string; onClose: () => void }) {
  const [input, setInput] = useState(initialText || '')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (initialText?.trim()) translate(initialText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText])

  const translate = async (text?: string) => {
    const src = (text ?? input).trim()
    if (!src) { setError('请输入或粘贴要翻译的内容'); return }
    setLoading(true)
    setError('')
    const api = (window as any).electronAPI
    try {
      if (api?.translateText) {
        const res = await api.translateText(src)
        if (res?.ok) setOutput(res.content)
        else setError(res?.error || '翻译失败')
      } else {
        setError('需要桌面版才能翻译')
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal trans-quick" onClick={(e) => e.stopPropagation()}>
        <div className="trans-header">
          <div className="trans-title"><Languages size={17} color="var(--accent)" /> 快速翻译</div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="trans-hint">
          快捷键 Ctrl+Shift+T 随时呼出 · 支持中英互译（自动识别）· 长文本自动分段
        </div>
        <textarea
          ref={inputRef}
          className="trans-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="粘贴或输入要翻译的文本，例如论文摘要、难句…"
          rows={4}
        />
        <div className="trans-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => { setInput(''); setOutput(''); setError(''); inputRef.current?.focus() }}>
            <RotateCcw size={14} /> 清空
          </button>
          <button className="btn btn-primary" onClick={() => translate()} disabled={loading || !input.trim()}>
            {loading ? <Loader2 size={15} className="spin" /> : <Languages size={15} />}
            {loading ? '翻译中…' : '翻译'}
          </button>
        </div>
        {error && <div className="trans-error">{error}</div>}
        {output && (
          <div className="trans-output-wrap">
            <div className="trans-output-head">
              <span>译文</span>
              <button className="btn btn-ghost btn-sm" onClick={copyOut}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <div className="trans-output">{output}</div>
          </div>
        )}
      </div>
      <style>{`
        .trans-quick { width: 560px; max-width: 94vw; max-height: 85vh; overflow-y: auto; }
        .trans-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .trans-title { font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
        .trans-hint { font-size: 11px; color: var(--text-3); margin-bottom: 12px; }
        .trans-input {
          width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px;
          background: var(--bg); color: var(--text-1); font-size: 14px; line-height: 1.6; resize: vertical;
          min-height: 90px;
        }
        .trans-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        .trans-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
        .trans-error { color: #e5484d; font-size: 13px; margin-top: 10px; }
        .trans-output-wrap { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px; }
        .trans-output-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 600; color: var(--text-2); margin-bottom: 8px; }
        .trans-output { font-size: 14px; line-height: 1.9; color: var(--text-1); background: var(--bg-hover); border-radius: 9px; padding: 12px 14px; white-space: pre-wrap; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

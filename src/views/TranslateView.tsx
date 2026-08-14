import { useRef, useState } from 'react'
import { Languages, Loader2, Copy, Check, RotateCcw, FileText, History } from 'lucide-react'
import { useStore, uid } from '../store'
import { useToast } from '../lib/toast'

interface HistoryItem {
  src: string
  out: string
  time: string
}

export default function TranslateView() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const outRef = useRef<HTMLDivElement>(null)

  const addNote = useStore((s) => s.addNote)
  const gotoView = useStore((s) => s.setView)
  const toast = useToast((s) => s.show)

  const translate = async () => {
    const src = input.trim()
    if (!src) { setError('请输入要翻译的内容'); return }
    setLoading(true)
    setError('')
    const api = (window as any).electronAPI
    try {
      if (api?.translateText) {
        const res = await api.translateText(src)
        if (res?.ok) {
          setOutput(res.content)
          setHistory((h) => [{ src, out: res.content, time: new Date().toLocaleString('zh-CN') }, ...h].slice(0, 20))
        } else {
          setError(res?.error || '翻译失败')
        }
      } else {
        setError('翻译功能需要桌面版运行')
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

  // 译文存为笔记（双语对照）
  const saveAsNote = () => {
    if (!output) return
    const title = input.trim().slice(0, 40) || '翻译片段'
    addNote({
      id: uid(),
      title,
      content: `原文：\n${input.trim()}\n\n译文：\n${output}`,
      tags: ['翻译'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    toast('已存为笔记', { actionLabel: '查看', onAction: () => gotoView('notes') })
  }

  const charCount = input.length

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">翻译</div>
          <div className="page-sub">中英互译（自动识别）· 支持整段长文本 · 记录历史</div>
        </div>
        <button className={`btn ${showHistory ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowHistory((v) => !v)}>
          <History size={15} /> {showHistory ? '隐藏历史' : '历史记录'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        {/* 原文 */}
        <div className="card trans-pane">
          <div className="trans-pane-head">
            <span>原文</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{charCount} 字符</span>
          </div>
          <textarea
            className="trans-pane-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={'粘贴整段论文文字、摘要、段落…\n\n示例：\nRecent advances in large language models have demonstrated remarkable capabilities in reasoning and task automation, particularly through agent-based frameworks that enable multi-step problem solving.'}
            rows={18}
          />
          <div className="trans-pane-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => { setInput(''); setOutput(''); setError('') }}>
              <RotateCcw size={14} /> 清空
            </button>
            <button className="btn btn-primary" onClick={translate} disabled={loading || !input.trim()}>
              {loading ? <Loader2 size={15} className="spin" /> : <Languages size={15} />}
              {loading ? '翻译中…' : '翻译'}
            </button>
          </div>
        </div>

        {/* 译文 */}
        <div className="card trans-pane">
          <div className="trans-pane-head">
            <span>译文</span>
            {output && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={saveAsNote} title="存为笔记（双语对照）">
                  <FileText size={14} /> 存笔记
                </button>
                <button className="btn btn-ghost btn-sm" onClick={copyOut}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            )}
          </div>
          <div className="trans-pane-output" ref={outRef}>
            {error && <div className="trans-error">{error}</div>}
            {output ? (
              <div className="trans-result">{output}</div>
            ) : (
              !error && <div className="trans-placeholder">译文将显示在这里</div>
            )}
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>翻译历史（最近 20 条）</div>
          {history.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>暂无翻译记录</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map((h, i) => (
                <div key={i} className="hist-item" onClick={() => { setInput(h.src); setOutput(h.out) }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hist-src">{h.src.slice(0, 80)}{h.src.length > 80 ? '…' : ''}</div>
                    <div className="hist-out">{h.out.slice(0, 80)}{h.out.length > 80 ? '…' : ''}</div>
                  </div>
                  <div className="hist-time"><FileText size={12} /> {h.time}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        .trans-pane { flex: 1; padding: 16px; display: flex; flex-direction: column; min-width: 0; }
        .trans-pane-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; color: var(--text-2); margin-bottom: 10px; }
        .trans-pane-input {
          flex: 1; border: 1px solid var(--border); border-radius: 9px; padding: 12px;
          background: var(--bg); color: var(--text-1); font-size: 14px; line-height: 1.8; resize: none;
        }
        .trans-pane-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        .trans-pane-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
        .trans-pane-output { flex: 1; min-height: 300px; }
        .trans-error { color: #e5484d; font-size: 13px; padding: 10px; }
        .trans-result { font-size: 14px; line-height: 2; color: var(--text-1); white-space: pre-wrap; padding: 4px; }
        .trans-placeholder { font-size: 13px; color: var(--text-3); padding: 20px 10px; text-align: center; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .hist-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; cursor: pointer; }
        .hist-item:hover { background: var(--bg-hover); }
        .hist-src { font-size: 12px; color: var(--text-2); margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hist-out { font-size: 12px; color: var(--accent-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hist-time { font-size: 11px; color: var(--text-3); flex-shrink: 0; display: flex; align-items: center; gap: 4px; }
      `}</style>
    </div>
  )
}

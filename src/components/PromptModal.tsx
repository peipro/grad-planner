import { useState, useEffect, useRef } from 'react'

interface Props {
  title: string
  placeholder?: string
  initial?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

/** Electron 中 window.prompt 不可用，用此弹窗替代 */
export default function PromptModal({ title, placeholder, initial, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(initial ?? '')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="field">
          <input
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()) }}
            placeholder={placeholder}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" onClick={() => onConfirm(value.trim())} disabled={!value.trim()}>确定</button>
        </div>
      </div>
    </div>
  )
}

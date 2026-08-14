import { CheckCircle2, X } from 'lucide-react'
import { useToast } from '../lib/toast'

export default function ToastContainer() {
  const toasts = useToast((s) => s.toasts)
  const dismiss = useToast((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <CheckCircle2 size={16} color="var(--accent-text)" style={{ flexShrink: 0 }} />
          <span className="toast-msg">{t.message}</span>
          {t.actionLabel && t.onAction && (
            <button
              className="toast-action"
              onClick={() => { t.onAction!(); dismiss(t.id) }}
            >
              {t.actionLabel}
            </button>
          )}
          <button className="toast-close" onClick={() => dismiss(t.id)}><X size={14} /></button>
        </div>
      ))}
      <style>{`
        .toast-container {
          position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
          display: flex; flex-direction: column; gap: 8px; z-index: 9999; align-items: center;
        }
        .toast {
          display: flex; align-items: center; gap: 10px;
          background: var(--bg-card); color: var(--text-1);
          border: 1px solid var(--border); border-radius: 10px;
          padding: 10px 14px; box-shadow: var(--shadow-lg);
          font-size: 13.5px; animation: toastIn 0.18s ease; max-width: 80vw;
        }
        .toast-msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .toast-action {
          border: none; background: none; color: var(--accent-text); font-weight: 700; cursor: pointer;
          padding: 2px 6px; border-radius: 5px; font-size: 13px; flex-shrink: 0;
        }
        .toast-action:hover { background: var(--accent-soft); }
        .toast-close { display: flex; align-items: center; border: none; background: none; color: var(--text-3); cursor: pointer; padding: 2px; flex-shrink: 0; }
        .toast-close:hover { color: var(--text-1); }
        @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}

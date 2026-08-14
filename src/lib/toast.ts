import { create } from 'zustand'

export interface ToastItem {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface ToastState {
  toasts: ToastItem[]
  show: (message: string, opts?: { actionLabel?: string; onAction?: () => void }) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  show: (message, opts) => {
    const id = ++seq
    set((s) => ({ toasts: [...s.toasts, { id, message, actionLabel: opts?.actionLabel, onAction: opts?.onAction }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

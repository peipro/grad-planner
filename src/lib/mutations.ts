// 研途计划 · Mutation 类型与权威刷新工具（Phase 1B-1）
// Mutation 契约与 electron/mutation-engine.cjs 一致：
//   - create/update 携带全量实体（复用 src/types.ts 的 Task / Note，不创建第二套模型）
//   - update 的 id 必须与 entity.id 一致
// 提交逻辑位于 public/sync-adapter.js（IIFE，浏览器脚本）；本模块提供类型 + 失败恢复工具。

import type { Task, Note } from '../types'
import { useStore, mergePersistedState } from '../store'

export type Mutation =
  | { type: 'task.create'; payload: Task }
  | { type: 'task.update'; id: string; entity: Task }
  | { type: 'task.delete'; id: string }
  | { type: 'note.create'; payload: Note }
  | { type: 'note.update'; id: string; entity: Note }
  | { type: 'note.delete'; id: string }

// 与 engine ERROR_CODES 对齐（外加 renderer 网络层错误）
export type MutationErrorCode =
  | 'invalid_mutation'
  | 'entity_not_found'
  | 'validation_failure'
  | 'persistence_failure'
  | 'internal_error'
  | 'network_error'

// 失败恢复语义（docs/Phase-1B-1-Mutation-Architecture.md L4）：
//   persistence_failure → refreshFromAuthority()（磁盘不可写，回权威）
//   其余错误（invalid/not_found/validation/network/internal）→ 只提示，不刷新整个 state
export const REFRESH_ON_ERROR: ReadonlySet<string> = new Set(['persistence_failure'])

/**
 * 从权威（桌面 IPC / 平板 GET /api/storage）重新拉取 state 并覆盖本地 store。
 * 仅在需要回权威时调用（如 persistence_failure）。
 * @returns 是否成功刷新
 */
export async function refreshFromAuthority(): Promise<boolean> {
  const api = (window as any).electronAPI
  let text: string | null = null
  try {
    if (api?.syncStorageGet) {
      const res = await api.syncStorageGet()
      if (res && res.found) text = res.data
    } else {
      const token = new URL(window.location.href).searchParams.get('token') || ''
      const path = '/api/storage' + (token ? '?token=' + encodeURIComponent(token) : '')
      const r = await fetch(path, { cache: 'no-store' })
      if (r.ok) text = await r.text()
    }
  } catch {
    return false
  }
  if (text == null) return false
  try {
    const j = JSON.parse(text)
    const persisted = j && j.state && typeof j.state === 'object' ? j.state : j
    useStore.setState(mergePersistedState(persisted, useStore.getState()))
    return true
  } catch {
    return false
  }
}

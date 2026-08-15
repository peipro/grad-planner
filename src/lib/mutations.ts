// 研途计划 · Mutation 类型与权威刷新工具（Phase 1B-1）
// Mutation 契约与 electron/mutation-engine.cjs 一致：
//   - create/update 携带全量实体（复用 src/types.ts 的 Task / Note，不创建第二套模型）
//   - update 的 id 必须与 entity.id 一致
// 提交逻辑位于 public/sync-adapter.js（IIFE，浏览器脚本）；本模块提供类型 + 失败恢复工具。

import type { Task, Note } from '../types'
import { useStore, mergePersistedState, repairMilestones } from '../store'
import type { PlannerState } from '../store'

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

// ===== Phase 1B-2: State Sync（Main → Renderer 就地更新，替代 reload） =====

// Renderer-only 字段：权威同步时绝不覆盖（§14/§15）
//   activeView  —— 页面导航，每端独立
//   pomo        —— 番茄钟运行时状态（running/remaining/swSec/endAt 等），覆盖会打断计时
//   newsConfig  —— 含 renderer 内存密钥（xKey/xSecret），从权威覆盖会清掉用户输入

/**
 * State Sync merge：authoritative 持久化字段覆盖 current，renderer-only 字段保留。
 * 与 mergePersistedState（hydration/导入用，pomo 强制复位）不同：
 * State Sync 绝不能打断用户正在进行的 UI 状态（番茄钟/页面/密钥）。
 */
export function mergeAuthoritativeState(persisted: unknown, current: PlannerState): PlannerState {
  const p = (persisted || {}) as Partial<PlannerState>
  return {
    ...current,
    ...p,
    milestones: repairMilestones(p.milestones),
    // renderer-only 字段保留
    activeView: current.activeView,
    pomo: current.pomo,
    newsConfig: current.newsConfig,
  }
}

/**
 * 应用权威 state 到 Zustand（不 reload、不重新 hydration）。
 * 防循环：先标记 sync-adapter 权威基准 → 随后的 persist setItem diff 为空 → 不产生 mutation。
 * P1 修复：本地存在未同步修改（网络提交失败、等待补交）时跳过权威覆盖，
 * 避免用户刚做的编辑被 state-sync 静默抹掉；等补交成功后由下一次 state-sync 收敛。
 */
export function applyAuthoritativeState(state: unknown): void {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return
  const hasPending = (window as any).__gradSyncHasPendingUnsynced
  if (typeof hasPending === 'function' && hasPending()) return
  const sync = (window as any).__gradSyncMarkAuthoritative
  if (typeof sync === 'function') sync(state)
  useStore.setState(mergeAuthoritativeState(state, useStore.getState()))
}

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

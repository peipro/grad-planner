# Phase 1B-1 Mutation Architecture（Stage A 设计文档）

> 阶段目标：证明 **Main Process 作为唯一 mutation authority** 在当前 grad-planner 架构中可可靠落地。
> 范围：仅 Task + Note 两个实体。不引入 revision / CRDT / merge / offline sync。
> 基线：`phase-1a-security-complete` + `docs/Phase-1B-0-Sync-Architecture-Report.md`（e1b2547）。

---

## A. Mutation Architecture

```
Desktop Renderer                     Tablet / Browser
   │  persist setItem                     │  persist setItem
   ▼                                     ▼
 sync-adapter.js                    sync-adapter.js
   │ diff(tasks/notes)                   │ diff(tasks/notes)
   │ 生成 Mutation[]                      │ 生成 Mutation[]
   ▼                                     ▼
 electronAPI.syncMutate              fetch POST /api/mutations
   │  (IPC)                              │  (HTTP)
   ▼                                     ▼
 ┌────────────────────────────────────────────────────────┐
 │            Main Process（同一进程，同一实例）              │
 │                                                       │
 │  Mutation Engine (electron/mutation-engine.cjs)       │
 │    validate mutation                                  │
 │    validate target entity                             │
 │    load authoritative state（文件权威 + mtime 缓存）     │
 │    apply mutation（串行，单线程）                       │
 │    validate resulting state                           │
 │    persist（原子写 tmp+rename）                        │
 │    return normalized result                           │
 │                                                       │
 │  权威 state：data/sync/grad-planner-storage.json       │
 └────────────────────────────────────────────────────────┘
```

**核心原则**：
1. **一个 state，多个 client**：文件 + 主进程 = 唯一权威；renderer 的 zustand store 只是 cached representation。
2. **mutation 是同步协议的基本单位**，不是整个 AppState。
3. **IPC 与 HTTP 进入同一个 mutation engine 实例**（Node 单线程，天然串行，无通道分裂）。

---

## B. 关键设计决策

### B1. 权威状态模型：文件权威 + mtime 缓存

- **磁盘文件是物理权威**（与 Phase 1B-0 结论一致：文件是唯一物理共享点）。
- Engine 持有内存缓存 + 文件 `mtime`；每次 apply 前 `stat`，文件被外部修改（旧客户端整份写、手动编辑）→ 重读，**不会分裂**。
- 存储格式**保持 Phase 0 兼容**：`{ state, version: 0 }`（zustand persist 格式，含 `partialize` 语义）。**不引入 envelope / revision / writeId**。

### B2. Renderer 写路径：persist-diff，不改 store actions

- `src/store.ts` 的 actions **原样不动**（UI 与现有测试零影响）。
- `public/sync-adapter.js` 改造：persist 每次 `setItem` 时，解析真实 persistence payload（`{state, version}`），与**上次成功提交的基准 state** 对比 `tasks` / `notes` 数组，按 id 生成 `Mutation[]`。
- 每次 `setItem` 直接**重置** pending 队列为最新 diff（最新 diff 已含基准以来的全部变化），300ms 节流合并提交；`pagehide/beforeunload` 强制 flush。
- 提交成功 → 基准更新为本次 state；提交失败 → 如实记录错误并触发权威刷新（见 B4）。
- 本地缓存：persist 仍写 `localStorage`（`nativeSet`），作为离线兜底与快速启动。

### B3. 乐观 / 悲观语义

- store 本地乐观更新（同步 set，UI 即时响应）。
- **引擎如实返回结果**（绝不 `catch{}` 伪装成功）。
- 失败时 renderer 通过 `refreshFromAuthority()` 从权威状态回滚对应字段，保证"UI 不长期持有失败状态"。

### B4. 失败恢复（最小）

- `sync-adapter` 提交失败 → `dispatch('sync-mutation-failed', {error})`。
- `App.tsx` 监听 → toast + 调用 `refreshFromAuthority()`（桌面 `syncStorageGet` / 平板 `GET /api/storage` → `mergePersistedState` → `setState`）。

### B5. 旧接口兼容（不删除）

- `sync-storage-set` IPC、`PUT /api/storage`、`DELETE /api/storage` **全部保留**。
- 旧客户端（phase-1a 打包）仍走整份写 → 文件变化 → engine mtime 检测自动重读 → 与 mutation 路径共存不分裂。
- 旧接口在文档中标记 `deprecated`（本阶段不删）。

---

## C. Mutation 类型定义

复用 `src/types.ts` 的 `Task` / `Note`，不创建第二套实体模型。

```ts
// src/lib/mutations.ts
export type Mutation =
  | { type: 'task.create'; payload: Task }
  | { type: 'task.update'; id: string; entity: Task }   // 全量实体（免 diff）
  | { type: 'task.delete'; id: string }
  | { type: 'note.create'; payload: Note }
  | { type: 'note.update'; id: string; entity: Note }
  | { type: 'note.delete'; id: string }
```

- `task.update` / `note.update` 传**全量实体**（含 id），由 renderer 的 diff 直接提供，避免客户端 diff 语义。
- `task.create` / `note.create` 传完整 payload（含 `id` / `createdAt` / `updatedAt`，由 renderer 的 `uid()` / `Date.now()` 生成——与现有 store actions 一致）。

---

## D. Mutation Engine 接口（electron/mutation-engine.cjs）

```js
createMutationEngine({ storageFile })
  → {
      applyMutations(list: Mutation[]) → {
        ok: boolean,                       // 全部成功
        results: Array<{ ok, type, id, entity?, error? }>,
        error?: string,                    // 首个错误（分类码）
      },
      getState() → { state: AppState|null },   // 权威 state（读文件/缓存）
      reload() → void,                         // 强制重读（外部写入后）
    }
```

**单条 mutation 执行步骤**（对应 §9 / §15 / §16）：

```
1. validate mutation（type 合法；payload/entity/id 结构）
2. validate target entity（task/note 关键字段：id/title/...）
3. load authoritative state（文件权威 + mtime 缓存）
4. apply：
     create → 追加（id 已存在 → 宽松覆盖，幂等）
     update → id 必须存在（不存在 → entity_not_found）；替换实体
     delete → id 不存在 → 幂等成功（宽松）
5. validate resulting state（顶层数组字段仍为数组，宽松校验）
6. persist（原子写 tmp + rename；失败 → persistence_failure）
7. return { ok: true, entity } / { ok: false, error }
```

**错误分类**（§16，不使用裸 catch 伪装成功）：

| code | 含义 |
|---|---|
| `invalid_mutation` | mutation 结构不合法（type 未知 / 缺字段 / 类型错误） |
| `entity_not_found` | update/delete 目标 id 不存在（delete 宽松幂等时可不返回） |
| `validation_failure` | 实体关键字段非法 |
| `persistence_failure` | 原子写盘失败 |
| `internal_error` | 未预期异常（引擎会显式返回并记录，不吞掉） |

**幂等语义**：create 同 id → 覆盖；delete 不存在 id → 成功（无操作）。这保证重试不产生重复实体（Phase 1B-0 不变量 9）。

---

## E. IPC API（electron/preload.js + main.cjs）

| 新增 | 说明 |
|---|---|
| `electronAPI.syncMutate(mutations)` → `{ok, results, error?}` | renderer → main，调用 `mutationEngine.applyMutations` |

保留（不动）：`syncStorageGet` / `syncStorageSet` / `syncStorageRemove` / `lanInfo` 等。

`main.cjs` 接线：
```js
const mutationEngine = createMutationEngine({ storageFile })
ipcMain.handle('sync-mutate', (_e, mutations) => {
  if (!Array.isArray(mutations)) return { ok: false, error: 'invalid_mutation' }
  return mutationEngine.applyMutations(mutations)
})
// startLanServer({ ..., mutationEngine }, ...)
```

---

## F. HTTP API（electron/lan-server.cjs）

| 新增 | 说明 |
|---|---|
| `POST /api/mutations`（body: `{ mutations: Mutation[] }`）→ `{ok, results, error?}` | Tablet → 同一个 `mutationEngine`。鉴权/CSRF 复用现有 token + originAllowed |

保留（标记 deprecated）：`GET/PUT/DELETE /api/storage`。

`lan-server.cjs` 改造：`createLanServer` 增加可选参数 `mutationEngine`；`POST /api/mutations` 处理器与 IPC 共用 `applyMutations`（**同进程同实例**）。

---

## G. 需要修改 / 新增的文件

| 文件 | 操作 | 内容 |
|---|---|---|
| `electron/mutation-engine.cjs` | **新增** | 引擎（纯 Node，可测） |
| `electron/mutation-engine.test.cjs` | **新增** | 引擎单元测试 |
| `src/lib/mutations.ts` | **新增** | Mutation 类型 + `refreshFromAuthority()` + 错误码常量（提交逻辑在 sync-adapter） |
| `src/lib/mutations.test.ts` | **新增** | sync-adapter diff 逻辑测试（真实 persist 格式） |
| `electron/main.cjs` | 修改 | 创建 engine；`sync-mutate` IPC；注入 lan-server |
| `electron/lan-server.cjs` | 修改 | `POST /api/mutations`（注入 engine） |
| `electron/lan-server.test.cjs` | 修改 | 新增 mutation HTTP 测试 |
| `electron/preload.js` | 修改 | 暴露 `syncMutate` |
| `public/sync-adapter.js` | 修改 | setItem → diff mutation 提交；失败事件 |
| `src/App.tsx` | 修改 | 监听 `sync-mutation-failed` → toast + 权威刷新 |
| `docs/Phase-1B-1-Mutation-Architecture.md` | 本文件 | 设计 |

**明确不修改**：`src/store.ts`（actions 不动）、`src/types.ts`、`src/data/*`、`electron/sync-manager.cjs`、`electron/storage-schema.cjs`。

---

## H. 迁移策略

1. **同步开发期**：新 renderer（本阶段产物）走 mutation；旧客户端（phase-1a 构建）走整份写。文件权威 + mtime 缓存保证两者共存。
2. **旧接口保留**：`sync-storage-set` / `PUT /api/storage` 保留并标记 deprecated，文档说明建议弃用。
3. **首次启动**：现有 hydration（`syncStorageGet` / `GET /api/storage`）不变，renderer 拿到权威 state。
4. **本地遗留数据迁移**：`sync-adapter.remoteGet` 的 legacy 分支保留（走 `syncStorageSet` 整份，兼容）。

---

## I. 测试计划

### 单元测试（Node 原生，`node --test electron/*.test.cjs`）

1. **engine：task.create** → 磁盘文件 + `getState()` 均含新 task；结果 `{ok:true, entity}`。
2. **engine：task.update** → 替换实体；`entity_not_found` 场景（id 不存在）。
3. **engine：task.delete** → 删除；不存在 id 幂等成功。
4. **engine：note.create / note.update / note.delete** → 同 task。
5. **engine：invalid_mutation** → 未知 type / 缺字段 / 错误类型。
6. **engine：persistence_failure** → 注入失败 write（如只读目录）→ 返回 `persistence_failure`，**不伪装成功**。
7. **engine：外部文件修改检测** → 手动写文件（模拟旧客户端 PUT）→ 下次 apply 前 mtime 变化 → 重读，不丢外部修改。
8. **engine：批处理** → `applyMutations([task.create, note.update, ...])` 原子应用到同一 state。
9. **真实格式**：engine 读写文件使用 `{state, version:0}` 包装（与 zustand persist 一致），断言包装完整。

### HTTP 集成测试（lan-server.test.cjs）

10. `POST /api/mutations` 成功 → 200 + results。
11. `POST /api/mutations` 非法 body → 400。
12. `POST /api/mutations` 无 token → 401；evil Origin → 403。
13. **双通道同一引擎**：IPC 路径（直接调 engine）与 HTTP 路径（POST）交错应用 → 最终文件 state 一致、无丢失（复现 Phase 1B-0 §5 场景 5，断言 mutation 不丢）。

### Renderer 测试（vitest，`src/lib/mutations.test.ts`）

14. **diff 逻辑（黑盒，真实 persist payload）**：加载真实 `public/sync-adapter.js`（`new Function`，与生产加载一致），mock `electronAPI.syncMutate`；用**真实 persist 格式**（`JSON.stringify({state: {...}, version: 0})`）调用 `localStorage.setItem`，断言生成的 Mutation[] 正确（create/update/delete）。
15. **连续 setItem 合并**：基准不变时多次 setItem → 提交队列只保留最新 diff。
16. **非 Task/Note 字段变更**（如 `setPomodoro`）→ 不生成 mutation、不提交。
17. **失败分类不刷新**：mock `syncMutate` 返回 `{ok:false, error:'validation_failure'}` → dispatch `sync-mutation-failed`，事件 detail.error 正确；`persistence_failure` → 触发 `refreshFromAuthority`（断言 store 被权威数据覆盖）。（L4）

### 回归

17. 全量：`npm test`（vitest 6 文件）+ `node --test`（electron 7 文件）+ `npm run build` + `npm run lint`。

---

## J. 风险评估（Stage A 结论）

**结论：当前架构可以低风险实现 Main authoritative mutation layer，无架构级阻碍。**

| 风险 | 等级 | 缓解 |
|---|---|---|
| 旧客户端整份写与 mutation 并存 | 低 | 文件权威 + mtime 缓存（B1） |
| renderer 乐观状态在 mutation 失败时漂移 | 低 | 失败事件 + `refreshFromAuthority()`（B4） |
| diff 在每次 setItem 全量比较（性能） | 低 | 数据量小（<5000 条）；仅比较 tasks/notes 两个数组 |
| 双端同时改同一实体（覆盖） | 低（本阶段接受） | 引擎按到达序 LWW；冲突检测留待下一阶段（§22 明确不做） |
| sync-adapter 改造影响现有 persist | 中 | getItem 不变（权威读）；setItem 改为本地写 + diff 提交；保留 legacy 分支；回归测试全覆盖 |

---

## L. 最终确认（Stage B 前定稿，2026-08-14）

### L1. persist-diff 的边界

保留：

```text
真实 Zustand persist payload { state, version }
→ sync-adapter diff
→ Task / Note Mutation[]
→ Main Mutation Engine
```

**Phase 1B-1 只解决：whole-state overwrite 导致的"不同实体互相覆盖"问题。**

**本阶段明确不解决（留待后续 Phase）：**

- 同一实体并发修改
- offline conflict
- revision
- CRDT
- 最终冲突 UI

### L2. mtime 只是缓存优化，不是同步一致性依据

- **缓存失效提示**：`mtime + size` 组合（`statStamp = `${mtimeMs}:${size}``）仅用于 `getState()` 读路径的缓存命中判断。
- **正确性优先于 cache hit**：`applyMutations()` 每次**直接从磁盘读取权威 state**，不经过缓存。任何写决策都基于磁盘最新内容。
- **不得把"mtime 没变化"理解为"内容一定没变化"**：缓存命中返回的是上次读盘的内容（读优化）；写路径从不依赖该判断。
- 当前数据量下不引入 hash 校验；若未来数据量增长需要读缓存，再升级为 `mtime + size + hash`（hash 计算需要读文件，等于每次读盘，当前无收益）。
- **新增测试**：
  - 外部文件修改 → `applyMutations` 必须重新读取权威 state（外部数据不被覆盖）；
  - 缓存判断异常（getState 读到旧缓存、外部随后修改文件）→ 下一次 apply 仍基于磁盘最新内容，**不得静默覆盖外部数据**。

### L3. Mutation Batch 的真正原子性

一次 `Mutation[]` 的处理流程（禁止逐条持久化）：

```text
读取 authoritative state（磁盘）
→ 创建 working copy（deep clone）
→ 依次 apply 所有 mutation（就地改 working copy）
→ 任一失败：整体返回失败，不写盘（working copy 丢弃）
→ 全部成功：验证最终 working state（validateStorageShape）
→ 一次性 persist（原子写）
→ 持久化成功后才返回成功
```

**禁止**：

```text
mutation 1 → persist
mutation 2 → persist
mutation 3 → persist
```

**测试必须覆盖**：batch 中第 N 个 mutation 失败 → 磁盘文件保持原样（前面 N-1 个也不持久化）。

### L4. 不同错误的恢复语义（不搞一刀切 refresh）

| 错误码 | renderer 行为 |
|---|---|
| `invalid_mutation` | 只返回错误（toast），**不刷新整个 state** |
| `entity_not_found` | 只返回错误（toast），**不刷新整个 state** |
| `validation_failure` | 只返回错误（toast），**不刷新整个 state** |
| `persistence_failure` | **authoritative refresh**（磁盘不可写，回权威）+ toast |
| `internal_error` | toast，保守不刷新（避免覆盖用户编辑） |
| `network_error` | toast，不刷新（离线时刷新也无意义；本阶段无离线队列） |

**关键约束**：用户正在编辑 Note 时，一个无关 Task mutation 失败（如 `validation_failure`）**不得触发整个 renderer refresh** 覆盖正在编辑的内容。相关逻辑必须加入测试。

### L5. 保持原有 Stage A 设计

以上 4 点确认不改变总体方案：

- Main Process 为唯一 mutation authority
- IPC / HTTP 共用同一个 Mutation Engine 实例
- Task / Note 作为第一批实体
- 复用现有 Task / Note 类型（`src/types.ts`）
- 不修改 `src/store.ts` / `src/types.ts` / `src/data/*`
- 不实现 revision / CRDT / entity merge / offline sync
- 保留旧 `/api/storage` 与 `sync-storage-set` 作为兼容路径

---

## K. 尚未解决（下一阶段）

- revision / 同实体并发冲突检测（LWW → 版本化）
- offline 客户端离线队列与重放
- fs.watch 通知链路的最终重构（状态推送替代整页 reload）
- Task/Note 之外其余实体的 mutation 化（本阶段明确只做 Task + Note）
- 旧接口（`sync-storage-set` / `PUT /api/storage`）的最终移除

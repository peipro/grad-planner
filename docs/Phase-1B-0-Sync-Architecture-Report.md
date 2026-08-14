# Phase 1B-0 Sync Architecture Report

> 调查基线：`phase-1a-security-complete`（b08690d）
> 调查日期：2026-08-14
> 本报告为**纯调查输出**，未修改任何核心同步代码。
> 结论：当前同步系统存在**可复现的 lost update 与存储格式分裂**，上一轮 Phase 1B 的失败根源是**架构层面的状态所有权分裂**，而非某个具体 Bug。

---

## 0. 基线验证结果（重要发现）

按任务要求执行 `git status` / `git describe` / `git log` / `npm test` / `npm run build` / `npm run lint` / `node --test`：

| 检查项 | 结果 |
|---|---|
| `git status --short` | 干净（clone 后） |
| **`HEAD` / 远程分支** | **⚠️ 异常：clone 到的 `origin/main` 仍指向 `phase-1b-sync-complete`（5e550d3），不是 `phase-1a-security-complete`** |
| `npm test`（vitest） | phase-1a：6 文件 / 78 测试 PASS；phase-1b：9 文件 / 86 测试 PASS |
| `node --test`（Electron .cjs 测试） | phase-1a：64/64 PASS；phase-1b 同 |
| `npm run build` | PASS（两基线均） |
| `npm run lint` | PASS（两基线均） |

**关键发现 #0**：用户声称"已回退到 phase-1a-security-complete"，但**远程仓库 `origin/main` 仍停留在 `phase-1b-sync-complete`**（本地回退未推送，或回退发生在别的克隆）。这解释了为何 clone 下来的代码与预期基线不符。**本次调查已在 `phase-1a-security-complete`（detached HEAD，working tree clean）上完成全部阅读与分析。**

**附带发现**：`node --test` 会报 9 个失败，全部来自 `src/*.ts`（vitest 专属测试，依赖 vite/jsdom 环境）。`node --test` 不是本项目官方测试命令（package.json 无此脚本），Electron `.cjs` 测试全部通过，**非代码回归**。

**Phase 1B 提交链**（5 个 commit，+1304/-151 行，正是"上一轮失败的修复"）：

```
5e550d3 docs: record Phase 1B sync consistency status
195f10d test: add sync consistency regression coverage
dcbcc63 sync: remove time-based watch heuristic          ← writeId 来源判断
cc4504e sync: client revision-aware submit and conflict events  ← sync-adapter 大改
24bc15f sync: add storage envelope with revision, conflict detection and entity merge  ← 核心
a1c1910 sync: add renderer flush protocol                ← flush 协议
b08690d phase-1a-security-complete（稳定基线）
```

---

## 1. 当前真实同步架构（phase-1a）

### 1.1 组件与职责

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Desktop (Electron)                          │
│                                                                     │
│  React UI (NotesView/TodoView/...)                                  │
│    │ set() 每次状态变更                                               │
│    ▼                                                                │
│  Zustand store (src/store.ts)                                       │
│    │ persist middleware：每次 set 同步调用 storage.setItem（无节流）     │
│    ▼                                                                │
│  localStorage.setItem('grad-planner-storage', {state,version} 序列化)│
│    │ 被 patch 拦截                                                   │
│    ▼                                                                │
│  sync-adapter.js (public/) —— 桌面端直接 IPC（无节流）                  │
│    │ window.electronAPI.syncStorageSet(string)                      │
│    ▼                                                                │
│  preload.js contextBridge → ipcRenderer.invoke('sync-storage-set')  │
│    │                                                                │
│    ▼                                                                │
│  Main Process (electron/main.cjs)                                   │
│    │ syncManager.setPending(data)  ← 300ms 节流（只保留最后一份）      │
│    │ flush() → syncStorage.write(data) → 原子写（tmp+rename）         │
│    ▼                                                                │
│  data/sync/grad-planner-storage.json  ← 唯一数据源                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          Tablet (Browser)                           │
│                                                                     │
│  React UI → Zustand store → persist setItem（同样每次 set 触发）       │
│    ▼                                                                │
│  sync-adapter.js —— 浏览器端 500ms 节流：pendingPut 只保留最后一份      │
│    ▼ flushPut()（pagehide/beforeunload 也强制 flush）                │
│  fetch PUT /api/storage?token=…  body=整份 JSON（keepalive）          │
│    ▼                                                                │
│  LAN Server (electron/lan-server.cjs, 同主进程)                      │
│    │ authorize(token) + originAllowed(CSRF) → validateStorageShape   │
│    │ storage.write(body)  ← 立即写盘，无节流                          │
│    ▼                                                                │
│  同一个 data/sync/grad-planner-storage.json                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    JSON 文件 → Desktop 刷新链路                        │
│                                                                     │
│  文件变化 → fs.watch(dir)                                            │
│    │ name 匹配 grad-planner-storage.json                             │
│    │ 800ms 时间窗口：Date.now()-lastDesktopWrite < 800 → 跳过（自写） │
│    │ 300ms debounce → sha256 内容哈希对比 lastReloadHash             │
│    │ 变化 → syncManager.flushAndReload()                             │
│    │    flush：桌面 pending 落盘（防 reload 丢数据）                   │
│    │    reload：webContents.reload() 整页重载（跳过翻译小窗）          │
│    ▼                                                                │
│  Renderer 重新加载 → zustand hydrate → syncStorageGet → 读文件 → 上屏  │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 各层"谁做什么"（明确清单）

| 职责 | Desktop Renderer | Main Process | LAN Server（同主进程） | Tablet Renderer |
|---|---|---|---|---|
| 读（数据源） | hydrate 时 GET 文件 | `sync-storage-get` → 读文件 | `GET /api/storage` → 读文件 | hydrate 时 GET 文件 |
| 写 | setState → persist → IPC | `sync-storage-set` → 300ms 节流落盘 | `PUT /api/storage` → **立即**落盘 | setState → persist → 500ms 节流 PUT |
| 缓存 | zustand store（内存，权威） | syncManager.pending（300ms 窗口） | 无（每次读盘） | zustand store（内存，权威） |
| reload | 被动被 reload | `reloadRenderers()` 主动整页 reload | — | — |
| merge | `mergePersistedState`（persist hydration） | 无 | 无 | `mergePersistedState` |
| flush | `pagehide/beforeunload` flushPut（浏览器端） | syncManager.flush（退出前/刷新前） | 无 | 同左 |
| 通知 | 无 | fs.watch → reload | — | 无 |
| 异步 | persist setItem 同步；IPC 异步 | IPC handler 同步执行 | HTTP 异步 | fetch 异步 |
| debounce | 无（每次 set 触发 IPC） | 300ms（落盘） | 无 | 500ms（PUT） |

### 1.3 关键机制细节（读代码确认，非 README）

1. **zustand persist v4.5.5**（`node_modules/zustand/esm/middleware.js`）：`api.setState = (state, replace) => { savedSetState(...); void setItem() }` —— **每次 `set()` 都同步序列化整个 state 并调用 `storage.setItem`**。无节流、无去重、无脏检查。存储格式为 `JSON.stringify({state, version:0})`（`createJSONStorage`）。
2. **partialize**（src/store.ts）：清空 `pomo.running/swRunning/endAt/swStartedAt`、清空 `newsConfig.xKey/xSecret`，其余字段（含全部实体数组、`activeView`、`theme` 等）原样保留。**每次写入都是整份 state 序列化**。
3. **mergePersistedState**：`persisted` 覆盖 `current` 的同名字段；`milestones` 自愈；`pomo`/`newsConfig` 强制复位。persist 默认 merge 由自定义 `merge` 覆盖。
4. **sync-adapter patch**（public/sync-adapter.js）：patch `Storage.prototype`，仅拦截 `'grad-planner-storage'` 键。桌面端走 IPC（`isElectron` 分支），浏览器端 500ms 节流 PUT。
5. **写入路径不对称**（关键）：
   - 桌面端：客户端**无节流**（每次 setState → IPC），主进程 300ms 节流落盘。
   - 平板端：客户端 500ms 节流（`pendingPut` 只保留最后一份），服务器**无节流立即写盘**。
6. **原子写**（lan-server.cjs `createStorageAccess.write`）：tmp 文件 + `renameSync`。注意 tmp 文件名形如 `grad-planner-storage.json.tmp-<pid>-<ts>`，也会触发 fs.watch 事件但被 `endsWith` 过滤。
7. **fs.watch 是目录级监听**（`fs.watch(path.dirname(storageFile))`），靠文件名过滤，靠 800ms 时间窗口区分自写/外写，靠 300ms debounce + sha256 去重。
8. **周期性写入源**：番茄钟运行时（src/lib/pomodoro.ts）每 250ms tick、每秒 `setPomodoro({remaining})` → persist 每秒整份写入；提醒器每分钟扫描但只读不写；自动备份每 10 分钟一次（写 backups 目录，不写共享文件）。
9. **Task 是即时提交**（TodoView）：`toggleStatus`/`toggleSubtask`/`quickAdd` 点击即 `updateTask`/`addTask` → 立即整份写入。Note 是 onBlur 提交（NotesView `persistContent/persistTitle/persistTags`）。

---

## 2. 数据流图

### 2.1 Desktop 完整写入链（以"修改 Note"为案例）

```
时间       用户动作/函数/事件                         状态变化
───        ──────────────────────────               ──────────
T0         用户在 textarea 输入                        React 本地 content state
T1         onBlur → persistContent()
           → updateNote({...selected, content,        zustand notes[i].content/updatedAt 更新
              updatedAt: new Date().toISOString()})
T2         persist middleware setItem()
           partialize(整个 state)                     JSON.stringify 全量序列化
           localStorage.setItem('grad-planner-        sync-adapter.syncSet 拦截
              storage', {state,version})
T3         sync-adapter remoteSet(String(value))      桌面端：直接 enqueue IPC（无节流）
           window.electronAPI.syncStorageSet(json)
T4         ipcRenderer.invoke('sync-storage-set') →   主进程 handler
           main.cjs: typeof data === 'string' 校验
           syncManager.setPending(data)               pending = data（覆盖旧值）
T5         （无新写入 300ms 后）syncManager.flush()     pending → write(data)
           → lastDesktopWrite = Date.now()
           → syncStorage.write(data)
           → fs.mkdirSync + tmp 文件 + renameSync     磁盘文件被原子替换
T6         fs.watch 收到 rename 事件
           Date.now()-lastDesktopWrite < 800 → 跳过    自己的写入，不触发 reload
```

### 2.2 Tablet 完整外部同步链（以"修改 Task"为案例）

```
时间       用户动作/函数/事件                         状态变化
───        ──────────────────────────               ──────────
T0         用户点击任务状态按钮
           toggleStatus(t) → updateTask({...t,        tablet zustand tasks[i].status 更新
              status: next})
T1         persist setItem → localStorage.setItem     sync-adapter.syncSet 拦截
T2         remoteSetThrottled(value)                  pendingPut = value（覆盖）
           （500ms 内无新写入）flushPut()
T3         fetch PUT /api/storage?token=…             HTTP 请求（keepalive）
           body = 整份 JSON
T4         lan-server: authorize(token) +             鉴权/CSRF 通过
           originAllowed(origin)
           JSON.parse → validateStorageShape         结构校验
T5         storage.write(body) → tmp + rename         磁盘文件被 tablet 整份覆盖
T6         fs.watch 事件
           lastDesktopWrite 不在 800ms 窗口内 → 继续
           300ms debounce → sha256 变化
           → syncManager.flushAndReload()
T7         flush()：桌面 pending 落盘                 ← 此处可能覆盖 tablet 数据（见 §5）
           reloadRenderers() → webContents.reload()
T8         Desktop renderer 重新加载
           zustand hydrate → localStorage.getItem
           → syncStorageGet → 读磁盘文件
           mergePersistedState → 新数据上屏
```

### 2.3 反向链路（Desktop 写 → Tablet 看到）

Tablet 没有 fs.watch 也没有推送机制，**完全靠主动刷新**（手动刷新页面重新 GET）。**桌面端修改后，平板端不会自动更新**——文档宣称"任一端修改，另一端约 1 秒内自动刷新"，实际只对 Desktop 成立（fs.watch），Tablet 无订阅机制。

---

## 3. 关键状态（谁持有什么）

| 状态 | 持有者 | 生命周期 | 与磁盘的关系 |
|---|---|---|---|
| `zustand store`（完整 AppState） | Desktop renderer | 页面生命周期 | hydration 时读一次；每次 set 全量写出 |
| `zustand store` | Tablet renderer | 页面生命周期 | 同上 |
| `syncManager.pending` | Main（`sync-manager.cjs`） | 300ms 窗口 | 未落盘的最新写入；reload/退出前 flush |
| `lastDesktopWrite` | Main（`main.cjs`） | 全局 | 判断 fs.watch 事件是否自写（800ms 启发式） |
| `lastReloadHash` | Main（`main.cjs`） | 全局 | 文件内容去重 |
| `syncNotifyTimer` | Main（`main.cjs`） | 300ms debounce | — |
| `pendingPut` | Tablet sync-adapter | 500ms 窗口 | 未上传的最新写入 |
| 磁盘 JSON 文件 | 文件系统 | 持久 | **唯一数据源** |

**核心观察**：同一份"用户数据"同时被 4 处持有（Desktop store、Tablet store、main.pending、磁盘文件），且 Desktop/Tablet 的 store 各自声称"权威"，磁盘文件是唯一的物理共享点。**没有任何串行化机制保证写入顺序。**

---

## 4. 六种场景时序图

> 图例：`[R]`=read，`[W]`=write，`[F]`=flush，`[WA]`=watch，`[RL]`=reload，`[SU]`=state update。节流窗口以 D=300ms（桌面）、T=500ms（平板）、W=800ms（watch 自写豁免）表示。

### Scenario A：Desktop 单独修改（正常路径）

```
Desktop UI:      [SU] updateNote
Desktop persist: [W→IPC] 全量序列化+提交
Main:            [W-pending] setPending
                 …300ms…
                 [F] 原子写盘
fs.watch:        [WA] 事件 → 800ms 窗口内 → 跳过（自写）
磁盘:            [W] 新内容
```
✅ 无问题。

### Scenario B：Tablet 单独修改（正常路径）

```
Tablet UI:       [SU] updateTask
Tablet adapter:  [W-pending] pendingPut …500ms…
                 [F] PUT /api/storage
LAN Server:      [W] 立即原子写盘
fs.watch:        [WA] 事件 → 非自写 → 300ms debounce → hash 变化
Main:            [F] flush（无 pending）→ [RL] reloadRenderers
Desktop:         [R] hydrate → 读盘 → [SU] 新数据上屏
```
✅ 基本正常（代价是 Desktop 整页 reload，丢失焦点/滚动/未 blur 输入）。

### Scenario C：Desktop 修改 → Tablet 修改（顺序）

```
Desktop:  [SU] → [W→IPC] → [W-pending]（300ms 未到）
Tablet:   [SU] → [W-pending]（500ms 未到）
          [F] PUT（Tablet 快照，不含 Desktop 修改）→ [W] 盘
fs.watch: [WA] → 非自写 → [F] flush Desktop pending → [W] 盘（Desktop 快照，覆盖 Tablet）
          [RL] reload
最终:     磁盘 = Desktop 快照；Tablet 的 Task 修改丢失（无冲突检测）
```
❌ **Tablet 修改被覆盖（lost update）**，详见 §5 场景 1。

### Scenario D：Desktop 与 Tablet 同时修改（并发）

```
Desktop:  [SU] Note 修改 → [W→IPC] → [W-pending]（300ms 未到）
Tablet:   [SU] Task 修改 → [W-pending]（500ms 未到）
          [F] PUT（Tablet 快照）→ [W] 盘
Main:     [F] Desktop flush → [W] 盘（Desktop 快照）
最终:     磁盘 = 后写盘者（通常 Desktop）；先写盘者（Tablet）修改整体丢失
```
❌ 与 C 同构，只是时间重叠。**谁最后写盘谁赢（last-writer-wins at whole-state level）**。

### Scenario E：Desktop 正在输入 → Tablet 修改

```
Desktop:  用户在 textarea 输入（未 blur，React 本地草稿，store 未更新）
Tablet:   [SU] → [F] PUT → [W] 盘
fs.watch:  [WA] → [RL] reloadRenderers
Desktop:   reload → 输入框销毁 → 草稿丢失（onBlur 不触发）
           hydrate → 读到 Tablet 数据
最终:      Desktop 未 blur 的草稿永久丢失
```
❌ phase-1a 已知问题（Phase 1B 的 flush 协议正是为此，但实现引入了新问题，见 §6）。

### Scenario F：网络中断 → Tablet 修改 → 网络恢复

```
网络断:  Tablet [SU] → [W-pending] …500ms… flushPut → fetch 失败（catch 静默）
恢复:    Tablet 继续操作 → 新 setItem → pendingPut 覆盖（旧修改被丢弃）
         flushPut → PUT 成功（只含最新快照）
最终:    断网期间 Tablet 的中间修改丢失（被合并为最后一次快照）；
         Desktop 无感知，无离线队列
```
❌ 无离线重试队列，`fetch().catch(() => {})` 静默丢弃。恢复后只同步"最后一次快照"，中间修改丢失。

---

## 5. Confirmed 数据一致性问题（真正的时间线）

### 场景 1：双通道并发 → 整份覆盖丢失（phase-1a 确凿）

```
T0  磁盘: revA（Desktop 与 Tablet 共同的起点）
T1  Desktop 修改 Note → persist → IPC → main.pending = desktopSnapshot
    （300ms 节流，未落盘）
T2  Tablet 修改 Task → PUT → lan-server 读盘 revA → 写盘 tabletSnapshot
    （tabletSnapshot 含 Task 修改，不含 Note 修改）
T3  Desktop fs.watch 事件 → flushAndReload
    flush：main.pending（desktopSnapshot）落盘 → 覆盖 tabletSnapshot
T4  磁盘: desktopSnapshot —— Tablet 的 Task 修改被静默覆盖
```
**覆盖点：T3 的 `syncStorage.write`。读方：T2 的 lan-server 读盘。没有任何检测。**

### 场景 2：reload 打断节流 → 草稿丢失（phase-1a 确凿）

```
T0  Desktop 用户输入（React 草稿未 blur，store 未更新）
T1  Tablet 写入 → fs.watch → reload
T2  reload 销毁输入组件 → 草稿丢失；main.pending 若存在则被 flush 保护（但草稿不在 store 里，flush 无济于事）
```

### 场景 3：800ms 自写豁免误判（phase-1a 确凿）

```
T0  Desktop 写入 → lastDesktopWrite = t0
T1  t0+100ms：Tablet 写入（外部修改）
T2  fs.watch 事件：Date.now() - t0 < 800 → 跳过 → Tablet 修改被当作"自己的写入"忽略
    Desktop 不刷新，显示旧数据
```
`lastDesktopWrite` 是**时间启发式**：任何发生在 Desktop 写入后 800ms 内的外部写入都会被误判。

### 场景 4：Tablet 端永不自动刷新（phase-1a 确凿）

Desktop 修改后，Tablet 无推送/无 watch，必须手动刷新页面才能看到新数据。文档声称的"1 秒内自动刷新"仅对 Desktop 方向成立。

### 场景 5（phase-1b 特有）：双通道 revision 碰撞 → 静默丢失（代码推演确认）

Phase 1B 中 IPC 通道用**内存** `currentEnvelopeText` 分配 revision，HTTP 通道每次**读盘**分配 revision，两通道各自计数：

```
T0  磁盘 rev5（IPC 与 HTTP 一致）
T1  Desktop IPC 提交 S1(expected=5) → 内存 rev6，currentEnvelopeText=envA
    （300ms 未落盘）
T2  Tablet HTTP 提交 S2(expected=5) → 读盘 rev5 → 接受 → 磁盘 rev6（envB，含 Tablet 修改）
T3  Desktop 300ms flush → 写盘 envA（rev6，含 Desktop 修改，不含 Tablet 修改）
T4  磁盘 rev6 = envA。Tablet 的修改丢失。
    但 revision 都是 6 —— 一致性检查完全无法检测！
```
这是 Phase 1B 的**确凿 lost update**：两个 server 入口（IPC/HTTP）共享一个文件、各自维护独立 revision 计数，无跨通道串行化。

---

## 6. 上一次失败方案（Phase 1B）的根因复盘

> 基于 `git diff phase-1a-security-complete phase-1b-sync-complete` 逐 commit 分析（24bc15f → cc4504e → dcbcc63 → 195f10d → 5e550d3）。

### 6.1 回答任务要求的 8 个问题

**1. 上一次方案的核心假设是什么？**

假设 A：只要引入 `revision`（乐观并发）+ `expectedRevision` 校验，stale 写入就会被 409 拒绝，旧数据不会覆盖新数据。
假设 B：只要引入 `changedIds/deletedIds` 实体级 diff + `entityVersions` 表，不同实体的并发修改就能自动合并，同实体冲突返回 409。
假设 C：只要用 `writeId` 替代 800ms 时间窗口，fs.watch 就能准确区分"自己的写入"和"外部写入"，杜绝同步循环。
假设 D：只要引入 renderer flush 协议（prepare-reload → 草稿提交 → 队列排空 → ACK → reload），reload 就不会丢未 blur 的输入。
假设 E：IPC 与 HTTP 共用同一个 `applySubmit` 实现，双通道语义就一致。

**2. 哪些假设是错误的？**

- **假设 A/B 成立的前提是"diff 与 revision 都基于同一个 state 视图"，但真实链路里 `submit.data` 是 zustand persist 的 `{state, version}` 包装，不是测试里的裸 AppState**（见 §6.2 问题 1）。`SyncCore.collectEntities({state, version})` 取不到任何数组字段 → `changedIds/deletedIds` 恒为空 → 实体级 merge 在真实运行时完全失效；stale 写入要么整份替换、要么 409，永远不会"按实体合并"。
- **假设 E 错误**：IPC 与 HTTP 虽然共用 `applySubmit` 函数，但**状态不共享**——IPC 用 main 内存 `currentEnvelopeText`，HTTP 每次读盘。同一函数的两次调用基于不同状态，产生 §5 场景 5 的 revision 碰撞。
- **假设 C 部分错误**：writeId 能区分"最近一次自写"，但**无法覆盖"自写落盘与外部写入交错"**：tablet 写盘 W2 与 desktop flush 写盘 W3 几乎同时发生时，watch 的 300ms debounce 后读到的是 W3（自写）→ 跳过，W2 的外部修改被忽略且可能已被 W3 覆盖（见 §6.2 问题 4）。
- **假设 D 正确但实现脆弱**：flush 协议依赖 renderer 响应（3s 超时兜底），且桌面端每次 setState 都立即入队一个 IPC 提交（无节流），队列在编辑会话中可能堆积几十个全量提交，超时窗口内 reload 会在提交进行中打断。

**3. 为什么修改之后问题越来越复杂？**

每一层修复都引入了新的状态，且这些状态之间没有单一权威：
- `knownRevision`（客户端）、`serverRevision`（服务器）、`currentEnvelopeText`（main 内存）、`lastWrittenWriteId`、`lastReloadHash`、`rendererFlushResolve`、`pendingPut`、`lastSubmittedData`（diff 基准）……
- 每个新状态都需要自己的正确性论证和测试；状态之间还互相耦合（knownRevision 依赖提交响应的顺序、diff 基准依赖提交是否成功、currentEnvelopeText 依赖 watch 是否触发）。
- 同时**没有删除旧的复杂度**：800ms 时间窗口虽然被"移除"，但 writeId 判断只覆盖"自写跳过"，外部写入判断仍然依赖 watch 事件的到达时机与文件最终状态——`dcbcc63` 把时间启发式换成了"读文件判断 writeId"，但**文件是覆盖写，最终状态的 writeId 只能反映最后一次写**，中间交错的外部写入信息已丢失。

**4. 是否产生了新的同步循环？**

- 主路径（writeId 自写跳过）在单设备单写路径下不循环。
- 但存在**跨设备 reload 风暴**：Tablet 每次 PUT → Desktop fs.watch → prepareAndReload → flush 写盘（自写，跳过）→ reload。若 Desktop 在 flush 后有新的 IPC 提交（用户 reload 前最后操作），该提交落盘又触发 watch（自写，跳过）→ 不循环，但 **Tablet 高频操作会让 Desktop 高频整页 reload**，每次 reload 都重新 hydrate + 可能触发一次 hydration 提交（见 6.2 问题 3）→ 又写盘 → 又是"外部事件+自写"的判别窗口。在边界时序下确实存在 reload → 提交 → 写盘 → watch 判定为外部 → 再 reload 的**放大循环**（取决于 writeId 匹配是否恰好错过）。

**5. 是否出现状态源不明确？**

是，且非常严重。同一份 AppState 在 Phase 1B 中同时有 5 个"副本"：Desktop renderer store、Desktop main `currentEnvelopeText`、磁盘文件、Tablet renderer store、Tablet `lastSubmittedData`。**没有任何一层是权威**：renderer 认为 store 权威、main 认为 currentEnvelopeText 权威、HTTP 通道认为磁盘权威。revision 计数在 IPC/HTTP 两处独立分配，`entityVersions` 表只存在服务器侧且从未被客户端读取校正。

**6. 是否出现双重 persist？**

没有字面意义的"两个 persist 中间件"，但有**双重序列化路径**：renderer 的 persist 把 state 包装成 `{state, version}` 后交给 sync-adapter；sync-adapter 又把它作为 `submit.data` 交给服务器；服务器把它包进 envelope（`envelope.data = {state, version}`）再落盘。客户端 GET 解包出 `envelope.data` 后**返回的是 `{state, version}` 而不是 `{state: {…}}` 期望的裸数据**……实际上是**三层嵌套结构不一致**（见问题 1 详述），导致 hydration 语义在 desktop/tablet/旧数据之间不一致。

**7. 是否出现 reload / write / watch 循环？**

存在理论循环路径（见问题 4），且更实际的问题是：**reload 本身会触发一次 hydration 提交**。persist hydrate 完成后如果有 migrate 标记会 setItem；即使没有，用户 reload 后第一次任何操作都会提交 → 写盘 → watch → 若该写盘与外部写入交错则进入判别窗口。Phase 1B 的测试 `sync-watch.test.cjs` 只测了 `classifyWatchEvent` 纯函数（输入 fileText+lastWrittenWriteId 输出分类），**没有测真实的事件到达时序**（fs.watch 是异步批量通知，Windows 上 rename 事件可能合并/延迟）。

**8. 是否存在"同一数据被多个层同时拥有"的问题？**

**是，这是根因**。数据所有权分散在：
- Desktop renderer zustand store（用户可见状态）
- Desktop main 内存 envelope（IPC 通道的"服务器状态"）
- 磁盘文件（HTTP 通道的"服务器状态"，也是唯一物理共享点）
- Tablet renderer zustand store

任何两端同时操作，必然有两层以上在改同一份数据的不同副本，而协调机制（revision/writeId/flush 协议）本身又引入更多状态。**修复的方向不应该是加更多协调状态，而应该是减少状态持有者。**

### 6.2 从 diff 中确认的具体实现缺陷

**问题 1（最致命）：存储格式分裂 —— 测试与生产行为不一致**

- `applySubmit`（sync-merge.cjs）把客户端提交的 `submit.data` **原样**存入 `envelope.data`。
- 真实链路中 `submit.data` 来自 zustand persist 的 `storage.setItem(name, JSON.stringify({state, version}))` → `buildSubmit(String(value))` → `parseData` → `data = {state, version}`。
- 因此 `envelope.data = {state, version}`，客户端 GET 解包后 persist 能解析（version 匹配）；**但**：
  - `SyncCore.diffEntities(lastSubmittedData, data)` 的 `collectEntities({state, version})` 遍历 `state[field]` → `{state, version}` 没有 `tasks/notes/...` 顶层字段 → **changedIds/deletedIds 恒为空数组** → 实体级 merge 永远不触发，stale 时要么整份替换要么 409。
- 而测试 `sync-adapter.test.ts` 直接 `setItem(SYNC_KEY, JSON.stringify({tasks:[...]}))`（**裸 state**）→ collectEntities 正常工作 → 测试全绿。
- **结论：Phase 1B 的"实体级自动合并"在真实运行时是死代码。** 测试通过恰恰掩盖了这一点。

**问题 2：IPC 与 HTTP 双通道 revision 计数分裂（§5 场景 5）**

- `main.cjs`：`sync-storage-set` 基于内存 `currentEnvelopeText` 调 `applySubmit`；成功后 `currentEnvelopeText = JSON.stringify(result.envelope)`，且 `setPending`（300ms 才落盘）。
- `lan-server.cjs`：PUT 每次 `storage.read()` 从**磁盘**取 `currentText` 调 `applySubmit`；成功后**立即** `storage.write`。
- 两通道各自分配 `revision+1`，互相不知道对方的未落盘状态 → 双端并发时 revision 可碰撞（都是 N），内容不同 → **一致性机制在碰撞时无法检测**。

**问题 3：hydration 提交污染（reload 后可能意外写盘）**

- sync-adapter `remoteGet`（electron 分支）：`res.found` 时 `knownRevision = res.revision`，返回 `res.data`。旧数据（phase-1a 无 envelope 的文件）经 `readEnvelopeFor` → `unwrapEnvelope` 旧格式分支 → `data = 整个旧 JSON（含 .state/.version）` → persist 能解析（version=0）→ OK。
- 但 **`unwrapEnvelope` 的 envelope 分支返回 `env.data`（即 `{state, version}`）给 persist**，persist 的 hydrate 逻辑 `deserializedStorageValue.state` → 取到的是**包装对象里的 state** ✓…… 等等，`{state: {...}, version: 0}` 的 `.state` 存在 → `return [false, deserializedStorageValue.state]` → merge 拿到真正 state ✓。
- 反观测试 mock：`syncStorageGet: async () => ({found:true, data: JSON.stringify({tasks:[...]})})`（裸 state）→ persist parse → 无 `.state` → **merge(undefined)** → 空。**测试里桌面端 hydration 就是空的**，测试没有断言数据上屏，只断言了 revision 与 submit 构造，因此漏掉了这个格式问题。
- 生产路径中 hydration 能工作，但**格式在两个分支（旧文件/新 envelope）下语义不同**，且 `diffEntities` 的基准 `lastSubmittedData` 与 persist 存储格式不一致（见问题 1）——整个系统在"裸 state"与"{state,version}"两种心智模型之间摇摆。

**问题 4：fs.watch + writeId 只能识别"最后一次写"**

- `dcbcc63` 的 `classifyWatchEvent` 读**当前文件**的 writeId 与 `lastWrittenWriteId` 比较。文件是覆盖写，**最终状态的 writeId 只反映最后一次写**：
  - 外部写入 W2 之后桌面又 flush 写 W3（自写）→ watch 后读文件 = W3 → 判定"自写"跳过 → W2 的外部修改**从未被处理**，且 W3 是桌面基于旧内存状态构造的 → W2 内容被覆盖丢失。
- 800ms 时间窗口被移除，但**新的启发式同样存在盲区**，只是从"时间"换成了"最后一个 writeId"。

**问题 5：桌面端提交无节流 → IPC 风暴 + 队列堆积**

- `sync-adapter.js`：`syncSet → isElectron ? remoteSet(value) : remoteSetThrottled(value)`。**桌面端每次 setState 立即入队一个 IPC 提交**（含全量 diff + 全量 data），浏览器端才有 500ms 节流。
- 番茄钟运行时每秒 `setPomodoro` → 每秒一次全量提交；用户打字时每个字符一次。串行队列 `submitChain` 在编辑会话中可能堆积大量全量提交，`__gradSyncFlush` 要等全部排空，可能超过主进程 3s 超时。

**问题 6：diff 基准漂移**

- `buildSubmit` 每次调用都更新 `lastSubmittedData = data`，**无论提交是否成功**。409/网络失败后，`lastSubmittedData` 已经推进到"服务器没有的状态" → 后续 diff 的基准错误 → changedIds 与服务器实际状态脱节。

---

## 7. 为什么之前的修复会越来越复杂（结构性解释）

1. **在"整份覆盖"之上叠加"冲突检测"**，而不是替换"整份覆盖"：whole-state PUT 仍然是传输单位，revision/entityVersions 只是检测工具。检测到冲突后**没有自动解决路径**（409 → toast → 手动 reload），用户体验反而变差。
2. **每个新状态都需要新的协调状态**：revision 需要 knownRevision；writeId 需要 lastWrittenWriteId；flush 需要 rendererFlushResolve + submitChain + ACK；防 reload 循环需要 lastReloadHash + self-write 判断。状态数从 4 个涨到 11 个。
3. **测试与生产的心智模型分裂**：测试用裸 state，生产传 {state,version}；测试测纯函数（applySubmit/classifyWatchEvent），不测真实时序（fs.watch 事件合并、IPC/HTTP 交错、reload 打断）。"86 个测试全绿"给团队虚假的安全感，每个测试其实都在验证一个与生产不完全一致的世界。
4. **没有处理"谁先写、谁后写"的基本序关系**：两通道无共享锁、无串行化、无单调时钟。revision 只在单通道内单调，跨通道失效。
5. **修复目标漂移**：从"修复数据丢失"漂移到"修复上一轮引入的回归"（dcbcc63 修 cc4504e 的循环，195f10d 补 cc4504e 的测试，5e550d3 只是改文档）——典型的复杂度螺旋。

---

## 8. A/B/C 三种同步架构比较

### 方案 A：Whole-state JSON + revision + merge（即 Phase 1B 路线）

| 维度 | 评价 |
|---|---|
| 正确性 | 依赖"所有写入都带正确 revision 且 diff 准确"。真实链路 diff 基准/格式已证明不可靠；跨通道 revision 分裂是硬伤。正确性难以论证。 |
| 实现复杂度 | 高。需要 envelope、revision、deviceId、writeId、entityVersions、串行队列、冲突协议、迁移兼容——Phase 1B 已演示 1304 行仍不可靠。 |
| 用户体验 | 冲突时 409 + toast + 手动 reload，输入丢失感知明显；reload 频繁打断。 |
| 数据安全 | 有检测能力但**检测到冲突后无自动保全**（不合并、不保留本机），且跨通道碰撞无法检测。 |
| 性能 | 每次提交整份序列化 + 全量传输 + 全量 diff（JSON.stringify 所有实体比较），番茄钟场景每秒一次全量。 |
| 与当前代码兼容性 | 需改存储格式（envelope）、sync-adapter、main、lan-server、persist——全部核心层。 |
| 未来扩展性 | 多设备/云同步时方向正确，但对单用户双端是过度设计。 |

**结论：A 路线的本质问题不是"做得不够"，而是"整份 state 作为传输/合并单位"这一前提就是错的**——单用户场景不需要在 state 层面解决并发。

### 方案 B：Main Process authoritative state + mutation API

核心：**主进程是唯一权威**（内存 state + 原子落盘文件）。所有变更以**实体级 mutation** 表达，而不是整份 state 覆盖。

| 维度 | 评价 |
|---|---|
| 正确性 | 单一权威 → 无"多副本同步"问题。mutation 串行应用（单线程主进程天然串行）。IPC 与 HTTP 共用同一 applyMutation，**无通道分裂**。 |
| 实现复杂度 | 低。无 revision/deviceId/envelope/merge。mutation 幂等（upsert/delete by id）。 |
| 用户体验 | 无整页 reload：外部 mutation 到来时主进程推送最新实体给 renderer，renderer 就地 setState（保留输入焦点/滚动）。冲突策略：同实体 last-writer-wins（以 mutation 到达序），单用户场景可接受；可选按 updatedAt 比较。 |
| 数据安全 | 丢失窗口 = mutation 队列未 flush（300ms 内退出）。文件仍原子写 + 备份兜底。无静默整份覆盖。 |
| 性能 | 传输量 = 变更实体，远小于整份 state；序列化只发生一次（主进程落盘）。 |
| 与当前代码兼容性 | renderer 侧 persist 保留（本地 hydration/回退），只把"写路径"改为 mutation 提交；存储文件格式不变（AppState JSON）——**不需要 envelope**。 |
| 未来扩展性 | 实体级 mutation 天然可扩展到云同步/增量同步；冲突策略可逐步增强（先 LWW，后 per-entity 版本）。 |

### 方案 C：Hybrid（B 为主，保留 revision 做冲突检测，不做合并）

即 B 的 mutation API + 轻量 per-entity 时间戳（`updatedAt` 已存在），冲突时按时间戳 LWW，并记录"被覆盖"事件到日志/备份。

| 维度 | 评价 |
|---|---|
| 正确性 | 介于 A/B 之间。有检测能力（记录覆盖事件），无自动合并负担。 |
| 实现复杂度 | 中。mutation 为主，时间戳比较为辅。 |
| 用户体验 | 同 B（无 reload、保留输入），冲突极少发生（单用户），发生时静默 LWW + 可审计。 |
| 数据安全 | 比 B 多一层"覆盖可追溯"；比 A 可靠（无格式分裂、无跨通道问题）。 |
| 性能 | 同 B。 |
| 兼容性 | 同 B。 |
| 扩展性 | 同 B，且为未来升级预留了检测点。 |

### 比较小结

| | A (Phase 1B) | B (mutation) | C (B+时间戳) |
|---|---|---|---|
| 正确性 | ✗（已证明失效） | ✓ | ✓ |
| 复杂度 | 高 | 低 | 中 |
| UX | 差（reload/冲突 toast） | 好 | 好 |
| 数据安全 | ✗（静默丢失/碰撞） | ✓（丢失窗口 300ms） | ✓（+可审计） |
| 性能 | 差（整份） | 好（实体级） | 好 |
| 兼容性 | 破坏存储格式 | 保留格式 | 保留格式 |
| 扩展性 | 中 | 高 | 高 |

---

## 9. 推荐架构

**推荐方案 C（本质是 B + 轻量冲突审计），并明确排除 CRDT 与 envelope。**

理由：
1. **消除"多副本同步"这一病根**：主进程为唯一权威，renderer 与 tablet 都是"客户端"，只有 mutation 通道，没有第二份"权威 state 副本"。
2. **消除整份覆盖**：传输单位从"整个 AppState"降为"实体级操作"，覆盖窗口从"整份文件"缩小到"单实体"。
3. **保留 persist 格式与数据文件格式**（Phase 0 兼容性不变量），不需要 envelope/version 迁移。
4. **单用户场景并发冲突是稀有事件**：不做 merge（不引入 CRDT/版本向量），用实体 `updatedAt` 比较做 last-writer-wins，并把覆盖写入审计日志 + 自动备份，做到"已保存数据不静默丢失"（即使被覆盖也有日志与备份可找回）。
5. **未来扩展路径清晰**：mutation 日志天然可重放（云同步/WebDAV），无需重写。

### 设计原则

- **单一权威**：主进程内存 + 文件 = 唯一 state；renderer 不拥有"需要同步"的状态所有权（store 只是主进程 state 的投影）。
- **写路径统一**：IPC `syncApplyMutations` 与 HTTP `POST /api/mutations` 调用**同一个同步函数**，在**同一次事件循环内串行执行**（Node 单线程，无并发交错）。
- **读路径统一**：renderer 通过"状态推送"（主进程 → renderer）或"拉取"（GET 全量）获取最新 state，不再整页 reload。
- **传输最小化**：mutation 只带变更实体；正常编辑时流量 = 单实体，不是整份 JSON。
- **失败可恢复**：mutation 幂等（按 id upsert/delete）；客户端重试队列；网络失败不丢（pendingMutations 持久化）。

---

## 10. 推荐架构的数据流

### 写入（Desktop 修改 Note）

```
NotesView onBlur → updateNote(...) → zustand set（本地立即反映）
  → persist setItem（本地 localStorage 回退缓存，可选）
  → sync-adapter.submitMutation({op:'upsert', type:'note', id, data, ts})
  → IPC syncApplyMutations([mutation])
  → Main: mutationsReducer(state, mutations)   ← 同步、串行、唯一入口
  → state 更新 → 300ms 节流原子落盘 → lastWrittenHash 记录
  → 广播给其他 renderer（BrowserWindow.getAllWindows webContents.send('state-sync', {mutations, stateHash}))
```

### 写入（Tablet 修改 Task）

```
TodoView toggleStatus → zustand set → persist setItem（本地）
  → sync-adapter.submitMutation(...)
  → fetch POST /api/mutations（500ms 节流合并）
  → LAN Server: 同一 mutationsReducer(state, mutations)（同一进程内同一函数）
  → state 更新 → 节流落盘 → 广播 renderer
```

### 读（Tablet 修改 → Desktop 更新）

```
LAN Server apply mutations → state 变化 → lastWrittenHash 变化
  → 主进程主动 webContents.send('state-sync', 变更或全量 state)
  → Desktop renderer onStateSync → useStore.setState(mergePersistedState(...))   ← 就地更新，不 reload
  → 用户输入焦点/滚动/未 blur 草稿全部保留
```

### fs.watch 的新职责（收缩）

fs.watch 唯一职责变为：**检测"本进程以外"对文件的修改**（外部编辑器/手动编辑/旧版本客户端）。实现：主进程每次自写后记录 `lastWrittenHash`，watch 事件到达后比对 hash——**不再需要时间窗口、writeId、deviceId**。hash 相同 = 自写，跳过；不同 = 外部写入，走"文件为权威"恢复流程。

---

## 11. 最小实施步骤（建议顺序）

> 每步可独立提交、独立验证、可回滚。不引入 revision/deviceId/CRDT/envelope。

1. **Step 0（前置，只读）**：在现有基线加"同步审计日志"——主进程记录每次写盘的 hash、来源（ipc/http）、时间、mutation 摘要。用于后续验证与回滚追踪。*（可跳过，但强烈建议）*
2. **Step 1：主进程权威 state 内存化**：main 启动时读文件到内存 `state`，`sync-storage-get` 改读内存；写路径统一走 `applyMutations`。**不改存储格式、不改 sync-adapter 语义**（先让 IPC 通道内部一致）。
3. **Step 2：新增 mutation API（IPC）**：`syncApplyMutations(mutations)` + `mutationsReducer`。renderer 侧新增 `submitMutation` 路径（保留旧的整份 setItem 作为回退/兼容）。
4. **Step 3：LAN PUT 改造为 mutation 提交**：`POST /api/mutations`（保留旧 PUT 兼容一段时间），与 IPC 共用 `mutationsReducer`，消除双通道分裂。
5. **Step 4：reload 替换为状态推送**：`webContents.send('state-sync')` + renderer `setState`，删除 `reloadRenderers`/flush 协议/800ms 窗口/`lastDesktopWrite`。
6. **Step 5：fs.watch 收缩**：改用 hash 比对（见 §10）。
7. **Step 6：renderer persist 降级为纯本地回退**：`grad-planner-storage` 键在桌面端不再走 IPC 写（或改为只写本地），数据权威完全移交主进程。
8. **Step 7：冲突审计**：同实体 mutation 并发时按 `updatedAt` LWW，被覆盖方记录日志 + 触发一次自动备份。
9. **Step 8：清理**：删除 envelope/sync-core/sync-merge/sync-watch（Phase 1B 产物），回归 Phase 0 存储格式。

---

## 12. 所需数据结构变化

**目标：零存储格式变化（Phase 0 格式保持兼容）。**

- 文件格式：保持 `grad-planner-storage.json` = persist 的 `{state, version}`（或解包后的 AppState，二选一，统一即可）。
- 新增（仅内部/内存）：
  - `main.state`（主进程内存权威 AppState）
  - `main.lastWrittenHash`（自写检测）
  - mutation 审计日志（文件或仅日志）
- 不需要：revision、deviceId、writeId、entityVersions、envelope、schemaVersion 变更。
- 可选（Step 7）：实体 `updatedAt` 已在 Note/Task 等部分实体存在；建议为**所有实体**补齐 `updatedAt`（calendar 事件/任务等目前缺），用于 LWW 冲突比较。*这是唯一可能需要的数据模型小改动，且向后兼容（缺失时回退到到达序）。*

---

## 13. API / IPC 变化

### IPC（preload.js / main.cjs）

| 现有 | 变化 |
|---|---|
| `sync-storage-get` | 保留（读主进程内存 state） |
| `sync-storage-set`（整份写） | 废弃或降级为兼容；新增 `sync-apply-mutations(mutations)` |
| `sync-storage-remove` | 保留 |
| （新增）`sync-state-push`（main→renderer 事件） | 外部 mutation 后推送最新 state |
| （新增）`sync-mutations-receipt`（可选） | 提交回执（含新 stateHash） |

### HTTP（lan-server.cjs）

| 现有 | 变化 |
|---|---|
| `GET /api/storage` | 保留（读主进程内存 state） |
| `PUT /api/storage`（整份覆盖） | 保留兼容期；新增 `POST /api/mutations` 为主路径 |
| `DELETE /api/storage` | 保留 |

鉴权/CSRF 校验不变（复用现有 token + originAllowed）。

---

## 14. 测试计划

### 单元测试（Node 原生，纯函数）
- `mutationsReducer`：upsert/delete/数组字段排序稳定、未知类型拒绝、幂等性（同 mutation 重放结果一致）。
- 双通道一致性：同一 reducer 先后被 IPC 与 HTTP 调用，模拟 §5 场景 5 的交错，断言最终 state 一致（不再有 revision 碰撞）。
- fs.watch hash 判别：自写 hash 匹配跳过、外部写入触发、事件合并后仍正确。

### 集成测试（真实时序）
- **Scenario A–F（§4 六场景）**：用真实 fs.watch + 内存文件系统（或 tmp 目录）驱动双"客户端"，断言最终磁盘 state。
- 特别增加：**Desktop 提交与 Tablet PUT 在 300ms 窗口内交错**（当前最危险时序）→ 断言 Tablet mutation 不丢失。
- 测试与生产的格式一致性检查：**用 zustand persist 真实输出（{state,version}）作为 reducer 输入**，禁止再传裸 state mock（防止重蹈 Phase 1B 覆辙）。

### 回归测试
- 现有 78 个 vitest + 64 个 node 测试全量保留，补充 mutation 路径后全量跑。
- 手动冒烟：桌面+平板真机双端，按 §4 六场景各操作一轮，验证无 reload、无丢失。

---

## 15. 回滚方案

- **提交粒度**：Step 1–8 每步独立 commit，commit message 标注 Phase 1B-0 步骤号。
- **回滚策略**：
  - 任意一步失败 → `git revert <commit>` 回退该步（每步不依赖后续步骤，可单独撤销）。
  - 若需要整体放弃 → 回到 `phase-1a-security-complete`（当前基线不变）。
- **数据保护**：实施前自动备份机制已存在（backup-store，14 份）；Step 0 的审计日志确保任何异常写盘可追溯。
- **兼容双通道**：Step 2/3 的"保留旧 PUT/PUT 兼容期"确保旧平板客户端/旧版本在过渡期不产生数据损坏（旧客户端整份覆盖仅在单客户端在线时安全——与现在一致）。

---

## 附：第九步——fs.watch 现在到底承担了什么职责？是否过多？

**当前职责（phase-1a）**：
1. 检测外部写入（Tablet/外部进程）；
2. 用 800ms 时间窗口区分自写/外写（本应只由"检测"承担）；
3. 用 300ms debounce 合并事件；
4. 用 sha256 内容哈希去重；
5. 触发 `flushAndReload`（既是"落盘保护"又是"刷新调度"）。

**职责是否过多？** 是。一个"文件变化通知"被用来承担：来源判别（时间启发式）、去抖、去重、落盘调度、整页刷新调度——其中**来源判别**是它最不该承担的职责（文件系统通知不含写入者身份，任何启发式都有盲区），**刷新调度**是它不该承担的职责（刷新应该由"数据变化"驱动，而不是"文件变化"驱动）。

**phase-1b 的改进**：用 writeId 替代时间窗口——把"来源判别"从时间启发式改为内容启发式，仍不能识别交错写入（§6.2 问题 4）。

**推荐**：fs.watch 收缩为"文件被外部进程修改"的检测器，采用 hash 比对（§10）。来源判别和刷新调度职责移交给"主进程权威 state + mutation 应用 + 主动推送"。

## 附：第十步——Whole-state JSON API 分析

**为什么当前采用整个 state 上传？** 因为 persist middleware 的设计就是"每次 set 序列化整个 partialize(state)"，而 sync-adapter 只是把 localStorage 的键重定向到网络——**整份上传是 persist 架构的副作用，不是设计选择**。改动最小。

**Whole-state overwrite 的根本问题**：
1. **传输单位 = 一致性单位**：整份覆盖意味着"我的快照中不包含的对方修改"全部被覆盖；
2. **无因果序信息**：整份覆盖无法表达"我只改了 Task A"；
3. **冲突检测只能后验**（比较后再决定），无法预防；
4. **与节流叠加放大丢失窗口**：500ms/300ms 节流期间，快照是"陈旧快照"，覆盖更危险。

**为什么导致双端冲突**：两端各自的快照是"各自视角"，整份覆盖是"我的视角覆盖你的视角"。只要两端同时在线操作，冲突是必然事件而不是异常事件。

**对当前个人双端应用，是否值得保留？** **不值得作为主路径**。保留兼容端点（PUT 整份）用于"单端离线迁移/导入"场景即可，日常同步必须走 mutation。

## 附：第十二步——是否需要 CRDT？

**明确回答：不需要。**

- 场景：单用户、双端（Desktop + Tablet/Phone）、局域网、操作频率低（编辑事件/任务/笔记，非实时协作）。
- CRDT 解决的是"多副本无协调并发编辑 + 最终一致"的问题，需要为每个实体维护版本向量/操作日志，序列化格式复杂，测试与心智负担高。
- 本项目的冲突窗口本质是"整份覆盖"造成的（架构问题），换成 mutation + 单一权威后，剩余冲突只有"双端几乎同时改同一实体"——单用户场景概率极低，用 `updatedAt` LWW + 审计 + 备份即可，无需 CRDT。
- 若未来做云同步/多人协作，再评估 CRDT 或 OT——届时数据模型已经支持实体级操作，迁移成本可控。

## 附：第十三步——同步不变量

用户定义的 7 条全部采纳，补充 3 条：

1. 已保存的数据不能静默丢失。
2. 旧状态不能静默覆盖新状态。
3. 自己的写入不会形成无限同步循环。
4. 不同实体的并发修改尽可能互不影响。
5. 真正冲突必须被检测。
6. Phase 0 数据格式必须保持兼容。
7. 同步失败不能让客户端进入不可恢复状态。
8. **（补充）任意覆盖必须可追溯**：被覆盖的写入有审计日志或备份可找回。
9. **（补充）mutation 必须幂等**：重试/重放不产生重复或损坏。
10. **（补充）客户端必须能在无主进程/无网络时独立可用**：persist 本地回退作为离线兜底。

---

## 结论（一句话）

> **当前同步不可靠的根因是"整份 state 作为传输与一致性单位 + 状态被四层同时拥有、无单一权威"；Phase 1B 试图用 revision/merge 修补这个错误前提，反而因存储格式分裂与双通道状态分裂引入了新的、更隐蔽的丢失路径。下一轮（Phase 1B）应改为：主进程单一权威 + 实体级 mutation API + 状态推送替代整页 reload + fs.watch 收缩为 hash 来源判别——不引入 CRDT，不引入 envelope。**

# V1 独立审计报告（Independent Audit）

> 审计对象：grad-planner（研途计划）`v1.0.0`
> 审计基线：commit `1cff4e3`（tag `v1.0.0`，origin/main），工作区 clean，detached HEAD。
> 审计方式：只读代码审计 + 真实运行测试/构建/lint。未修改任何产品代码。
> 审计人视角：独立第三方（不采信仓库内既有审计文档结论，逐条以代码为准）。

---

# 1. Executive Summary

**结论先行：V1 的工程底子相当扎实，但存在一个真实的数据丢失缺陷（P1，建议发布前修复），以及若干中等/低等级问题。整体评价：值得发布，但不能原样发布。**

真实运行基线（非文档数字，本机实测）：

| 命令 | 结果 |
|---|---|
| `git describe --tags --always` | `v1.0.0`（`1cff4e3`） |
| `npm test`（vitest） | **17 文件 / 251 tests PASS** ✅ |
| `npm run build`（tsc && vite build） | **PASS**（仅 main chunk 1005 KB 体积警告）✅ |
| `npm run lint` | **0 errors / 1 warning**（NewsView `useCallback` 缺依赖）✅ |
| `node --test`（裸命令） | **156 pass / 10 fail**（9 个 `.ts` 文件因 Node 内置 runner 无法解析无扩展名导入失败 + 1 个 `test-setup.ts` 因 `expect` 未定义失败；均为工具链不兼容，非产品缺陷，与仓库声明一致）|

值得肯定的部分（已核实为真，不是"文档声称"）：

- **同步/权威写路径设计正确**：Main Process 是唯一 mutation authority，IPC 与 LAN 共用同一 `mutationEngine` 实例，串行原子应用；`baseVersion` 冲突检测、跨实体删除解引用、batch 原子性、`onPersisted` 成功后才广播，均有真实测试覆盖。
- **数据安全链路完整**：原子写（tmp + rename）、备份前置、导入/恢复前 Schema 校验 + 自动备份、里程碑自愈、`{ state, version }` 格式兼容。
- **Electron 安全基线到位**：`sandbox:true` + `contextIsolation:true` + `nodeIntegration:false`、CSP、窄 preload、SSRF 基础校验（含 DNS 解析到私网拒绝）、LAN token + Origin/CSRF、X 密钥 safeStorage 加密、剪贴板权限边界。
- **V1 polish 的 5 个历史 P1/P2 确已修复**：Today/Todo 快速添加时间不再丢失（统一走 `taskDueOf`）、Quick Capture 保存前预览、Today 增加快速记录入口、日历任务 chip 可操作、番茄钟任务绑定 + 跨午夜归属修正——均已在代码中确认。

最需要警惕的问题（详见后文）：

1. **P1 · 数据丢失**：平板端 mutation 提交遇到瞬时网络错误时，`sync-adapter.js` 会把失败的 diff 当作"已同步"推进基准（`baseState = lastDiffState`），该修改被**永久丢弃且永不重试**；同时 toast 文案声称"将在下次操作时重新尝试"——**与真实行为相反**。一旦桌面端随后发生任何修改，平板轮询到权威变化并整份覆盖本地，用户的这条编辑即被静默抹掉。
2. **P2 · 导入/恢复只做浅层校验**：`validateStorageShape` 只校验顶层字段是数组，不校验实体内部结构，畸形实体可穿透校验并在渲染层引发异常。
3. **LIKELY · SSRF TOCTOU**：URL 校验与真实请求使用两次独立 DNS 解析，DNS rebinding 存在理论绕过窗口。
4. **P2 · 平板功能断链**：News / Translation / 备份恢复 / X 凭据在平板（Web）模式不可用（有降级提示），但 README 宣称平板"完整功能"，与事实不符。

---

# 2. Confirmed Issues

## C1 · 瞬时网络失败 → 修改被丢弃 + toast 谎报"将重试"（P1，数据丢失）

- **证据（调用链）**：
  - `public/sync-adapter.js` L121-122：`handle` 回调在判断 `res.ok` **之前**无条件执行 `if (lastDiffState) baseState = lastDiffState`。即提交失败时，把"失败的那份本地 state"推进为 diff 基准。
  - `public/sync-adapter.js` L175-177：下次 `enqueueFromPersist` 用新 `baseState` 重算 diff → 已失败的修改不再出现在 diff 中 → **不重试**。
  - `src/App.tsx` L113-114：`network_error` 分支 toast 文案为"网络不可用，本次修改未同步（将在下次操作时重新尝试）"——代码中**不存在任何重试机制**。
  - `src/lib/mutations.ts` L45-55 `mergeAuthoritativeState`：`{ ...current, ...p }`，权威 state 的实体数组（tasks/notes/events…）**整份覆盖**本地。
  - `public/sync-adapter.js` L244-265 `pollAuthority`：平板每 5s 轮询，权威内容变化时派发 `state-sync-external` → `applyAuthoritativeState` 覆盖本地。
- **触发条件**：平板端编辑任务 → 提交 mutation 时网络瞬时失败（WiFi 抖动）→ 桌面端随后做任意修改 → 平板轮询到权威变化 → 整份覆盖。
- **实际结果**：用户的编辑被永久丢弃，且用户被告知"会重试"（误导）。
- **期望结果**：失败应保留待同步状态并重试，或明确提示"未同步/已保留为本地草稿"，且不得让权威覆盖本地未同步变更。
- **可否复现**：可。代码路径确定；用 mock `fetch` 让首次提交 reject、后续轮询返回权威内容即可复现。当前测试**未覆盖此路径**（见 §10）。
- **用户影响**：高。核心卖点"多端同步"下发生静默数据丢失。
- **修复建议**：`submit` 失败时**不要**推进 `baseState`（或仅对 `conflict`/`validation` 等"已明确拒绝"的错误推进，对 `network_error` 保留 pending 并退避重试）；同时修正 toast 文案；为"本地未同步变更"增加可感知状态。
- **修复成本**：S-M（改 `sync-adapter.js` + 补测试）。

## C2 · 关于页版本号仍为 v0.2.0（P3）

- **证据**：`src/views/SettingsView.tsx` L496：`研途计划 v0.2.0`；而 `package.json` 已是 `"version": "1.0.0"`。
- **触发条件**：打开设置页。
- **实际结果**：正式 V1.0.0 的界面显示过时版本号。
- **用户影响**：低（可信度/一致性）。
- **修复建议**：改为从 `package.json` 或常量读取 `1.0.0`。
- **修复成本**：S（一行）。

## C3 · 平板端 News / Translation / 备份恢复 / X 凭据不可用，但 README 宣称"完整功能"（P2，功能断链）

- **证据**：
  - `src/views/NewsView.tsx` L101-102：无 `electronAPI` 时仅显示"资讯功能需要桌面版运行"。
  - `src/views/TranslateView.tsx` L42：无 `electronAPI` 时仅显示"翻译功能需要桌面版运行"。
  - `electron/lan-server.cjs` 只提供静态资源 + `/api/storage` + `/api/mutations`，**没有** news/translate/article 代理端点。
  - `README.md` L166："平板/手机…即可使用完整功能并与桌面端共享同一份数据"。
- **触发条件**：平板浏览器打开 LAN 地址 → 点"资讯"/"翻译"/设置页的备份/X。
- **实际结果**：这些功能在平板上是死路（有降级提示，不会崩，但不可用）。
- **期望结果**：要么 README 如实写"数据查看/编辑功能，不含资讯/翻译"，要么平板端隐藏/置灰这些入口。
- **用户影响**：中。"完整功能"预期落空；导航里出现两个点了只能看到"需要桌面版"的入口。
- **修复建议**：平板模式（`!electronAPI`）隐藏 News/Translate 导航与设置相关卡片，或提供 LAN 代理端点（V2）；修正 README。
- **修复成本**：S（前端条件渲染 + 文案）或 M（实现 LAN 代理）。

## C4 · 导入/恢复仅做顶层浅层校验，畸形实体可穿透（P2，数据完整性）

- **证据**：`src/data/validate.ts` / `electron/storage-schema.cjs` 的 `validateStorageShape` 只校验"根是对象 + 顶层数组字段是数组 + paperStages 元素是字符串"，**不校验实体内部字段**（如 task 的 `id/title` 是否字符串、`subtasks` 是否数组）。而 `electron/mutation-engine.cjs` 有每实体 `makeValidator`，但导入/恢复路径（`SettingsView.importData/restoreBackup → applyData → mergePersistedState`）**不经过** mutation engine 的实体校验。
- **触发条件**：导入一个手改过/损坏的备份，如 `{ tasks: [42, null, {id: 1, title: 2}] }`。
- **实际结果（LIKELY）**：校验通过，进入 state；渲染层对 `t.title.slice()`、`t.id` 等访问可能抛错或产生 `id=undefined` 的脏数据；后续同步时 mutation engine 会拒绝（validation_failure），但渲染层本地状态已被污染。
- **期望结果**：导入前做与 mutation engine 同级的实体结构校验，拒绝畸形实体。
- **用户影响**：中（需损坏/手改的备份文件触发；官方导出不会产生畸形数据）。
- **修复建议**：复用/对齐 mutation engine 的实体校验，在导入与恢复前对每个实体逐条校验。
- **修复成本**：M（把 engine 校验抽成共享 CJS，或在前端复制一份并锁一致性测试）。

---

# 3. Likely Issues

## L1 · SSRF 校验与真实请求是两次独立 DNS 解析（TOCTOU / DNS rebinding 窗口）（P2）

- **证据**：
  - `electron/url-security.cjs` `validateExternalUrl` 用 `dns.lookup` 解析一次并校验所有结果非私网。
  - `electron/news.cjs` `fetchUrl` 的直连分支 `attemptDirect` 用 `mod.get(url, …)` 让 Node **再次解析**并连接；`proxiedRequest` 则把 hostname 交给代理 CONNECT（代理侧再解析）。
  - 两条路径的"校验解析"与"连接解析"是两次独立解析，存在 rebinding 时差窗口。
- **触发条件**：恶意 RSS 源（`fetchArticle` 的 `it.link` 来自外部 feed，渲染层可控）返回一个可 rebinding 的域名，第一次解析到公网、第二次解析到私网/环回。
- **实际结果（LIKELY）**：SSRF 到内网/本机端口。
- **缓解因素**：RSS 源 URL 硬编码；`fetchArticle` 需要用户点击某条资讯卡片才会触发；OS DNS 缓存降低 rebinding 成功率；2MB 响应上限 + 超时限制影响。
- **用户影响**：中低（本地单用户应用，需恶意 feed + 成功 rebinding）。
- **修复建议**：连接时复用校验阶段解析出的 IP（固定 IP 直连并校验证书 hostname），或对每次重定向/连接前重新校验并对比。
- **修复成本**：M。

## L2 · 删除/解引用不 bump 版本 → 并发陈旧写入未被判为 conflict（POSSIBLE→LIKELY 边界，P2）

- **证据**：`electron/mutation-engine.cjs` 跨实体删除（`project.delete` 解引用 tasks/milestones 的 `projectId`、`paper.delete` 移除 notes/projects 的关系数组）用 `{ ...e, projectId: undefined }` / 过滤数组，**不递增被解引用实体的 `version`**。
- **触发条件**：Desktop 删除 Project；同时 Tablet 基于旧快照对某个关联 Task 做 `task.update`（baseVersion 与权威一致）→ 不会被判 conflict，而是被应用（`enforceRefIntegrity` 会再清掉悬挂 projectId）。
- **实际结果**：权威侧悬挂引用会被 `enforceRefIntegrity` 自愈，不会留下悬挂引用；但该陈旧 update 的**其他字段**会覆盖权威的新值（未被识别为冲突）。
- **用户影响**：低（窄窗口 + 引用自愈）。
- **修复建议**：解引用时对被解引用实体 `version+1`，使其陈旧写入进入 conflict 流程。
- **修复成本**：M。

---

# 4. Possible Risks

| # | 风险 | 证据 | 说明 |
|---|---|---|---|
| P1 | 生产模式 `will-navigate` 守卫允许任意 `file://` URL | `electron/main.cjs` L35：`isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file://')` | 比"自身 dist 目录"更宽；`App.tsx` 点击拦截只拦 http(s)，`file://` 链接可触发窗口内导航到任意本地文件（nodeIntegration 已关，仍属纵深防御缺口）。P3。 |
| P2 | `translate-paste` IPC 不校验 sender | `electron/main.cjs` L127-133 | 任意 renderer（主窗若被 XSS）可触发主进程读剪贴板并推送到翻译窗；不能直接回传，但构成隐私边界弱化。`read-clipboard`（handle）有 sender 校验，此 `on` 通道没有。P3。 |
| P3 | 平板初次 hydration 无超时 | `public/sync-adapter.js` `remoteGet`（`fetch(STORAGE_PATH)` 无 AbortController/超时）→ `App.tsx` L199 在 `hydrated` 前无限"加载中…" | 平板打开已失效的 LAN 地址/服务未启动时，可能长时间卡加载页。P3。 |
| P4 | `uid()` 用 `Math.random` | `src/store.ts` L303 | 仓库已披露（P3）；碰撞概率极低但存在。P3。 |
| P5 | 退出前 mutation 未落盘的窄窗口 | `public/sync-adapter.js` 依赖 `pagehide/beforeunload` flush；`electron/main.cjs` `will-quit` 只 flush 旧 `syncManager`（legacy 路径），不 flush mutation 通道 | 正常关闭大概率经 beforeunload 送达；硬崩溃 + 300ms debounce 窗口内的编辑可能丢失（与任何 debounce 写入同风险）。P2，待真实 Electron 验证。 |

---

# 5. Security Findings

**已到位且经测试证实的正向项**：`sandbox/contextIsolation/nodeIntegration` 三开关、CSP（`script-src 'self'`、`object-src 'none'`、无 `unsafe-eval`）、窄 preload、`read-clipboard` sender 边界、X 密钥 safeStorage + 仅返回 `configured` 布尔、SSRF 基础校验（协议/IPv4/IPv6/环回/私网/DNS 解析到私网拒绝）、LAN token 鉴权（query/Authorization）+ Origin/CSRF（evil Origin → 403）+ 访问日志去 query 防令牌泄漏、超大 body 413、路径穿越拒绝、`shell.openExternal` 协议白名单。

**发现的问题**：

1. **SSRF TOCTOU（LIKELY，P2）** — 见 L1。既有 `url-security.test.cjs` 的"域名解析到私网 REJECT"只覆盖"单次解析命中私网"，**未覆盖两次解析结果不同的 rebinding 场景**（测试假信心）。
2. **`file://` 导航过宽（POSSIBLE，P3）** — 见 P1。建议生产模式限定到 `dist` 目录的 `file://` 前缀。
3. **`translate-paste` 无 sender 校验（POSSIBLE，P3）** — 见 P2。
4. 其余未发现高危：无 renderer 直连网络（News/翻译走主进程）、CSP 无 `unsafe-eval`、LAN API 均有 token + Origin 双层、无明文密钥落盘。

---

# 6. Data Integrity Findings

- **C1（P1）网络失败丢修改 + 假重试** — 见 §2。这是本次审计最重要的数据完整性问题。
- **C4（P2）导入/恢复浅层校验** — 见 §2。
- **L2（P2）解引用不 bump 版本** — 见 §3。
- **正向确认**：原子写（`tmp + rename`）、备份前置、恢复/导入前校验、里程碑去重自愈、`create` 幂等、`delete` 幂等、batch 原子性、`onPersisted` 成功后才广播（不传播"未来状态"）、权威文件损坏时不把垃圾当权威（`internal_error`）。这些链路测试覆盖良好。

---

# 7. Sync Findings

- **架构判断（回答"单用户 + Desktop + Tablet + LAN 是否够可靠"）**：**方向正确，但平板端的失败路径不可靠**。
  - 场景 1（Desktop 改 Task → Tablet）：✅ 经 mutation → `onPersisted` → `broadcastStateSync` → 平板轮询（5s）最终一致。
  - 场景 2（Tablet 改 Task → Desktop）：✅ 正常路径经 `POST /api/mutations` → 同一 engine → 落盘 → `fs.watch` 判外部 → 广播；有测试覆盖。
  - 场景 3（Desktop 改 Task + Tablet 改 Note）：✅ 不同实体并发互不覆盖（有测试）。
  - 场景 4（双端改同一实体）：✅ `baseVersion` 冲突检测 → 拒绝 + 保留本地草稿 + 用户选择（非 LWW，符合 V1 声明）。
  - 场景 5（debounce/persist/fs.watch/renderer 窗口）：⚠️ 见 C1——**网络失败窗口会产生 lost update**。
  - 场景 6（网络异常/失联）：⚠️ 平板离线时 mutation 提交失败 → C1 的丢修改路径（localStorage 仅兜底缓存，不重试）。
- **`fs.watch` 分类**：用内容 sha256 而非时间窗口区分 self-write/external，正确。
- **平板轮询 5s**：非实时，V1 已声明（非 WebSocket），可接受。

---

# 8. UX Findings

| # | 问题 | 严重度 | 说明 |
|---|---|---|---|
| U1 | About 版本号 v0.2.0 | P3 | 见 C2。 |
| U2 | 恢复备份后强制跳日历，而非默认入口 Today | P3 | `SettingsView.tsx` L230 `setView('calendar')`；仓库已披露（Phase 3 §16-8），仍存在。 |
| U3 | 平板"完整功能"预期落空 | P2 | 见 C3。 |
| U4 | 信息性提示 `alert()` 与 `toast()` 混用 | P3 | 文献导入/同步、资讯正文失败用阻塞 `alert`；仓库已披露。 |
| U5 | 平板初次加载无超时 | P3 | 见 P3。 |
| U6 | 裸"下周/下个礼拜"（无星期 X、无"后"）不被解析为日期 | P3 | `natural.ts` 只认 `下(个)?周后`（需"后"）与 `下周X`（需星期）；"下周交报告"会保留在标题、不设日期。 |
| U7 | `hasDateHint` 用"日"字判断，中文常见词（日本/节日/生日）会误触发"未能识别日期"警告 | P3 | `natural.ts` L262。 |

---

# 9. Performance Findings

1. **番茄钟运行期间每秒触发一次全量持久化（P2）**：`usePomodoroTicker` 每秒 `setPomodoro({remaining})` → zustand persist `setItem` → `sync-adapter.enqueueFromPersist` 每秒做 `JSON.parse(全量)` + 全实体 `diffMutations` + `nativeSet` 全量写 localStorage。diff 结果为空（`pomo` 不在 ENTITY_FIELDS），但**全量 parse/diff/写盘照跑**。数据量到几千条时在平板/弱设备上可感知卡顿与耗电。
   - 建议：把 `pomo.remaining/swSec` 从 persist 排除（运行时状态不入库），或给 persist 加粗粒度节流。
2. **main chunk 1005 KB**（vite 体积警告）：已披露；桌面加载可接受，但平板 LAN 每次刷新要下载 ~1MB JS。P3。
3. **JSON 单文件规模上限**（~1000 流畅 / 5000 可感知 / 10000 不可用）：仓库已披露；个人双端规模无碍。P3。
4. 正向确认：News 有 30 分钟 TTL 缓存 + 后台刷新，无重复请求；Today/Calendar 用 `useMemo`；未发现重复 fetch/无意义整页刷新。

---

# 10. Test Coverage Findings

**Good coverage（真实覆盖生产行为）**：
- `electron/*.test.cjs`（node --test 156 pass）：mutation engine 全实体、batch 原子性、版本冲突、跨实体解引用、lan-server HTTP/token/CSRF/路径穿越/413/并发 PUT、url-security SSRF、backup-store 原子性、credentials-store、CSP、state-sync 分类、sync-manager 时序——均为真实 CJS 模块，质量高。
- vitest 251 tests：`natural.ts` 68 条（日期解析）、`mutations.test.ts` 用**真实 `{state, version}` payload** 验证 diff/提交契约、Today/Calendar/News/Notes/Todo 组件级测试。

**Missing coverage（缺失且重要）**：
1. **`sync-adapter.js` 的失败路径完全未测**：`submit` 失败时 `baseState = lastDiffState`（C1 根因）、"不重试"、网络失败后权威覆盖本地，均无测试。这是 251 个测试全绿下漏掉的最重要的生产缺陷。
2. **无真实 Electron 集成测试**：`security-boundary.test.cjs` 对 BrowserWindow/导航/CSP 是静态断言（读代码/读产物），未启动真实窗口验证 `will-navigate`、`setWindowOpenHandler`、preload 注入的运行时行为。
3. **日期测试缺乏跨时区覆盖**：`today.test.ts`/`natural.test.ts` 在本地时区跑，未用 `TZ=...` 跑 UTC-8/UTC+14 等边界（凌晨归属修复虽已做，但回归仅覆盖本地时区）。
4. **`sync-adapter.js` IIFE（浏览器脚本）本身无直接单测**，只通过 mock 间接测契约。

**False confidence（假信心）**：
- "DNS rebinding 防护 REJECT" 测试只覆盖单次解析命中私网，不覆盖 TOCTOU 两次解析不同（L1）。
- "251 tests PASS" 掩盖了 `node --test` 的 10 个失败（虽属工具链不兼容，但 `npm test` 之外的 `.test.ts` 文件对 Node 内置 runner 是"红的"），以及上述未被测试的 C1 路径。

---

# 11. Technical Debt

（仓库已披露的 P3 项仅列名，不重复展开；"新增"为本审计新发现）

- `uid()` 用 `Math.random`（已披露）
- 本地日期工具 ×7 重复实现（已披露）
- 事件类型 meta ×3 重复（已披露）
- `alert`/`toast` 混用（已披露）
- 导航"系统"分组命名（已披露）
- `Milestone.progress` 字段冗余（已披露）
- `lan-access.log` 无轮转（已披露）
- **新增**：`SettingsView` About 版本号 v0.2.0 硬编码（C2）
- **新增**：`docs/V1-Freeze.md` L19 声明 `v1.0.0`（annotated tag）"指向 e1e00d8"，实际 tag 指向 `1cff4e3`（其后的 docs 提交）；不影响代码，但说明文档与事实存在漂移，佐证"文档≠事实"。

---

# 12. Top 10 Recommendations

> 排序按价值（数据安全 > 安全 > 一致性 > UX > 性能 > 债）。

### #1（P1，发布前必须）修复 C1 网络失败丢修改 + 假重试
- 问题：见 C1。
- 证据：`sync-adapter.js` L121-122 / `App.tsx` L113-114 / `mutations.ts` L45-55 / `sync-adapter.js` L244-265。
- 严重度：P1（数据丢失）。
- 复现：mock 平板 fetch 首次 reject → 桌面改任意数据 → 平板轮询覆盖。
- 用户影响：高，静默丢编辑。
- 修复建议：失败不推进 baseState（network_error 保留 pending + 退避重试）；修正 toast 文案；本地未同步变更显性化。
- 成本：S-M。

### #2（P2）导入/恢复加实体级校验
- 见 C4；复用 mutation engine 校验。成本 M。

### #3（P2）闭合 SSRF TOCTOU
- 见 L1；连接复用校验时解析的 IP（固定 IP + 证书 hostname 校验）。成本 M。

### #4（P2）平板功能断链与 README 对齐
- 见 C3；平板隐藏/置灰 News·Translation·备份恢复·X 卡片，并修正 README"完整功能"。成本 S（或 V2 做 LAN 代理）。

### #5（P3）生产模式收紧 `will-navigate` 到 dist 目录的 `file://` 前缀
- 见 P1。成本 S。

### #6（P3）`translate-paste` 加 sender 校验（与 `read-clipboard` 一致）
- 见 P2。成本 S。

### #7（P2）番茄钟运行时状态不入 persist（或 persist 粗节流）
- 见 §9.1。成本 S-M。

### #8（P3）修复版本号/恢复跳转/加载超时等一致性小项
- C2（About 版本）、U2（restore→today）、P3（平板加载超时）。成本 S。

### #9（P2）补齐 sync-adapter 失败路径测试 + 跨时区日期测试
- 见 §10。成本 M。

### #10（P3，可选）解引用 bump version / 收敛日期工具与事件 meta
- 见 L2 + §11。成本 M（V2 可做）。

---

# 13. Release Recommendation

## SHIP WITH FIXES

**不原样发布，但也不至于 BLOCK 全量返工。** 理由：

- **必须修复（发布前置）**：**C1（P1 数据丢失）**。它落在"多端同步"这一 V1 核心卖点上，且属于用户数据损坏，符合仓库自身 freeze 纪律中"V1 仅接受 P0/P1 修复"的定义。修复成本低（S-M），风险收益比极高。
- **强烈建议同批修复**：C4（导入浅层校验）、L1（SSRF TOCTOU）、C3（平板功能断链文案/入口）——都是"低成本、防未来严重后果"项。
- **不阻塞发布**：其余 P3 技术债与 UX 小项可在 V2 前清理批次处理；`node --test` 10 个失败为工具链不兼容，非产品缺陷。
- **不成立的担忧（已确认无问题）**：同步权威写路径、备份/恢复安全流程、Paper↔Note↔Project 删除解引用、Electron 安全基线、Quick Capture/Today/日历/番茄的 polish 修复——均经代码核实为真，无需返工。

**一句话结论**：V1 是一份工程质量明显高于平均水平的本地 Personal OS 骨架，值得发布；唯一需要"卡一下"的是 C1 这个真实的数据丢失缺陷。修掉 C1（并按成本顺手做 #2-#4），即可 SHIP；否则请在发布说明中明确披露"平板端瞬时断网时编辑可能丢失"这一风险。

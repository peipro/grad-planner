# grad-planner V1.0（研途计划）

> 正式版本总结 · V1.0 Release Summary
> 仓库：https://github.com/peipro/grad-planner
> 文档依据：实际仓库代码、Git 历史、tag、测试输出与既有设计文档（`docs/Phase-1B-0/1/3A`、`docs/Phase-2A-Personal-OS-Architecture.md`、`docs/Phase-3-V1-Final-Audit.md`）。
> 本文档是 V1 的能力说明、架构基线、已知限制与 V2 起点的正式封存。

---

## 1. Product Positioning（产品定位）

> **grad-planner V1 是一个面向研究生的 Personal OS（个人操作系统）：把科研、学习、生活、时间、目标、知识与执行统一到一个每日入口里，让用户不用思考"该打开哪个模块"。**

它不是：
- 一个"包含很多功能的 Todo App"——Task/Calendar 只是跨领域横向能力，不是中心。
- 纯 Research OS——科研是重要领域（Paper/Note/Project 闭环），但不是唯一中心。

V1 实际覆盖的领域与状态：

| 领域 | V1 状态 |
|---|---|
| Research（科研） | ✅ Paper / Reading / Note / Project 关系闭环 |
| Study（学习） | ✅ 统一 Task + Calendar（学习任务即任务） |
| Life（生活） | ✅ Life area、Habit、Birthday、生活任务 |
| Planning（规划） | ✅ Task / Calendar / Project / Milestone / 快速添加 + 自然语言日期解析 |
| Goals（目标） | ⚠️ **V1 未正式实现**（Goal→Project→Task 层级属 V2 规划，架构文档 Phase 2C） |
| Knowledge（知识） | ✅ Note（Markdown）+ Paper↔Note 关系；⚠️ 无统一 Knowledge 入口（V2） |
| Execution（执行） | ✅ Today 时间线、内联完成、Habit 打卡、Pomodoro（含任务绑定） |
| Review（复盘） | ❌ **V1 未实现**（每日/每周复盘属 V2；V1 有 Stats 统计但无引导式复盘） |

**一句话**：V1 已经把"今天、科研、学习、生活、执行"打通，目标与复盘是明确留给 V2 的两块。

---

## 2. V1 Capabilities（产品能力，按用户场景）

### 2.1 Today —— 每日入口（Phase 2B，Today 2.0）
- 打开即落在「今日」，几秒看懂"今天要做什么"
- **今日时间线**：日程 + 到期任务按时间混排升序，同一任务只出现一次，全天任务独立分组
- **area 轻量分区**：科研 / 学习 / 生活 / 其他（任务侧标签）
- **内联操作**：直接完成/取消任务、习惯打卡、一键开始"专注该任务"
- **侧栏**：今日习惯 + 逾期（含逾期天数、一键完成）
- **顶部概览**：待办/完成/逾期、日程数、习惯打卡、今日专注分钟
- **底部轻操作**：开始专注（含倒计时）· 添加待办（自然语言，时间不丢失）· ⚡ 快速记录（直达 Quick Capture）· 跳转日历
- 已过时段弱化显示；空状态友好引导

### 2.2 Planning（规划）
- **Task**：列表 / 看板 / 四象限；优先级、截止、子任务、项目、领域；逾期自动标记
- **Calendar**：月 / 周 / 日视图；日程 + 生日 + 里程碑 + 到期任务聚合展示；悬浮卡片（锚定、无闪烁）；**日历内可直接操作任务**（完成/撤销、改期保留时间、编辑标题/优先级）
- **Project**：弱实体（名称+颜色），聚合任务/里程碑/论文/笔记，删除自动解引用
- **Milestone**：时间线 + 检查点 + 自动进度（检查点 + 关联任务完成度）
- **快速添加**：三入口（Today / TodoView / Quick Capture）共用同一套自然语言解析与 due 构造
- **日期解析**（确定性语义）：明天/后天/今天、N天后、N周后、**半个月后=+15天**、**N周半后=N×7+3天**、下个月、明年、下个/这周X、**下个礼拜X≡星期X**、X月X日、时段默认时间（上午09:00/下午15:00/中午12:00/晚上19:00…）、"下午3点"式数字时间

### 2.3 Knowledge / Research（科研）
- **Paper**：阶段分组 + 状态流转（未读/在读/已读）+ 精读/略读标记 + 阅读计划视图 + 逾期提示
- **Reading**：按计划日期分组 + 一键"同步到待办"（`[文献] xxx`，按标题去重）+ 转日历日程
- **Note**：Markdown + DOMPurify 消毒 + 标签 + 预览/编辑切换 + 来源跳转（论文/项目 chip）
- **关系**：Paper↔Note（双向）、Paper↔Project（双向）、Note↔Project（双向）；一键创建阅读笔记（带模板）；删除跨实体解引用（引擎事务）

### 2.4 Life（生活）
- Life area 任务（"生活 买洗衣液"一句话入 Today 时间线）
- **Habit**：打卡 + 周目标 + 连续天数；Today 内联打卡
- **Birthday**：农历/阳历 + 下次生日倒计时 + 日历展示 + 提前提醒
- **Pomodoro**：倒计时/正计时 + 任务绑定（这 25 分钟在做哪个任务）+ Today/待办/统计三处专注分钟回流

### 2.5 Capture（快速记录，Phase 2C）
- **Quick Capture**（Ctrl+Shift+K 或 Today「⚡ 快速记录」）：一句话输入 → 显式选择 **任务 / 日程 / 笔记**（无 AI 分类）
- **保存前实时预览**：类型 · 日期 · 时间 · area（如「任务 · 明天 · 15:00 · 生活」），所见即所存
- 解析失败明确警告（如"下周组会"→ 提示"未能识别日期，将保存为任务"），**绝不静默生成错误数据**
- area 前缀（科研/学习/生活/杂务）、优先级词、会议/截止类型词
- 保存成功 toast 反馈；错误经全局 mutation 失败通道分类提示

### 2.6 Information（资讯与翻译）
- **News**：RSS/热搜聚合（AI/Agent/官方筛选）+ 30 分钟缓存 + 后台刷新 + 阅读弹窗（正文/翻译）+ **存待办/存笔记**（英文自动附中文翻译；存笔记抓全文，失败明确降级摘要版）
- **Translation**：中英互译 + 历史记录 + **存笔记（双语对照）**

### 2.7 Multi-device（多端）
- **Desktop（Electron）**：主权威端，局域网服务承载平板
- **Tablet（浏览器）**：同一局域网打开地址即用，与桌面共享同一份数据
- **State Sync**：桌面 → 渲染进程就地更新（不 reload）；平板 → 权威轮询
- **Mutation**：全核心实体走统一 mutation 通道（IPC 与 HTTP 同引擎）

---

## 3. Core User Workflows（关键用户工作流）

### 3.1 日常工作流（✅ 稳定）
```
打开 Today → 看时间线（日程+任务+逾期+习惯） → 内联完成任务 → 习惯打卡
→ 底部一键开始专注（可绑定任务） → ⚡ 快速记录随手事项 → 关闭/重开数据仍在
```

### 3.2 快速捕获工作流（✅ 稳定）
```
想到事情 → Ctrl+Shift+K 或 Today「快速记录」 → 输入一句话 → 预览确认
→ 任务/日程/笔记 → Today 时间线 / Calendar / Notes 立即可见
```

### 3.3 科研工作流（✅ 稳定）
```
文献页 → 阅读计划 → 转待办（[文献] 标题，按计划日排期）→ 阅读
→ 一键创建阅读笔记（自动关联）→ 笔记回流项目 → 任务推进
```

### 3.4 生活工作流（✅ 稳定）
```
一句话「生活 明天下午3点取快递」→ 任务落 Today 15:00 + area=生活
→ 时间线完成 → 日历/待办同步
```

### 3.5 双端工作流（✅ 稳定，LAN 内）
```
Desktop 主权威 ↔ Mutation Engine ↔ 平板 HTTP mutation ↔ 权威文件
→ 版本冲突检测（baseVersion）→ 冲突保留本地草稿 + 用户选择
```

---

## 4. Engineering Foundation（工程基础）

### 4.1 数据可靠性（Phase 0，tag `phase-0-complete`）
- 持久化可靠性回归测试：reload flush、损坏数据自愈（里程碑去重/补 id）、旧格式兼容
- import/restore 安全流程：JSON 解析 → Schema 校验 → 数据摘要 → **前置自动备份** → 用户确认 → 应用 → 二次校验；任何失败当前数据不受影响
- 备份：手动导出 / 自动备份（10 分钟，桌面写磁盘）/ 从磁盘备份列表恢复
- `validateStorageShape` 统一校验；`mergePersistedState` 单一 merge 语义（hydration/导入/恢复共用）
- 防误删：清空数据前自动备份

### 4.2 安全（Phase 1A，tag `phase-1a-security-complete`）
- **SSRF 防护**：News/Article 全入口 URL 校验（url-security.cjs）
- **Credentials**：X API 密钥仅存主进程，renderer 只可查询"是否已配置"
- **External Protocol**：外链仅允许 http/https 白名单，系统浏览器打开
- **CSP**：生产构建注入单源 CSP
- **sandbox**：渲染进程沙箱，preload 仅 contextBridge/ipcRenderer
- **LAN Origin/CSRF**：写请求 Origin 校验 + token 鉴权
- **Navigation**：同窗口导航守卫（will-navigate）
- **Clipboard 权限边界**：read-clipboard 仅翻译小窗可调用

### 4.3 同步（Phase 1B，核心工程成就）
- **Main Process 唯一 mutation authority**：文件 + 主进程 = 唯一权威；renderer 的 store 只是缓存视图
- **Mutation Engine**（electron/mutation-engine.cjs）：validate → 加载权威 → 应用（Node 单线程串行）→ 校验结果 → 原子写（tmp+rename）→ 返回规范化结果
- **IPC 与 HTTP 共用同一引擎实例**：无通道分裂
- **Mutation 是同步协议基本单位**（非整份 AppState）：create/update（全量实体）/delete + 跨实体事务
- **全核心实体 mutation 化**：Task/Event/Note/Milestone/Project/Paper/Habit/Birthday/Pomodoro/paperStages
- **State Sync 就地更新，绝不 reload**：权威变化 → renderer 就地 merge（保留 renderer-only 状态如番茄钟/视图/密钥）
- **版本冲突（Phase 1B-3B）**：实体 version + baseVersion；陈旧 mutation 拒绝；冲突保留本地草稿 + 用户选择；跨实体事务删除解引用
- 旧整份写接口保留为 deprecated 兼容路径（mtime 检测自动重读，不分裂）
- **明确不追求**：CRDT、Offline Sync、WebSocket 实时、多主并发自动合并——V1 不做这些（见 §11）

### 4.4 其他工程事实
- 存储：JSON 单文件（`{state, version}` zustand persist 格式）；审计结论 1000 条内无碍（见 §10）
- 路由/模块：React 18 + Zustand + Vite；纯前端 + Electron 主进程
- `uid()` 当前用 Math.random+Date.now（低风险项，未替换 crypto.randomUUID）

---

## 5. Data Model（数据模型 / 实体）

**核心实体**（跨领域横向能力）：
| 实体 | 说明 |
|---|---|
| `Task` | 统一任务：title / due / priority / status / projectId / **area** / subtasks |
| `CalEvent` | 统一时间层：title / start / end / type（course/meeting/deadline/personal） |
| `Note` | 统一知识：Markdown content / tags / paperIds / projectIds |

**辅助实体**（领域工作区）：
| 实体 | 说明 |
|---|---|
| `Project` | 弱实体（名称+颜色），聚合任务/里程碑/论文/笔记 |
| `Paper` | 文献：stage / status / focus / plannedDate / projectIds / noteIds |
| `Milestone` | 里程碑 + checkpoints，进度自动计算 |
| `Habit` | 习惯：weeklyTarget / records（打卡日期数组） |
| `Birthday` | 生日：农历/阳历 + 下次日期换算 |
| `PomodoroRecord` | 执行记录：taskTitle / minutes / completedAt / **taskId** |
| `paperStages` | 文献阶段枚举（字符串数组，整组 replace 同步） |

**Renderer-only transient state**（不参与权威同步的运行时状态）：
- `pomo`（PomodoroState：running/remaining/phase/endAt 等）
- `activeView`（当前页面）
- `newsConfig` 的密钥内存值（xKey/xSecret 不回写存储）

**Derived / 一次性数据**（不持久化）：
- `NewsItem`（资讯，30 分钟缓存）
- 翻译历史（组件本地 state）

---

## 6. Module Relationships（模块关系）

```
Quick Capture ──→ Task / Event / Note（显式类型 + 预览 + 反馈）
Task ⇄ Calendar ⇄ Today            （日历内可完成/改期；Today 内联完成）
Paper ⇄ Note ⇄ Project             （双向关系 + 删除解引用）
Habit → Today                      （今日侧栏内联打卡）
Pomodoro → Task / Today            （任务绑定 + 三处专注分钟回流）
News → Note                        （存笔记/全文或摘要；tag=资讯）
Translation → Note                 （双语对照存笔记）
Milestone → Project（共享 projectId → 自动进度）
Birthday → Calendar（下次生日展示 + 提前提醒）
Task → Calendar（due 到期展示，按实际时间定位）
```
（以上均为 V1 实际实现的关系；`Paper → Task` 为标题弱关联 `[文献]` 前缀，无 ID 回链——见 §10 限制。）

---

## 7. V1 Evolution Timeline（演进时间线）

```
Phase 0  数据可靠性与数据安全（42be848）
         解决：持久化可靠性、导入/恢复安全、备份、schema 校验与自愈
Phase 1A Electron / LAN / 外部请求安全（b08690d）
         解决：SSRF、凭证、CSP、sandbox、LAN CSRF、导航与剪贴板边界
Phase 1B 双端同步基础设施（5e550d3 → 0e6211d → 49ef14e → f81fd5e → 9586034 → 0e3ebae）
         解决：整份同步的 lost update 与格式分裂 → Main 权威 mutation 架构、
               全实体 mutation 化、状态同步就地更新、版本冲突检测
Phase 1C 现有功能与体验修复（e4f37fb）
         解决：News 缓存、资讯→笔记全文保存、剪贴板越权、LAN 可达地址
Phase 2A 架构审视 + 科研关系（be9ea37）
         解决：确认 Personal OS 定位；Paper↔Note↔Project 关系与删除事务
Phase 2B Today 2.0 / 每日入口（1ada3ff）
         解决："打开不知道今天做什么" → Today 时间线 + Task.area + 内联执行
Phase 2C Quick Capture（1bfd6c1）
         解决：一句话记录 → 任务/日程/笔记；确定性日期解析（修复 Unicode 星期与下周跨周 bug）
Phase 3  V1 Final Audit + Polish（277a3cc → 2adccdf → 5f11186 → 80f4b00 → 5a93ee3 → ed084fb）
         解决：审计 + 6 个高频断点（见 §8）
最终：  V1.0 = ed084fb（tag v1-polish-pomodoro-timezone）
```

---

## 8. V1 Final Polish（最终修复记录）

按实际提交（`v1-polish-*` 5 个 tag）：

| # | 修复 | 提交 |
|---|---|---|
| 1 | Today/TodoView 快速添加**丢失解析出的时间**（一律 12:00）→ 三入口共用 `taskDueOf`（date+time / 仅 time→今天该时段 / 仅 date→12:00 / 格式统一 HH:mm:00） | `2adccdf` |
| 2 | **Quick Capture 保存前解析预览**（类型·日期·时间·area，所见即所存；解析失败明确警告） | `5f11186` |
| 3 | **Today 增加 Quick Capture 入口**（底部「⚡ 快速记录」，无需记忆快捷键） | `2adccdf` |
| 4 | **Calendar 任务可操作**（完成/撤销、改期保留时间、编辑标题/优先级）；并修复日历任务硬编码 09:00 显示 bug | `80f4b00` |
| 5 | **Pomodoro ↔ Task**（番茄钟下拉选任务 + Today 任务行 🍅 一键绑定 + 三处专注分钟回流） | `5a93ee3` |
| 6 | **Pomodoro 跨午夜归属错日**（UTC ISO vs 本地日期键 → 统一本地换算；5 个跨午夜时刻测试） | `ed084fb` |

**Quick Capture 阶段（Phase 2C）已修复的日期解析问题**（`1bfd6c1`）：
- 半个月后 = +15 天；两周半 = 17 天（N×7+3）；下个月（addMonths）；明年（addYears）
- 下个礼拜三 ≡ 下个星期三
- 后天上午 / 明天上午 / 下周三下午 → 时段默认时间（上午 09:00 / 下午 15:00 …）
- **Unicode 星期识别 bug**：`[一-日天]` 是 Unicode 范围（误匹配"半/周/两"）→ 显式枚举
- **下周跨周计算 bug**：周四~周日"下周三"多跳一周 → 周一基准计算

---

## 9. Quality & Testing（测试与质量）

### 9.1 自动化（V1.0 基线实际输出）
| 命令 | 结果 |
|---|---|
| `npm test`（vitest，官方测试命令） | **16 文件 / 247 tests PASS** |
| `npm run build`（tsc + vite build） | **PASS**（仅 chunk 体积提示，非错误） |
| `npm run lint`（eslint src） | **0 errors / 1 warning**（NewsView `useCallback` 缺依赖，历史既有，非阻塞） |
| `node --test` | **156 pass / 10 fail（历史兼容问题，见下）** |

**关于 `node --test` 的 10 个失败——如实记录**：
- 失败全部来自 `src/**/*.test.ts`（vitest 专属测试，依赖 vite/jsdom 环境：`import { describe, it } from 'vitest'` + React 渲染）
- `node --test` 不是项目官方测试命令（package.json 无该脚本；`npm test` = vitest run）
- 该现象在 Phase-1B-0 文档（42be848 时代）即被记录为"非代码回归"；Electron `.cjs` 测试在早期阶段曾用 node --test 全过
- **结论：历史已知的工具链兼容问题，不影响 V1 产品与官方测试**

### 9.2 测试覆盖
- 单元测试：日期解析（含固定语义注释）、today 聚合、import、关系操作、event/task 工具
- 集成/组件测试：TodayView、CalendarView（悬浮卡片 + 任务操作）、NotesView（draft 保留）、NewsView（存笔记）、QuickCapture、PomodoroView
- 同步测试：sync-adapter 真实 IIFE + 真实 persist payload（`{state,version}`）→ mutation 生成/提交/冲突/防循环；mutation engine 集成；跨实体事务
- 人工验证：Electron 桌面、LAN 双端、Today 2.0、Quick Capture（类型/日期/时间/area/反馈）、V1 Polish 6 项全部通过（详见阶段记录）

---

## 10. Known Limitations（V1 已知限制，如实列出）

1. **同实体高级冲突合并未实现**：双端同时改同一任务 → baseVersion 冲突检测会拒绝陈旧写入并保留本地草稿 + 用户手动选择，但不自动合并（V1 有意为之）
2. **Offline Sync 未实现**：平板/桌面 mutation 需要 LAN 可达；localStorage 仅作离线兜底缓存（hydration），不可离线提交
3. **Tablet 实时性**：桌面→渲染进程为推送式就地更新；平板为**轻量轮询**（非 WebSocket 实时）
4. **`node --test` 10 个失败**：vitest TS 测试文件与 node 内置 runner 不兼容（历史已知，非官方测试命令，不影响 V1）
5. **JSON 单文件规模上限**：审计结论约 1000 条内流畅、5000 条可感知、10000 条不可用（当前个人双端规模无碍；未来评估 SQLite 的收益大于迁移成本时再动）
6. **Paper → Task 为标题弱关联**（`[文献] 标题` 前缀去重，无 paperId 回链）：文献改标题后重复同步会新建任务（V2 修）
7. **News → Task 存待办无截止日期**：需要用户自行补期才会进 Today
8. **删除 Paper 后 renderer 关系引用短暂残留**：由引擎跨实体解引用 + State Sync 最终修正（不可见损坏，最终一致）
9. **剩余 P3 项**：本地日期工具函数仍多处重复（DatePicker/reminder/LiteratureView/TodoView）；信息性提示 alert/toast 混用（文献导入等）；导航「系统」分组命名（含资讯/翻译/统计）；Milestone 过期文案"可拖动滑块"（无滑块）；`lan-access.log` 无轮转；`uid()` 用 Math.random+Date.now
10. **提醒依赖系统通知**：需用户授权 Notification 权限（桌面）

---

## 11. Explicit Non-Goals（V1 明确不做）

> "暂时未做" ≠ "产品不需要"。以下为 V2 候选或有意取舍，不是 V1 缺陷：

- **CRDT**（无多主自动合并需求；用户规模小，版本号+手动合并足够）
- **Offline Sync / 云同步**（WebDAV/Git 等）
- **SQLite**（JSON 单文件在当前规模足够；迁移须收益明确）
- **WebSocket 实时通道**（平板轮询 + 桌面推送已满足）
- **Knowledge Graph / 语义搜索**（先证明关键词检索不足再引入）
- **AI Personal Copilot**（V1 的 AI 仅"外部 AI 生成 JSON → 手动导入"；内建 AI 属 V2，须密钥不出主进程 + 只读提案 + 用户确认）
- **高级 Review（每日/每周复盘）**（V1 只有 Stats 统计，无引导式复盘）
- **Goal 系统**（Goal→Project→Task 层级）
- **复杂 Conflict Editor**（冲突走"保留草稿 + 用户选择"，不做三方合并 UI）
- **重复任务/重复日程、甘特图、PDF 管理/附件**（V2 候选）

---

## 12. V1 Value Assessment（价值判断）

**V1 是否具备日常使用价值？——具备，且已经解决"每天愿不愿意打开"的核心问题。**

已解决的问题：
- **作为日常任务/日程工具**：Today 打开即见"今天要做什么"，内联完成、逾期一目了然，专注可绑定任务——执行闭环成立
- **作为研究生科研辅助**：文献→阅读计划→转待办→阅读笔记→回流项目，关系可追溯；知识有落点
- **处理生活事务**：一句话记生活任务/习惯打卡/生日提醒，与科研同处一个时间线
- **Desktop + Tablet 协同**：同一份数据、同一条 mutation 链路、冲突不静默覆盖
- **记录成本**：Quick Capture 3 秒记录 + 保存前预览，无 AI 也能确定

**不夸大**：V1 没有目标层（长期锚点缺失）、没有复盘（"为什么没完成/下周改什么"无答案）、没有统一知识入口（文献笔记要分别找）——这正是 V2 的方向。

---

## 13. V1 Freeze Decision

# V1 Freeze = **YES**

理由：
1. 官方测试 247 全绿、build/lint 干净；同步/备份/导入恢复链路全程未动且稳定
2. 每日高频路径（打开 Today → 看安排 → 加任务 → 记录想法 → 专注 → 完成）全部顺畅，3 个 P1 + 2 个 P2 已修复
3. 剩余问题（§10 的 P3）不阻塞使用，属于"为理论完美继续修改稳定功能"的范畴——原则是**不为此继续折腾稳定功能**
4. V2 候选（Review/Goal/Knowledge 入口）与 V1 不冲突，可在 V2 内自然演进

建议 Freeze 收尾动作：`npm run dist` 打正式 exe（日常使用不再依赖 vite dev 的 HMR 缓存，规避开发期偶发白屏）。

**进入 V2 的问题**：Review、Goal、Knowledge 统一入口、Task 级番茄聚合视图、Paper→Task ID 回链。

---

## 14. V2 Roadmap（V2 建议 Top 5，按当前仓库实际状态重新判断）

1. **Daily / Weekly Review**
   - 用户价值：补上 Plan→Execute→Review→Adjust 闭环的最后一步；Stats 有数据但无解释
   - 与 V1 关系：数据齐全（任务/番茄/习惯），纯新增视图
   - 复杂度：中；风险：低
2. **Goal → Project → Task 轻量层**
   - 用户价值：长期目标锚点，让任务流不再琐碎（架构文档明确规划）
   - 与 V1 关系：Project/Task 已就绪，新增 Goal 实体 + 关系复用 Phase 2A 机制
   - 复杂度：低-中；风险：需防"为模型而模型"
3. **Knowledge 统一入口（Papers + Notes 统一列表 + 关系上下文 + 搜索）**
   - 用户价值：文献和笔记一处找；GlobalSearch 已证明跨实体检索可行
   - 与 V1 关系：关系数据已存在（paperIds/projectIds），纯聚合视图
   - 复杂度：中；风险：低
4. **Task 级 Pomodoro 聚合视图 / 专注洞察**
   - 用户价值：回答"时间花在哪"；V1 已打底（绑定 + 聚合函数）
   - 与 V1 关系：数据已记录，补视图与解释
   - 复杂度：低-中；风险：低
5. **Quick Capture → Today 深度联动 + Paper→Task ID 回链**
   - 用户价值：记录→今日立即可见的最后一米；文献任务可追溯
   - 与 V1 关系：V1 已统一解析与入口，此处补数据回链与转化
   - 复杂度：低；风险：低

> 不为规划而规划：一次只推进 1-2 项，验证用户价值后再继续。

---

## 15. V1.0 Release Notes（用户视角）

# 研途计划 V1.0 —— 研究生个人 OS

**这是干什么的？**
研途计划是一个装在电脑上的桌面软件（桌面版 + 局域网平板访问），帮你把**科研、学习、生活**放在一个"今日"入口里统一管理。打开软件，第一眼就是"今天要做什么"。

**核心功能**
- **今日**：时间线把日程、任务、习惯、逾期、专注放在一起，勾一下就完成
- **快速记录**（Ctrl+Shift+K）：一句话记下任何事——"生活 明天下午3点取快递"自动变成明天 15:00 的生活任务；"记录一下刚才的想法"变成笔记；保存前先预览，不会记错
- **科研**：文献阅读计划 → 转待办 → 读 → 一键生成阅读笔记，自动挂到文献和项目下
- **生活**：习惯打卡、生日提醒（支持农历）、生活任务
- **专注**：番茄钟可以绑定某个任务，之后知道每个任务投入了多少分钟
- **多端**：桌面 + 平板（同一局域网）用同一份数据，改哪端都同步

**为什么适合研究生**
- 不逼你用"科研工具"或"待办工具"二选一——论文、组会、买菜、健身都在一个时间线上
- 数据完全本地 + 自动备份，可以导出/恢复，不担心丢失
- 同步冲突不会静默覆盖你的修改

**怎么用**
1. 桌面：安装 exe 打开，默认落在「今日」
2. 平板：设置页复制局域网地址，浏览器打开即用
3. 日常：早上看今日 → 随手快速记录 → 该专注时绑定任务开番茄 → 晚上数据自动备份

**V1 版本号**：v0.2.0（产品迭代版本），工程里程碑 tag `v1-polish-pomodoro-timezone`（ed084fb）

---

*文档生成：基于 `ed084fb`（V1.0）实际仓库状态。* *测试数据：`npm test` 247 passed / `npm run build` PASS / `npm run lint` 0 errors / `node --test` 156 pass + 10 历史兼容失败（见 §9）。*

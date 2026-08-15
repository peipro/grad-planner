# grad-planner V1.0.0 Freeze

> 研途计划 V1.0.0 正式冻结声明。
> **v1.0.0 是稳定基线。** 自此之后，普通功能开发进入 V2；V1 仅接受 P0 级修复（数据损坏 / 安全 / 无法启动 / 核心功能不可用）。

---

## Final Commit

```
e1e00d8  fix: TodoView shows and preserves task time (V1.0 release blocker)
```

> 说明：V1 最终代码基线 = `e1e00d8`（HEAD）。该提交包含正式 EXE 验收期间发现的 Release Blocker 修复（待办页任务时间显示与编辑保留），并已通过完整回归。

## Release Tag

```
v1.0.0（annotated tag，指向 e1e00d8）
```

前置里程碑 tags：`phase-0-complete` → `phase-1a-security-complete` → `phase-1b-*`（5 个）→ `phase-1c-product-ux-complete` → `phase-2a-research-workflow-core` → `phase-2b-today-core` → `phase-2c-quick-capture` → `v1-polish-*`（5 个）→ **`v1.0.0`**

## Product Scope

面向研究生的 **Personal OS**：统一管理科研、学习、生活、时间、知识与执行，以 Today 为每日入口。

V1 已实现领域：Research ✅ / Study ✅ / Life ✅ / Planning ✅ / Knowledge（部分）✅ / Execution ✅
V1 明确未实现（V2）：Goals ❌ / Review ❌ / 统一 Knowledge 入口 ❌ / AI Copilot ❌

## Core Features

- **Today 2.0**：今日时间线（日程+任务按时间混排）、area 分区、内联完成、习惯打卡、逾期侧栏、数字概览、底部轻操作（专注/快速添加/快速记录/日历）
- **Quick Capture**（Ctrl+Shift+K / Today 入口）：一句话 → 任务/日程/笔记；显式类型选择；保存前解析预览；确定性日期解析（半个月后=+15天、两周半=17天、下个月、明年、下个礼拜X、时段默认时间）；解析失败明确提示
- **Calendar**：月/周/日视图、生日/里程碑/到期任务聚合、任务日历内可操作（完成/撤销/改期保留时间/编辑）、悬浮卡片（锚定无闪烁）
- **Task**：列表/看板/四象限、优先级、截止（日期+时间）、子任务、项目、领域（research/study/life/other）；**编辑保留时间**（V1.0 验收修复）
- **Research**：Paper（阶段/状态/精读/计划）、Reading 计划、一键转待办/日程、Paper↔Note↔Project 双向关系、删除跨实体解引用
- **Note**：Markdown + DOMPurify 消毒、标签、来源跳转
- **Life**：Habit 打卡（Today 内联）、Birthday（农历/阳历 + 提醒）
- **Pomodoro**：倒计时/正计时、**任务绑定**（这 25 分钟在做哪个任务）、Today/待办/统计专注分钟回流、跨午夜归属正确
- **Info**：News（缓存 + 存笔记/待办 + 翻译）、Translation（互译 + 历史 + 存笔记）
- **Multi-device**：Desktop 主权威 + Tablet（LAN）同数据、Mutation 统一通道、State Sync 就地更新、版本冲突检测

## Engineering Foundation

- **数据可靠性（Phase 0）**：持久化回归、导入/恢复安全流程（Schema 校验 + 前置自动备份）、导出/自动备份、数据自愈
- **安全（Phase 1A）**：SSRF 防护、凭证主进程存储、CSP、sandbox、LAN Origin/CSRF、导航守卫、剪贴板权限边界
- **同步（Phase 1B）**：Main Process 唯一 mutation authority；Mutation Engine（IPC 与 HTTP 同实例）；全核心实体 mutation 化 + 跨实体事务；State Sync 就地更新不 reload；baseVersion 冲突检测 + 本地草稿保留
- **V1 有意不做**：CRDT / Offline Sync / SQLite / WebSocket / Cloud Sync / Knowledge Graph / AI Copilot（见 V1 Non-goals）

## Test Results

| 命令 | 结果 |
|---|---|
| `npm test`（vitest，官方） | **17 文件 / 251 tests PASS** |
| `npm run build` | PASS（仅 chunk 体积提示） |
| `npm run lint` | 0 errors / 1 warning（NewsView useCallback 缺依赖，历史既有） |
| `node --test` | 156 pass / **10 fail（历史已知兼容问题**：vitest TS 测试与 node 内置 runner 不兼容；`node --test` 非官方测试命令；不影响 V1） |

## Formal Build

- 安装包：`release/研途计划 Setup 1.0.0.exe`（NSIS，x64）
- 便携版：`release/win-unpacked/研途计划.exe`（含 app.asar）
- 版本：**1.0.0**（package.json 已同步，`release: bump version to 1.0.0`）
- 便携模式：数据目录 = exe 旁 `data/`（与开发数据分离，设计如此；可经「设置→导入备份」迁移）

## Manual Acceptance

正式 EXE（非 dev server）验收通过：

- **Startup**：正常启动、不白屏、默认进入 Today ✅
- **Today**：时间线/任务/日程/习惯/逾期/专注 ✅
- **Quick Capture**：`生活 买洗衣液`（任务+生活）、`下周三下午给导师发实验结果`（下周三 15:00 预览）、`记录一下刚才的想法`（笔记）✅
- **Calendar**：任务真实时间显示、点击操作、改期保留时间 ✅
- **Task**：列表时间显示、编辑保留/修改时间 ✅（V1.0 验收修复项）
- **Note / Paper**：笔记读取与渲染、文献分组与关系 ✅
- **Pomodoro**：任务关联、专注分钟回流、跨午夜归属（确定性测试）✅
- **News**：刷新、存为笔记 ✅
- **Translation**：打开不自动读剪贴板、手动翻译 ✅
- **LAN / Tablet**：桌面启动 LAN（8899）、token 鉴权（无 token 401）、mutation 信封全链路（写入→引擎→落盘→读回）✅
- **Persistence**：关闭重开数据保留 ✅

## Known Limitations（如实记录，不阻塞 V1）

1. **同实体高级冲突合并未实现**：baseVersion 检测到陈旧写入 → 拒绝 + 保留本地草稿 + 用户选择；不自动合并
2. **Offline Sync 未实现**：LAN 断开时平板不可提交 mutation（localStorage 仅离线兜底缓存）
3. **Tablet 实时性**：桌面→渲染进程推送；平板轻量轮询（非 WebSocket）
4. **`node --test` 10 个失败**：历史工具链兼容问题（vitest 文件），非官方测试命令
5. **JSON 单文件规模上限**：约 1000 条内流畅 / 5000 条可感知 / 10000 条不可用（当前个人双端规模无碍）
6. **Paper→Task 标题弱关联**（`[文献] 前缀`，无 ID 回链）：文献改标题可能重复建任务（V2）
7. **News→Task 存待办无截止日期**
8. **删除 Paper 后 renderer 关系引用短暂残留**（引擎解引用 + State Sync 最终一致）
9. **剩余 P3**：本地日期工具仍多处重复；alert/toast 混用（文献导入等）；导航「系统」分组命名；Milestone 过期文案；lan-access.log 无轮转；uid() 用 Math.random

## V1 Non-goals

> "暂时未做" ≠ "产品不需要"——以下为 V2 候选或有意取舍：

- CRDT / Offline Sync / SQLite / WebSocket / Cloud Sync
- Knowledge Graph / 语义搜索
- AI Personal Copilot（V1 的 AI 仅"外部 AI 生成 JSON → 手动导入"）
- 高级 Review（每日/每周复盘）
- Goal 系统（Goal→Project→Task）
- 复杂 Conflict Editor / 重复任务 / 甘特图 / PDF 附件

## V2 Boundary

V2 规划（待 V2 Planning 文档细化），候选按价值排序：

1. Daily / Weekly Review（补 Plan→Execute→Review→Adjust 闭环）
2. Quick Capture → Today 深度联动 + Paper→Task ID 回链
3. Goal → Project → Task 轻量层
4. Knowledge 统一入口（Papers + Notes + 关系 + 搜索）
5. Task 级 Pomodoro 聚合视图 / 专注洞察
6. AI Personal Copilot

**V1 Freeze 后开发纪律**：禁止修改 V1 功能，除非 P0（数据损坏 / 安全 / 无法启动 / 核心功能不可用）。普通问题进入 V2。

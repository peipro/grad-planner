# Phase 3 · V1 Final Audit（V1 最终审计报告）

> 阶段性质：只读审计。未修改任何产品代码（除建立复现所需的测试外，本阶段零代码改动）。
> 基线：HEAD `1bfd6c1`（tag `phase-2c-quick-capture`），工作区干净。
> 验证：`npm test` 202 passed（15 文件）· `npm run build` ✓ · `npm run lint` 0 errors（1 个既有 warning）· `node --test` 与基线一致（10 个既有失败，vitest 文件与 node 内置 runner 不兼容，非产品缺陷）。

---

## 1. 完整产品阅读摘要

| 模块 | 实现概况 | 关键观察 |
|---|---|---|
| Today（今日） | 时间线 + area 分区 + 内联完成 + 习惯打卡 + 逾期侧栏 + 概览 + 底部轻操作 | 见 §8 |
| Quick Capture | 显式 Task/Event/Note + 确定性日期解析 + area + 反馈 | 见 §9 |
| Calendar | 月/周/日视图 + 事件/生日/里程碑/到期任务聚合 + 悬浮卡片 | 任务只读展示 |
| Task | 列表/看板/四象限 + 项目关联 + 子任务 + 领域 | 三处快速添加行为不一致（§6/§16） |
| Habit | 打卡 + 周目标 + 连续天数 | Today 已可内联打卡 |
| Pomodoro | 倒计时/正计时 + 记录 | 与 Task 弱关联（§16-5） |
| Paper / Reading | 阶段分组 + 阅读计划 + 转待办/转日程 + 关系面板 | 关系完整 |
| Note | Markdown + DOMPurify 消毒 + 标签 + 来源跳转 | 无法在笔记内建立关联 |
| Project | 弱实体 + 任务/里程碑/论文/笔记聚合 | 入口在 TodoView 内 |
| Milestone | 时间线 + 检查点 + 自动进度 | 有残留文案（§16-9） |
| News | RSS/热搜 + 缓存 + 阅读 + 翻译 + 存待办/笔记 | 存待办无 due |
| Translation | 中英互译 + 历史 + 存笔记 | 闭环已通 |
| Settings | 主题/备份/导入恢复/提醒/资讯源/LAN | restore 后跳转视图过时（§16-8） |
| LAN / Tablet | 引擎级 mutation + 版本冲突 + token | 稳定 |

---

## 2. 真实用户的一天审计（模拟）

```
起床 → 打开 Today（落在今日 ✓ 几秒看懂今天安排）
→ 添加临时任务（Today 底部输入 "下午3点去医院" → ⚠️ 落成 12:00，见 P1-1）
→ 处理科研任务（待办页 ✓）
→ 阅读论文（文献页 ✓ 转待办/笔记 ✓）
→ 记录想法（⚠️ 必须 Ctrl+Shift+K 或切到笔记页，Today 上没有入口，见 P1-3）
→ 处理生活事务（今日页 ✓）
→ 番茄专注（⚠️ 只能空白启动，无法"专注这个任务"，见 P2-5）
→ 修改日程（⚠️ 需跳日历页，Today 时间线日程不可编辑）
→ 晚上复盘（❌ 无 Review 模块，只能看 Stats 数字，无法回答"为什么没完成"）
```

结论：**白天执行闭环已成立；"记录想法"与"复盘"两步不自然。**

---

## 3. 模块闭环矩阵

| 关系 | 状态 | 实际路径 |
|---|---|---|
| Today ↔ Task | ✅ CONNECTED | Today 显示到期任务 → 内联完成 `updateTask` → 待办/日历同步 |
| Today ↔ Calendar | ⚠️ PARTIAL | Today 显示当天日程，但日程**不可点击/编辑**（需跳日历页）；日历也看不到 Today 新建的**无日期**任务 |
| Quick Capture ↔ Task/Event/Note | ✅ CONNECTED | QC → `addTask/addEvent/addNote` → persist diff → Mutation → 引擎 → State Sync |
| Paper ↔ Note | ✅ CONNECTED | 关系面板双向关联 + 一键创建阅读笔记（`createLiteratureNote`） |
| Paper ↔ Project | ✅ CONNECTED | 关系面板双向关联（engine 删除解引用） |
| Note ↔ Project | ✅ CONNECTED | 同上 |
| Paper ↔ Task | ⚠️ PARTIAL | 「转待办」用标题前缀 `[文献] xxx` 弱关联，**无 ID 回链**；文献改标题后同步会重复建任务 |
| Habit ↔ Today | ✅ CONNECTED | Today 侧栏内联打卡 |
| Habit ↔ Review | ❌ DISCONNECTED | Review 不存在（V2 规划，非缺陷） |
| Pomodoro ↔ Task | ⚠️ PARTIAL | `taskId/taskTitle` 弱引用，Stats 按标题聚合；无"针对某任务专注"入口 |
| News ↔ Note | ✅ CONNECTED | 存笔记（全文或摘要）+ 自动翻译 + `资讯` 标签 |
| News ↔ Task | ⚠️ PARTIAL | 存待办但**无截止日期**、无来源回链 |
| Translation ↔ Note | ✅ CONNECTED | 双语对照存笔记 |

---

## 4. 功能孤岛（动作后无自然下一步）

1. **创建 Note（手动）→ 之后去哪？** NotesView 只能展示已有关联；新建的笔记无法在笔记页关联到论文/项目（关联面板在文献页和待办项目侧）。手动笔记=孤岛。
2. **完成一个番茄 → 之后去哪？** 记录即结束，无"这次专注了什么/是否推进某任务"的追问；Stats 能聚合但用户不主动去。
3. **News 存待办 → 之后去哪？** 任务无截止日期，不会出现在 Today/日历，用户要再跑去待办页补日期——两步操作。
4. **Today 时间线里的日程 → 点不动。** 想改时间必须去日历页找到它——跳转路径长。
5. **统计页"今日安排" → 只读重复。** Stats 复刻了 Today 的信息但没有操作，是半孤岛。

---

## 5. 重复操作检查

1. **同一个"快速添加任务"有三套入口、三种时间行为**（核心重复问题）：
   - Today 底部：`parsed.time` 被丢弃 → 一律 12:00
   - TodoView 顶部：无日期 → 不设 due；有日期 → 一律 12:00
   - Quick Capture：完整使用 date+time（Phase 2C 已修）
   → 同一句话在不同入口得到不同结果（P1-1）。
2. **本地日期工具函数重复实现 7 处**：`DatePicker.toStr` / `QuickCapture.localTodayKey` / `reminder.localToday` / `today.localDateKey` / `LiteratureView.todayStr`(×2) / `TodoView` 内联 —— 每处都是潜在的时区 bug 温床。
3. **事件类型 meta 重复 3 处**：`CalendarView.typeMeta` / `TodayView.EVENT_COLORS+EVENT_LABELS` / `LiteratureView.EVENT_TYPE_META`。
4. **项目/领域录入**：仅 TodoView 表单可设 project；Today/QC 快速入口都不支持 → 项目型任务要二次编辑。

---

## 6. 导航检查

- **默认落在 Today** ✓（Phase 2B 后）；全局搜索 Ctrl+K ✓（跨 8 类实体）。
- **「系统」分组命名混乱**：导航把 `番茄钟/资讯/翻译/统计/设置` 归为"系统"，但前四项不是系统功能（P3）。
- **层级**：文献 → 关系面板 → 创建笔记 → 跳笔记页（3 步但顺畅）；项目聚合深藏在 TodoView 项目筛选内，全局无"项目页"（V2 再议，P3）。
- **重复入口**：任务创建有 5 个入口（Today 底栏 / Ctrl+Shift+K / Todo 快速 / News 存待办 / 文献转待办），各自行为不一致——问题不在数量，在行为分裂。

---

## 7. Today 2.0 专项评价

| 维度 | 评价 |
|---|---|
| 信息量 | ✅ 均衡（概览 4 卡 + 时间线 + 侧栏 2 卡 + 底栏） |
| 时间线清晰度 | ✅ 日程/任务混排升序，同一任务只出现一次 |
| area 意义 | ✅ 轻量可见，无噪音 |
| 逾期干扰 | ✅ 隔离在侧栏，不污染时间线 |
| Habit 帮助 | ✅ 内联打卡，符合"今日行动" |
| Pomodoro 便利性 | ⚠️ 只能空白启动；无法"专注该任务"（P2-5）；且**今日专注分钟数在凌晨有跨日偏差**（P2，见 §16-6） |
| Quick Capture 便利性 | ❌ Today 无 QC 入口；底栏"添加待办"是**降级版**（丢时间），与 QC 重复且更弱（P1-3） |
| 日程编辑 | ⚠️ 时间线日程只读 |

---

## 8. Quick Capture 专项评价

| 维度 | 评价 |
|---|---|
| Task/Event/Note | ✅ 显式选择，无 AI |
| 日期/时间/area | ✅ Phase 2C 确定性语义（半个月=15 天、两周半=17 天、下个礼拜=星期、时段默认时间） |
| 解析失败反馈 | ✅ auto 模式回落 Task + 明确 toast，不写错误日程 |
| **创建前预览** | ❌ **无**。Enter 即保存，用户看不到"将创建什么日期/时间/领域"——只能保存后凭 toast 猜测（P1-2） |
| 创建后确认 | ⚠️ toast 只说"已保存为任务"，不含解析出的日期/时间摘要 |

---

## 9. 错误处理检查

| 场景 | 反馈 | 是否合格 |
|---|---|---|
| Mutation 失败（网络/校验/冲突/磁盘） | App 全局分类 toast + 冲突保留本地 | ✅ |
| 磁盘不可写（persistence） | 回权威刷新 | ✅ |
| News 抓取失败 | 错误横幅 + 缓存兜底 | ✅ |
| Article 提取失败 | 明确提示 + 摘要版 | ✅（但用阻塞 `alert`，见 P3） |
| 翻译失败 | 内联错误文案 | ✅ |
| 导入/恢复失败 | Schema 校验 + 前置自动备份 + 明确 alert | ✅ |
| LAN 不可用 | 设置页"服务不可用" | ✅ |
| **反馈方式分裂** | 同是信息性提示：`toast`（多数）/ `alert`（文献导入、同步、资讯正文失败）混用 | ⚠️ P3 |

---

## 10. 数据边界检查（只记录，不修复）

| 场景 | 现状 | 风险 |
|---|---|---|
| 空数据 | 各页均有空状态 | ✅ |
| 超长 Note（全文正文） | 无长度限制；桌面/平板走磁盘存储（sync-adapter 重定向），无配额问题；纯 Web 模式无 News 功能，天然规避 | ✅（低） |
| 删除 Paper | renderer 乐观删除后**本地关系引用残留**，由引擎跨实体解引用 + State Sync 最终修正；窗口期内 GlobalSearch/Notes 的"来源"会消失片刻 | ⚠️ P3（最终一致，不可见损坏） |
| 删除 Project | 任务/里程碑解引用 + 论文/笔记关系移除（engine 事务） | ✅ |
| 重复点击「同步到待办」 | 无 loading/防抖，同一渲染闭包下连点两次可能重复建任务（标题去重基于旧数组） | ⚠️ P3 |
| 日期跨月/跨年 | `addMonths/addYears` date-fns 语义，测试覆盖 | ✅ |
| 凌晨番茄归属 | `completedAt` 为 UTC ISO，Today 用 `startsWith(dateKey)` 比对 → 本地 00:00-08:00 的番茄被记到前一天 | ⚠️ P2（数据准确性问题，见 §16-6） |
| Desktop/Tablet 同时使用 | 版本号 + 冲突保留本地 + 明确提示 | ✅ |

---

## 11. 视觉一致性

- Button/Modal/Empty/Toast/进度条体系一致（global.css 统一 token）。
- 明显问题：**信息性提示 `alert()` 与 `toast()` 混用**（阻断式 vs 非阻断式）；Milestone 卡片残留"可手动拖动滑块调整"文案但界面无滑块；导航"系统"分组命名。
- 组件内 `<style>` 多处重复定义 `spin` keyframes / `progress-bar` 等（今日/日历/番茄/翻译各自定义），无冲突但冗余。

---

## 12. 性能

- News：TTL 缓存 + 后台刷新，✅ 无重复请求。
- Today/Calendar：`useMemo` 合理；Calendar 月视图每格每次渲染重算 `monthVisibleItems`（O(格数×事件)），V1 数据规模无感。
- Notes：客户端过滤，本地规模无感。
- Stats：热力图 O(365×(番茄+习惯))，数据量大时偏慢，但非高频页。
- 构建：main chunk 984KB（vite 警告），桌面加载可接受，V1 不必拆包。
- **未发现重复请求/无意义刷新类问题。**

---

## 13. 代码质量（只记录）

- 本地日期工具 ×7、事件类型 meta ×3（见 §5）——最值得合并。
- Settings restore 后 `setView('calendar')` → 与 Phase 2B 默认入口（today）不一致。
- NewsView `useCallback` 缺依赖（既有 lint warning）。
- `EVENT_TYPE_META`（LiteratureView）与 CalendarView `typeMeta` 功能重叠。
- 无 TODO/FIXME 遗留；无废弃运行路径；`Milestone.progress` 字段已被自动计算替代但仍存储（弱冗余）。

---

## 14. 问题矩阵

| # | 问题 | 类型 | 严重度 | 用户影响 | 修复成本 | 建议修复 |
|---|---|---|---|---|---|---|
| 1 | Today/TodoView 快速添加丢弃 `parsed.time`（一律 12:00） | Bug+UX | P1 | 高：输入时间却落错时间 | S | Yes |
| 2 | Quick Capture 保存前无解析预览 | UX | P1 | 高：不知道将创建什么 | S-M | Yes |
| 3 | Today 无 Quick Capture 入口（记想法需 Ctrl+Shift+K） | UX | P1 | 高：每日入口不完整 | S | Yes |
| 4 | Calendar 任务 chip 只读（不能完成/改期） | UX | P2 | 中：跨页跳转才能操作 | M | Yes |
| 5 | Pomodoro↔Task 弱关联（无"专注该任务"入口） | UX | P2 | 中：专注无任务归属 | M | Yes |
| 6 | 凌晨番茄专注分钟归属错日（UTC ISO vs 本地日期） | Bug | P2 | 低-中：统计/今日数字错 | S | Yes |
| 7 | 本地日期工具 ×7 / 事件类型 meta ×3 重复 | 代码 | P3 | 低：未来 bug 温床 | S | Yes |
| 8 | 信息性提示 alert/toast 混用 | UX | P3 | 低：阻断式体验 | S-M | Yes |
| 9 | restore 跳 'calendar' + 导航"系统"分组 + Milestone 残留文案 | UX/代码 | P3 | 低 | S | Yes |
| 10 | 删除 Paper 后本地关系引用残留窗口期 | 数据 | P3 | 低（最终一致） | M | 可选 |
| 11 | Paper→Task 标题弱关联，无 ID 回链 | 数据 | P3 | 低：改标题会重复 | M | 可选（V2） |
| 12 | News 存待办无截止日期 | UX | P3 | 低：不会出现在 Today | S | 可选 |
| 13 | 「同步到待办」连点可能重复建任务 | Bug | P3 | 低 | S | 可选 |
| 14 | Milestone.progress 字段冗余 | 代码 | P3 | 无 | S | 可选 |

---

## 15. Top 10 最值得修复的问题

### #1（P1）Today / TodoView 快速添加丢弃解析出的时间
1. **场景**：用户在 Today 底部输入"下午3点去医院"，希望出现在 15:00。
2. **当前**：`quickSave` 用 `parsed.date ? date+"T12:00:00" : 今天+"T12:00:00"`，`parsed.time` 被忽略 → 任务落在 12:00；TodoView 快速添加同样只认日期。
3. **期望**：与 Quick Capture 一致——`date+time` 组合；仅有时间 → 今天该时段；仅日期 → 12:00。
4. **根因**：Phase 2C 只修了 QuickCapture，两个更早的快速添加路径未同步。
5. **最小修复**：把 QC 的 due 构造逻辑提取为 `natural.ts` 的共享函数（如 `taskDueOf(parsed)`），三处复用；补两个组件测试。
6. **优先级**：P1（高频入口 + 数据正确性）。
7. **成本**：S。

### #2（P1）Quick Capture 保存前无解析预览
1. **场景**：用户输入"下个礼拜三下午开会"，回车后不知道识别成了哪天。
2. **当前**：Enter 即保存，toast 只说"已保存为日程"。
3. **期望**：输入框下方实时显示解析摘要（如"📅 2026-08-19 15:00 · 日程"），保存后 toast 同样带摘要。
4. **根因**：QC 缺少"确认前预览"这一轻交互。
5. **最小修复**：QC 组件内用 `parseQuickAdd` 实时渲染一行摘要（无新增数据层）。
6. **优先级**：P1（"用户是否知道最终创建了什么"是 QC 的核心验收点）。
7. **成本**：S-M。

### #3（P1）Today 无 Quick Capture 入口
1. **场景**：用户打开 Today 想随手记一个想法，找不到入口（除非知道 Ctrl+Shift+K）。
2. **当前**：Today 底部只有"添加待办/开始专注/日历"；添加待办是任务专用降级版。
3. **期望**：Today 底部提供"快速记录"打开完整 QC（Task/Event/Note 三选），或至少让"添加待办"行为与 QC 一致。
4. **根因**：Phase 2B 与 2C 各自落地，未统一 Today 的轻操作与全局 QC。
5. **最小修复**：Today 底部加"快速记录"按钮唤起 QC（App 已有 `quickOpen` 状态，复用即可）；同时按 #1 统一时间行为。
6. **优先级**：P1。
7. **成本**：S。

### #4（P2）Calendar 任务 chip 只读
1. **场景**：用户在日历看到 📌 到期任务，想顺手标完成。
2. **当前**：点击只跳转待办页。
3. **期望**：chip 点击弹出小面板：完成 / 改期（复用现有 mutation）。
4. **根因**：Calendar 是纯展示层（架构文档早已标注 Task→Calendar 为 Partial）。
5. **最小修复**：`onItemClick` 对 task 类型弹轻量操作面板（完成/改期），不新建页面。
6. **优先级**：P2。
7. **成本**：M。

### #5（P2）Pomodoro ↔ Task 弱关联（无"专注该任务"）
1. **场景**：Today 时间线里"读LSTM论文"想开个番茄专注它。
2. **当前**：只能空白启动番茄，记录 `taskTitle='专注'`，与任务无关联。
3. **期望**：任务行提供"🍅 专注"按钮 → 启动番茄并绑定 `taskId/taskTitle` → 完成后 Stats 按任务聚合准确。
4. **根因**：番茄钟只有全局启动，无任务级入口。
5. **最小修复**：Today 时间线任务行加专注按钮（`setPomodoro({taskId, taskTitle, ...})` 启动）；复用现有 pomo 状态机，零新数据。
6. **优先级**：P2。
7. **成本**：M。

### #6（P2）凌晨番茄归属错日
1. **场景**：本地 00:30 完成的番茄被算到前一天。
2. **当前**：`completedAt=new Date().toISOString()`（UTC），Today `startsWith(dateKey)` 比对导致 UTC+8 的 00:00-08:00 错日。
3. **期望**：按本地日期归属（StatsView 已用 `format(...)` 正确实现，可对齐）。
4. **根因**：UTC ISO 字符串与本地日期键直接比对。
5. **最小修复**：`todayFocusMinutes` 改为 `format(new Date(completedAt), 'yyyy-MM-dd') === dateKey`（或集中提取本地日期工具 #7 一并解决）。
6. **优先级**：P2（数据准确性，频率低但错误确定）。
7. **成本**：S。

### #7（P3）重复工具代码（日期 ×7、事件类型 ×3）
1. **场景**：未来任何一处"本地日期"实现引入 bug（reminder.ts 已踩过该坑并在注释中警示）。
2. **当前**：7 处独立实现 `yyyy-MM-dd`。
3. **期望**：统一走 `lib/today.ts localDateKey`（或提升到 `lib/format.ts`），事件类型 meta 收口到 `lib/event.ts`。
4. **根因**：各阶段各自实现。
5. **最小修复**：提取共享函数 + 替换 7 处 + 事件 meta 导出。
6. **优先级**：P3（与 #6 一并做）。
7. **成本**：S。

### #8（P3）信息性提示 alert/toast 混用
1. **场景**：文献"同步到待办"成功后弹阻塞式 alert。
2. **当前**：LiteratureView 导入/同步/无目标、NewsView 正文失败用 `alert`；其余用 toast。
3. **期望**：信息性提示统一 toast（可带"查看"动作）；`confirm` 仅保留给破坏性操作。
4. **根因**：历史实现不一致。
5. **最小修复**：替换 4 处 alert 为 toast。
6. **优先级**：P3。
7. **成本**：S-M。

### #9（P3）三个小一致性：restore 跳转 / 导航分组 / Milestone 残留文案
1. **场景**：恢复备份后跳到"日历"（默认入口已变 Today）；导航"系统"组含非系统功能；里程碑提示"拖动滑块"但无滑块。
2. **当前**：`SettingsView` restore 后 `setView('calendar')`；`nav.slice(8)` 组标签"系统"；Milestone 卡片文案过期。
3. **期望**：restore 跳 Today；导航分组更名（如"工具"）；删除过期文案。
4. **根因**：Phase 2B 默认入口变更未同步到 Settings；历史文案未清理。
5. **最小修复**：三行改动。
6. **优先级**：P3。
7. **成本**：S。

### #10（P3）删除 Paper 后本地引用残留窗口期（可选）
1. **场景**：删除文献后，笔记的"来源论文"标签短暂消失再恢复（引擎解引用 + State Sync 修正）。
2. **当前**：renderer `deletePaper` 只过滤，不解引用；最终一致但存在窗口期。
3. **期望**：renderer 删除时同步清理 `notes[].paperIds / projects[].paperIds`（与 engine CROSS_ENTITY 语义一致）。
4. **根因**：renderer 侧缺少解引用（engine 已有）。
5. **最小修复**：`deletePaper` 加双向清理（注意与撤销恢复对称）。
6. **优先级**：P3（不可见损坏，建议 V1 收尾时顺手做）。
7. **成本**：M。

---

## 16. 跨功能互助机会（不新增模块）

- **#3 → #1 → #2**：Today 底栏"快速记录"唤起完整 QC（含预览与正确时间）→ 一次改动同时消掉 3 个 P1 的一半。
- **#5 专注按钮**：Today 任务行 🍅 → Pomodoro 绑定任务 → Stats 聚合更准 → 晚上 Stats 成为"复盘替代品"（为 V2 Review 铺路）。
- **Paper→Task 加 ID 回链（#11 可选）**：文献转待办携带 `paperId` → 未来 Knowledge 页可直接聚合。
- **News 存待办带默认 due（#12 可选）**：存为"明天"或可选项，让资讯任务落入 Today。
- Habit 打卡已在 Today ✓；QC Note 自动打 `#想法` 标签可让笔记页分类更自然（P3 可选）。

---

## 17. V1 结论

### A. 当前 V1 是否值得日常使用？
**值得**，且已经具备日常使用的骨架：Today 行动界面成立、同步/备份/恢复数据安全链路完整、Paper↔Note↔Project 科研闭环成立、QC 记录成本低、202 个测试全绿。**存在 3 个 P1 值得在 freeze 前修掉**（Today/Todo 快速添加丢时间、QC 无预览、Today 无 QC 入口），它们都落在"每天打开会用到的前两步"。

### B. 当前最大 5 个问题
1. 快速添加任务的时间丢失（Today/TodoView，与 QC 行为分裂）
2. Quick Capture 无创建前预览（用户不知道将创建什么）
3. Today 无 Quick Capture 入口（记想法路径断裂）
4. Calendar 中的任务只能看不能动（跨页跳转摩擦）
5. 番茄钟无法归属到具体任务（专注数据无法回流任务）

### C. 哪些功能已经足够好，不应继续折腾
- **同步链路**（Mutation→Main→Persist→State Sync + 版本冲突 + 冲突保留本地）
- **数据备份/导入/恢复**（Schema 校验 + 前置自动备份）
- **Paper↔Note↔Project 关系**（双向 + 删除解引用 + 一键阅读笔记）
- **Note 编辑器**（Markdown + DOMPurify + 标签）
- **日期解析**（Phase 2C 固定语义 + 回归测试）
- **Habit / Translation / Today 时间线**

### D. 哪些功能应进入 V2
1. **Review（每日/每周复盘）**——完成架构闭环 Plan→Execute→Review→Adjust，替代目前"Stats 数字没有解释"的空白（架构文档 Top3）
2. **Goal 轻量层**（Goal→Project→Task）——长期目标锚点（架构文档 Top4）
3. **Knowledge 统一入口**（Papers+Notes 统一列表 + 关系上下文 + 搜索）（架构文档 Top5）
4. **Pomodoro↔Task 聚合视图 + Task 级专注**（若 #5 未在 V1 做）
5. **AI Personal Copilot**（基于 Goals/Tasks/Calendar/Knowledge/Review 上下文，架构文档 Phase 2E）

### E. V1 是否可以正式 Freeze？
**修完 Top10 中的 1-5（3×P1 + 2×P2）后即可 Freeze**。剩余 P3 可在 freeze 后随 V2 前清理批次处理；#10/#11/#12 可选，不阻塞 freeze。

---

## 18. 路线

```
V1 Final Polish（本轮 Top10：先 1-3 个 P1，再 4-6 个 P2）
        ↓
V1 Freeze（数据格式冻结、行为冻结、仅修 P0/P1）
        ↓
V2（Review → Goal → Knowledge 统一入口 → Copilot，按价值排序）
```

**V2 最值得做的 3-5 件事（按用户价值排序）**：
1. **Review 每日/每周复盘**——补上"晚上复盘"这最后一步，直接提升"每天愿不愿意打开"
2. **Quick Capture → Today 联动强化**（若 V1 未做 #3/#1）——记录 3 秒完成、今日立即可见
3. **Goal 轻量层**——让任务流不再琐碎
4. **Knowledge 统一入口**——文献+笔记一处找
5. **Task 级番茄聚合**——让"专注在推进什么"可见

---

## 附：本阶段执行纪律

- 未修改任何产品代码（0 文件改动，工作区保持 clean）。
- 未引入 Goals/Review/Research Question/Copilot/Knowledge Graph/Offline/CRDT/WebSocket/SQLite 等任何新模块。
- 全部结论基于代码阅读与既有测试；性能/数据边界判断标注了证据位置。

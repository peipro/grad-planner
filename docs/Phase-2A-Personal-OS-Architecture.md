# Phase 2A · Personal OS Architecture（产品架构审视）

> 阶段性质：**产品架构审计**（只读，不修改代码）。
> 目标：回答 "grad-planner 到底应该是什么"，输出 Personal OS 架构设计，等待确认后再进入实现阶段。

---

## A. 产品定位（一句话）

> **grad-planner 是一个面向研究生的 Personal Operating System：统一管理科研、学习、生活、时间、目标、知识与执行状态，让用户不用思考"该打开哪个模块"。**

- 不是"科研功能集合"（Research OS）
- 不是普通 Todo App
- 科研是**重要领域**，不是产品唯一中心

---

## B. 一级信息架构（基于调查的重新设计，非照搬）

**现状导航**（12 项，功能平铺）：

```
日历 | 生日 | 习惯 | 待办 | 里程碑 | 文献 | 笔记 | 番茄钟 | 资讯 | 翻译 | 统计 | 设置
```

**目标信息架构**（认知模型分组）：

```
Today        ← 每日入口（今日时间线/任务/习惯/专注/逾期/快速记录）
Plan         ← 目标 → 项目 → 任务（规划层）
Knowledge    ← 文献 + 笔记 + 资讯 + 学习资料（统一知识层）
Research     ← 项目/文献/阅读/里程碑（科研工作区）
Life         ← 习惯/生日/生活事务（生活工作区）
Review       ← 每日/每周回顾（Plan→Execute→Review→Adjust 闭环）
System       ← 番茄钟/翻译/统计/设置（工具与系统）
```

**注意**：导航不一定要立即改——先确认认知模型。Tasks/Calendar/Notes 保持为跨领域横向能力，不塞进 Research/Life 二选一。

---

## C. 核心实体

**保留的现有核心对象**（16 个实体 + 配置）：

| 实体 | 领域 | 说明 |
|---|---|---|
| Task | Cross-domain | 统一任务（research/study/life 全靠它） |
| CalEvent | Cross-domain | 统一时间层 |
| Note | Knowledge | 统一知识（markdown + 关系） |
| Paper | Research | 文献 + 阅读状态 + 关系 |
| Project | Cross-domain | 当前顶层组织单元（弱实体） |
| Milestone | Research | 里程碑 + checkpoints |
| PomodoroRecord | Cross-domain | 执行层记录（taskId 弱引用） |
| Habit | Life | 习惯打卡（派生统计） |
| Birthday | Life | 生活事件 |
| PaperStage | Research | 阅读阶段枚举 |
| PomodoroState | 运行时 | renderer-only |

**评估结论**：
- 需要**新增 Goal 层**（Goal→Project→Task）——当前只有 Project 是顶层，无法表达"提高研究能力"这类长期目标（§9）
- 需要**新增 Review 结构**——当前 Review 缺失（§13）
- **不需要**新增 area/category 字段以外的实体——Task 加 `area` 字段即可支撑 Today 分区（§8）
- **不建议**为 Note 增加类型字段（Paper/Project 关系已表达来源，§15 已确认）

---

## D. 实体关系图

```
                    Goal（新增，Phase 2C）
                     ↓
┌─────────────────── Project ───────────────────┐
│   ↓(projectId)    ↓(projectIds)   ↓(noteIds)  │
│  Task             Paper          Note         │
│                     ↓(noteIds)    ↑(paperIds) │
│                   ┌─┴─┐                      │
│                   │ Reading │（paper 状态）    │
│                   └───┴────┘                 │
│  Milestone（projectId）                      │
└──────────────────────────────────────────────┘

Task ──(taskId)── PomodoroRecord      Task ──→ Calendar（展示）
Habit ──→ Stats（派生）                Birthday ──→ Calendar（展示）
News ──→ Note / Task（单向）            Translation ──→ 剪贴板（无知识落点）
```

**已连接（Phase 2A-Research 完成）**：Paper↔Note、Paper↔Project、Note↔Project（双向 + 删除解引用 + 同步）。

---

## E. 用户核心工作流

1. **Daily Planning**：Today 入口 → 看今日任务/日程/习惯 → 计划 → 执行（Task/Calendar/Pomodoro）
2. **Research**：Project → Paper → 阅读 → 一键创建阅读笔记 → 笔记回流 Project
3. **Study**：课程/学习任务 → 时间层（Calendar/Task）
4. **Life**：生活任务/习惯/生日 → 统一 Task + Calendar + Habit
5. **Knowledge Capture**：想法 → 快速记录 → Task/Calendar；News → Note；Paper → Note
6. **Review**：每日/每周 → 调整下周计划

---

## F. 当前孤岛（§19）

| 关系 | 状态 | 说明 |
|---|---|---|
| Paper → Note | ✅ Connected | Phase 2A-Research 完成 |
| Project → Paper | ✅ Connected | 同上 |
| Note → Project | ✅ Connected | 同上 |
| Paper → Task / Event | ✅ Connected | 文献转任务/日程（title 弱关联） |
| Task → Calendar | ⚠️ Partial | 日历展示任务，无双向操作 |
| Pomodoro → Task | ⚠️ Partial | taskId 弱引用，无"某任务专注时长"聚合视图 |
| News → Knowledge | ⚠️ Partial | News→Note 单向，无统一知识入口 |
| Translation → Note | ❌ Disconnected | 译文只能复制，不能一键存笔记 |
| Goal → Project | ❌ Disconnected | 无 Goal 层 |
| Habit → Review | ❌ Disconnected | 无 Review |
| Task → Review | ❌ Disconnected | 同上 |

---

## G. Top 5 优化方向（§21）

### 1. Today 统一入口 ⭐⭐⭐⭐⭐
- **用户问题**：每天打开 App 不知道今天要做什么；科研/学习/生活散落在 12 个模块
- **当前缺陷**：首页是 Calendar（activeView 默认），无"今日任务+日程+习惯+专注"汇聚
- **方案**：新增 Today 视图（今日时间线 + 今日任务分区 + 习惯打卡 + 逾期 + 快速记录）
- **成本**：中（复用现有数据，纯展示层）
- **价值**：最高（每日使用入口）
- **近期做**：✅

### 2. Task 增加 `area` 分类字段（research / study / life / admin）⭐⭐⭐⭐
- **用户问题**：无法在 Today/规划中区分科研与生活任务
- **当前缺陷**：Task 只有 projectId，无领域维度
- **方案**：Task 加可选 `area` 字段 + 快速添加解析（"生活 取快递"）+ Today 分区
- **成本**：低（字段 + diff 自动同步）
- **价值**：高（支撑 Today 与统一规划）
- **近期做**：✅

### 3. Review 每日/每周回顾 ⭐⭐⭐⭐
- **用户问题**：计划完成率、时间去向、科研进展无反馈，无法调整
- **当前缺陷**：Stats 只是统计数字，不回答"为什么没完成、下周改什么"
- **方案**：每日/每周回顾页（任务完成 + 番茄钟 + 习惯 + 自由记录）→ 引导调整
- **成本**：中
- **价值**：高（Plan→Execute→Review 闭环）
- **近期做**：✅（Phase 2C）

### 4. Goal 层（轻量）⭐⭐⭐
- **用户问题**：没有长期目标锚点，任务流于琐碎
- **当前缺陷**：Project 是顶层，无法表达 Goal→Project→Task
- **方案**：Goal 实体（标题/描述/目标日期）+ Goal↔Project 关系
- **成本**：低-中（新实体 + 关系复用 Phase 2A 机制）
- **价值**：中-高（长期价值）
- **近期做**：⚠️（Phase 2C，避免与 Today 抢优先级）

### 5. Knowledge 统一入口 ⭐⭐⭐
- **用户问题**：文献和笔记分散，无法统一浏览"我的知识"
- **当前缺陷**：Literature / Notes 是两个模块，虽有关系但无统一视图
- **方案**：Knowledge 视图（Papers + Notes 统一列表 + 关系上下文 + 搜索）
- **成本**：中
- **价值**：中-高
- **近期做**：⚠️

---

## H. Phase Roadmap

```
Phase 2A'   Personal OS 架构审视（本次）✅
Phase 2B    Today / 统一规划（Today 视图 + Task.area）
Phase 2C    Goals / Review（Goal 实体 + 每日/每周回顾）
Phase 2D    Research workflow 深化（Question 层、Pomodoro↔Task 聚合）
Phase 2E    AI Personal Copilot（基于 Goals/Tasks/Calendar/Knowledge/Review 上下文）
```

**决策标准**（§24）：任何新功能必须回答——"它是否让用户更容易管理今天、目标、知识、科研、生活？" 否则不做。

---

## 附：模块盘点摘要（§4）

| 模块 | 解决什么 | 领域 | 关系 | 价值 |
|---|---|---|---|---|
| Calendar | 时间事件 | Cross-domain | Tasks/Milestones/Birthdays 展示 | 高 |
| Tasks | 待办执行 | Cross-domain | Project/TaskId | 高 |
| Projects | 组织单元 | Cross-domain | Task/Milestone/Paper/Note | 中（弱实体） |
| Milestones | 阶段推进 | Research | Project | 中 |
| Notes | 知识沉淀 | Knowledge | Paper/Project | 高 |
| Papers | 文献管理 | Research | Note/Project/Task/Event | 高 |
| Reading 视图 | 阅读计划 | Research | Paper | 中 |
| Pomodoro | 专注执行 | Cross-domain | Task 弱引用 | 中-高 |
| Habits | 习惯养成 | Life | Stats | 中 |
| Birthdays | 生活事件 | Life | Calendar | 低-中 |
| News | 资讯输入 | Knowledge | Note/Task 单向 | 中 |
| Translation | 翻译工具 | 工具 | 无知识落点（孤岛） | 低-中 |
| Stats | 统计反馈 | Cross-domain | 全实体派生 | 中 |
| Settings | 系统配置 | 系统 | — | 必要 |

**断链优先级**：Today 缺失 > Review 缺失 > Goal 缺失 > Translation→Note > Pomodoro→Task 聚合。

---

## 结论（一句话）

> grad-planner 的定位应从"科研功能集合"升级为**研究生 Personal OS**：以 **Today** 为每日入口、**Task/Calendar/Note** 为跨领域横向能力、**Research/Life** 为领域工作区、**Goal/Review** 补齐长期闭环——第一阶段（本次）先确认架构，下一阶段从 **Today + Task.area** 落地。

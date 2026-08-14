# Phase 1B-3A Entity Migration Plan（Stage A 设计文档）

> 阶段目标：将剩余 7 个核心实体（Event / Project / Milestone / Paper / Habit / Birthday / Pomodoro）逐步迁入
> `Mutation → Main authoritative state → Persist → State Sync` 链路，消除 Task/Note 与新机制、其他实体走旧路径的**双轨状态**。
> 基线：`phase-1b-2-state-sync-complete`（f81fd5e），全量测试绿。
> 本阶段不实现：revision / same-entity conflict / CRDT / offline queue / WebSocket / SQLite。

---

## A. Entity Matrix

| Entity | 当前写入方式 | Mutation 已有 | 关联实体 | Transaction 风险 | 迁移优先级 |
|---|---|---|---|---|---|
| Task | persist diff → mutation（已迁移） | ✅ | Project（projectId）、Paper（文献转任务） | 无 | 已完 |
| Note | persist diff → mutation（已迁移） | ✅ | 无（Paper↔Note 未实现） | 无 | 已完 |
| Event | persist diff（diff 不覆盖 → 不同步） | ❌ | 无写联动；Calendar 只读展示 tasks/milestones/birthdays | 低 | **组 1** |
| Project | persist diff（不同步） | ❌ | Task（projectId）、Milestone（projectId） | **高：deleteProject 跨实体** | **组 1** |
| Milestone | persist diff（不同步） | ❌ | Project（projectId）、Task（todo 视图关联） | 中：deleteProject 波及 | **组 2** |
| Paper | persist diff（不同步） | ❌ | Task/Event（文献转出）、paperStages | **高：deletePaperStage 跨实体 + 批量导入** | **组 2** |
| Habit | persist diff（不同步） | ❌ | Stats（只读） | 低 | **组 3** |
| Birthday | persist diff（不同步） | ❌ | Calendar（只读） | 低 | **组 3** |
| Pomodoro | persist diff（不同步） | ❌ | Task（taskId 弱引用） | 低 | **组 3** |

**paperStages**（字符串数组，非对象实体）：纳入迁移（`paperStages.replace` 整组替换），随组 2。

---

## B. Mutation List

新增 mutation 类型（复用 `src/types.ts` 实体，不建第二套模型）：

```
event.create / event.update / event.delete
project.create / project.update / project.delete（engine 内嵌跨实体解引用）
milestone.create / milestone.update / milestone.delete
paper.create / paper.update / paper.delete
paperStages.replace（整组替换字符串数组）
habit.create / habit.update / habit.delete
birthday.create / birthday.update / birthday.delete
pomodoro.create / pomodoro.delete
```

- `update` 一律携带**全量实体**（与 Task/Note 契约一致）。
- `pomodoro` 无 update（业务只有 create/delete/clear）；`clearPomodoros` 表达为 `pomodoro.delete × N`（或新增 `pomodoro.clear` 批量，见 C）。
- 校验规则（宽松，关键字段合法即可）：复用 Task/Note 已有的 `makeValidator` 工厂泛型化：
  - event: id/title 必须；start/end 若提供须为非空字符串
  - project: id/name 必须
  - milestone: id/title 必须；progress 0-100 数值；checkpoints 数组
  - paper: id/title 必须；status ∈ {unread, reading, read}
  - habit: id/name 必须；records 数组
  - birthday: id/name 必须；calendarType ∈ {lunar, solar}
  - pomodoro: id/taskTitle 必须；minutes 数值

---

## C. Cross-Entity Operations（Transaction 边界）

### C1. `project.delete`（强事务，engine 内嵌）

```
当前 store 行为（store.ts deleteProject）：
  projects 移除该 id
  tasks 中 projectId === id → projectId: undefined
  milestones 中 projectId === id → projectId: undefined
```

**设计决策：transaction 必须在 engine（权威侧）执行，而非 renderer 展开。**

理由：若 renderer 展开（本地读 tasks/milestones 生成 update batch），当平板刚修改过某 task 而 renderer 本地快照未同步时，会基于**过期快照**覆盖权威。engine 侧基于**权威 state**原子展开，杜绝该窗口。

Engine 实现：`project.delete` 收到后，在 working copy 上同时执行：
```
working.projects = filter(id !== m.id)
working.tasks = tasks.map(t => t.projectId === m.id ? {...t, projectId: undefined} : t)
working.milestones = milestones.map(m => m.projectId === id ? {...m, projectId: undefined} : m)
```
一次 persist、一次 state-sync。✅ 满足 §12。

### C2. `paperStage.delete`（强事务，engine 内嵌）

```
当前 store 行为（store.ts deletePaperStage）：
  paperStages 移除该 name
  papers 中 stage === name → stage: '未分类'
```

Engine：`paperStage.delete`（kind=paperStage, op=delete）→ 移除 + 重设 papers.stage。

### C3. 批量操作（batch mutation）

- `importPapers / importTasks / importEvents`：去重后批量 create（同实体 batch，一次提交）。Renderer 侧仍用原 action（本地乐观），diff 自然生成批量 create。
- `batchSetPaperStatus`：批量 update（同实体 batch）。
- 文献→Task：批量 create/update tasks（现有循环；diff 生成 batch）。
- `clearPomodoros`：表达为一次 batch `[pomodoro.delete × N]`（renderer diff 自然生成；无专用 mutation）。

### C4. 整体替换（import / restore / resetAll）

- `importData / applyData / resetAll`：本地整体 setState（保持现状），随后 persist diff 生成**全量 mutation**（所有实体的 create/delete）提交到权威。Engine 原子批处理保证整体一致。
- **已知边界**：全量替换与"另一端的并发修改"是 LWW（整体胜出）——记录为 same-entity/whole-state conflict，Phase 1B-3B，不在本阶段解决。

---

## D. 实施顺序（§8 推荐 + 组内分批）

```
组 1（core）：Event + Project（含 project.delete 事务）
  → docs 更新 → engine 泛型化(9 实体 + paperStages) → sync-adapter 通用 diff → 测试 → 双端人工验证
  → tag: phase-1b-3a-core-mutations-complete

组 2（research）：Milestone + Paper + paperStages（含 paperStage.delete 事务）
  → 测试 → 双端验证
  → tag: phase-1b-3a-research-mutations-complete

组 3（life）：Habit + Birthday + Pomodoro
  → 测试 → 双端验证
  → tag: phase-1b-3a-all-entities-complete
```

每组独立 commit，全量回归（npm test / node --test / build / lint）通过后才进入下一组。

---

## E. Engine 泛型化设计（electron/mutation-engine.cjs）

- 将现有 Task/Note 的 `validateEntity` 重构为 `ENTITY_CONFIG` 表（kind → { field, validate }），覆盖 9 个对象实体 + `paperStages`（无 id，仅 replace）。
- 新增 engine 内嵌事务：`project.delete`、`paperStage.delete`（C1/C2）。
- `applyOne` 保持单条语义；事务在 `applyOne` 内完成（同 working copy），batch 原子性不变（任一失败整体不持久化）。
- 存储格式不变（`{state, version}`）；`validateStorageShape`（storage-schema.cjs）已覆盖全部数组字段，最终校验兜底无需改动。

## F. sync-adapter 通用 diff（public/sync-adapter.js）

现有 diff 显式处理 tasks/notes。§14 建议评估通用化——采用**字段表驱动**（低复杂度，避免复制粘贴）：

```js
var ENTITY_FIELDS = [
  { field: 'events', kind: 'event' },
  { field: 'tasks', kind: 'task' },
  { field: 'milestones', kind: 'milestone' },
  { field: 'notes', kind: 'note' },
  { field: 'pomodoros', kind: 'pomodoro' },
  { field: 'birthdays', kind: 'birthday' },
  { field: 'habits', kind: 'habit' },
  { field: 'projects', kind: 'project' },
  { field: 'papers', kind: 'paper' },
]
// 对象实体：按 id diff → create / update / delete
// paperStages（字符串数组）：JSON 内容不同 → { type: 'paperStages.replace', payload }
```

- 排序稳定性：diff 按字段表顺序输出，create 顺序与数组顺序一致（避免无意义顺序抖动）。
- 防循环机制（`__gradSyncMarkAuthoritative`）不变：state-sync 应用后 diff 为空 → 不产生 mutation。

## G. Renderer 侧改动

- **store actions 全部保留**（乐观本地更新 + persist diff → mutation），不做 UI/Store 重构（§2 禁止）。
- **不改**：`src/types.ts` / `src/data/*`（复用）。
- SettingsView import/restore/resetAll 保持现状（C4）。

## H. 测试计划

1. **engine 单元测试**（node）：9 实体 create/update/delete + paperStages.replace + 校验错误分类；
   `project.delete` 事务（关联 task/milestone 解引用、原子性、未关联实体不受影响）；
   `paperStage.delete` 事务；batch 原子性（含跨实体 batch）。
2. **diff 测试**（vitest，**真实 persist payload**）：各实体变更生成正确 mutation；跨实体并发变更合并；state-sync 后不产生 mutation（防循环）；paperStages 变更 → replace。
3. **双端集成**（lan-server.test）：POST /api/mutations 各实体；`project.delete` 通过 HTTP 后权威正确。
4. **人工双端验证**（每组装 tag 前）：Desktop↔Tablet 各实体 CRUD + project.delete 跨实体 + 双端不同实体并发（C/D 场景）。

## I. 风险与决策记录

| 项 | 决策 |
|---|---|
| 跨实体事务位置 | **engine 权威侧**（非 renderer 展开），杜绝过期快照覆盖 |
| paperStages | replace 整组（无 id 实体，diff 内容比较） |
| import/restore/resetAll | 保持本地整体替换 + diff 全量同步（batch 原子） |
| clearPomodoros | diff 生成批量 delete，无专用 mutation |
| 双端同实体并发 | LWW（到达序），记录到 Phase 1B-3B，本阶段不做 |

## J. 遗留（DEFERRED）

- same-entity conflict（revision / conflict UI）→ Phase 1B-3B
- offline sync → Phase 1B future
- Paper↔Note 反链（未实现的业务功能，非本阶段范围）
- 全量替换（import）与并发修改的 whole-state conflict → Phase 1B-3B

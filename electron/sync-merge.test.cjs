const test = require('node:test')
const assert = require('node:assert')
const { applySubmit, emptyEnvelope } = require('./sync-merge.cjs')

const mkSubmit = (over) => ({ expectedRevision: 0, changedIds: [], deletedIds: [], data: {}, ...over })

// ===== Task 3: revision 乐观并发 =====

test('revision 单调递增：连续提交 revision +1，不回退', async () => {
  const env0 = await emptyEnvelope('server')
  let cur = JSON.stringify(env0)
  let lastRevision = 0
  for (let i = 1; i <= 5; i++) {
    const r = await applySubmit({
      currentText: cur,
      submit: mkSubmit({ expectedRevision: lastRevision, data: { tasks: [{ id: 't1', title: `v${i}` }] }, changedIds: ['tasks:t1'] }),
      deviceId: 'dev', writeId: `w${i}`,
    })
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.revision, i)
    lastRevision = i
    cur = JSON.stringify(r.envelope)
  }
})

test('Scenario C: 旧 revision 提交（stale write）→ 409，绝不覆盖新数据', async () => {
  const env0 = await emptyEnvelope('server')
  // Tablet 先写（revision 0 → 1）
  const t1 = await applySubmit({ currentText: JSON.stringify(env0), submit: mkSubmit({ expectedRevision: 0, data: { tasks: [{ id: 't1', title: '平板写入' }] }, changedIds: ['tasks:t1'] }), deviceId: 'tablet', writeId: 'tw1' })
  assert.strictEqual(t1.ok, true)
  // Desktop 用旧 revision 0 提交 → 409
  const stale = await applySubmit({ currentText: JSON.stringify(t1.envelope), submit: mkSubmit({ expectedRevision: 0, data: { tasks: [{ id: 't1', title: '桌面旧数据' }] }, changedIds: ['tasks:t1'] }), deviceId: 'desktop', writeId: 'dw1' })
  assert.strictEqual(stale.ok, false)
  assert.strictEqual(stale.status, 409)
  assert.strictEqual(stale.serverData.tasks[0].title, '平板写入', '服务端数据必须保持不变')
})

test('网络中断恢复：客户端基于过期 revision 提交不覆盖远程新数据', async () => {
  const env0 = await emptyEnvelope('server')
  let cur = JSON.stringify(env0)
  // 模拟：Tablet 读到 revision 0 后断网
  // 期间 Desktop 连续写 3 次（revision 3）
  let rev = 0
  for (let i = 1; i <= 3; i++) {
    const r = await applySubmit({ currentText: cur, submit: mkSubmit({ expectedRevision: rev, data: { tasks: [{ id: 't1', title: `桌面v${i}` }] }, changedIds: ['tasks:t1'] }), deviceId: 'desktop', writeId: `d${i}` })
    rev = r.revision
    cur = JSON.stringify(r.envelope)
  }
  // Tablet 网络恢复，用旧 revision 0 提交 → 409
  const r = await applySubmit({ currentText: cur, submit: mkSubmit({ expectedRevision: 0, data: { tasks: [{ id: 't1', title: '平板离线修改' }] }, changedIds: ['tasks:t1'] }), deviceId: 'tablet', writeId: 'tw' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.status, 409)
  assert.strictEqual(r.serverData.tasks[0].title, '桌面v3')
})

test('旧数据（Phase 0 无 envelope）迁移：revision 0 可直接接受提交', async () => {
  // 旧格式：整份 state（无 schemaVersion/revision）
  const legacy = JSON.stringify({ tasks: [{ id: 't1', title: '旧任务' }], theme: { mode: 'dark' } })
  const r = await applySubmit({
    currentText: legacy,
    submit: mkSubmit({ expectedRevision: 0, data: { tasks: [{ id: 't1', title: '旧任务' }], theme: { mode: 'dark' } }, changedIds: ['tasks:t1'] }),
    deviceId: 'desktop', writeId: 'w',
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.revision, 1)
  assert.strictEqual(r.envelope.data.tasks[0].title, '旧任务')
  assert.strictEqual(r.envelope.data.theme.mode, 'dark', '配置字段保留')
})

test('空存储文件（无数据）：首次提交可接受', async () => {
  const r = await applySubmit({
    currentText: JSON.stringify(await emptyEnvelope('server')),
    submit: mkSubmit({ expectedRevision: 0, data: { tasks: [] }, changedIds: [] }),
    deviceId: 'dev', writeId: 'w',
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.revision, 1)
})

test('非法提交（data 缺失）→ 拒绝', async () => {
  const r = await applySubmit({ currentText: JSON.stringify(await emptyEnvelope('s')), submit: { expectedRevision: 0 }, deviceId: 'd', writeId: 'w' })
  assert.strictEqual(r.ok, false)
})

// ===== Task 5: 最小实体级 merge =====

// 初始状态：Task A + Note B 存在（revision 1）
async function initState() {
  const env0 = await emptyEnvelope('server')
  const init = await applySubmit({
    currentText: JSON.stringify(env0),
    submit: mkSubmit({
      expectedRevision: 0,
      data: { tasks: [{ id: 'A', title: '读LSTM' }], notes: [{ id: 'B', title: '初始笔记' }] },
      changedIds: ['tasks:A', 'notes:B'],
    }),
    deviceId: 'init', writeId: 'i0',
  })
  return init
}

test('Scenario A: 双端修改不同实体 → 自动合并，两边修改都保留', async () => {
  const init = await initState()
  // Desktop 修改 Task A（revision 1 → 2）
  const desktop = await applySubmit({
    currentText: JSON.stringify(init.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: '读LSTM-桌面改' }], notes: [{ id: 'B', title: '初始笔记' }] }, changedIds: ['tasks:A'] }),
    deviceId: 'desktop', writeId: 'd1',
  })
  assert.strictEqual(desktop.ok, true)
  assert.strictEqual(desktop.revision, 2)
  // Tablet 基于 revision 1 修改 Note B（stale）
  const tablet = await applySubmit({
    currentText: JSON.stringify(desktop.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: '读LSTM' }], notes: [{ id: 'B', title: '平板改的笔记' }] }, changedIds: ['notes:B'] }),
    deviceId: 'tablet', writeId: 't1',
  })
  assert.strictEqual(tablet.ok, true, '不同实体并发应自动合并')
  assert.strictEqual(tablet.revision, 3)
  assert.strictEqual(tablet.envelope.data.tasks[0].title, '读LSTM-桌面改', 'Task A 保留桌面修改')
  assert.strictEqual(tablet.envelope.data.notes[0].title, '平板改的笔记', 'Note B 保留平板修改')
})

test('Scenario B: 双端修改同一实体 → 409 冲突（不静默覆盖）', async () => {
  const init = await initState()
  const desktop = await applySubmit({
    currentText: JSON.stringify(init.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: '读LSTM-桌面改' }], notes: [{ id: 'B', title: '初始笔记' }] }, changedIds: ['tasks:A'] }),
    deviceId: 'desktop', writeId: 'd1',
  })
  // Tablet 基于 revision 1 也修改 Task A → 真冲突
  const tablet = await applySubmit({
    currentText: JSON.stringify(desktop.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: '读Transformer-平板改' }], notes: [{ id: 'B', title: '初始笔记' }] }, changedIds: ['tasks:A'] }),
    deviceId: 'tablet', writeId: 't1',
  })
  assert.strictEqual(tablet.ok, false)
  assert.strictEqual(tablet.status, 409)
  assert.strictEqual(tablet.conflicts.length, 1)
  assert.strictEqual(tablet.conflicts[0].id, 'tasks:A')
  assert.strictEqual(tablet.serverData.tasks[0].title, '读LSTM-桌面改', '服务端数据不变')
  assert.strictEqual(tablet.clientData.tasks[0].title, '读Transformer-平板改', '冲突时返回客户端数据供 UI 提示')
})

test('Scenario D: 删除冲突（Desktop 删 Task A，Tablet 改 Task A）→ 409', async () => {
  const init = await initState()
  // Desktop 删除 Task A（revision 1 → 2）
  const desktop = await applySubmit({
    currentText: JSON.stringify(init.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { tasks: [], notes: [{ id: 'B', title: '初始笔记' }] }, deletedIds: ['tasks:A'] }),
    deviceId: 'desktop', writeId: 'd1',
  })
  assert.strictEqual(desktop.ok, true)
  assert.strictEqual(desktop.envelope.data.tasks.length, 0)
  // Tablet 基于 revision 1 修改 Task A → 冲突（不允许静默数据丢失）
  const tablet = await applySubmit({
    currentText: JSON.stringify(desktop.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: '修改已删除的任务' }], notes: [{ id: 'B', title: '初始笔记' }] }, changedIds: ['tasks:A'] }),
    deviceId: 'tablet', writeId: 't1',
  })
  assert.strictEqual(tablet.ok, false)
  assert.strictEqual(tablet.status, 409)
})

test('反向删除冲突（Desktop 改 Task A，Tablet 删 Task A）→ 409', async () => {
  const init = await initState()
  const desktop = await applySubmit({
    currentText: JSON.stringify(init.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: '桌面修改' }], notes: [{ id: 'B', title: '初始笔记' }] }, changedIds: ['tasks:A'] }),
    deviceId: 'desktop', writeId: 'd1',
  })
  const tablet = await applySubmit({
    currentText: JSON.stringify(desktop.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { notes: [{ id: 'B', title: '初始笔记' }] }, deletedIds: ['tasks:A'] }),
    deviceId: 'tablet', writeId: 't1',
  })
  assert.strictEqual(tablet.ok, false)
  assert.strictEqual(tablet.status, 409)
})

test('无冲突删除：客户端删除服务端未改过的实体 → 正常删除', async () => {
  const init = await initState()
  // Tablet 基于 revision 1 删除 Note B（Desktop 只改过 Task A，未改 Note B）
  const desktop = await applySubmit({
    currentText: JSON.stringify(init.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: '读LSTM-桌面改' }], notes: [{ id: 'B', title: '初始笔记' }] }, changedIds: ['tasks:A'] }),
    deviceId: 'desktop', writeId: 'd1',
  })
  const tablet = await applySubmit({
    currentText: JSON.stringify(desktop.envelope),
    submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: '读LSTM-桌面改' }] }, deletedIds: ['notes:B'] }),
    deviceId: 'tablet', writeId: 't1',
  })
  assert.strictEqual(tablet.ok, true, '删除未被服务端改过的实体应成功')
  assert.strictEqual(tablet.envelope.data.notes.length, 0)
  assert.strictEqual(tablet.envelope.data.tasks[0].title, '读LSTM-桌面改', '桌面修改保留')
})

test('同实体冲突后实体版本正确：下次基于新 revision 提交可恢复', async () => {
  const init = await initState()
  const desktop = await applySubmit({ currentText: JSON.stringify(init.envelope), submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: 'D版' }], notes: [{ id: 'B', title: '初始笔记' }] }, changedIds: ['tasks:A'] }), deviceId: 'desktop', writeId: 'd1' })
  // Tablet 冲突
  const tablet = await applySubmit({ currentText: JSON.stringify(desktop.envelope), submit: mkSubmit({ expectedRevision: 1, data: { tasks: [{ id: 'A', title: 'T版' }], notes: [{ id: 'B', title: '初始笔记' }] }, changedIds: ['tasks:A'] }), deviceId: 'tablet', writeId: 't1' })
  assert.strictEqual(tablet.status, 409)
  // Tablet 用服务端最新 revision 提交（用户选择"保留本机"）→ 无冲突接受
  const retry = await applySubmit({ currentText: JSON.stringify(desktop.envelope), submit: mkSubmit({ expectedRevision: 2, data: { tasks: [{ id: 'A', title: 'T版最终' }], notes: [{ id: 'B', title: '初始笔记' }] }, changedIds: ['tasks:A'] }), deviceId: 'tablet', writeId: 't2' })
  assert.strictEqual(retry.ok, true)
  assert.strictEqual(retry.revision, 3)
  assert.strictEqual(retry.envelope.data.tasks[0].title, 'T版最终')
})

// ===== Scenario E/F: fs.watch 来源判断基础（writeId/deviceId） =====

test('Scenario E/F: envelope 携带写入者 deviceId + writeId（fs.watch 来源判断依据）', async () => {
  const env0 = await emptyEnvelope('server')
  const r = await applySubmit({ currentText: JSON.stringify(env0), submit: mkSubmit({ expectedRevision: 0, data: { tasks: [] } }), deviceId: 'desktop-abc', writeId: 'write-xyz' })
  assert.strictEqual(r.envelope.deviceId, 'desktop-abc')
  assert.strictEqual(r.envelope.writeId, 'write-xyz')
})

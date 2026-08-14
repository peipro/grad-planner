const test = require('node:test')
const assert = require('node:assert')

// sync-core.js 是 UMD：项目 package.json 为 type:module，.js 按 ESM 加载，
// UMD 在 ESM 下走 else 分支（挂到 globalThis.SyncCore），故 import 后从 globalThis 读取。
;(async () => {
  await import('../public/sync-core.js')
  const { collectEntities, unwrapEnvelope, buildEnvelope, diffEntities } = globalThis.SyncCore

  test('collectEntities：按 type:id 提取全部实体', () => {
    const state = {
      tasks: [{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }],
      notes: [{ id: 'n1', title: 'note' }],
      events: [],
      papers: [{ id: 'p1', title: 'paper' }],
      milestones: 'not-array', // 忽略非数组
    }
    const map = collectEntities(state)
    assert.deepStrictEqual(Object.keys(map).sort(), ['notes:n1', 'papers:p1', 'tasks:t1', 'tasks:t2'])
    assert.strictEqual(map['tasks:t1'].title, 'A')
  })

  test('collectEntities：空/非法输入返回空对象', () => {
    assert.deepStrictEqual(collectEntities(null), {})
    assert.deepStrictEqual(collectEntities('x'), {})
    assert.deepStrictEqual(collectEntities({}), {})
  })

  test('unwrapEnvelope：新格式（含 revision）', () => {
    const env = { schemaVersion: 1, revision: 12, deviceId: 'dev-1', writeId: 'w-1', updatedAt: 'x', entityVersions: { 'tasks:t1': 5 }, data: { tasks: [] } }
    const u = unwrapEnvelope(JSON.stringify(env))
    assert.strictEqual(u.revision, 12)
    assert.strictEqual(u.deviceId, 'dev-1')
    assert.strictEqual(u.writeId, 'w-1')
    assert.deepStrictEqual(u.entityVersions, { 'tasks:t1': 5 })
    assert.deepStrictEqual(u.data, { tasks: [] })
  })

  test('unwrapEnvelope：旧格式（无 envelope）→ revision=0，data=原内容', () => {
    const legacy = JSON.stringify({ tasks: [{ id: 't1', title: '旧任务' }], theme: { mode: 'dark' } })
    const u = unwrapEnvelope(legacy)
    assert.strictEqual(u.revision, 0)
    assert.strictEqual(u.deviceId, '')
    assert.deepStrictEqual(u.data.tasks, [{ id: 't1', title: '旧任务' }])
    assert.deepStrictEqual(u.data.theme, { mode: 'dark' }) // 配置保留
  })

  test('unwrapEnvelope：非法输入返回 null', () => {
    assert.strictEqual(unwrapEnvelope(''), null)
    assert.strictEqual(unwrapEnvelope('not json'), null)
    assert.strictEqual(unwrapEnvelope(null), null)
    assert.strictEqual(unwrapEnvelope('[1,2,3]'), null)
  })

  test('buildEnvelope：结构完整', () => {
    const env = buildEnvelope({ tasks: [] }, 7, 'dev-9', 'w-9', {})
    assert.strictEqual(env.schemaVersion, 1)
    assert.strictEqual(env.revision, 7)
    assert.strictEqual(env.deviceId, 'dev-9')
    assert.strictEqual(env.writeId, 'w-9')
    assert.ok(typeof env.updatedAt === 'string' && env.updatedAt.length > 0)
    assert.deepStrictEqual(env.data, { tasks: [] })
  })

  test('diffEntities：新增/修改/删除/无变化', () => {
    const prev = { tasks: [{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }], notes: [{ id: 'n1', title: 'x' }] }
    // 修改 t1、新增 t3、删除 n1、t2 不变
    const next = { tasks: [{ id: 't1', title: 'A2' }, { id: 't2', title: 'B' }, { id: 't3', title: 'C' }], notes: [] }
    const d = diffEntities(prev, next)
    assert.deepStrictEqual(d.changedIds.sort(), ['tasks:t1', 'tasks:t3'])
    assert.deepStrictEqual(d.deletedIds, ['notes:n1'])
  })

  test('diffEntities：无变化时为空', () => {
    const s = { tasks: [{ id: 't1', title: 'A' }] }
    const d = diffEntities(s, JSON.parse(JSON.stringify(s)))
    assert.deepStrictEqual(d.changedIds, [])
    assert.deepStrictEqual(d.deletedIds, [])
  })
})()

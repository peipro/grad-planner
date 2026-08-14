import { describe, it, expect, vi, afterEach } from 'vitest'
import { performPrepareFlush, PREPARE_FLUSH_EVENT } from './reload-flush'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('performPrepareFlush（renderer flush 协议，事件驱动）', () => {
  it('Case A: 有草稿 handler 时，最新值被推给主进程并 ACK', async () => {
    let committed = 'note-content-in-draft'
    const commit = () => {
      committed = 'note-content-updated'
    }
    window.addEventListener(PREPARE_FLUSH_EVENT, commit)

    const sent: string[] = []
    const ack = vi.fn().mockResolvedValue(true)
    const api = {
      syncStorageSet: async (s: string) => { sent.push(s); return { ok: true } },
      flushAck: ack,
    }

    await performPrepareFlush(api, () => JSON.stringify({ notes: [{ content: committed }] }))

    expect(committed).toBe('note-content-updated') // 草稿已提交
    expect(sent).toEqual([JSON.stringify({ notes: [{ content: 'note-content-updated' }] })]) // 推送的是最新值
    expect(ack).toHaveBeenCalledTimes(1)
    window.removeEventListener(PREPARE_FLUSH_EVENT, commit)
  })

  it('Case B: 多个 handler（如 Note 标题/正文）依次提交，全部生效', async () => {
    let title = 'draft-title'
    let body = 'draft-body'
    const commitA = () => { title = 'final-title' }
    const commitB = () => { body = 'final-body' }
    window.addEventListener(PREPARE_FLUSH_EVENT, commitA)
    window.addEventListener(PREPARE_FLUSH_EVENT, commitB)

    const sent: string[] = []
    await performPrepareFlush(
      { syncStorageSet: async (s) => { sent.push(s); return { ok: true } }, flushAck: async () => true },
      () => JSON.stringify({ t: title, b: body }),
    )

    expect(title).toBe('final-title')
    expect(body).toBe('final-body')
    expect(sent[0]).toContain('final-title')
    expect(sent[0]).toContain('final-body')
    window.removeEventListener(PREPARE_FLUSH_EVENT, commitA)
    window.removeEventListener(PREPARE_FLUSH_EVENT, commitB)
  })

  it('Case C: 无注册 handler 时无额外副作用，正常 ACK', async () => {
    const sent: string[] = []
    const ack = vi.fn().mockResolvedValue(true)
    await performPrepareFlush(
      { syncStorageSet: async (s) => { sent.push(s); return { ok: true } }, flushAck: ack },
      () => '{"empty":true}',
    )
    expect(sent).toEqual(['{"empty":true}'])
    expect(ack).toHaveBeenCalledTimes(1)
  })

  it('syncStorageSet 失败时抛错（由调用方兜底 ACK，主进程有超时保护）', async () => {
    const failing = { syncStorageSet: async () => { throw new Error('ipc error') }, flushAck: async () => true }
    await expect(performPrepareFlush(failing, () => '{}')).rejects.toThrow('ipc error')
  })
})

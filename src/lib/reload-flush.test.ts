import { describe, it, expect, vi, afterEach } from 'vitest'
import { performPrepareFlush, PREPARE_FLUSH_EVENT } from './reload-flush'

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as any).__gradSyncFlush
})

describe('performPrepareFlush（renderer flush 协议，事件 + 提交队列驱动）', () => {
  it('Case A: 有草稿 handler 时草稿提交，等待提交队列排空后 ACK', async () => {
    let committed = ''
    window.addEventListener(PREPARE_FLUSH_EVENT, () => { committed = 'note-content-updated' })

    // 模拟 sync-adapter 的 flush 接口（提交队列）
    let flushed = false
    ;(window as any).__gradSyncFlush = vi.fn().mockImplementation(() => new Promise<void>((r) => setTimeout(() => { flushed = true; r() }, 5)))

    const ack = vi.fn().mockResolvedValue(true)
    await performPrepareFlush({ flushAck: ack })

    expect(committed).toBe('note-content-updated') // 草稿已提交
    expect(flushed).toBe(true) // 提交队列已排空
    expect(ack).toHaveBeenCalledTimes(1)
    window.removeEventListener(PREPARE_FLUSH_EVENT, () => {})
  })

  it('Case C: 无 flush 接口（降级）时直接 ACK，无副作用', async () => {
    const ack = vi.fn().mockResolvedValue(true)
    await performPrepareFlush({ flushAck: ack })
    expect(ack).toHaveBeenCalledTimes(1)
  })

  it('flush 接口失败时抛错（由调用方兜底 ACK）', async () => {
    ;(window as any).__gradSyncFlush = vi.fn().mockRejectedValue(new Error('flush failed'))
    await expect(performPrepareFlush({ flushAck: async () => true })).rejects.toThrow('flush failed')
  })
})

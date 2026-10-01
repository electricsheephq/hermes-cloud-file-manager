import { createTestContext, host } from './sdk-mock'
import plugin, { isNotFoundError } from '../plugin'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
// Exactly what Electron hands the renderer: the status only survives inside the message text.
const ipcError = (status: number) => new Error(`Error invoking remote method 'hermes:api': Error: ${status}: {"detail":"Plugin not found"}`)

describe('availability gate', () => {
  it('always registers the page route and adds the sidebar row only after /available answers', async () => {
    const t = createTestContext({ rest: async () => ({ ok: true }) })
    plugin.register(t.ctx as any)
    expect(t.live.has('page')).toBe(true)
    await flush()
    expect(t.live.get('nav')?.data).toMatchObject({ label: 'Cloud Files', path: '/cloud-files', codicon: 'cloud' })
  })

  it('removes the row only on a definite 404 and ignores transport errors', async () => {
    let answer: () => Promise<unknown> = async () => ({ ok: true })
    const t = createTestContext({ rest: () => answer() })
    plugin.register(t.ctx as any)
    await flush()
    expect(t.live.has('nav')).toBe(true)

    answer = async () => {
      throw new Error('connect ECONNREFUSED')
    }
    t.tickIntervals()
    await flush()
    expect(t.live.has('nav')).toBe(true)

    answer = async () => {
      throw ipcError(404)
    }
    t.tickIntervals()
    await flush()
    expect(t.live.has('nav')).toBe(false)
    expect(t.live.has('page')).toBe(true)
  })

  it('re-probes when the selected agent changes', async () => {
    const calls: string[] = []
    const t = createTestContext({ rest: async path => (calls.push(path), { ok: true }) })
    plugin.register(t.ctx as any)
    const before = calls.length
    host.state.profile.set('other')
    await flush()
    expect(calls.length).toBeGreaterThan(before)
    t.dispose()
  })

  it('ignores a late answer from a probe for the previous agent', async () => {
    const pending: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
    const t = createTestContext({ rest: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
    plugin.register(t.ctx as any)
    host.state.profile.set('agent-b') // second probe starts while the first is still pending
    pending[1].resolve({ ok: true }) // newest probe: agent-b has the plugin
    await flush()
    expect(t.live.has('nav')).toBe(true)
    pending[0].reject(ipcError(404)) // stale probe for the previous agent answers late
    await flush()
    expect(t.live.has('nav')).toBe(true)
    t.dispose()
  })

  it('parses 404 out of IPC error text', () => {
    expect(isNotFoundError(ipcError(404))).toBe(true)
    expect(isNotFoundError(ipcError(500))).toBe(false)
    expect(isNotFoundError(new Error('timeout after 4040ms'))).toBe(false)
  })
})

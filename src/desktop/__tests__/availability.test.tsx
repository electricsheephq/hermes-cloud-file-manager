import { createTestContext, host } from './sdk-mock'
import { $available, httpStatus } from '../api'
import { $insertText, $pickerOpen } from '../picker'
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

  it('adds and removes the + → Cloud provider and its picker host together with the row', async () => {
    let answer: () => Promise<unknown> = async () => ({ ok: true })
    const t = createTestContext({ rest: () => answer() })
    plugin.register(t.ctx as any)
    await flush()
    expect(t.live.get('attach-cloud')).toMatchObject({ area: 'composer.attachments', data: { label: 'Cloud', icon: 'cloud' } })
    expect(t.live.get('picker-host')?.area).toBe('composer.underside')
    expect($available.get()).toBe(true)

    answer = async () => {
      throw new Error('Error invoking remote method: timed out')
    }
    t.tickIntervals()
    await flush()
    expect(t.live.has('attach-cloud')).toBe(true)

    answer = async () => {
      throw ipcError(404)
    }
    t.tickIntervals()
    await flush()
    expect([t.live.has('nav'), t.live.has('attach-cloud'), t.live.has('picker-host')]).toEqual([false, false, false])
    expect($available.get()).toBe(false)
    expect(t.live.has('page')).toBe(true)
    t.dispose()
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

  it('takes the status from the IPC format only, never from "404" inside a body (N1)', () => {
    const ipc = (text: string) => new Error(`Error invoking remote method 'hermes:api': Error: ${text}`)
    expect(isNotFoundError(ipc('500: {"detail":"cannot list docs/404/report"}'))).toBe(false)
    expect(isNotFoundError(ipc('403: {"detail":"forbidden: see 404 page"}'))).toBe(false)
    expect(isNotFoundError(ipc('404: {"detail":"No such API endpoint"}'))).toBe(true)
    expect(isNotFoundError(new Error('404: Not Found'))).toBe(true)
    expect(isNotFoundError(new Error('connect ECONNREFUSED 10.0.0.1:404'))).toBe(false)
  })

  it('prefers an anchored leading status over an IPC-looking pattern nested in the body (N1)', () => {
    const ipc = (text: string) => new Error(`Error invoking remote method 'hermes:api': Error: ${text}`)
    expect(httpStatus(new Error('500: {"detail":"Error: 404: nested"}'))).toBe(500)
    expect(httpStatus(new Error('403: {"detail":"denied; Error: 404: nested"}'))).toBe(403)
    expect(httpStatus(ipc('404: {"detail":"No such API endpoint"}'))).toBe(404)
    expect(httpStatus(ipc('500: {"detail":"Error: 404: nested"}'))).toBe(500)
    expect(isNotFoundError(new Error('500: {"detail":"Error: 404: nested"}'))).toBe(false)
  })

  it('keeps the row when a non-404 error mentions 404 in its body (N1)', async () => {
    let answer: () => Promise<unknown> = async () => ({ ok: true })
    const t = createTestContext({ rest: () => answer() })
    plugin.register(t.ctx as any)
    await flush()
    answer = async () => {
      throw new Error(`Error invoking remote method 'hermes:api': Error: 500: {"detail":"cannot list docs/404/report"}`)
    }
    t.tickIntervals()
    await flush()
    expect(t.live.has('nav')).toBe(true)
    t.dispose()
  })

  it('closes the picker and drops the stored composer callback when the backend goes away (bot 4152168379)', async () => {
    let answer: () => Promise<unknown> = async () => ({ ok: true })
    const t = createTestContext({ rest: () => answer() })
    plugin.register(t.ctx as any)
    await flush()
    const insertText = vi.fn()
    await t.live.get('attach-cloud').data.run({ insertText })
    expect($pickerOpen.get()).toBe(true)
    answer = async () => {
      throw ipcError(404)
    }
    t.tickIntervals()
    await flush()
    expect(t.live.has('picker-host')).toBe(false)
    expect($pickerOpen.get()).toBe(false)
    expect($insertText.get()).toBeNull()
    t.dispose()
  })
})

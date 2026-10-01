import { createTestContext, host, resetHost } from './sdk-mock'
import { $driveAvailable } from '../api'
import { $pickerOpen, $pickerSource } from '../picker'
import plugin from '../plugin'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const ipcError = (status: number) => new Error(`Error invoking remote method 'hermes:api': Error: ${status}: {"detail":"Not Found"}`)

/** A backend where /available always answers and /drive/available answers whatever `drive` says now. */
function gate(initial: () => Promise<unknown>) {
  const state = { drive: initial }
  const paths: string[] = []
  const t = createTestContext({
    rest: path => {
      paths.push(path)
      return path === '/drive/available' ? state.drive() : Promise.resolve({ ok: true })
    }
  })
  plugin.register(t.ctx as any)
  return { t, state, paths }
}

beforeEach(() => {
  resetHost()
  $driveAvailable.set(null)
  $pickerOpen.set(false)
})

describe('Google Drive availability gate', () => {
  it('registers the + → Google Drive provider only when /drive/available says available: true', async () => {
    const { t } = gate(async () => ({ ok: true, available: true }))
    await flush()
    expect(t.live.get('attach-drive')).toMatchObject({ area: 'composer.attachments', data: { label: 'Google Drive', icon: 'cloud-download' } })
    expect($driveAvailable.get()).toBe(true)
    expect(t.live.has('attach-cloud')).toBe(true)
    t.dispose()
  })

  it('hides Drive on an in-band available: false (the reason is not shown anywhere)', async () => {
    const { t } = gate(async () => ({ ok: true, available: false, reason: 'not_signed_in' }))
    await flush()
    expect(t.live.has('attach-drive')).toBe(false)
    expect($driveAvailable.get()).toBe(false)
    expect(t.live.has('attach-cloud')).toBe(true)
    t.dispose()
  })

  it('hides Drive on a 404 from an older gateway half', async () => {
    const { t, state } = gate(async () => ({ ok: true, available: true }))
    await flush()
    expect(t.live.has('attach-drive')).toBe(true)
    state.drive = async () => {
      throw ipcError(404)
    }
    t.tickIntervals()
    await flush()
    expect(t.live.has('attach-drive')).toBe(false)
    expect($driveAvailable.get()).toBe(false)
    expect(t.live.has('attach-cloud')).toBe(true)
    t.dispose()
  })

  it('keeps the last answer on a transport error', async () => {
    const { t, state } = gate(async () => ({ ok: true, available: true }))
    await flush()
    state.drive = async () => {
      throw new Error('connect ECONNREFUSED')
    }
    t.tickIntervals()
    await flush()
    expect(t.live.has('attach-drive')).toBe(true)
    expect($driveAvailable.get()).toBe(true)
    t.dispose()
  })

  it('does not probe Drive while the plugin itself is unavailable, and hides Drive with it', async () => {
    let plugin404 = false
    const paths: string[] = []
    const t = createTestContext({
      rest: async path => {
        paths.push(path)
        if (plugin404) throw ipcError(404)
        return path === '/drive/available' ? { ok: true, available: true } : { ok: true }
      }
    })
    plugin.register(t.ctx as any)
    await flush()
    expect(t.live.has('attach-drive')).toBe(true)
    plugin404 = true
    paths.length = 0
    t.tickIntervals()
    await flush()
    expect(paths).toEqual(['/available'])
    expect(t.live.has('attach-drive')).toBe(false)
    expect($driveAvailable.get()).toBe(false)
    t.dispose()
  })

  it('ignores a late Drive answer from a probe for the previous agent', async () => {
    const pending: Array<{ path: string; resolve: (v: unknown) => void }> = []
    const t = createTestContext({
      rest: path => (path === '/available' ? Promise.resolve({ ok: true }) : new Promise(resolve => pending.push({ path, resolve })))
    })
    plugin.register(t.ctx as any)
    await flush()
    expect(pending.map(p => p.path)).toEqual(['/drive/available'])
    host.state.profile.set('agent-b') // second probe starts while the first Drive probe is pending
    await flush()
    expect(pending).toHaveLength(2)
    pending[1].resolve({ ok: true, available: false }) // the newest probe: agent-b has no Drive
    await flush()
    expect(t.live.has('attach-drive')).toBe(false)
    pending[0].resolve({ ok: true, available: true }) // the stale probe for the previous agent answers late
    await flush()
    expect(t.live.has('attach-drive')).toBe(false)
    expect($driveAvailable.get()).toBe(false)
    t.dispose()
  })

  it('never carries one agent\'s Drive answer over to another while the new agent\'s probe is pending or fails', async () => {
    const { t, state } = gate(async () => ({ ok: true, available: true }))
    await flush()
    expect(t.live.has('attach-drive')).toBe(true)
    let answer: (value: unknown) => void = () => undefined
    state.drive = () => new Promise(resolve => (answer = resolve))
    host.state.profile.set('other')
    await flush()
    expect($driveAvailable.get()).not.toBe(true)
    expect(t.live.has('attach-drive')).toBe(false)
    answer({ ok: true, available: true })
    await flush()
    expect(t.live.has('attach-drive')).toBe(true)
    state.drive = async () => {
      throw new Error('socket hang up')
    }
    host.state.connectionId.set('conn-2')
    await flush()
    expect($driveAvailable.get()).not.toBe(true)
    expect(t.live.has('attach-drive')).toBe(false)
    t.dispose()
  })

  it('re-probes Drive when the selected agent or connection changes', async () => {
    const { t, paths } = gate(async () => ({ ok: true, available: true }))
    await flush()
    const before = paths.filter(p => p === '/drive/available').length
    host.state.connectionId.set('conn-2')
    await flush()
    host.state.profile.set('other')
    await flush()
    expect(paths.filter(p => p === '/drive/available').length).toBe(before + 2)
    t.dispose()
  })

  it('closes an open Drive picker when Drive flips to unavailable', async () => {
    const { t, state } = gate(async () => ({ ok: true, available: true }))
    await flush()
    await t.live.get('attach-drive').data.run({ insertText: vi.fn() })
    expect([$pickerOpen.get(), $pickerSource.get()]).toEqual([true, 'drive'])
    state.drive = async () => ({ ok: true, available: false })
    t.tickIntervals()
    await flush()
    expect($pickerOpen.get()).toBe(false)
    expect(t.live.has('attach-drive')).toBe(false)
    expect(t.live.has('picker-host')).toBe(true) // the Cloud picker host stays
    t.dispose()
  })

  it('leaves an open + → Cloud picker alone when Drive flips to unavailable', async () => {
    const { t, state } = gate(async () => ({ ok: true, available: true }))
    await flush()
    await t.live.get('attach-cloud').data.run({ insertText: vi.fn() })
    state.drive = async () => ({ ok: true, available: false })
    t.tickIntervals()
    await flush()
    expect([$pickerOpen.get(), $pickerSource.get()]).toEqual([true, 'cloud'])
    t.dispose()
  })
})

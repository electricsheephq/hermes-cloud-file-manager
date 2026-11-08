// v0.6.2: Desktop sends a chat's events only to its own window, so each window relays the ones that may change files to
// the plugin in its other windows. Real timers: BroadcastChannel delivers through the event loop.
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { $available, $driveAvailable, $scopeInfo, bindContext, type Entry } from '../api'
import { $pickState, RELAY_CHANNEL, startEventRelay } from '../browser'
import { CloudFilesPage } from '../page'
import { fakeBackend } from './fake-backend'
import { createTestContext, resetHost, resetQueryCache } from './sdk-mock'

const entry = (rel: string): Entry => ({ name: rel, rel, abs: `/home/agent/${rel}`, is_dir: false, size: 1, mtime: 0 })
const wait = (ms: number) => act(() => new Promise<void>(resolve => setTimeout(resolve, ms)))
const opened: BroadcastChannel[] = []
/** Another Desktop window's end of the relay. */
function otherWindow() {
  const channel = new BroadcastChannel(RELAY_CHANNEL)
  opened.push(channel)
  return channel
}
beforeEach(() => {
  resetHost(); resetQueryCache(); $scopeInfo.set({}); $pickState.set(null); $available.set(true); $driveAvailable.set(false)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { cleanup(); opened.splice(0).forEach(channel => channel.close()); vi.restoreAllMocks() })

it('relays only events that may change files, carrying only the event type and the agent', async () => {
  const context = createTestContext()
  const stop = startEventRelay(context.ctx as any)
  const got: unknown[] = []
  otherWindow().onmessage = event => got.push(event.data)
  act(() => {
    context.emitEvent({ type: 'tool.complete', profile: 'default', connectionId: 'conn-1', payload: { name: 'write_file', args: { path: 'notes.md', content: 'private' }, result: 'ok' } })
    context.emitEvent({ type: 'tool.complete', profile: 'default', connectionId: 'conn-1', payload: { name: 'read_file' } })
    context.emitEvent({ type: 'tool.complete', payload: { name: 'write_file' } }) // no agent
    context.emitEvent({ type: 'subagent.complete', profile: 'research' })
  })
  await waitFor(() => expect(got).toHaveLength(2))
  expect(got).toEqual([{ type: 'tool.complete', profile: 'default', connectionId: 'conn-1' }, { type: 'subagent.complete', profile: 'research' }])
  stop()
  act(() => context.emitEvent({ type: 'tool.complete', profile: 'default', connectionId: 'conn-1', payload: { name: 'write_file' } }))
  await wait(50); expect(got).toHaveLength(2)
})

it('a chat in another window refreshes the open folder of the same agent, and only that agent', async () => {
  const backend = fakeBackend({ '/list': () => ({ ok: true, applied_sort: 'name', entries: [entry('old.txt')], total: 1, truncated: false }) })
  const context = createTestContext({ rest: backend.rest })
  bindContext(context.ctx as any)
  const stop = startEventRelay(context.ctx as any)
  render(<CloudFilesPage />)
  const reads = () => backend.calls.filter(call => call.path === '/list').length
  await waitFor(() => expect(reads()).toBe(1))
  const other = otherWindow()
  other.postMessage({ type: 'tool.complete', profile: 'research', connectionId: 'conn-1' }) // another agent
  other.postMessage({ type: 'tool.complete', profile: 'default', connectionId: 'conn-2' }) // another connection
  other.postMessage({ type: 'tool.complete', profile: 7 }) // not a relay message
  other.postMessage('write_file')
  await wait(1300); expect(reads()).toBe(1)
  other.postMessage({ type: 'tool.complete', profile: 'default', connectionId: 'conn-1' })
  await waitFor(() => expect(reads()).toBe(2), { timeout: 2500 })
  stop()
})

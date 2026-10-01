import { atom } from './sdk-mock'
import { MIN_CHUNK, type UploadDeps, UploadBatch } from '../upload'

const MiB = 1024 * 1024
const flush = async (rounds = 20) => {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 0))
}
const ipc = (text: string) => new Error(`Error invoking remote method 'hermes:api': Error: ${text}`)
const blob = (size: number) => new Blob([new Uint8Array(size)])

interface Call {
  path: string
  body: any
  timeoutMs?: number
  /** The agent selected when the request was dispatched (where ctx.rest would send it). */
  agent: string
}

/** A fake backend. The injected chunk reader encodes a slice as its byte length, so `data` = length. */
function harness(handlers: Partial<Record<string, (body: any, n: number) => any>> = {}, limits = { max_file_bytes: 50 * MiB, chunk_bytes: 4 * MiB }) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  const state = { connectionId: atom<null | string>('conn-1'), profile: atom('default') }
  const sleeps: number[] = []
  const defaults: Record<string, (body: any) => any> = {
    '/uploads/start': body => ({ ok: true, upload_id: `u:${body.path}`, chunk_bytes: limits.chunk_bytes, max_file_bytes: limits.max_file_bytes }),
    '/uploads/chunk': body => ({ ok: true, size: body.offset + Number(body.data) }),
    '/uploads/finish': body => ({ ok: true, renamed: false, entry: { name: body.path, rel: body.path } }),
    '/uploads/abort': () => ({ ok: true }),
    '/mkdir': () => ({ ok: true, created: true })
  }
  const deps: UploadDeps = {
    rest: (async (path: string, opts: any) => {
      calls.push({ path, body: opts?.body, timeoutMs: opts?.timeoutMs, agent: state.profile.get() })
      counts[path] = (counts[path] ?? 0) + 1
      const handler = handlers[path]
      const answer = handler ? await handler(opts?.body, counts[path]) : undefined
      return answer === undefined ? defaults[path](opts?.body) : answer
    }) as UploadDeps['rest'],
    state,
    readChunk: async (slice: Blob) => String(slice.size),
    sleep: async ms => void sleeps.push(ms)
  }
  const batch = new UploadBatch(limits, deps)
  const of = (path: string) => calls.filter(call => call.path === path)
  return { batch, calls, of, state, sleeps }
}

describe('upload engine', () => {
  it('chunks a 10.5 MiB file at 4 MiB: offsets 0/4/8 MiB, then finish', async () => {
    const h = harness()
    h.batch.add({ files: [{ file: blob(10.5 * MiB), rel: 'big.bin' }] }, { root: 'home', folder: 'uploads' })
    await h.batch.start()
    expect(h.of('/uploads/start')[0].body).toEqual({ root: 'home', path: 'uploads/big.bin', size: 10.5 * MiB })
    expect(h.of('/uploads/chunk').map(c => c.body.offset)).toEqual([0, 4 * MiB, 8 * MiB])
    expect(h.of('/uploads/chunk').every(c => c.timeoutMs === 120_000)).toBe(true)
    expect(h.calls.at(-1)).toMatchObject({ path: '/uploads/finish', body: { upload_id: 'u:uploads/big.bin', size: 10.5 * MiB } })
    expect(h.batch.getSnapshot().items[0]).toMatchObject({ status: 'done', sent: 10.5 * MiB })
  })

  it('resumes from the server size on an in-band `offset` answer', async () => {
    const h = harness({ '/uploads/chunk': (_body, n) => (n === 1 ? { ok: false, code: 'offset', size: MiB } : undefined) })
    h.batch.add({ files: [{ file: blob(5 * MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    await h.batch.start()
    expect(h.of('/uploads/chunk').map(c => c.body.offset)).toEqual([0, MiB])
    expect(h.batch.getSnapshot().items[0].status).toBe('done')
  })

  it('resumes after a size_mismatch on finish', async () => {
    const h = harness({ '/uploads/finish': (_body, n) => (n === 1 ? { ok: false, code: 'size_mismatch', size: 2 * MiB } : undefined) })
    h.batch.add({ files: [{ file: blob(3 * MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    await h.batch.start()
    expect(h.of('/uploads/chunk').map(c => c.body.offset)).toEqual([0, 2 * MiB])
    expect(h.of('/uploads/finish')).toHaveLength(2)
    expect(h.batch.getSnapshot().items[0].status).toBe('done')
  })

  it('halves the chunk on a thrown 413 and on a timeout, retrying the same offset', async () => {
    const h = harness({
      '/uploads/chunk': (_body, n) => {
        if (n === 1) throw ipc('413: {"detail":"Request Entity Too Large"}')
        if (n === 2) throw new Error('Request timed out after 120000ms')
      }
    })
    h.batch.add({ files: [{ file: blob(4 * MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    await h.batch.start()
    const chunks = h.of('/uploads/chunk').map(c => [c.body.offset, Number(c.body.data)])
    expect(chunks.slice(0, 3)).toEqual([
      [0, 4 * MiB],
      [0, 2 * MiB],
      [0, 1 * MiB]
    ])
    expect(h.sleeps).toEqual([])
    expect(h.batch.getSnapshot().items[0].status).toBe('done')
  })

  it('never halves below 256 KiB; at the floor a 413 becomes a retried transport error', async () => {
    const h = harness({ '/uploads/chunk': () => Promise.reject(ipc('413: too large')) }, { max_file_bytes: 50 * MiB, chunk_bytes: 512 * 1024 })
    h.batch.add({ files: [{ file: blob(MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    await h.batch.start()
    const sizes = h.of('/uploads/chunk').map(c => Number(c.body.data))
    expect(sizes[0]).toBe(512 * 1024)
    expect(Math.min(...sizes)).toBe(MIN_CHUNK)
    expect(h.sleeps).toEqual([1000, 2000, 4000])
    expect(h.batch.getSnapshot().items[0]).toMatchObject({ status: 'failed', error: '413: too large' })
  })

  it('retries a transport error with 1 s / 2 s backoff, then succeeds', async () => {
    const h = harness({
      '/uploads/chunk': (_body, n) => {
        if (n <= 2) throw ipc('502: bad gateway')
      }
    })
    h.batch.add({ files: [{ file: blob(MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    await h.batch.start()
    expect(h.sleeps).toEqual([1000, 2000])
    expect(h.of('/uploads/chunk').map(c => c.body.offset)).toEqual([0, 0, 0])
    expect(h.batch.getSnapshot().items[0].status).toBe('done')
  })

  it('restarts a file from 0 once on `gone`, and fails on a second `gone`', async () => {
    const once = harness({ '/uploads/chunk': (_body, n) => (n === 2 ? { ok: false, code: 'gone' } : undefined) })
    once.batch.add({ files: [{ file: blob(6 * MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    await once.batch.start()
    expect(once.of('/uploads/start')).toHaveLength(2)
    expect(once.of('/uploads/chunk').map(c => c.body.offset)).toEqual([0, 4 * MiB, 0, 4 * MiB])
    expect(once.batch.getSnapshot().items[0].status).toBe('done')

    const twice = harness({ '/uploads/chunk': () => ({ ok: false, code: 'gone' }) })
    twice.batch.add({ files: [{ file: blob(MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    await twice.batch.start()
    expect(twice.of('/uploads/start')).toHaveLength(2)
    expect(twice.batch.getSnapshot().items[0].status).toBe('failed')
  })

  it('refuses an oversize file before any request', async () => {
    const h = harness({}, { max_file_bytes: MiB, chunk_bytes: 4 * MiB })
    h.batch.add({ files: [{ file: blob(MiB + 1), rel: 'huge.bin' }] }, { root: 'home', folder: '' })
    await h.batch.start()
    expect(h.calls).toEqual([])
    expect(h.batch.getSnapshot().items[0]).toMatchObject({ status: 'failed', error: 'Too large (max 1 MB)', retryable: false })
  })

  it('keeps at most 2 files in flight', async () => {
    let active = 0
    let peak = 0
    const h = harness({
      '/uploads/start': () => {
        peak = Math.max(peak, ++active)
      },
      '/uploads/finish': async () => {
        await flush(2)
        active -= 1
      }
    })
    h.batch.add({ files: [1, 2, 3, 4, 5].map(i => ({ file: blob(300 * 1024), rel: `f${i}.bin` })) }, { root: 'home', folder: '' })
    await h.batch.start()
    expect(peak).toBe(2)
    expect(h.batch.getSnapshot().items.every(item => item.status === 'done')).toBe(true)
  })

  it('pauses while another agent is selected and resumes when it is selected again', async () => {
    const h = harness({
      '/uploads/chunk': (_body, n) => {
        if (n === 1) h.state.profile.set('other')
      }
    })
    h.batch.add({ files: [{ file: blob(6 * MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    const done = h.batch.start()
    await flush()
    expect(h.batch.getSnapshot().paused).toBe(true)
    const sent = h.calls.length
    await flush()
    expect(h.calls.length).toBe(sent) // nothing goes to the other agent
    h.state.profile.set('default')
    await done
    expect(h.batch.getSnapshot()).toMatchObject({ paused: false })
    expect(h.batch.getSnapshot().items[0].status).toBe('done')
  })

  it('cancel aborts the in-flight upload on the server', async () => {
    const h = harness({ '/uploads/chunk': () => new Promise(() => undefined) })
    h.batch.add({ files: [{ file: blob(MiB), rel: 'a.bin' }, { file: blob(MiB), rel: 'b.bin' }, { file: blob(MiB), rel: 'c.bin' }] }, { root: 'home', folder: 'x' })
    void h.batch.start()
    await flush()
    h.batch.cancel()
    expect(h.of('/uploads/abort').map(c => c.body)).toEqual([
      { upload_id: 'u:x/a.bin', root: 'home', path: 'x/a.bin' },
      { upload_id: 'u:x/b.bin', root: 'home', path: 'x/b.bin' }
    ])
    expect(h.batch.getSnapshot().items.map(item => item.status)).toEqual(['canceled', 'canceled', 'canceled'])
  })

  it('creates empty directories with /mkdir and reports renamed files', async () => {
    const h = harness({ '/uploads/finish': () => ({ ok: true, renamed: true, entry: { name: 'a (1).txt', rel: 'docs/a (1).txt' } }) })
    h.batch.add({ files: [{ file: blob(10), rel: 'a.txt' }], dirs: ['empty/inner'] }, { root: 'home', folder: 'docs' })
    await h.batch.start()
    expect(h.of('/mkdir')[0].body).toEqual({ root: 'home', path: 'docs/empty/inner' })
    expect(h.batch.getSnapshot().items.find(item => !item.isDir)).toMatchObject({ status: 'done', savedAs: 'a (1).txt' })
  })

  // F1: the pin must be re-checked synchronously right before each dispatch. A listener fired while the batch
  // resumes stands in for anything that switches agents between the pin check and the request.
  it('never sends a request to an agent selected after the pin check (F1)', async () => {
    const h = harness({
      '/uploads/chunk': (_body, n) => {
        if (n === 1) h.state.profile.set('other')
      }
    })
    let pausedOnce = false
    let flipped = false
    h.batch.subscribe(() => {
      const snap = h.batch.getSnapshot()
      if (snap.paused) pausedOnce = true
      if (pausedOnce && !snap.paused && !flipped && h.state.profile.get() === 'default') {
        flipped = true
        h.state.profile.set('other')
      }
    })
    h.batch.add({ files: [{ file: blob(6 * MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    const done = h.batch.start()
    await flush()
    h.state.profile.set('default') // resume; the listener switches away again right after the pin check
    await flush()
    expect(h.calls.filter(c => c.agent !== 'default')).toEqual([])
    expect(h.batch.getSnapshot().paused).toBe(true)
    h.state.profile.set('default')
    await done
    expect(h.calls.every(c => c.agent === 'default')).toBe(true)
    expect(h.batch.getSnapshot().items[0].status).toBe('done')
  })

  it('sends nothing after cancel, even when cancel lands between the pin check and the request (F3)', async () => {
    const h = harness({
      '/uploads/chunk': (_body, n) => {
        if (n === 1) h.state.profile.set('other')
      }
    })
    let pausedOnce = false
    h.batch.subscribe(() => {
      const snap = h.batch.getSnapshot()
      if (snap.paused) pausedOnce = true
      if (pausedOnce && !snap.paused && !snap.canceled) h.batch.cancel()
    })
    h.batch.add({ files: [{ file: blob(6 * MiB), rel: 'a.bin' }] }, { root: 'home', folder: '' })
    void h.batch.start()
    await flush()
    h.state.profile.set('default')
    await flush()
    const abortAt = h.calls.findIndex(c => c.path === '/uploads/abort')
    expect(abortAt).toBeGreaterThanOrEqual(0)
    expect(h.calls.slice(abortAt + 1).map(c => c.path)).toEqual([])
    expect(h.batch.getSnapshot().items[0].status).toBe('canceled')
  })

  it('validates newly added files against the current limits, not the batch’s original ones (F4)', async () => {
    const h = harness({}, { max_file_bytes: 100, chunk_bytes: 4 * MiB })
    h.batch.add({ files: [{ file: blob(6), rel: 'a.txt' }] }, { root: 'home', folder: '' }, { max_file_bytes: 5, chunk_bytes: 4 * MiB })
    await h.batch.start()
    expect(h.of('/uploads/start')).toEqual([])
    expect(h.batch.getSnapshot().items[0]).toMatchObject({ status: 'failed', retryable: false })
  })

  it('a batch pinned to another agent starts paused and sends nothing until that agent is selected', async () => {
    const h = harness()
    const batch = new UploadBatch({ max_file_bytes: MiB, chunk_bytes: MiB }, {
      rest: (async (path: string, opts: any) => {
        h.calls.push({ path, body: opts?.body, agent: h.state.profile.get() })
        return path === '/uploads/start' ? { ok: true, upload_id: 'u1' } : path === '/uploads/chunk' ? { ok: true, size: opts.body.offset + Number(opts.body.data) } : { ok: true }
      }) as UploadDeps['rest'],
      state: h.state,
      readChunk: async (slice: Blob) => String(slice.size),
      sleep: async () => undefined
    }, { connectionId: 'conn-1', profile: 'origin' })
    batch.add({ files: [{ file: blob(10), rel: 'a.txt' }] }, { root: 'home', folder: '' })
    const done = batch.start()
    await flush()
    expect(batch.getSnapshot()).toMatchObject({ profile: 'origin', paused: true })
    expect(h.calls).toEqual([])
    h.state.profile.set('origin')
    await done
    expect(h.calls.every(c => c.agent === 'origin')).toBe(true)
    expect(batch.getSnapshot().items[0].status).toBe('done')
  })

  it('a finish that succeeds after cancel leaves no done row in the canceled batch (thread 4152251051)', async () => {
    let finish!: (value: unknown) => void
    const h = harness({ '/uploads/finish': () => new Promise(resolve => (finish = resolve)) })
    h.batch.add({ files: [{ file: blob(10), rel: 'a.txt' }] }, { root: 'home', folder: '' })
    const done = h.batch.start()
    await flush()
    expect(h.of('/uploads/finish')).toHaveLength(1)
    h.batch.cancel()
    finish({ ok: true, renamed: false, entry: { name: 'a.txt', rel: 'a.txt' } })
    await done
    expect(h.batch.getSnapshot().canceled).toBe(true)
    expect(h.batch.getSnapshot().items.map(item => item.status)).toEqual(['canceled'])
  })
})

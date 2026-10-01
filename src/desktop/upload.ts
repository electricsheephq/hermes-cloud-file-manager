// Upload engine: pure logic with injected transport, chunk reader and timers so tests run instantly.
// Protocol (backend contract): start → chunk* → finish, with in-band recovery codes. At most 2 files in flight,
// chunks sequential within a file. The batch is pinned to the agent it started on and pauses while another
// agent is selected (ctx.rest always talks to the selected agent).
import { baseName, joinPath } from './format'
import { codeText, S } from './strings'

export const MIN_CHUNK = 256 * 1024
export const REQUEST_TIMEOUT_MS = 120_000
const CONCURRENCY = 2
const BACKOFF_MS = [1000, 2000, 4000]

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'canceled'

export interface UploadItem {
  id: number
  root: string
  /** Target path relative to the root. */
  path: string
  size: number
  /** Bytes the server has acknowledged. */
  sent: number
  status: UploadStatus
  isDir?: boolean
  error?: string
  /** Final name when the server renamed it to avoid a collision. */
  savedAs?: string
  retryable?: boolean
}

export interface BatchSnapshot {
  profile: string
  connectionId: null | string
  items: readonly UploadItem[]
  running: boolean
  paused: boolean
  canceled: boolean
}

interface Readable<T> {
  get(): T
  subscribe(listener: (value: T) => void): () => void
}

type Rest = <T>(path: string, opts?: { method?: string; body?: unknown; timeoutMs?: number }) => Promise<T>

export interface UploadDeps {
  rest: Rest
  state: { connectionId: Readable<null | string>; profile: Readable<string> }
  readChunk?: (blob: Blob) => Promise<string>
  sleep?: (ms: number) => Promise<void>
}

export interface UploadInput {
  files: Array<{ file: Blob; rel: string }>
  /** Empty directories to create (relative to the destination folder). */
  dirs?: string[]
}

export interface Destination {
  root: string
  folder: string
}

export interface Limits {
  max_file_bytes: number
  chunk_bytes: number
}

interface Reply {
  ok: boolean
  code?: string
  message?: string
  size?: number
  upload_id?: string
  chunk_bytes?: number
  renamed?: boolean
  entry?: { name?: string; rel?: string }
}

/** Base64 of a blob via FileReader (never String.fromCharCode over the bytes: it overflows on big chunks). */
export function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result ?? '')
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

/** A 413 status or a timeout in the IPC error text: the chunk was too big for the path, so halve it. */
export function isShrinkError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /(^|\D)413(\D|$)/.test(text) || /timed?[ -]?out/i.test(text)
}

/** Readable text for a thrown transport error (drops the IPC wrapper). */
export function transportText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method \S+: /, '').replace(/^Error: /, '') || 'Connection problem'
}

class Canceled extends Error {}
class Shrink extends Error {}

export class UploadBatch {
  private snapshot: BatchSnapshot
  private readonly blobs = new Map<number, Blob>()
  private readonly inFlight = new Map<number, string>()
  private readonly listeners = new Set<() => void>()
  private waiters: Array<() => void> = []
  private pool: null | Promise<void> = null
  private nextId = 1
  private readonly readChunk: (blob: Blob) => Promise<string>
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly limits: Limits,
    private readonly deps: UploadDeps
  ) {
    this.readChunk = deps.readChunk ?? readBase64
    this.sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
    this.snapshot = {
      profile: deps.state.profile.get(),
      connectionId: deps.state.connectionId.get(),
      items: [],
      running: false,
      paused: false,
      canceled: false
    }
  }

  getSnapshot = (): BatchSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Queue files (and empty dirs) for a destination; oversize files fail before any request. */
  add(input: UploadInput, dest: Destination): void {
    const items: UploadItem[] = []
    for (const rel of input.dirs ?? []) {
      items.push({ id: this.nextId++, root: dest.root, path: joinPath(dest.folder, rel), size: 0, sent: 0, status: 'queued', isDir: true })
    }
    for (const { file, rel } of input.files) {
      const id = this.nextId++
      const tooBig = file.size > this.limits.max_file_bytes
      this.blobs.set(id, file)
      items.push({
        id,
        root: dest.root,
        path: joinPath(dest.folder, rel),
        size: file.size,
        sent: 0,
        status: tooBig ? 'failed' : 'queued',
        ...(tooBig ? { error: S.tooLarge(this.limits.max_file_bytes), retryable: false } : {})
      })
    }
    this.set({ items: [...this.snapshot.items, ...items] })
  }

  /** Run until every queued item is settled. Safe to call again (returns the running pool). */
  start(): Promise<void> {
    if (this.pool) return this.pool
    if (this.snapshot.canceled) return Promise.resolve()
    const wake = () => this.wake()
    const stops = [this.deps.state.connectionId.subscribe(wake), this.deps.state.profile.subscribe(wake)]
    this.set({ running: true })
    this.pool = this.drain().finally(() => {
      stops.forEach(stop => stop())
      this.pool = null
      this.set({ running: false, paused: false })
      // A Retry that landed while the last worker was exiting.
      if (!this.snapshot.canceled && this.snapshot.items.some(item => item.status === 'queued')) void this.start()
    })
    return this.pool
  }

  retry(id: number): void {
    const item = this.snapshot.items.find(it => it.id === id)
    if (!item || item.status !== 'failed' || item.retryable === false || this.snapshot.canceled) return
    this.patch(id, { status: 'queued', sent: 0, error: undefined })
    void this.start()
  }

  cancel(): void {
    if (this.snapshot.canceled) return
    this.set({
      canceled: true,
      items: this.snapshot.items.map(item => (item.status === 'queued' || item.status === 'uploading' ? { ...item, status: 'canceled' } : item))
    })
    for (const id of [...this.inFlight.keys()]) this.abort(id)
    this.wake()
  }

  private async drain(): Promise<void> {
    for (const item of this.snapshot.items) {
      if (item.isDir && item.status === 'queued') await this.guard(item.id, () => this.mkdir(item))
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => this.worker()))
  }

  private async worker(): Promise<void> {
    for (;;) {
      if (this.snapshot.canceled) return
      const next = this.snapshot.items.find(item => !item.isDir && item.status === 'queued')
      if (!next) return
      this.patch(next.id, { status: 'uploading' })
      await this.guard(next.id, () => this.uploadFile(next))
    }
  }

  private async guard(id: number, run: () => Promise<void>): Promise<void> {
    try {
      await run()
    } catch (error) {
      if (error instanceof Canceled || this.snapshot.canceled) {
        this.abort(id)
        return
      }
      this.fail(id, { error: transportText(error) })
    }
  }

  private async mkdir(item: UploadItem): Promise<void> {
    const res = await this.send('/mkdir', { root: item.root, path: item.path }, false)
    if (res.ok) this.patch(item.id, { status: 'done' })
    else this.fail(item.id, { error: codeText(res.code, res.message) })
  }

  private async uploadFile(item: UploadItem): Promise<void> {
    const blob = this.blobs.get(item.id)!
    const { root, path, size } = item
    let chunk = Math.max(MIN_CHUNK, this.limits.chunk_bytes)
    let restarted = false

    restart: for (;;) {
      this.patch(item.id, { sent: 0 })
      const started = await this.send('/uploads/start', { root, path, size }, false)
      if (!started.ok || !started.upload_id) return this.fail(item.id, { error: codeText(started.code, started.message) })
      const uploadId = started.upload_id
      this.inFlight.set(item.id, uploadId)
      if (started.chunk_bytes) chunk = Math.min(chunk, Math.max(MIN_CHUNK, started.chunk_bytes))
      let offset = 0

      for (;;) {
        if (offset >= size) {
          const fin = await this.send('/uploads/finish', { upload_id: uploadId, root, path, size }, false)
          if (fin.ok) {
            this.inFlight.delete(item.id)
            const finalName = baseName(fin.entry?.rel ?? fin.entry?.name ?? path)
            this.patch(item.id, { status: 'done', sent: size, ...(fin.renamed ? { savedAs: finalName } : {}) })
            return
          }
          if (fin.code === 'size_mismatch' && typeof fin.size === 'number' && fin.size < size) {
            offset = fin.size
            this.patch(item.id, { sent: offset })
            continue
          }
          if (fin.code === 'gone' && !restarted) {
            restarted = true
            this.inFlight.delete(item.id)
            continue restart
          }
          return this.fail(item.id, { error: codeText(fin.code, fin.message) })
        }

        const data = await this.readChunk(blob.slice(offset, Math.min(size, offset + chunk)))
        let res: Reply
        try {
          res = await this.send('/uploads/chunk', { upload_id: uploadId, root, path, offset, data }, chunk > MIN_CHUNK)
        } catch (error) {
          if (!(error instanceof Shrink)) throw error
          chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2))
          continue
        }

        if (res.ok && typeof res.size === 'number' && res.size > offset) {
          offset = res.size
          this.patch(item.id, { sent: offset })
        } else if (res.code === 'offset' && typeof res.size === 'number') {
          offset = res.size
          this.patch(item.id, { sent: offset })
        } else if (res.code === 'chunk_too_large' && chunk > MIN_CHUNK) {
          chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2))
        } else if (res.code === 'gone' && !restarted) {
          restarted = true
          this.inFlight.delete(item.id)
          continue restart
        } else {
          return this.fail(item.id, { error: codeText(res.code, res.message) })
        }
      }
    }
  }

  /** POST with the agent pin, transport retries (1 s / 2 s / 4 s) and — for chunks above the floor — a
   *  Shrink signal on 413/timeout so the caller retries the same offset with half the chunk. */
  private async send(path: string, body: Record<string, unknown>, canShrink: boolean): Promise<Reply> {
    for (let attempt = 0; ; attempt += 1) {
      await this.ready()
      try {
        return await this.deps.rest<Reply>(path, { method: 'POST', body, timeoutMs: REQUEST_TIMEOUT_MS })
      } catch (error) {
        if (this.snapshot.canceled) throw new Canceled()
        if (canShrink && isShrinkError(error)) throw new Shrink()
        if (attempt >= BACKOFF_MS.length) throw error
        await this.sleep(BACKOFF_MS[attempt])
      }
    }
  }

  private matches(): boolean {
    return this.deps.state.connectionId.get() === this.snapshot.connectionId && this.deps.state.profile.get() === this.snapshot.profile
  }

  /** Resolve once the pinned agent is selected again; throw if the batch is canceled meanwhile. */
  private async ready(): Promise<void> {
    while (!this.snapshot.canceled && !this.matches()) {
      if (!this.snapshot.paused) this.set({ paused: true })
      await new Promise<void>(resolve => this.waiters.push(resolve))
    }
    if (this.snapshot.canceled) throw new Canceled()
    if (this.snapshot.paused) this.set({ paused: false })
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    waiters.forEach(resolve => resolve())
  }

  /** Best-effort server-side cleanup of a temp upload; only while the pinned agent is selected. */
  private abort(id: number): void {
    const uploadId = this.inFlight.get(id)
    const item = this.snapshot.items.find(it => it.id === id)
    this.inFlight.delete(id)
    if (!uploadId || !item || !this.matches()) return
    void this.deps
      .rest('/uploads/abort', { method: 'POST', body: { upload_id: uploadId, root: item.root, path: item.path } })
      .catch(() => undefined)
  }

  private fail(id: number, { error }: { error: string }): void {
    if (this.snapshot.canceled) return
    this.abort(id)
    this.patch(id, { status: 'failed', error })
  }

  private patch(id: number, fields: Partial<UploadItem>): void {
    this.set({ items: this.snapshot.items.map(item => (item.id === id ? { ...item, ...fields } : item)) })
  }

  private set(fields: Partial<BatchSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...fields }
    this.listeners.forEach(listener => listener())
  }
}

export interface BatchSummary {
  total: number
  settled: number
  done: number
  failed: number
  sent: number
  size: number
}

/** Counts for the drawer header (files only; empty-dir rows are bookkeeping). */
export function summarize(snapshot: BatchSnapshot): BatchSummary {
  const files = snapshot.items.filter(item => !item.isDir)
  return {
    total: files.length,
    settled: files.filter(item => item.status !== 'queued' && item.status !== 'uploading').length,
    done: files.filter(item => item.status === 'done').length,
    failed: files.filter(item => item.status === 'failed').length,
    sent: files.reduce((sum, item) => sum + item.sent, 0),
    size: files.reduce((sum, item) => sum + item.size, 0)
  }
}

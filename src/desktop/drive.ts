// Google Drive source: the gateway's /drive/* shapes and the import job. An import is one file per request,
// sequential, into <root>/uploads/drive, pinned to the agent selected when it started: while another agent is
// selected it waits before the next request (ctx.rest always talks to the selected agent), and never re-pins.
import { atom } from '@hermes/plugin-sdk'

import type { Entry } from './api'
import { codeText } from './strings'
import { type AgentPin, transportText, type UploadDeps } from './upload'

export const DRIVE_DEST = 'uploads/drive'
/** The gateway allows 300 s for the download; leave room for the copy into the root. */
export const IMPORT_TIMEOUT_MS = 330_000

export interface DriveItem {
  id: string
  name: string
  mime: string
  is_folder: boolean
  size: null | number
  /** RFC 3339, not epoch seconds. */
  mtime: null | string
}

export interface DriveListResponse {
  ok: boolean
  items: DriveItem[]
  truncated: boolean
}

interface ImportReply {
  ok: boolean
  entry?: Entry
  renamed?: boolean
  code?: string
  message?: string
}

const GOOGLE = 'application/vnd.google-apps.'

/** Codicon for a Drive item: folder, document, spreadsheet, presentation, image, pdf, or generic. */
export function driveIcon({ mime, is_folder }: Pick<DriveItem, 'mime' | 'is_folder'>): string {
  const has = (...parts: string[]) => parts.some(part => mime.includes(part))
  if (is_folder) return 'folder'
  if (mime === 'application/pdf') return 'file-pdf'
  if (has('spreadsheet', 'excel', 'text/csv')) return 'table'
  if (has('presentation', 'powerpoint')) return 'preview'
  if (mime.startsWith('image/') || mime === `${GOOGLE}drawing` || mime === `${GOOGLE}photo`) return 'file-media'
  if (mime === `${GOOGLE}document` || has('wordprocessing', 'msword') || mime.startsWith('text/')) return 'file-text'
  return 'file'
}

export interface ImportFailure {
  name: string
  error: string
}

export interface ImportSnapshot {
  pin: AgentPin
  total: number
  settled: number
  imported: Entry[]
  failures: ImportFailure[]
  running: boolean
  paused: boolean
  canceled: boolean
}

/** An extra reason to wait before the next request (the picker: the focused chat belongs to another agent). */
export interface ImportHold {
  held(): boolean
  subscribe(wake: () => void): () => void
}

export class DriveImport {
  private snapshot: ImportSnapshot
  private readonly listeners = new Set<() => void>()
  private wake: () => void = () => undefined
  private run: null | Promise<ImportSnapshot> = null

  constructor(
    private readonly items: readonly DriveItem[],
    private readonly root: string,
    pin: AgentPin,
    private readonly deps: Pick<UploadDeps, 'rest' | 'state'> & { hold?: ImportHold }
  ) {
    this.snapshot = { pin, total: items.length, settled: 0, imported: [], failures: [], running: false, paused: false, canceled: false }
  }

  getSnapshot = (): ImportSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Import every item once, in order. Resolves with the final snapshot (also after a cancel). */
  start(): Promise<ImportSnapshot> {
    this.run ??= this.drain()
    return this.run
  }

  /** No request starts after this; the one in flight (if any) still settles and its file stays. */
  cancel(): void {
    if (this.snapshot.canceled) return
    this.set({ canceled: true })
    this.wake()
  }

  private async drain(): Promise<ImportSnapshot> {
    const { state, rest } = this.deps
    const wake = () => this.wake()
    const stops = [state.connectionId.subscribe(wake), state.profile.subscribe(wake), this.deps.hold?.subscribe(wake) ?? (() => undefined)]
    this.set({ running: true })
    try {
      for (const item of this.items) {
        while (!this.snapshot.canceled && !this.matches()) {
          this.set({ paused: true })
          await new Promise<void>(resolve => (this.wake = resolve))
        }
        if (this.snapshot.canceled) break
        this.set({ paused: false })
        let failure: null | string = null
        try {
          const body = { id: item.id, root: this.root, dest: DRIVE_DEST }
          const res = await rest<ImportReply>('/drive/import', { method: 'POST', body, timeoutMs: IMPORT_TIMEOUT_MS })
          if (res?.ok && res.entry) this.set({ imported: [...this.snapshot.imported, res.entry] })
          else failure = codeText(res?.code, res?.message)
        } catch (error) {
          failure = transportText(error)
        }
        const failures = failure ? [...this.snapshot.failures, { name: item.name, error: failure }] : this.snapshot.failures
        this.set({ settled: this.snapshot.settled + 1, failures })
      }
    } finally {
      stops.forEach(stop => stop())
      this.set({ running: false, paused: false })
    }
    return this.snapshot
  }

  private matches(): boolean {
    const { pin } = this.snapshot
    const { state, hold } = this.deps
    return state.profile.get() === pin.profile && state.connectionId.get() === pin.connectionId && !hold?.held()
  }

  private set(patch: Partial<ImportSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach(listener => listener())
  }
}

/** The Cloud Files page's import job; it outlives the page, like the upload batch. */
export const $driveJob = atom<null | DriveImport>(null)

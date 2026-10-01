// The Cloud Files page: header, toolbar, the shared browser, drag-and-drop, new folder, and the upload drawer.
import {
  atom,
  Button,
  Codicon,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  host,
  Input,
  Skeleton,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { type ChangeEvent, type CSSProperties, type DragEvent, type FormEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { $available, ApiError, call, errorText, pluginCtx, rest, type RootsResponse } from './api'
import { Breadcrumbs, type Browser, BrowserSearch, EntryList, LoadError, RootSelect, useBrowser, useRoots } from './browser'
import { baseName, humanSize, joinPath } from './format'
import { codeText, S } from './strings'
import { type AgentPin, type BatchSnapshot, type Destination, type Limits, summarize, UploadBatch, type UploadInput, type UploadItem } from './upload'
import { collectDropEntries, filesFromInput, walkEntries } from './walk'

const muted: CSSProperties = { color: 'var(--ui-text-tertiary)' }
const pad = '0 20px'

/** The current upload batch outlives the page, so leaving and coming back keeps the drawer. */
export const $batch = atom<null | UploadBatch>(null)

/** The agent selected right now. Read it synchronously in the event handler that picked the files: a folder
 *  walk is async, and the files belong to the agent they were picked on even if the user switches meanwhile. */
export const currentPin = (): AgentPin => ({ connectionId: host.state.connectionId.get(), profile: host.state.profile.get() })

/** Queue files on the batch for `pin`'s agent. A batch for another agent pauses until it is selected again;
 *  it is never re-pinned. `limits` are the current /roots limits. */
export function enqueueUpload(input: UploadInput, dest: Destination, limits: Limits, pin: AgentPin = currentPin()): void {
  if (!input.files.length && !input.dirs?.length) return
  let batch = $batch.get()
  const snap = batch?.getSnapshot()
  const sameAgent = snap?.profile === pin.profile && snap?.connectionId === pin.connectionId
  if (snap?.running && !sameAgent) {
    host.notify({ kind: 'warning', message: S.busyElsewhere })
    return
  }
  if (!batch || !snap || snap.canceled || !sameAgent) {
    batch = new UploadBatch(limits, { rest, state: host.state }, pin)
    $batch.set(batch)
  }
  batch.add(input, dest, limits)
  void batch.start()
}

export function CloudFilesPage() {
  const available = useValue($available)
  const profile = useValue(host.state.profile)
  const connectionId = useValue(host.state.connectionId)
  if (available === false) {
    return (
      <Frame profile={profile}>
        <p style={{ ...muted, fontSize: 13, padding: pad, maxWidth: 560, lineHeight: 1.5 }}>{S.notSetUp(profile)}</p>
      </Frame>
    )
  }
  // Keyed by agent: switching agents resets folder, search and selection.
  return <PageBody key={`${connectionId ?? 'local'}::${profile}`} profile={profile} />
}

function PageBody({ profile }: { profile: string }) {
  const roots = useRoots()
  if (roots.error) {
    return (
      <Frame profile={profile}>
        <LoadError error={roots.error} onRetry={() => void roots.refetch()} />
      </Frame>
    )
  }
  if (!roots.data) {
    return (
      <Frame profile={profile}>
        <div aria-busy="true" style={{ display: 'grid', gap: 6, padding: pad }}>
          {[0, 1, 2].map(i => (
            <Skeleton key={i} style={{ height: 18 }} />
          ))}
        </div>
      </Frame>
    )
  }
  if (roots.data.supported === false || roots.data.code === 'unsupported_backend' || !roots.data.roots?.length) {
    return (
      <Frame profile={profile}>
        <EmptyState description={roots.data.reason ?? codeText(roots.data.code, roots.data.message)} title={S.unsupportedTitle} />
      </Frame>
    )
  }
  return <Files profile={profile} roots={roots.data} />
}

/** Page chrome: full height, title + agent label, optional header controls, and a drop target. */
function Frame({ children, profile, controls, onDropInput, dropLabel }: {
  children: ReactNode
  profile: string
  controls?: ReactNode
  onDropInput?: (input: Promise<UploadInput>, pin: AgentPin) => void
  dropLabel?: string
}) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  // preventDefault on dragover AND drop, always: otherwise Electron navigates the window to the file.
  const dragOver = (event: DragEvent) => {
    event.preventDefault()
    if (onDropInput) event.dataTransfer.dropEffect = 'copy'
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    depth.current = 0
    setOver(false)
    if (!onDropInput) return
    const { entries, files } = collectDropEntries(event.dataTransfer) // synchronous: the list dies after this handler
    onDropInput(entries.length ? walkEntries(entries) : Promise.resolve(filesFromInput(files)), currentPin())
  }
  return (
    <section
      onDragEnter={event => {
        event.preventDefault()
        depth.current += 1
        if (onDropInput && event.dataTransfer.types.includes('Files')) setOver(true)
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setOver(false)
      }}
      onDragOver={dragOver}
      onDrop={drop}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'var(--ui-text-primary)' }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px 10px' }}>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{S.title}</h1>
        <span style={{ ...muted, fontSize: 12 }}>{profile}</span>
        <span style={{ marginLeft: 'auto' }}>{controls}</span>
      </header>
      {children}
      {over && (
        <div
          style={{
            position: 'absolute',
            inset: 8,
            display: 'grid',
            placeItems: 'center',
            border: '1.5px dashed var(--ui-accent)',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--ui-accent) 8%, transparent)',
            color: 'var(--ui-text-primary)',
            fontSize: 13,
            fontWeight: 500,
            pointerEvents: 'none'
          }}
        >
          {dropLabel}
        </div>
      )}
    </section>
  )
}

function Files({ profile, roots }: { profile: string; roots: RootsResponse }) {
  const b = useBrowser(roots, 'page')
  const queryClient = useQueryClient()
  const [newFolder, setNewFolder] = useState(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const rootId = b.root?.id ?? ''
  const limits: Limits = { max_file_bytes: roots.max_file_bytes, chunk_bytes: roots.chunk_bytes }
  const here = baseName(b.path) || b.root?.label || ''
  const dest = { root: rootId, folder: b.path }

  const fromInput = (input: HTMLInputElement | null) => {
    if (!input?.files) return
    enqueueUpload(filesFromInput(input.files), dest, limits, currentPin())
    input.value = ''
  }

  const copyPaths = () => {
    const text = [...b.selected.keys()].join('\n')
    void pluginCtx()
      .os.writeClipboard(text)
      .then(ok => host.notify(ok ? { kind: 'success', message: S.copied(b.selected.size) } : { kind: 'error', message: S.copyFailed }))
  }

  return (
    <Frame
      controls={<RootSelect b={b} />}
      dropLabel={S.dropTo(here)}
      onDropInput={(pending, pin) =>
        void pending.then(
          input => enqueueUpload(input, dest, limits, pin),
          error => host.notify({ kind: 'error', message: errorText(error) })
        )
      }
      profile={profile}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '0 20px 8px', borderBottom: '1px solid var(--ui-stroke-tertiary)' }}>
        <Breadcrumbs b={b} />
        <BrowserSearch b={b} />
        <ToolButton icon="new-folder" label={S.newFolder} onClick={() => setNewFolder(true)} />
        <ToolButton icon="cloud-upload" label={S.uploadFiles} onClick={() => filesInput.current?.click()} />
        <ToolButton icon="file-directory-create" label={S.uploadFolder} onClick={() => folderInput.current?.click()} />
        <ToolButton disabled={!b.selected.size} icon="copy" label={S.copyPath} onClick={copyPaths} />
        <input hidden multiple onChange={event => fromInput(event.currentTarget)} ref={filesInput} type="file" />
        <input
          hidden
          multiple
          onChange={event => fromInput(event.currentTarget)}
          ref={folderInput}
          type="file"
          {...{ webkitdirectory: '' }}
        />
      </div>
      <div style={{ ...muted, fontSize: 11, padding: '4px 20px', textAlign: 'right' }}>{S.maxPerFile(roots.max_file_bytes)}</div>
      <EntryList b={b} />
      <UploadDrawer onSettled={() => void queryClient.invalidateQueries({ queryKey: ['hcfm'] })} />
      <NewFolderDialog
        b={b}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ['hcfm'] })}
        onOpenChange={setNewFolder}
        open={newFolder}
      />
    </Frame>
  )
}

function ToolButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button disabled={disabled} onClick={onClick} size="sm" variant="ghost">
      <Codicon name={icon} size="0.875rem" />
      {label}
    </Button>
  )
}

function NewFolderDialog({ b, open, onOpenChange, onCreated }: {
  b: Browser
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setName('')
      setError('')
    }
  }, [open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError(S.nameRequired)
    if (trimmed.includes('/')) return setError(S.nameNoSlash)
    setBusy(true)
    try {
      await call('/mkdir', { method: 'POST', body: { root: b.root?.id, path: joinPath(b.path, trimmed) } })
      onOpenChange(false)
      onCreated()
      host.notify({ kind: 'success', message: S.folderCreated(trimmed) })
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : errorText(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent style={{ maxWidth: 380 }}>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <DialogHeader>
            <DialogTitle>{S.newFolder}</DialogTitle>
          </DialogHeader>
          <Input aria-label={S.folderName} autoFocus onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder={S.folderName} value={name} />
          {error && <div style={{ color: 'var(--ui-red)', fontSize: 12 }}>{error}</div>}
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="text">
              {S.cancel}
            </Button>
            <Button loading={busy} type="submit">
              {S.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const EMPTY: BatchSnapshot = { profile: '', connectionId: null, items: [], running: false, paused: false, canceled: false }
const noop = () => () => undefined

function useBatch(batch: null | UploadBatch): BatchSnapshot {
  return useSyncExternalStore(batch?.subscribe ?? noop, batch?.getSnapshot ?? (() => EMPTY), batch?.getSnapshot ?? (() => EMPTY))
}

/** Thin progress line: muted track, accent fill. Shown only while something is uploading. */
function Bar({ value, style }: { value: number; style?: CSSProperties }) {
  const pct = Math.round(Math.min(100, Math.max(0, value * 100)))
  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={pct}
      role="progressbar"
      style={{ height: 2, borderRadius: 2, background: 'var(--ui-stroke-tertiary)', overflow: 'hidden', ...style }}
    >
      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--ui-accent)', transition: 'width 150ms' }} />
    </div>
  )
}

function UploadDrawer({ onSettled }: { onSettled: () => void }) {
  const batch = useValue($batch)
  const snap = useBatch(batch)
  const [collapsed, setCollapsed] = useState(false)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !snap.running) onSettled()
    wasRunning.current = snap.running
  }, [snap.running, onSettled])

  if (!batch || !snap.items.length) return null
  const sum = summarize(snap)
  const headline = snap.canceled
    ? S.canceled
    : snap.paused
      ? S.paused(snap.profile)
      : snap.running
        ? S.uploading(Math.min(sum.total, sum.settled + 1), sum.total, humanSize(sum.sent), humanSize(sum.size))
        : S.uploaded(sum.done, sum.total, sum.failed)

  return (
    <div aria-label={S.uploads} role="region" style={{ borderTop: '1px solid var(--ui-stroke-tertiary)', padding: '8px 20px', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <Button aria-label={collapsed ? S.expand : S.collapse} onClick={() => setCollapsed(!collapsed)} size="icon-xs" variant="ghost">
          <Codicon name={collapsed ? 'chevron-up' : 'chevron-down'} size="0.875rem" />
        </Button>
        <span style={{ flex: 1, minWidth: 0 }}>{headline}</span>
        {snap.running ? (
          <Button onClick={() => batch.cancel()} size="sm" variant="text">
            {S.cancel}
          </Button>
        ) : (
          <Button onClick={() => $batch.set(null)} size="sm" variant="text">
            {S.clear}
          </Button>
        )}
      </div>
      {snap.running && <Bar value={sum.size ? sum.sent / sum.size : sum.total ? sum.settled / sum.total : 0} />}
      {!collapsed && (
        <div style={{ maxHeight: 180, overflowY: 'auto', display: 'grid', gap: 4 }}>
          {snap.items.map(item => (
            <UploadRow item={item} key={item.id} onRetry={() => batch.retry(item.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function statusText(item: UploadItem): string {
  if (item.status === 'queued') return S.queued
  if (item.status === 'uploading') return `${item.size ? Math.floor((item.sent / item.size) * 100) : 0}%`
  if (item.status === 'canceled') return S.canceledItem
  if (item.status === 'failed') return S.failed(item.error ?? '')
  return item.savedAs ? S.savedAs(item.savedAs) : S.done
}

function UploadRow({ item, onRetry }: { item: UploadItem; onRetry: () => void }) {
  return (
    <div data-upload={item.path} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '2px 8px', alignItems: 'center', fontSize: 11 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.path}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: item.status === 'failed' ? 'var(--ui-red)' : 'var(--ui-text-tertiary)' }}>
        {statusText(item)}
        {item.status === 'failed' && item.retryable !== false && (
          <Button onClick={onRetry} size="micro" variant="textStrong">
            {S.retry}
          </Button>
        )}
      </span>
      {item.status === 'uploading' && (
        <Bar style={{ gridColumn: '1 / -1', marginTop: 3 }} value={item.size ? item.sent / item.size : 0} />
      )}
    </div>
  )
}

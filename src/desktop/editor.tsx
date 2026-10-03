// The text editor on the Cloud Files page: a read-only View first, Edit only on request, and a write only from
// the Save button in the Review dialog. Nothing saves on close, blur, unmount, agent switch, a timer or ⌘S.
// A draft left behind by leaving the page is kept in memory only (never storage), keyed by agent and file.
import {
  atom,
  Button,
  Codicon,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  host,
  Skeleton,
  Streamdown,
  Textarea,
  useValue
} from '@hermes/plugin-sdk'
import { type CSSProperties, type Dispatch, type KeyboardEvent, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, call, type Entry, isNotFoundError, pluginCtx, query, type Root } from './api'
import { type LineDiff, lineDiff } from './diff'
import { isMarkdown } from './format'
import { fileCodeText, S } from './strings'
import { type AgentPin, transportText } from './upload'

export interface Doc {
  /** Load generation: a late /file answer for an earlier open is dropped. */
  id: number
  pin: AgentPin
  root: string
  rootLabel: string
  path: string
  abs: string
  name: string
  status: 'loading' | 'error' | 'ready'
  error?: string
  /** The opened version, BOM stripped and CRLF turned into LF; `sha` is the server's hash of its raw bytes. */
  base: string
  sha: string
  bom: boolean
  crlf: boolean
  /** Some lines end in CRLF and some in LF: a save writes them all as CRLF (said in Edit and Review). */
  mixed: boolean
  draft: string
  mode: 'view' | 'edit'
}

export type SetDoc = Dispatch<SetStateAction<Doc | null>>

interface FileResponse {
  ok: boolean
  text: string
  sha256: string
}

const BOM = '\uFEFF'
const mono = 'var(--ui-font-mono, ui-monospace, monospace)'
const muted: CSSProperties = { color: 'var(--ui-text-tertiary)' }

/** Edit as LF without a BOM; `encodeText` puts both back, so an untouched uniform text round-trips byte-exact.
 *  A mixed CRLF/LF text cannot: it is flagged `mixed`, and an edited save converts every line to CRLF. */
export function decodeText(raw: string): { text: string; bom: boolean; crlf: boolean; mixed: boolean } {
  const bom = raw.startsWith(BOM)
  const body = bom ? raw.slice(1) : raw
  const crlf = body.includes('\r\n')
  const text = crlf ? body.replaceAll('\r\n', '\n') : body
  return { text, bom, crlf, mixed: crlf && body.replaceAll('\r\n', '').includes('\n') }
}

export const encodeText = (text: string, { bom, crlf }: { bom: boolean; crlf: boolean }) =>
  (bom ? BOM : '') + (crlf ? text.replaceAll('\n', '\r\n') : text)

export const isDirty = (doc: Doc | null) => Boolean(doc && doc.status === 'ready' && doc.draft !== doc.base)

const isCurrent = (pin: AgentPin) => pin.connectionId === host.state.connectionId.get() && pin.profile === host.state.profile.get()

// ---- Drafts that outlive the page (memory only).
export const $drafts = atom<ReadonlyMap<string, Doc>>(new Map())
const draftKey = (doc: Doc) => [doc.pin.connectionId ?? 'local', doc.pin.profile, doc.root, doc.path].join('|')

function setDraft(doc: Doc, keep: boolean) {
  const next = new Map($drafts.get())
  if (keep) next.set(draftKey(doc), doc)
  else next.delete(draftKey(doc))
  $drafts.set(next)
}

/** `doc` after the server saved `sent` as `sha`: that text is the new base (all CRLF if it was mixed). A draft
 *  still equal to it is clean and goes back to View; anything typed since stays a dirty draft on the new base.
 *  A doc back in View (edits discarded while the save was pending) has no draft to keep: it shows the saved text. */
function savedAs(doc: Doc, sent: string, sha: string): Doc {
  const next = { ...doc, base: sent, sha, mixed: false }
  return doc.draft === sent || doc.mode === 'view' ? { ...next, draft: sent, mode: 'view' } : next
}

// The open-file setters of mounted pages, so a late Save answer reaches the page shown now.
const mounted = new Set<SetDoc>()

/** A Save of `sent` answered as `sha`: settle that same opened file (same load id, still on the sent sha) on the
 *  Editor that sent it, on any page mounted now, and in a draft parked meanwhile. */
function settleSave(sent: Doc, sha: string, own: SetDoc) {
  const settle = (d: Doc | null) => (d && d.id === sent.id && d.sha === sent.sha ? savedAs(d, sent.draft, sha) : d)
  for (const set of new Set([own, ...mounted])) set(settle)
  const parked = $drafts.get().get(draftKey(sent))
  if (parked && parked.id === sent.id && parked.sha === sent.sha) setDraft(savedAs(parked, sent.draft, sha), true)
}

function findParked(pin: AgentPin): Doc | null {
  return [...$drafts.get().values()].find(d => d.pin.connectionId === pin.connectionId && d.pin.profile === pin.profile) ?? null
}

/** The open file, owned above the per-agent page so an agent switch keeps it (with a banner). Mounting the
 *  page restores a draft left for the current agent; unmounting it keeps an unsaved Edit for later. */
export function useOpenDoc(): [Doc | null, SetDoc] {
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const [doc, setDoc] = useState<Doc | null>(() => findParked({ connectionId, profile }))
  const latest = useRef(doc)
  latest.current = doc
  useEffect(() => {
    mounted.add(setDoc)
    if (latest.current) setDraft(latest.current, false)
    return () => {
      mounted.delete(setDoc)
      const last = latest.current
      if (last && last.mode === 'edit' && isDirty(last)) setDraft(last, true)
    }
  }, [])
  useEffect(() => {
    // An agent switch with no file open brings back that agent's parked draft, as reopening the page would.
    if (latest.current) return
    const parked = findParked({ connectionId, profile })
    if (parked) {
      setDraft(parked, false)
      setDoc(parked)
    }
  }, [connectionId, profile])
  return [doc, setDoc]
}

let generation = 0

function loadText(error: unknown): string {
  if (error instanceof ApiError) return fileCodeText(error.code, error.body?.message, error.body?.max_bytes)
  return isNotFoundError(error) ? S.needsUpdateBody : transportText(error)
}

/** Fetch `doc`'s file into a fresh generation of it; the answer lands only if that generation is still open. */
function load(doc: Doc, setDoc: SetDoc) {
  const id = ++generation
  setDoc({ ...doc, id, status: 'loading', error: undefined, mode: 'view' })
  call<FileResponse>(query('/file', { root: doc.root, path: doc.path })).then(
    res => {
      const { text, ...flags } = decodeText(res.text)
      setDoc(d => (d?.id === id ? { ...d, ...flags, status: 'ready', base: text, draft: text, sha: res.sha256 } : d))
    },
    error => setDoc(d => (d?.id === id ? { ...d, status: 'error', error: loadText(error) } : d))
  )
}

export function openDoc(entry: Entry, root: Root, pin: AgentPin, setDoc: SetDoc) {
  const base = { bom: false, crlf: false, mixed: false, base: '', draft: '', sha: '' }
  load({ ...base, id: 0, pin, root: root.id, rootLabel: root.label, path: entry.rel, abs: entry.abs, name: entry.name, status: 'loading', mode: 'view' }, setDoc)
}

/** "Discard unsaved changes?" before any action that would drop the draft. */
export function useLeaveGuard(doc: Doc | null) {
  const [pending, setPending] = useState<null | (() => void)>(null)
  const leave = (action: () => void) => (isDirty(doc) ? setPending(() => action) : action())
  const dialog = (
    <Dialog onOpenChange={(open: boolean) => !open && setPending(null)} open={Boolean(pending && doc)}>
      <DialogContent style={{ maxWidth: 400 }}>
        <DialogHeader>
          <DialogTitle>{S.discardTitle(doc?.name ?? '')}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => setPending(null)} variant="text">
            {S.keepEditing}
          </Button>
          <Button
            onClick={() => {
              pending?.()
              setPending(null)
            }}
            variant="destructive"
          >
            {S.discard}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
  return { leave, dialog }
}

function copy(text: string, message: string) {
  void pluginCtx()
    .os.writeClipboard(text)
    .then(ok => ok, () => false)
    .then(ok => host.notify(ok ? { kind: 'success', message } : { kind: 'error', message: S.copyFailed }))
}

type Popup = null | 'review' | 'gone' | { conflict: { sha: string; text?: string } }

export function Editor({ doc, setDoc, onClose, leave }: { doc: Doc; setDoc: SetDoc; onClose: () => void; leave: (action: () => void) => void }) {
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const here = doc.pin.connectionId === connectionId && doc.pin.profile === profile
  const [popup, setPopup] = useState<Popup>(null)
  const [changes, setChanges] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const latest = useRef(doc)
  latest.current = doc
  const popupRef = useRef(popup)
  popupRef.current = popup
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])
  const dirty = isDirty(doc)
  const editing = doc.mode === 'edit'
  const diff = useMemo(() => (popup === 'review' || changes ? lineDiff(doc.base, doc.draft) : null), [popup, changes, doc.base, doc.draft])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 4000) // clears a note only; never writes
    return () => clearTimeout(timer)
  }, [saved])

  const review = () => {
    if (!dirty || !here) return
    setSaveError('')
    setPopup('review')
  }
  const keyDown = (event: KeyboardEvent) => {
    // ⌘S / Ctrl-S opens Review; it never saves by itself.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (editing) review()
    }
  }
  const save = async () => {
    // ctx.rest targets the selected agent: never send while it isn't this file's. Never send an unchanged text.
    if (!isCurrent(doc.pin) || !isDirty(doc) || busy) return
    const sent = doc.draft
    setBusy(true)
    setSaveError('')
    try {
      const res = await call<{ ok: boolean; sha256: string }>('/file/save', {
        method: 'POST',
        body: { root: doc.root, path: doc.path, base_sha256: doc.sha, text: encodeText(sent, doc) }
      })
      settleSave(doc, res.sha256, setDoc)
      setPopup(null)
      setChanges(false)
      setSaved(true)
    } catch (error) {
      // Edits discarded while the save was pending: there is nothing left to save, so a late refusal is moot.
      if (latest.current.id === doc.id && latest.current.mode === 'view') return
      if (error instanceof ApiError && error.code === 'conflict') setPopup({ conflict: { sha: error.body?.sha256, text: error.body?.text } })
      else if (error instanceof ApiError && error.code === 'gone') setPopup('gone')
      else {
        const message = error instanceof ApiError ? fileCodeText(error.code, error.body?.message, error.body?.max_bytes, true) : transportText(error)
        setSaveError(message)
        // Review closed (Back to editing, or the page was left) before the answer: say it where it can be seen.
        if (!live.current || popupRef.current !== 'review') host.notify({ kind: 'error', message: S.notSaved(doc.name, message) })
      }
    } finally {
      setBusy(false)
    }
  }
  const compare = (theirs: { sha: string; text?: string }) => {
    if (typeof theirs.text !== 'string') return
    const { text, ...flags } = decodeText(theirs.text)
    setDoc(d => (d?.id === doc.id ? { ...d, ...flags, base: text, sha: theirs.sha } : d))
    setPopup('review')
  }
  const reload = () => {
    if (!isCurrent(doc.pin)) return
    setPopup(null)
    setChanges(false)
    load(doc, setDoc)
  }
  const cancel = () => leave(() => setDoc(d => (d?.id === doc.id ? { ...d, draft: d.base, mode: 'view' } : d)))
  const conflict = popup && typeof popup === 'object' ? popup.conflict : null

  let body
  if (doc.status === 'loading') {
    body = (
      <div aria-busy="true" aria-label={S.loadingFile} style={{ display: 'grid', gap: 6, padding: '12px 20px' }}>
        {[0, 1, 2].map(i => (
          <Skeleton key={i} style={{ height: 16 }} />
        ))}
      </div>
    )
  } else if (doc.status === 'error') {
    body = <p style={{ ...muted, fontSize: 13, padding: '12px 20px' }}>{doc.error}</p>
  } else if (editing && changes) {
    body = <DiffView diff={diff!} style={{ flex: 1, minHeight: 0, margin: '0 20px 12px' }} />
  } else if (editing) {
    body = (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: '0 20px 12px' }}>
        <Textarea
          aria-label={doc.name}
          onChange={(event: { target: { value: string } }) => setDoc(d => (d?.id === doc.id ? { ...d, draft: event.target.value } : d))}
          readOnly={!here}
          spellCheck={false}
          style={{ flex: 1, height: '100%', resize: 'none', fontFamily: mono, fontSize: 12, lineHeight: 1.5 }}
          value={doc.draft}
        />
      </div>
    )
  } else {
    body = (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 20px 20px', fontSize: 13, lineHeight: 1.6 }}>
        {isMarkdown(doc.name) ? (
          // Inset so list markers (drawn outside the text column) stay inside the page instead of the gutter.
          <div style={{ paddingLeft: 24 }}>
            <Streamdown controls={false} mode="static" parseIncompleteMarkdown={false}>
              {doc.base}
            </Streamdown>
          </div>
        ) : (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: mono, fontSize: 12 }}>{doc.base}</pre>
        )}
      </div>
    )
  }

  return (
    <div onKeyDown={keyDown} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', fontSize: 12 }}>
        <Button onClick={() => leave(onClose)} size="sm" variant="ghost">
          <Codicon name="arrow-left" size="0.875rem" />
          {S.close}
        </Button>
        {editing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            {S.editing}
            {dirty && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 400, ...muted }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--ui-accent)' }} />
                {S.unsaved}
              </span>
            )}
            {doc.mixed && <span style={{ fontWeight: 400, ...muted }}>{S.mixedEndings}</span>}
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>{doc.name}</span>
            <span style={muted}>{doc.pin.profile}</span>
            <span style={{ ...muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.abs}</span>
            {saved && <span style={{ color: 'var(--ui-green)' }}>{S.saved}</span>}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {editing ? (
            <>
              <Button aria-pressed={changes} onClick={() => setChanges(!changes)} size="sm" variant={changes ? 'secondary' : 'ghost'}>
                {S.changes}
              </Button>
              <Button onClick={cancel} size="sm" variant="text">
                {S.cancel}
              </Button>
              <Button disabled={!dirty || !here} onClick={review} size="sm">
                {S.reviewSave}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => copy(doc.abs, S.copied(1))} size="sm" variant="ghost">
                {S.copyPath}
              </Button>
              <Button disabled={doc.status !== 'ready' || !here} onClick={() => setDoc(d => (d?.id === doc.id ? { ...d, mode: 'edit' } : d))} size="sm">
                {S.edit}
              </Button>
            </>
          )}
        </span>
      </div>
      {!here && (
        <div role="status" style={{ margin: '0 20px 8px', padding: '6px 10px', borderRadius: 6, fontSize: 12, background: 'var(--ui-warning-background, color-mix(in srgb, var(--ui-accent) 10%, transparent))', color: 'var(--ui-warning-text, var(--ui-text-primary))' }}>
          {S.otherAgent(doc.pin.profile)}
        </div>
      )}
      {body}

      <Dialog onOpenChange={(open: boolean) => !open && setPopup(null)} open={popup === 'review'}>
        <DialogContent style={{ maxWidth: 760 }}>
          <DialogHeader>
            <DialogTitle>{S.reviewTitle(doc.name)}</DialogTitle>
          </DialogHeader>
          {diff && !diff.tooLarge && <div style={{ ...muted, fontSize: 12 }}>{S.diffSummary(diff.added, diff.removed)}</div>}
          {diff && <DiffView diff={diff} style={{ maxHeight: '60vh' }} />}
          {doc.mixed && <div style={{ ...muted, fontSize: 12 }}>{S.mixedEndings}</div>}
          {saveError && <div style={{ color: 'var(--ui-red)', fontSize: 12 }}>{saveError}</div>}
          <DialogFooter>
            <Button onClick={() => setPopup(null)} variant="text">
              {S.backToEditing}
            </Button>
            <Button disabled={!here || !dirty || busy} loading={busy} onClick={() => void save()}>
              {S.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open: boolean) => !open && setPopup(null)} open={Boolean(conflict)}>
        <DialogContent style={{ maxWidth: 460 }}>
          <DialogHeader>
            <DialogTitle>{S.conflictTitle(doc.name, doc.pin.profile)}</DialogTitle>
          </DialogHeader>
          <DialogFooter style={{ flexWrap: 'wrap' }}>
            <Button onClick={() => setPopup(null)} variant="text">
              {S.backToEditing}
            </Button>
            <Button onClick={() => copy(doc.draft, S.textCopied)} variant="secondary">
              {S.copyMine}
            </Button>
            <Button disabled={!here} onClick={reload} variant="secondary">
              {S.discardReload}
            </Button>
            <Button disabled={typeof conflict?.text !== 'string'} onClick={() => conflict && compare(conflict)}>
              {S.compare}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open: boolean) => !open && setPopup(null)} open={popup === 'gone'}>
        <DialogContent style={{ maxWidth: 420 }}>
          <DialogHeader>
            <DialogTitle>{S.goneTitle(doc.name, doc.pin.profile)}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => copy(doc.draft, S.textCopied)} variant="secondary">
              {S.copyMine}
            </Button>
            <Button
              onClick={() => {
                setPopup(null)
                leave(onClose)
              }}
            >
              {S.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const DIFF_COLORS = {
  add: { background: 'var(--ui-diff-add-background, color-mix(in srgb, var(--ui-green) 12%, transparent))', color: 'var(--ui-diff-add-foreground, var(--ui-green))' },
  del: { background: 'var(--ui-diff-remove-background, color-mix(in srgb, var(--ui-red) 12%, transparent))', color: 'var(--ui-diff-remove-foreground, var(--ui-red))' },
  same: {}
}

/** Unified line diff: old and new line numbers, a +/− gutter, and folded unchanged runs. */
export function DiffView({ diff, style }: { diff: LineDiff; style?: CSSProperties }) {
  const frame: CSSProperties = { overflow: 'auto', border: '1px solid var(--ui-stroke-tertiary)', borderRadius: 6, fontFamily: mono, fontSize: 11.5, lineHeight: 1.5, ...style }
  if (diff.tooLarge || !diff.rows.length) {
    return <div style={{ ...frame, ...muted, padding: '8px 10px', fontFamily: undefined }}>{diff.tooLarge ? S.diffTooLarge : S.noChanges}</div>
  }
  return (
    <div style={frame}>
      {diff.rows.map((row, i) =>
        row.kind === 'skip' ? (
          <div key={i} style={{ ...muted, padding: '2px 10px', background: 'var(--ui-row-hover-background)' }}>
            {S.unchangedLines(row.count)}
          </div>
        ) : (
          <div data-diff={row.kind} key={i} style={{ display: 'grid', gridTemplateColumns: '3.5em 3.5em 1.5em minmax(0, 1fr)', ...DIFF_COLORS[row.kind] }}>
            <span style={{ ...muted, textAlign: 'right', paddingRight: 6 }}>{row.old ?? ''}</span>
            <span style={{ ...muted, textAlign: 'right', paddingRight: 6 }}>{row.new ?? ''}</span>
            <span style={{ textAlign: 'center' }}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
            <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', paddingRight: 10 }}>{row.text}</span>
          </div>
        )
      )}
    </div>
  )
}

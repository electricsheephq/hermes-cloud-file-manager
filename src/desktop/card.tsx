// A file the agent hands over in its reply. The agent writes `::cloud-file{path="/abs/path"}` (it learns the syntax
// from the plugin's instructions section) and Desktop's transcript directives draw this card in its place. The
// attributes are model output: the path only ever goes to the guarded /locate route, and nothing here writes.
import { atom, Button, Codicon, host, useQuery, useValue } from '@hermes/plugin-sdk'

import { ApiError, call, type Entry, httpStatus, PAGE_PATH } from './api'
import { useScope } from './browser'
import { AddToChat } from './chat'
import { captureFor } from './download'
import { baseName, entryIcon, humanSize, isOpenable, parentPath, shortDate } from './format'
import { ownerMismatch } from './picker'
import { codeText, S } from './strings'
import { type AgentPin } from './upload'

export const DIRECTIVE_AREA = 'transcript.directives'
export const DIRECTIVE_NAME = 'cloud-file'
const MAX_PATH = 4096
/** A reveal the page hasn't picked up by then (it couldn't mount) is dropped, so it can't surprise a later visit. */
export const REVEAL_TTL_MS = 30_000

/** A card asked the page to show (and maybe open) a file; the Files view takes it once and clears it. */
export interface Reveal {
  pin: AgentPin
  root: string
  rootPath: string
  entry: Entry
  preview: boolean
  at: number
}
export const $reveal = atom<null | Reveal>(null)

interface Located {
  ok: true
  root: string
  root_label?: string
  root_path: string
  entry: Entry
}

/** What the host passes a directive's render (sessionId is missing on older hosts). */
export interface DirectiveProps {
  attrs: Readonly<Record<string, string>>
  source: string
  streaming: boolean
  sessionId?: null | string
}

const NO_OWNER = atom<null | { connectionId: null | string; profile: string }>(null)
const NO_SESSION = atom<null | string>(null)

export function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !/[\r\n\0]/.test(value)
    && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value))
}

const box = {
  display: 'grid',
  gap: 6,
  margin: '6px 0',
  padding: '8px 10px',
  maxWidth: 520,
  border: '1px solid var(--ui-stroke-tertiary)',
  borderRadius: 8,
  background: 'var(--ui-surface-background)'
} as const
const muted = { fontSize: 12, color: 'var(--ui-text-secondary)' } as const

function Head({ icon, name, detail, title }: { icon: string; name: string; detail?: string; title?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }} title={title}>
      <Codicon name={icon} size="1rem" style={{ color: 'var(--ui-text-secondary)', flex: 'none' }} />
      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {detail && <span style={{ ...muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>}
    </div>
  )
}

function failureText(error: unknown): string {
  if (httpStatus(error) === 404) return S.cardUpdate
  if (error instanceof ApiError) {
    if (error.code === 'outside_root' || error.code === 'protected') return S.cardOutside
    if (error.code === 'not_found') return S.cardGone
    return codeText(error.code, error.message)
  }
  return S.cardUnavailable
}

export function FileCard({ attrs, source, streaming, sessionId }: DirectiveProps) {
  // Not trimmed: a trailing space is part of a POSIX file name, and trimming could point the card at another file.
  const path = typeof attrs.path === 'string' ? attrs.path : ''
  const valid = validPath(path)
  const [connectionId, profile] = useScope()
  // Older hosts have no focusedSessionOwner: then the selected agent is the only one there is.
  const owner = useValue((host.state as unknown as { focusedSessionOwner?: typeof NO_OWNER }).focusedSessionOwner ?? NO_OWNER)
  // The same pin the page builds (raw host connection id, 'local' included), so its reveal check matches.
  const pin: AgentPin = { connectionId: useValue(host.state.connectionId), profile }
  const otherAgent = Boolean(owner && ownerMismatch(owner, host.state.connectionId.get(), host.state.profile.get()))
  // A card in a chat that isn't the focused one may belong to another agent (tiles): Desktop doesn't say which, so it
  // only looks the file up for the focused chat (the interacted tile, else the primary). The host names a card's chat
  // by its stored id, or its runtime id before it has one, so match either. Hosts that don't pass sessionId, or don't
  // expose the focused ids, have one chat at a time.
  const focus = host.state as unknown as { focusedStoredSessionId?: typeof NO_SESSION; focusedSessionId?: typeof NO_SESSION }
  const focusedStored = useValue(focus.focusedStoredSessionId ?? NO_SESSION)
  const focusedRuntime = useValue(focus.focusedSessionId ?? NO_SESSION)
  const knowsFocus = Boolean(focus.focusedStoredSessionId || focus.focusedSessionId)
  const elsewhere = Boolean(sessionId) && knowsFocus && sessionId !== focusedStored && sessionId !== focusedRuntime
  const query = useQuery({
    queryKey: ['hcfm', connectionId, profile, 'locate', path],
    queryFn: () => call<Located>(`/locate?path=${encodeURIComponent(path)}`),
    enabled: valid && !streaming && !otherAgent && !elsewhere,
    retry: false
  })

  if (!valid) return <code style={muted}>{source}</code>
  const name = baseName(path.replace(/\\/g, '/')) || path
  if (otherAgent && owner) {
    return (
      <div style={box}>
        <Head icon="file" name={name} title={path} />
        <span style={muted}>{S.cardOtherAgent(owner.profile)}</span>
      </div>
    )
  }
  if (elsewhere) {
    return (
      <div style={box}>
        <Head icon="file" name={name} title={path} />
        <span style={muted}>{S.cardFocusChat}</span>
      </div>
    )
  }
  if (streaming || (!query.data && !query.error)) {
    return (
      <div aria-busy="true" style={box}>
        <Head icon="file" name={name} title={path} />
      </div>
    )
  }
  if (!query.data) {
    return (
      <div style={box}>
        <Head icon="file" name={name} title={path} />
        <span style={muted}>{failureText(query.error)}</span>
      </div>
    )
  }

  const { entry, root, root_path: rootPath } = query.data
  const label = query.data.root_label || baseName(rootPath.replace(/\\/g, '/')) || rootPath
  const parent = parentPath(entry.rel)
  const folder = parent ? `${label}/${parent}` : label
  const facts = [S.cardIn(folder), entry.size !== null && !entry.is_dir ? humanSize(entry.size) : '', entry.mtime ? shortDate(entry.mtime) : '']
    .filter(Boolean)
    .join(' · ')
  const reveal = (preview: boolean) => {
    $reveal.set({ pin, root, rootPath, entry, preview, at: Date.now() })
    host.navigate(PAGE_PATH)
  }
  const save = !entry.is_dir && !entry.link_outside ? captureFor([connectionId, profile]) : null

  return (
    <div style={box}>
      <Head icon={entryIcon(entry)} name={entry.name || name} detail={facts} title={entry.abs} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <Button onClick={() => reveal(false)} size="sm" variant="secondary">
          {S.open}
        </Button>
        {!entry.is_dir && isOpenable(entry) && (
          <Button onClick={() => reveal(true)} size="sm" variant="ghost">
            {S.cardPreview}
          </Button>
        )}
        {save && (
          <Button onClick={() => void save(entry.abs, entry.name).catch(() => undefined)} size="sm" variant="ghost">
            {S.download}
          </Button>
        )}
        {!entry.link_outside && <AddToChat entries={() => [entry]} pin={pin} sessionId={sessionId ?? null} />}
      </div>
    </div>
  )
}

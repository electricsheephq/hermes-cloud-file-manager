// The folder browser shared by the Cloud Files page and the "+ → Cloud" picker: breadcrumbs, search, and the
// entry list with selection. Styling is inline with theme variables only (a runtime plugin cannot rely on the
// app's compiled utility classes).
import {
  Button,
  Checkbox,
  Codicon,
  EmptyState,
  ErrorState,
  host,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react'

import { ApiError, call, type Entry, errorText, isNotFoundError, type ListResponse, query, type Root, type RootsResponse, type SearchResponse } from './api'
import { entryIcon, humanSize, parentPath, shortDate } from './format'
import { S } from './strings'
import { transportText } from './upload'

export const LIST_LIMIT = 500
const SEARCH_LIMIT = 200
const DEBOUNCE_MS = 300

/** Query-key scope: (connectionId, profile) so switching agents never shows another agent's files. */
export function useScope(): [string, string] {
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  return [connectionId ?? 'local', profile]
}

export function useRoots() {
  const scope = useScope()
  return useQuery({ queryKey: ['hcfm', ...scope, 'roots'], queryFn: () => call<RootsResponse>('/roots'), retry: 1 })
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

export type Mode = 'page' | 'pick'

/** Browser state: root, folder, search text and selection (keyed by absolute path). In page mode the
 *  selection belongs to the folder; in pick mode it persists across folders. */
export function useBrowser(roots: RootsResponse, mode: Mode) {
  const [rootId, setRootId] = useState(roots.roots[0]?.id ?? '')
  const root: Root | undefined = roots.roots.find(r => r.id === rootId) ?? roots.roots[0]
  const [path, setPath] = useState('')
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), DEBOUNCE_MS)
  const [selected, setSelected] = useState<ReadonlyMap<string, Entry>>(new Map())

  const navigate = (next: string) => {
    setPath(next)
    setSearch('')
    if (mode === 'page') setSelected(new Map())
  }

  return {
    roots,
    root,
    path,
    search,
    query: search.trim() ? debounced : '',
    selected,
    mode,
    setSearch,
    navigate,
    switchRoot: (id: string) => {
      setRootId(id)
      navigate('')
      setSelected(new Map())
    },
    toggle: (entry: Entry) =>
      setSelected(prev => {
        const next = new Map(prev)
        if (!next.delete(entry.abs)) next.set(entry.abs, entry)
        return next
      }),
    selectOnly: (entry: Entry) => setSelected(new Map([[entry.abs, entry]]))
  }
}

export type Browser = ReturnType<typeof useBrowser>

const muted: CSSProperties = { color: 'var(--ui-text-tertiary)' }
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

/** A failed load. A 404 on our own route means the agent's gateway half is missing, disabled or older than
 *  this Desktop half: say so plainly and keep the raw error as a small details line. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const retry = (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <Button onClick={onRetry} size="sm" variant="secondary">
        {S.retry}
      </Button>
    </div>
  )
  if (isNotFoundError(error)) {
    return (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'center', padding: '8px 32px 32px', textAlign: 'center' }}>
        <EmptyState description={S.needsUpdateBody} title={S.needsUpdateTitle} />
        <div style={{ ...muted, fontSize: 11, maxWidth: 560, overflowWrap: 'anywhere' }}>{errorText(error)}</div>
        {retry}
      </div>
    )
  }
  return (
    <div style={{ padding: 32 }}>
      <ErrorState description={error instanceof ApiError ? error.message : transportText(error)} title={S.loadFailed}>
        {retry}
      </ErrorState>
    </div>
  )
}

export function RootSelect({ b }: { b: Browser }) {
  if (b.roots.roots.length < 2) return null
  return (
    <Select onValueChange={b.switchRoot} value={b.root?.id}>
      <SelectTrigger aria-label={S.root} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {b.roots.roots.map(root => (
          <SelectItem key={root.id} value={root.id}>
            {root.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function Breadcrumbs({ b }: { b: Browser }) {
  const parts = b.path.split('/').filter(Boolean)
  const crumbs = [{ label: b.root?.label ?? '', path: '' }, ...parts.map((part, i) => ({ label: part, path: parts.slice(0, i + 1).join('/') }))]
  return (
    <nav aria-label={S.breadcrumbs} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1, fontSize: 12, ...ellipsis }}>
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1
        return (
          <span key={crumb.path || '/'} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            {i > 0 && <Codicon name="chevron-right" size="0.75rem" style={muted} />}
            {last && !b.query ? (
              <span style={{ ...ellipsis, color: 'var(--ui-text-primary)', fontWeight: 500 }}>{crumb.label}</span>
            ) : (
              <Button onClick={() => b.navigate(crumb.path)} size="inline" variant="text">
                {crumb.label}
              </Button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export function BrowserSearch({ b }: { b: Browser }) {
  return (
    <span onKeyDown={event => event.key === 'Escape' && b.setSearch('')}>
      <SearchField aria-label={S.search} onChange={b.setSearch} placeholder={S.search} value={b.search} />
    </span>
  )
}

function sortEntries(entries: Entry[], highlights: string[], atRoot: boolean): Entry[] {
  const rank = (entry: Entry) => (atRoot && entry.is_dir && highlights.includes(entry.name) ? highlights.indexOf(entry.name) : highlights.length)
  return [...entries].sort((a, b) => rank(a) - rank(b) || Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name))
}

/** The scrolling list: folder listing, or search results while a query is active. */
export function EntryList({ b, height }: { b: Browser; height?: number }) {
  const [connectionId, profile] = useScope()
  const rootId = b.root?.id ?? ''
  const searching = Boolean(b.query)
  const listing = useQuery({
    queryKey: ['hcfm', connectionId, profile, 'list', rootId, b.path],
    queryFn: () => call<ListResponse>(query('/list', { root: rootId, path: b.path, offset: 0, limit: LIST_LIMIT })),
    enabled: Boolean(rootId) && !searching,
    retry: 1
  })
  const found = useQuery({
    queryKey: ['hcfm', connectionId, profile, 'search', rootId, b.query],
    queryFn: () => call<SearchResponse>(query('/search', { root: rootId, q: b.query, limit: SEARCH_LIMIT })),
    enabled: Boolean(rootId) && searching,
    retry: 1
  })
  const active = searching ? found : listing
  const entries = useMemo(() => {
    if (searching) return found.data?.results ?? []
    return sortEntries(listing.data?.entries ?? [], b.roots.highlights ?? [], b.path === '')
  }, [searching, found.data, listing.data, b.roots.highlights, b.path])
  const truncated = searching ? found.data?.truncated : listing.data?.truncated

  const open = (entry: Entry) => {
    if (!entry.is_dir || entry.link_outside) return
    b.navigate(entry.rel)
  }

  let body: ReactNode
  if (active.error) {
    body = <LoadError error={active.error} onRetry={() => void active.refetch()} />
  } else if (!active.data) {
    body = (
      <div aria-busy="true" style={{ display: 'grid', gap: 6, padding: '8px 12px' }}>
        {[0, 1, 2, 3, 4].map(i => (
          <Skeleton key={i} style={{ height: 18, opacity: 1 - i * 0.15 }} />
        ))}
      </div>
    )
  } else if (!entries.length) {
    body = <EmptyState title={searching ? S.noResults : S.emptyFolder} />
  } else {
    body = (
      <div role="list">
        {entries.map(entry => (
          <EntryRow b={b} entry={entry} key={entry.abs} onOpen={open} searching={searching} />
        ))}
        {truncated && <div style={{ ...muted, fontSize: 11, padding: '8px 12px' }}>{S.truncated(entries.length)}</div>}
      </div>
    )
  }

  // A plain scroller, not ScrollArea: Radix's viewport lays children out as a table, which defeats the
  // rows' text-overflow ellipsis on long names.
  return (
    <div style={{ overflowY: 'auto', overflowX: 'hidden', ...(height ? { height } : { flex: 1, minHeight: 0 }) }}>
      {body}
    </div>
  )
}

function EntryRow({ b, entry, onOpen, searching }: { b: Browser; entry: Entry; onOpen: (entry: Entry) => void; searching: boolean }) {
  const [hover, setHover] = useState(false)
  const checked = b.selected.has(entry.abs)
  const note = !searching && b.path === '' ? b.root?.notes?.[entry.rel] ?? b.root?.notes?.[entry.name] : undefined
  const secondary = searching ? parentPath(entry.rel) || b.root?.label : note
  const click = () => {
    if (searching && entry.is_dir && !entry.link_outside) return onOpen(entry)
    if (b.mode === 'pick') b.toggle(entry)
    else b.selectOnly(entry)
  }
  return (
    <div
      aria-selected={checked}
      data-entry={entry.rel}
      onClick={click}
      onDoubleClick={() => onOpen(entry)}
      onKeyDown={event => {
        if (event.key === 'Enter') onOpen(entry)
        if (event.key === ' ') {
          event.preventDefault()
          b.toggle(entry)
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="listitem"
      style={{
        display: 'grid',
        gridTemplateColumns: '16px 16px minmax(0, 1fr) 72px 96px',
        alignItems: 'center',
        gap: 8,
        minHeight: 28,
        padding: '3px 12px',
        fontSize: 12,
        cursor: 'default',
        userSelect: 'none',
        opacity: entry.link_outside ? 0.5 : 1,
        background: checked ? 'var(--ui-row-active-background)' : hover ? 'var(--ui-row-hover-background)' : undefined
      }}
      tabIndex={0}
    >
      <span onClick={event => event.stopPropagation()} style={{ display: 'inline-flex' }}>
        {/* The kit's unchecked border token can match the page background; give it a visible stroke. */}
        <Checkbox
          aria-label={entry.name}
          checked={checked}
          onCheckedChange={() => b.toggle(entry)}
          style={checked ? undefined : { borderColor: 'var(--ui-stroke-secondary)' }}
        />
      </span>
      <Codicon name={entryIcon(entry)} size="0.875rem" style={{ color: entry.is_dir ? 'var(--ui-accent)' : 'var(--ui-text-secondary)' }} />
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{ ...ellipsis, color: 'var(--ui-text-primary)' }}>{entry.name}</span>
        {secondary && <span style={{ ...ellipsis, ...muted, fontSize: 11 }}>{secondary}</span>}
      </span>
      <span style={{ ...muted, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.is_dir ? '' : humanSize(entry.size)}</span>
      <span style={{ ...muted, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{shortDate(entry.mtime)}</span>
    </div>
  )
}

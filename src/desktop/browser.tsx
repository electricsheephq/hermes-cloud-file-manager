// The folder browser shared by the Cloud Files page and the "+ → Cloud" picker: breadcrumbs, search, and the
// entry list with selection. Styling is inline with theme variables only (a runtime plugin cannot rely on the
// app's compiled utility classes).
import {
  atom,
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
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'

import { ApiError, call, type Entry, errorText, isNotFoundError, type ListResponse, pluginCtx, query, type Root, type RootsResponse, type SearchResponse } from './api'
import { captureFor, type SaveFile } from './download'
import { baseName, entryIcon, humanSize, isOpenable, parentPath, shortDate } from './format'
import { codeText, S } from './strings'
import { transportText } from './upload'

export const LIST_LIMIT = 500
const LIST_PAGE_MAX = 2000
const SEARCH_LIMIT = 200
export const DEBOUNCE_MS = 300
/** Plugin settings in Hermes Desktop; older hosts redirect it to Capabilities ▸ Plugins. */
export const SETTINGS_PATH = '/settings?tab=plugins&agent=hermes-cloud-file-manager&plugin=hermes-cloud-file-manager'

/** Where focus goes once the listing of folder `at` has loaded: the row whose data-entry is `want`, else (or for
 *  `true`) the first row, else the list itself. Set by keyboard navigation and by closing the editor. */
export type FocusRequest = MutableRefObject<null | { at: string; want: true | string; from: Element | null }>

/** Asks for focus to move into folder `at`'s list once it has loaded, remembering where focus is now. Asked from a
 *  row, focus waits on the list itself meanwhile: the row is about to unmount, and focus that falls to the page body
 *  while a slow listing loads was lost in the real app (a Drive folder opened with Enter, 0.4.5). */
export function requestFocus(request: FocusRequest, at: string, want: true | string = true) {
  const from = document.activeElement
  request.current = { at, want, from }
  from?.closest<HTMLElement>('[data-hcfm-list]')?.focus({ preventScroll: true })
}

/** The ref for a list's scroller: after a focus request for `at`, the folder on screen, moves focus into the list
 *  once `ready` (loaded). Matching `at` keeps a render of the previous folder from taking the request. */
export function useListFocus(request: FocusRequest, ready: boolean, at: string | null, fetching = false) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const req = request.current
    if (!req || !ready || !list.current || req.at !== at) return
    const rows = [...list.current.querySelectorAll<HTMLElement>('[data-entry]')]
    const wanted = rows.find(row => row.getAttribute('data-entry') === req.want)
    // A cached listing can lack a file just written (Show after an upload): wait for the refetch under way.
    if (!wanted && typeof req.want === 'string' && fetching) return
    request.current = null
    // The user moved on while the listing loaded (into Search, a dialog, ...): leave their focus where it is.
    const now = document.activeElement
    if (now && now !== document.body && now !== req.from && !list.current.contains(now)) return
    ;(wanted ?? rows[0] ?? list.current).focus()
  })
  return list
}

/** Row focus: the host CSS removes every focus ring, so a focused row draws its own (inset accent line). */
export function useRowFocus() {
  const [focused, setFocused] = useState(false)
  return {
    focused,
    handlers: { onBlur: () => setFocused(false), onFocus: () => setFocused(true) },
    ring: focused ? { boxShadow: 'inset 0 0 0 1px var(--ui-accent, currentColor)' } : undefined
  }
}

/** A Button click with no pointer behind it (Enter or Space): `detail` counts mouse clicks and is 0 then. */
export const fromKeyboard = (event?: MouseEvent) => !event?.detail

/** Query-key scope: (connectionId, profile) so switching agents never shows another agent's files. */
export function useScope(): [string, string] {
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  return [connectionId ?? 'local', profile]
}

const MUTATING_TOOL_RE =
  /terminal|shell|exec|bash|command|write|edit|patch|replace|apply|create|delete|remove|move|rename|mkdir|format/i
export function toolMayChangeFiles(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const tool = payload as { name?: unknown; tool?: unknown; inline_diff?: unknown }
  if (typeof tool.inline_diff === 'string' && tool.inline_diff.trim()) return true
  const name = String(tool.name ?? tool.tool ?? '')
  return MUTATING_TOOL_RE.test(name)
}

/** Only the open agent's Cloud listings follow tool events; older hosts have no event subscription. */
function useLiveRefresh() {
  const [connectionId, profile] = useScope()
  const client = useQueryClient()
  useEffect(() => {
    const ctx = pluginCtx()
    if (typeof ctx.onEvent !== 'function') return
    let timer: number | undefined
    let missed = false
    const refresh = () => {
      // Folder mtime bypasses the gateway cache for new/deleted/renamed files; an edited size can lag 5 s.
      void client.invalidateQueries({ queryKey: ['hcfm', connectionId, profile, 'list'] })
      void client.invalidateQueries({ queryKey: ['hcfm', connectionId, profile, 'search'] })
    }
    const dispose = ctx.onEvent('tool.complete', event => {
      // Absent or empty connection ids both mean the local agent, on either side.
      if (event.profile === undefined || ((event.connectionId ?? '').trim() || 'local') !== (connectionId.trim() || 'local') ||
        ((event.profile ?? '').trim() || 'default') !== (profile.trim() || 'default') || !toolMayChangeFiles(event.payload)) return
      if (timer !== undefined) return
      timer = window.setTimeout(() => {
        timer = undefined
        if (document.visibilityState === 'hidden') missed = true
        else refresh()
      }, 1000)
    })
    const visible = () => {
      if (document.visibilityState !== 'visible' || !missed) return
      missed = false
      if (timer === undefined) refresh() // else the pending timer refreshes
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      dispose()
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [connectionId, profile])
}

export function useRoots() {
  const scope = useScope()
  return useQuery({ queryKey: ['hcfm', ...scope, 'roots'], queryFn: () => call<RootsResponse>('/roots'), retry: 1 })
}

export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

export type Mode = 'page' | 'pick'
interface PickState {
  scope: string
  rootId: string
  path: string
  search: string
  selected: ReadonlyMap<string, Entry>
}
export const $pickState = atom<PickState | null>(null)

/** Browser state: root, folder, search text and selection (keyed by absolute path). In page mode the
 *  selection belongs to the folder; in pick mode it persists across folders. */
export function useBrowser(roots: RootsResponse, mode: Mode) {
  const [localRootId, setLocalRootId] = useState(roots.roots[0]?.id ?? '')
  const [localPath, setLocalPath] = useState('')
  const [localSearch, setLocalSearch] = useState('')
  const [localSelected, setLocalSelected] = useState<ReadonlyMap<string, Entry>>(new Map())
  const scope = useScope().join('::')
  const picked = useValue($pickState)
  const fresh = (): PickState => ({ scope, rootId: roots.roots[0]?.id ?? '', path: '', search: '', selected: new Map() })
  const pick = picked?.scope === scope ? picked : fresh()
  useEffect(() => {
    if (mode === 'pick' && picked?.scope !== scope) $pickState.set(fresh())
  }, [mode, picked, scope, roots])
  const write = <K extends keyof PickState>(key: K, value: SetStateAction<PickState[K]>) => {
    const current = $pickState.get()
    const prev = current?.scope === scope ? current : fresh()
    $pickState.set({ ...prev, [key]: typeof value === 'function' ? value(prev[key]) : value })
  }
  const rootId = mode === 'pick' ? pick.rootId : localRootId
  const path = mode === 'pick' ? pick.path : localPath
  const search = mode === 'pick' ? pick.search : localSearch
  const selected = mode === 'pick' ? pick.selected : localSelected
  const setRootId = mode === 'pick' ? (id: string) => write('rootId', id) : setLocalRootId
  const setPath = mode === 'pick' ? (path: string) => write('path', path) : setLocalPath
  const setSearch = mode === 'pick' ? (text: string) => write('search', text) : setLocalSearch
  const setSelected = mode === 'pick' ? (value: SetStateAction<ReadonlyMap<string, Entry>>) => write('selected', value) : setLocalSelected
  const root: Root | undefined = roots.roots.find(r => r.id === rootId) ?? roots.roots[0]
  const debounced = useDebounced(search.trim(), DEBOUNCE_MS)
  const focusNext: FocusRequest = useRef(null)
  // What the list shows now: its entries and the save captured with the read that fetched them (null: none).
  const [shown, setShown] = useState<null | { entries: readonly Entry[]; save: SaveFile | null }>(null)

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
    focusNext,
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
    selectOnly: (entry: Entry) => setSelected(new Map([[entry.abs, entry]])),
    setShown,
    picked: () => selectedEntries(shown?.entries ?? [], selected),
    /** The save for `entry` only while the list's current data still shows it as a plain file (not a folder, not a
     *  link outside the shown folders), captured with that data. A selection keeps its old flags across a refresh. */
    saveFor: (entry: Entry) => {
      const now = shown?.entries.find(e => e.abs === entry.abs)
      return (now && !now.is_dir && !now.link_outside && shown?.save) || null
    }
  }
}

/** Shown order first, then selected rows hidden by search; outside links never carry references. */
export function selectedEntries(entries: readonly Entry[], selected: ReadonlyMap<string, Entry>): Entry[] {
  const shown = new Set(entries.map(e => e.abs))
  return [...entries.filter(e => selected.has(e.abs)), ...[...selected.values()].filter(e => !shown.has(e.abs))].filter(e => !e.link_outside)
}

export type Browser = ReturnType<typeof useBrowser>

const muted: CSSProperties = { color: 'var(--ui-text-tertiary)' }
const hidden: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
/** Crumbs share a narrow pane without drawing over each other: the host Button never shrinks by default
 *  (`shrink-0`), so its style overrides that and the label ellipsizes inside it. The current folder keeps up to 70%
 *  of the width; the folders above it shrink first, the root down to a sliver with an ellipsis, the ones between down
 *  to nothing, which keeps the current folder in sight on any realistic path. A crumb holding keyboard focus is
 *  sized like the current one, so Tab never rests on a crumb that has shrunk out of sight. `title` keeps the full
 *  name on hover. */
export const crumbStyle = (index: number, current: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 2, overflow: 'hidden',
  ...(current ? { flex: '0 0 auto', maxWidth: '70%', minWidth: 0 } : { flex: '0 100 auto', minWidth: index === 0 ? '2em' : 0 })
})
/** Which crumb holds keyboard focus, for `crumbStyle`: spread `handlers(i)` on each crumb. */
export function useCrumbFocus() {
  const [focused, setFocused] = useState<number | null>(null)
  return {
    focused,
    handlers: (index: number) => ({ onBlur: () => setFocused(f => (f === index ? null : f)), onFocus: () => setFocused(index) })
  }
}
export const crumbButtonStyle: CSSProperties = { flexShrink: 1, minWidth: 0, maxWidth: '100%', overflow: 'hidden' }
export const crumbLabelStyle: CSSProperties = { ...ellipsis, minWidth: 0 }
export const chevronStyle: CSSProperties = { ...muted, flexShrink: 0 }

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

/** `/roots` found none of the configured folders: the gateway's reason and a way to the plugin's settings. */
export function NoRoots({ reason, onOpenSettings }: { reason?: string; onOpenSettings?: () => void }) {
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'center', padding: '8px 32px 32px', textAlign: 'center' }}>
      <EmptyState description={reason ?? codeText('no_roots')} title={S.noRootsTitle} />
      <Button
        onClick={() => {
          onOpenSettings?.()
          host.navigate(SETTINGS_PATH)
        }}
        size="sm"
        variant="secondary"
      >
        {S.openSettings}
      </Button>
    </div>
  )
}

/** The value of the Google Drive entry in the root selector (not a root id). */
const DRIVE_VALUE = 'hcfm:google-drive'

/** Root selector. With `drive`, Google Drive is offered after the cloud roots, even when there is one root. */
export function RootSelect({ b, drive }: { b: Browser; drive?: { active: boolean; choose: (drive: boolean) => void } }) {
  if (b.roots.roots.length < 2 && !drive) return null
  const change = (value: string) => {
    drive?.choose(value === DRIVE_VALUE)
    if (value !== DRIVE_VALUE) b.switchRoot(value)
  }
  return (
    <Select onValueChange={change} value={drive?.active ? DRIVE_VALUE : b.root?.id}>
      <SelectTrigger aria-label={S.root} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {b.roots.roots.map(root => (
          <SelectItem key={root.id} value={root.id}>
            {root.label}
          </SelectItem>
        ))}
        {drive && <SelectItem value={DRIVE_VALUE}>{S.drive}</SelectItem>}
      </SelectContent>
    </Select>
  )
}

/** The folder path, or with `leaf` (an open file) the file's folder followed by its name, every folder clickable. */
export function Breadcrumbs({ b, folder = b.path, rootLabel = b.root?.label ?? '', leaf, onNavigate = b.navigate }: {
  b: Browser
  folder?: string
  rootLabel?: string
  leaf?: string
  onNavigate?: (path: string) => void
}) {
  const parts = folder.split('/').filter(Boolean)
  const crumbs = [{ label: rootLabel, path: '' }, ...parts.map((part, i) => ({ label: part, path: parts.slice(0, i + 1).join('/') }))]
  const focus = useCrumbFocus()
  return (
    <nav aria-label={S.breadcrumbs} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1, fontSize: 12, ...ellipsis }}>
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1
        return (
          <span key={crumb.path || '/'} {...focus.handlers(i)} style={crumbStyle(i, (last && !leaf) || focus.focused === i)}>
            {i > 0 && <Codicon name="chevron-right" size="0.75rem" style={chevronStyle} />}
            {last && !b.query && !leaf ? (
              <span style={{ ...crumbLabelStyle, color: 'var(--ui-text-primary)', fontWeight: 500 }} title={crumb.label}>{crumb.label}</span>
            ) : (
              <Button
                onClick={(event?: MouseEvent) => {
                  if (fromKeyboard(event)) requestFocus(b.focusNext, crumb.path)
                  onNavigate(crumb.path)
                }}
                size="inline"
                style={crumbButtonStyle}
                title={crumb.label}
                variant="text"
              >
                <span style={crumbLabelStyle}>{crumb.label}</span>
              </Button>
            )}
          </span>
        )
      })}
      {leaf && (
        <span style={crumbStyle(crumbs.length, true)}>
          <Codicon name="chevron-right" size="0.75rem" style={chevronStyle} />
          <span style={{ ...crumbLabelStyle, color: 'var(--ui-text-primary)', fontWeight: 500 }} title={leaf}>{leaf}</span>
        </span>
      )}
    </nav>
  )
}

export function BrowserSearch({ b, label = S.search }: { b: { search: string; setSearch: (text: string) => void; path?: string }; label?: string }) {
  // Search covers the folder shown, so the placeholder names it below the root.
  const folder = b.path?.split('/').pop()
  return (
    <span onKeyDown={event => event.key === 'Escape' && b.setSearch('')}>
      <SearchField aria-label={label} onChange={b.setSearch} placeholder={folder ? S.searchIn(folder) : label} value={b.search} />
    </span>
  )
}

function sortEntries(entries: Entry[], highlights: string[], atRoot: boolean): Entry[] {
  const rank = (entry: Entry) => (atRoot && entry.is_dir && highlights.includes(entry.name) ? highlights.indexOf(entry.name) : highlights.length)
  return [...entries].sort((a, b) => rank(a) - rank(b) || Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name))
}

/** The first count entries. The gateway scans the whole folder for every request, so a Load more (the first read
 *  of a larger count, given the listing on screen) reads only the new slice when the shown rows still line up: it
 *  re-reads the last shown entry too, and appends only if that entry is still in its place and the total is
 *  unchanged. Any other read re-reads the whole range in capped chunks, deduplicated by abs if the folder changes
 *  between them. The plugin's REST client follows the selected agent, so each request is sent only while this
 *  listing's agent is still selected: after a switch the listing fails rather than mixing two agents' files. */
async function listUpTo([connectionId, profile]: [string, string], root: string, path: string, count: number, shown?: ListResponse): Promise<ListResponse> {
  const read = (offset: number, limit: number) => {
    if ((host.state.connectionId.get() ?? 'local') !== connectionId || host.state.profile.get() !== profile) throw new Error(S.agentChanged)
    return call<ListResponse>(query('/list', { root, path, offset, limit }))
  }
  const have = shown?.entries.length ?? 0
  if (shown && have && have < count && count - have < LIST_PAGE_MAX) {
    const next = await read(have - 1, count - have + 1)
    if (next.total === shown.total && next.entries[0]?.abs === shown.entries[have - 1].abs) {
      const seen = new Set(shown.entries.map(entry => entry.abs))
      return { ...next, entries: [...shown.entries, ...next.entries.filter(entry => !seen.has(entry.abs))] }
    }
  }
  const seen = new Set<string>()
  const entries: Entry[] = []
  let last: ListResponse | undefined
  for (let offset = 0; offset < count; offset += LIST_PAGE_MAX) {
    last = await read(offset, Math.min(LIST_PAGE_MAX, count - offset))
    for (const entry of last.entries) if (!seen.has(entry.abs)) { seen.add(entry.abs); entries.push(entry) }
    if (offset + last.entries.length >= last.total) break
  }
  return { ...last!, entries }
}

/** The scrolling list: folder listing, or search results while a query is active. With `onOpenFile`, opening
 *  an editable or previewable file (double-click / Enter) hands it to the page; other files stay inert. */
export function EntryList({ b, height, onOpenFile, dragOut }: {
  b: Browser
  height?: number
  onOpenFile?: (entry: Entry) => void
  /** Page only: checks the listing's scope against the live host before a drag can carry paths. */
  dragOut?: (event: DragEvent, scope: [string, string]) => boolean
}) {
  const [connectionId, profile] = useScope()
  useLiveRefresh()
  const rootId = b.root?.id ?? ''
  const folder = `${connectionId}|${profile}|${rootId}|${b.path}`
  const [range, setRange] = useState({ folder, count: LIST_LIMIT })
  const count = range.folder === folder ? range.count : LIST_LIMIT
  if (range.folder !== folder) setRange({ folder, count: LIST_LIMIT })
  const listingKey = ['hcfm', connectionId, profile, 'list', rootId, b.path, count]
  const client = useQueryClient()
  const searching = Boolean(b.query)
  const listing = useQuery({
    queryKey: listingKey,
    // A first read of this count is a Load more: hand it the listing on screen (the previous count).
    // The save is captured with the read, never at click time: it belongs to the agent that answered.
    queryFn: async () => {
      const save = captureFor([connectionId, profile])
      return { ...await listUpTo([connectionId, profile], rootId, b.path, count,
        client.getQueryData(listingKey) === undefined ? client.getQueryData<ListResponse>([...listingKey.slice(0, 6), count - LIST_LIMIT]) : undefined), save }
    },
    placeholderData: (previous, previousQuery) => listingKey.slice(0, 6).every((value, i) => previousQuery?.queryKey[i] === value) ? previous : undefined,
    enabled: Boolean(rootId) && !searching,
    retry: 1
  })
  const found = useQuery({
    queryKey: ['hcfm', connectionId, profile, 'search', rootId, b.path, b.query],
    queryFn: async () => {
      const save = captureFor([connectionId, profile])
      return { ...await call<SearchResponse>(query('/search', { root: rootId, path: b.path, q: b.query, limit: SEARCH_LIMIT })), save }
    },
    enabled: Boolean(rootId) && searching,
    retry: 1
  })
  const active = searching ? found : listing
  const entries = useMemo(() => {
    if (searching) return found.data?.results ?? []
    return sortEntries(listing.data?.entries ?? [], b.roots.highlights ?? [], b.path === '')
  }, [searching, found.data, listing.data, b.roots.highlights, b.path])
  const truncated = searching ? found.data?.truncated : listing.data?.truncated
  const reason = searching ? found.data?.reason : undefined
  const stopped = reason === 'time' || reason === 'visits'
  const truncationNote = stopped ? S.searchStopped(found.data?.visited ?? 0) : reason === 'results' ? S.searchMore(entries.length) : S.truncated(entries.length)

  const list = useListFocus(b.focusNext, Boolean(active.data || active.error), searching ? null : b.path, active.isFetching)
  const { setShown } = b
  useEffect(() => setShown(active.data && !active.error ? { entries, save: active.data.save ?? null } : null), [active.data, active.error, entries, setShown])
  // One tab stop: the last focused row, else the first selected, else the first.
  const [lastFocused, setLastFocused] = useState<string | null>(null)
  const tabStop = (entries.find(e => e.abs === lastFocused) ?? entries.find(e => b.selected.has(e.abs)) ?? entries[0])?.abs
  const total = listing.data?.total ?? entries.length
  // A Load more read is pending (its count has no data yet). A refresh of the count on screen is not: it keeps
  // the button enabled, so keyboard focus on it survives a live refresh, and the count isn't announced again.
  const loadingMore = listing.isFetching && client.getQueryData(listingKey) === undefined
  const announce = active.error ? S.folderFailed : !active.data ? '' : searching ? S.results(entries.length)
    : count === LIST_LIMIT || entries.length >= total ? S.items(total) : loadingMore ? '' : S.showingOf(entries.length, total)

  const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10, Home: -Infinity, End: Infinity }
  const navKey = (entry: Entry, event: KeyboardEvent) => {
    if ((event.altKey && event.key === 'ArrowUp') || event.key === 'Backspace') {
      event.preventDefault()
      if (!b.path) return
      requestFocus(b.focusNext, parentPath(b.path), b.path)
      return b.navigate(parentPath(b.path))
    }
    if (!(event.key in step) || event.altKey) return
    event.preventDefault()
    const at = entries.indexOf(entry)
    const next = Math.max(0, Math.min(entries.length - 1, at + step[event.key]))
    if (event.shiftKey && b.mode === 'pick' && Math.abs(step[event.key]) === 1) {
      for (const e of new Set([entry, entries[next]])) if (!b.selected.has(e.abs)) b.toggle(e)
    }
    const row = list.current?.querySelectorAll<HTMLElement>('[role=option]')[next]
    row?.focus()
    row?.scrollIntoView?.({ block: 'nearest' })
  }

  const open = (entry: Entry) => {
    if (onOpenFile && isOpenable(entry)) return onOpenFile(entry)
    if (!entry.is_dir || entry.link_outside) return
    b.navigate(entry.rel)
  }

  const startDrag = (entry: Entry, event: DragEvent) => {
    if (!dragOut?.(event, [connectionId, profile])) return
    const picked = b.selected.has(entry.abs) ? selectedEntries(entries, b.selected) : [entry].filter(e => !e.link_outside)
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/x-hermes-paths', JSON.stringify(picked.map(e => ({ isDirectory: e.is_dir, path: e.abs }))))
    // The host's HTML5Backend requires a native type to let dragstart proceed.
    event.dataTransfer.setData('text/plain', picked.map(e => e.abs).join('\n'))
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
    body = <EmptyState description={stopped ? truncationNote : undefined} title={stopped ? S.noResultsYet : searching ? S.noResults : b.mode === 'pick' ? S.emptyFolderPick : S.emptyFolder} />
  } else {
    body = (
      <>
        <div aria-label={searching ? S.searchResults : S.filesIn(baseName(b.path) || b.root?.label || '')} aria-multiselectable="true" role="listbox">
          {entries.map(entry => (
            <EntryRow b={b} entry={entry} key={entry.abs} onDragStart={dragOut && !entry.link_outside ? event => startDrag(entry, event) : undefined} onFocus={() => setLastFocused(entry.abs)} onNavKey={navKey} onOpen={open} searching={searching} tabStop={entry.abs === tabStop} />
          ))}
        </div>
        {searching ? truncated && <div style={{ ...muted, fontSize: 11, padding: '8px 12px' }}>{truncationNote}</div> :
          (listing.data?.total ?? 0) > entries.length ? (
            <div style={{ ...muted, fontSize: 11, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{S.showingOf(entries.length, listing.data!.total)}</span>
              <Button disabled={loadingMore} onClick={() => setRange({ folder, count: count + LIST_LIMIT })} size="sm" variant="text">{S.loadMore}</Button>
            </div>
          ) : truncated && <div style={{ ...muted, fontSize: 11, padding: '8px 12px' }}>{S.firstOnly(entries.length)}</div>}
      </>
    )
  }

  // A plain scroller, not ScrollArea: Radix's viewport lays children out as a table, which defeats the
  // rows' text-overflow ellipsis on long names.
  return (
    <div data-hcfm-list="" ref={list} style={{ overflowY: 'auto', overflowX: 'hidden', ...(height ? { height } : { flex: 1, minHeight: 0 }) }} tabIndex={-1}>
      {body}
      <div aria-live="polite" style={hidden}>{announce}</div>
    </div>
  )
}

function EntryRow({ b, entry, onOpen, searching, tabStop, onFocus, onNavKey, onDragStart }: {
  b: Browser
  entry: Entry
  onOpen: (entry: Entry) => void
  searching: boolean
  tabStop: boolean
  onFocus: () => void
  onNavKey: (entry: Entry, event: KeyboardEvent) => void
  onDragStart?: (event: DragEvent) => void
}) {
  const [hover, setHover] = useState(false)
  const focus = useRowFocus()
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
      draggable={onDragStart ? true : undefined}
      onClick={click}
      onDoubleClick={() => onOpen(entry)}
      onDragStart={onDragStart}
      onKeyDown={event => {
        // Only keys aimed at the row itself: Space on the nested checkbox is the checkbox's own toggle.
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter') {
          if (entry.is_dir && !entry.link_outside) requestFocus(b.focusNext, entry.rel)
          onOpen(entry)
        }
        if (event.key === ' ') {
          event.preventDefault()
          b.toggle(entry)
        }
        onNavKey(entry, event)
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...focus.handlers}
      onFocus={() => (focus.handlers.onFocus(), onFocus())}
      role="option"
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
        background: checked ? 'var(--ui-row-active-background)' : hover || focus.focused ? 'var(--ui-row-hover-background)' : undefined,
        ...focus.ring
      }}
      tabIndex={tabStop ? 0 : -1}
    >
      {/* An option holds no focusable control: the row's aria-selected carries the state; the box is mouse-only. */}
      <span aria-hidden onClick={event => event.stopPropagation()} onMouseDown={event => event.preventDefault()} style={{ display: 'inline-flex' }}>
        {/* The kit's unchecked border token can match the page background; give it a visible stroke. */}
        <Checkbox
          aria-label={entry.name}
          checked={checked}
          onCheckedChange={() => b.toggle(entry)}
          tabIndex={-1}
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

// The Google Drive browser shared by the Cloud Files page and the "+ → Google Drive" picker: breadcrumbs
// (folder names kept client-side), debounced search, and the item list. Files multi-select across folders;
// folders open on click and cannot be selected (imports are one file each).
import { Button, Checkbox, Codicon, EmptyState, Skeleton, useQuery } from '@hermes/plugin-sdk'
import { type CSSProperties, type ReactNode, useState, useSyncExternalStore } from 'react'

import { call, query } from './api'
import { DEBOUNCE_MS, LoadError, useDebounced, useScope } from './browser'
import { type DriveImport, driveIcon, type DriveItem, type DriveListResponse, type ImportFailure, type ImportSnapshot } from './drive'
import { humanSize, shortDate } from './format'
import { S } from './strings'

const muted: CSSProperties = { color: 'var(--ui-text-tertiary)' }
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

interface Crumb {
  id: string
  name: string
}

export function useDriveBrowser() {
  const [trail, setTrail] = useState<readonly Crumb[]>([{ id: 'root', name: S.drive }])
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), DEBOUNCE_MS)
  const [selected, setSelected] = useState<ReadonlyMap<string, DriveItem>>(new Map())
  const q = search.trim() ? debounced : ''
  const goTo = (next: readonly Crumb[]) => {
    setTrail(next)
    setSearch('')
  }
  return {
    trail,
    folder: trail[trail.length - 1].id,
    search,
    q,
    selected,
    setSearch,
    /** A folder opened from search results has no known path: it hangs directly off the Drive root. */
    open: (item: DriveItem) => goTo(q ? [trail[0], item] : [...trail, item]),
    crumb: (index: number) => goTo(trail.slice(0, index + 1)),
    toggle: (item: DriveItem) =>
      setSelected(prev => {
        const next = new Map(prev)
        if (!next.delete(item.id)) next.set(item.id, item)
        return next
      }),
    clear: () => setSelected(new Map())
  }
}

export type DriveBrowser = ReturnType<typeof useDriveBrowser>

export function DriveCrumbs({ d }: { d: DriveBrowser }) {
  return (
    <nav aria-label={S.breadcrumbs} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1, fontSize: 12, ...ellipsis }}>
      {d.trail.map((crumb, i) => (
        <span key={`${i}:${crumb.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          {i > 0 && <Codicon name="chevron-right" size="0.75rem" style={muted} />}
          {i === d.trail.length - 1 && !d.q ? (
            <span style={{ ...ellipsis, color: 'var(--ui-text-primary)', fontWeight: 500 }}>{crumb.name}</span>
          ) : (
            <Button onClick={() => d.crumb(i)} size="inline" variant="text">
              {crumb.name}
            </Button>
          )}
        </span>
      ))}
    </nav>
  )
}

export function DriveList({ d, height }: { d: DriveBrowser; height?: number }) {
  const [connectionId, profile] = useScope()
  const list = useQuery({
    queryKey: ['hcfm', connectionId, profile, 'drive', d.folder, d.q],
    queryFn: () => call<DriveListResponse>(query('/drive/list', d.q ? { folder: d.folder, q: d.q } : { folder: d.folder })),
    retry: 1
  })
  const items = list.data?.items ?? []

  let body: ReactNode
  if (list.error) {
    body = <LoadError error={list.error} onRetry={() => void list.refetch()} />
  } else if (!list.data) {
    body = (
      <div aria-busy="true" style={{ display: 'grid', gap: 6, padding: '8px 12px' }}>
        {[0, 1, 2, 3, 4].map(i => (
          <Skeleton key={i} style={{ height: 18, opacity: 1 - i * 0.15 }} />
        ))}
      </div>
    )
  } else if (!items.length) {
    body = <EmptyState title={d.q ? S.noResults : S.driveEmpty} />
  } else {
    body = (
      <div role="list">
        {items.map(item => (
          <DriveRow d={d} item={item} key={item.id} />
        ))}
        {list.data.truncated && <div style={{ ...muted, fontSize: 11, padding: '8px 12px' }}>{S.truncated(items.length)}</div>}
      </div>
    )
  }
  return <div style={{ overflowY: 'auto', overflowX: 'hidden', ...(height ? { height } : { flex: 1, minHeight: 0 }) }}>{body}</div>
}

function DriveRow({ d, item }: { d: DriveBrowser; item: DriveItem }) {
  const [hover, setHover] = useState(false)
  const checked = d.selected.has(item.id)
  const activate = () => (item.is_folder ? d.open(item) : d.toggle(item))
  return (
    <div
      aria-selected={checked}
      data-entry={item.id}
      onClick={activate}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        activate()
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
        background: checked ? 'var(--ui-row-active-background)' : hover ? 'var(--ui-row-hover-background)' : undefined
      }}
      tabIndex={0}
    >
      <span onClick={event => event.stopPropagation()} style={{ display: 'inline-flex' }}>
        {!item.is_folder && (
          <Checkbox
            aria-label={item.name}
            checked={checked}
            onCheckedChange={() => d.toggle(item)}
            style={checked ? undefined : { borderColor: 'var(--ui-stroke-secondary)' }}
          />
        )}
      </span>
      <Codicon name={driveIcon(item)} size="0.875rem" style={{ color: item.is_folder ? 'var(--ui-accent)' : 'var(--ui-text-secondary)' }} />
      <span style={{ ...ellipsis, color: 'var(--ui-text-primary)' }}>{item.name}</span>
      <span style={{ ...muted, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {item.is_folder ? '' : item.size == null ? '—' : humanSize(item.size)}
      </span>
      <span style={{ ...muted, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {item.mtime ? shortDate(Date.parse(item.mtime) / 1000) : ''}
      </span>
    </div>
  )
}

const noop = () => () => undefined
const none = () => null

export function useImport(job: null | DriveImport): null | ImportSnapshot {
  return useSyncExternalStore(job?.subscribe ?? noop, job?.getSnapshot ?? none, job?.getSnapshot ?? none)
}

/** One line for an import: paused on another agent, "Importing 2 of 5…", or "Imported N files". */
export function importStatus(snap: ImportSnapshot): string {
  if (snap.canceled && !snap.running) return S.importCanceled(snap.imported.length)
  if (snap.paused) return S.importPaused(snap.pin.profile)
  if (snap.running) return S.importing(Math.min(snap.total, snap.settled + 1), snap.total)
  return S.imported(snap.imported.length)
}

export function ImportFailures({ failures }: { failures: readonly ImportFailure[] }) {
  if (!failures.length) return null
  return (
    <div style={{ display: 'grid', gap: 2, maxHeight: 120, overflowY: 'auto', fontSize: 11, color: 'var(--ui-red)' }}>
      {failures.map((failure, i) => (
        <div key={i} style={ellipsis}>
          {S.importFailed(failure.name, failure.error)}
        </div>
      ))}
    </div>
  )
}

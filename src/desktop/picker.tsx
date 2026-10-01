// "+ → Cloud": an attachment provider that opens a picker, and the single host that renders it.
// Every chat tile mounts its own composer (and so its own underside slot); one mounted host claims the
// dialog and the rest render nothing.
import {
  atom,
  Button,
  type ComposerAttachmentProvider,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  host,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef } from 'react'

import { Breadcrumbs, BrowserSearch, EntryList, LoadError, RootSelect, useBrowser, useRoots } from './browser'
import { formatInsertText } from './format'
import { S } from './strings'
import type { RootsResponse } from './api'

export const $pickerOpen = atom(false)
/** `insertText` of the composer whose "+" menu opened the picker. */
export const $insertText = atom<null | ((text: string) => void)>(null)
/** The host instance that renders the dialog (null when none is mounted). */
export const $hostClaim = atom<null | object>(null)
const NO_OWNER = atom<null | { connectionId: null | string; profile: string }>(null)

export const cloudProvider: ComposerAttachmentProvider = {
  label: S.providerLabel,
  icon: 'cloud',
  run(ctx) {
    $insertText.set(ctx.insertText)
    $pickerOpen.set(true)
  }
}

/** True when the focused chat belongs to a different agent than the one Cloud Files talks to. */
export function ownerMismatch(owner: null | { connectionId: null | string; profile: string }, connectionId: null | string, profile: string) {
  if (!owner) return false
  // Nullable connection ids compare directly: a local-owned chat (null) is not a remote agent ("conn-B").
  // An empty string means "no connection" in the owner fallback, the same as null.
  const id = (value: null | string) => String(value ?? '').trim() || null
  return (owner.profile || 'default') !== (profile || 'default') || id(owner.connectionId) !== id(connectionId)
}

export function PickerHost() {
  const me = useRef({}).current
  const claim = useValue($hostClaim)
  const open = useValue($pickerOpen)

  useEffect(() => {
    const tryClaim = () => {
      if ($hostClaim.get() === null) $hostClaim.set(me)
    }
    tryClaim()
    const stop = $hostClaim.subscribe(tryClaim)
    return () => {
      stop()
      if ($hostClaim.get() === me) $hostClaim.set(null)
    }
  }, [me])

  // Render nothing when closed or not the claimed host, so the underside strip stays empty.
  if (claim !== me || !open) return null
  return <PickerDialog />
}

function close() {
  $pickerOpen.set(false)
  $insertText.set(null)
}

function PickerDialog() {
  const profile = useValue(host.state.profile)
  const connectionId = useValue(host.state.connectionId)
  const owner = useValue(host.state.focusedSessionOwner ?? NO_OWNER)
  const mismatch = ownerMismatch(owner, connectionId, profile)

  return (
    <Dialog onOpenChange={(next: boolean) => !next && close()} open>
      <DialogContent style={{ maxWidth: 720, width: '92vw' }}>
        <DialogHeader>
          <DialogTitle>{S.pickerTitle}</DialogTitle>
        </DialogHeader>
        {mismatch ? (
          <p style={{ fontSize: 13, color: 'var(--ui-text-secondary)', lineHeight: 1.5 }}>{S.ownerMismatch(owner!.profile, profile)}</p>
        ) : (
          <PickerBody key={`${connectionId ?? 'local'}::${profile}`} profile={profile} />
        )}
        {mismatch && (
          <DialogFooter>
            <Button onClick={close} variant="text">
              {S.cancel}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PickerBody({ profile }: { profile: string }) {
  const roots = useRoots()
  if (roots.error) return <LoadError error={roots.error} onRetry={() => void roots.refetch()} />
  if (roots.data && (roots.data.supported === false || !roots.data.roots?.length)) {
    return <EmptyState description={roots.data.reason} title={S.unsupportedTitle} />
  }
  if (!roots.data) return <div aria-busy="true" style={{ height: 360 }} />
  return <PickerBrowser profile={profile} roots={roots.data} />
}

function PickerBrowser({ profile, roots }: { profile: string; roots: RootsResponse }) {
  const b = useBrowser(roots, 'pick')
  const insert = () => {
    const text = formatInsertText(profile, [...b.selected.values()])
    $insertText.get()?.(text)
    close()
  }
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--ui-stroke-tertiary)', paddingBottom: 6 }}>
        <Breadcrumbs b={b} />
        <BrowserSearch b={b} />
        <RootSelect b={b} />
      </div>
      <EntryList b={b} height={360} />
      <DialogFooter style={{ alignItems: 'center' }}>
        <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--ui-text-tertiary)' }}>{S.selected(b.selected.size)}</span>
        <Button onClick={close} variant="text">
          {S.cancel}
        </Button>
        <Button disabled={!b.selected.size} onClick={insert}>
          {S.insert}
        </Button>
      </DialogFooter>
    </div>
  )
}

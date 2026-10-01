// "+ → Cloud" and "+ → Google Drive": attachment providers that open a picker, and the single host that renders it.
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
import { DriveImport, type ImportHold } from './drive'
import { DriveCrumbs, DriveList, ImportFailures, importStatus, useDriveBrowser, useImport } from './drive-browser'
import { formatInsertText } from './format'
import { currentPin } from './page'
import { S } from './strings'
import type { AgentPin } from './upload'
import { rest, type RootsResponse } from './api'

export const $pickerOpen = atom(false)
/** `insertText` of the composer whose "+" menu opened the picker. */
export const $insertText = atom<null | ((text: string) => void)>(null)
/** The host instance that renders the dialog (null when none is mounted). */
export const $hostClaim = atom<null | object>(null)
/** Which source the open picker browses. */
export const $pickerSource = atom<'cloud' | 'drive'>('cloud')
/** The "+ → Google Drive" import in progress; outlives the dialog body, which remounts on an agent switch. */
const $pickerJob = atom<null | DriveImport>(null)
const NO_OWNER = atom<null | { connectionId: null | string; profile: string }>(null)
/** Imported locations waiting until their agent is selected and owns the focused chat again. */
const $pendingInsert = atom<null | { profile: string }>(null)
let stopPending: () => void = () => undefined

const focusedOwner = () => (host.state.focusedSessionOwner ?? NO_OWNER).get()

/** True when `pin`'s agent is selected and the focused chat (if any) belongs to it. */
function pinReady(pin: AgentPin): boolean {
  const { connectionId, profile } = host.state
  return profile.get() === pin.profile && connectionId.get() === pin.connectionId && !ownerMismatch(focusedOwner(), pin.connectionId, pin.profile)
}

/** Insert once, and only into a draft of `pin`'s agent: if the composer moved to another agent meanwhile, the
 *  dialog says to switch back and the text goes in when it does. */
function insertWhenReady(pin: AgentPin, text: string, insertText: null | ((text: string) => void), closeAfter: boolean) {
  const attempt = () => {
    if (!pinReady(pin)) return
    clearPending()
    insertText?.(text)
    if (closeAfter) closePicker()
  }
  const { connectionId, profile } = host.state
  const stops = [connectionId.subscribe(attempt), profile.subscribe(attempt), (host.state.focusedSessionOwner ?? NO_OWNER).subscribe(attempt)]
  stopPending = () => stops.forEach(stop => stop())
  $pendingInsert.set({ profile: pin.profile })
  attempt()
}

function clearPending() {
  stopPending()
  stopPending = () => undefined
  $pendingInsert.set(null)
}

/** The picker's import also waits while the focused chat belongs to another agent than the one it imports for. */
const ownerHold = (pin: AgentPin): ImportHold => ({
  held: () => ownerMismatch(focusedOwner(), pin.connectionId, pin.profile),
  subscribe: wake => (host.state.focusedSessionOwner ?? NO_OWNER).subscribe(wake)
})

function openPicker(insertText: (text: string) => void, source: 'cloud' | 'drive') {
  stopImport()
  $insertText.set(insertText)
  $pickerSource.set(source)
  $pickerOpen.set(true)
}

export const cloudProvider: ComposerAttachmentProvider = {
  label: S.providerLabel,
  icon: 'cloud',
  run(ctx) {
    openPicker(ctx.insertText, 'cloud')
  }
}

export const driveProvider: ComposerAttachmentProvider = {
  label: S.drive,
  icon: 'cloud-download',
  run(ctx) {
    openPicker(ctx.insertText, 'drive')
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

/** No further import requests; files already imported stay where they are. */
function stopImport() {
  $pickerJob.get()?.cancel()
  $pickerJob.set(null)
  clearPending()
}

export function closePicker() {
  stopImport()
  $pickerOpen.set(false)
  $insertText.set(null)
}

function PickerDialog() {
  const profile = useValue(host.state.profile)
  const connectionId = useValue(host.state.connectionId)
  const owner = useValue(host.state.focusedSessionOwner ?? NO_OWNER)
  const mismatch = ownerMismatch(owner, connectionId, profile)
  const source = useValue($pickerSource)
  const pending = useValue($pendingInsert)
  const notice = pending ? S.insertPaused(pending.profile) : mismatch ? S.ownerMismatch(owner!.profile, profile) : null

  return (
    <Dialog onOpenChange={(next: boolean) => !next && closePicker()} open>
      <DialogContent style={{ maxWidth: 720, width: '92vw' }}>
        <DialogHeader>
          <DialogTitle>{source === 'drive' ? S.drivePickerTitle : S.pickerTitle}</DialogTitle>
        </DialogHeader>
        {notice ? (
          <p style={{ fontSize: 13, color: 'var(--ui-text-secondary)', lineHeight: 1.5 }}>{notice}</p>
        ) : (
          <PickerBody key={`${connectionId ?? 'local'}::${profile}`} profile={profile} source={source} />
        )}
        {notice && (
          <DialogFooter>
            <Button onClick={closePicker} variant="text">
              {S.cancel}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PickerBody({ profile, source }: { profile: string; source: 'cloud' | 'drive' }) {
  const roots = useRoots()
  if (roots.error) return <LoadError error={roots.error} onRetry={() => void roots.refetch()} />
  if (roots.data && (roots.data.supported === false || !roots.data.roots?.length)) {
    return <EmptyState description={roots.data.reason} title={S.unsupportedTitle} />
  }
  if (!roots.data) return <div aria-busy="true" style={{ height: 360 }} />
  if (source === 'drive') return <DrivePicker roots={roots.data} />
  return <PickerBrowser profile={profile} roots={roots.data} />
}

function PickerBrowser({ profile, roots }: { profile: string; roots: RootsResponse }) {
  const b = useBrowser(roots, 'pick')
  const insert = () => {
    const text = formatInsertText(profile, [...b.selected.values()])
    $insertText.get()?.(text)
    closePicker()
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
        <Button onClick={closePicker} variant="text">
          {S.cancel}
        </Button>
        <Button disabled={!b.selected.size} onClick={insert}>
          {S.insert}
        </Button>
      </DialogFooter>
    </div>
  )
}

/** Pick Drive files, import them one at a time into <first root>/uploads/drive, then insert the locations of
 *  the files that made it. Any failure keeps the dialog open with the list; none succeeded → nothing inserted. */
function DrivePicker({ roots }: { roots: RootsResponse }) {
  const d = useDriveBrowser()
  const snap = useImport(useValue($pickerJob))
  const start = () => {
    const insertText = $insertText.get()
    const pin = currentPin()
    const job = new DriveImport([...d.selected.values()], roots.roots[0].id, pin, { rest, state: host.state, hold: ownerHold(pin) })
    $pickerJob.set(job)
    void job.start().then(done => {
      if (done.canceled || $pickerJob.get() !== job || !done.imported.length) return
      insertWhenReady(pin, formatInsertText(pin.profile, done.imported), insertText, !done.failures.length)
    })
  }
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--ui-stroke-tertiary)', paddingBottom: 6 }}>
        <DriveCrumbs d={d} />
        <BrowserSearch b={d} label={S.searchDrive} />
      </div>
      <DriveList d={d} height={360} />
      {snap && <ImportFailures failures={snap.failures} />}
      <DialogFooter style={{ alignItems: 'center' }}>
        <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--ui-text-tertiary)' }}>{snap ? importStatus(snap) : S.selected(d.selected.size)}</span>
        {snap && !snap.running ? (
          <Button onClick={closePicker}>{S.close}</Button>
        ) : (
          <>
            <Button onClick={closePicker} variant="text">
              {S.cancel}
            </Button>
            <Button disabled={!d.selected.size} loading={Boolean(snap)} onClick={start}>
              {S.importAndInsert}
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  )
}

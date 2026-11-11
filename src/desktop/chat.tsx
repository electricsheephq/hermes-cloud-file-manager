// The page's accessible twin of drag: composer references, guarded against the live selected agent and chat.
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, host } from '@hermes/plugin-sdk'

import { type Entry } from './api'
import { formatRef } from './format'
import { ownerMismatch } from './picker'
import { S } from './strings'
import { type AgentPin } from './upload'

export function canReference([connectionId, profile]: [string, string], warning = S.addOtherAgent): boolean {
  const pin = { connectionId: host.state.connectionId.get(), profile: host.state.profile.get() }
  const owner = host.state.focusedSessionOwner?.get() ?? null
  if ((pin.connectionId ?? 'local') === connectionId && pin.profile === profile && !ownerMismatch(owner, pin.connectionId, pin.profile)) return true
  host.notify({ kind: 'warning', message: warning(owner?.profile ?? pin.profile, profile) })
  return false
}

type RefEntry = Pick<Entry, 'abs' | 'is_dir' | 'link_outside'>
type ChatProps = { entries: () => readonly RefEntry[]; pin: AgentPin; disabled?: boolean; sessionId?: null | string }

export function buildRefs(entries: readonly RefEntry[]): { refs: string[]; skipped: number } {
  let skipped = 0
  const refs = entries.filter(e => !e.link_outside).flatMap(entry => {
    const value = formatRef(entry.abs)
    if (value === null) { skipped++; return [] }
    return [`@${entry.is_dir ? 'folder' : 'file'}:${value}`]
  })
  return { refs, skipped }
}

export function AddToChat({ entries, pin, disabled, sessionId = null }: ChatProps) {
  const composer = (host as any).composer
  if (typeof composer?.insertText !== 'function') return null
  const add = async () => {
    if (!canReference([pin.connectionId ?? 'local', pin.profile])) return
    const { refs, skipped } = buildRefs(entries())
    if (skipped) host.notify({ kind: 'warning', message: S.refSkipped(skipped) })
    if (!refs.length) return
    const ok = await Promise.resolve().then(() => composer.insertText(sessionId, refs.join(' '), { mode: 'inline' })).catch(() => false)
    host.notify(ok ? { kind: 'success', message: S.addedToChat(refs.length) } : { kind: 'info', message: S.openChatFirst })
  }
  return <Button disabled={disabled} onClick={() => void add()} size="sm" variant="ghost">{S.addToChat}</Button>
}

/** `selectionSize` is how many rows are selected, outside links included: Rename needs exactly one, and `entries`
 *  has already dropped outside links. */
export function AskAgent({ entries, pin, disabled, sessionId = null, selectionSize }: ChatProps & { selectionSize?: () => number }) {
  const composer = (host as any).composer
  if (typeof composer?.insertText !== 'function') return null
  const canRename = () => (selectionSize ? selectionSize() : entries().length) === 1 && entries().length === 1 && !entries()[0].link_outside
  const draft = async (text: (refs: string) => string) => {
    if (text === S.askRenameText && !canRename()) return
    if (!canReference([pin.connectionId ?? 'local', pin.profile])) return
    const { refs, skipped } = buildRefs(entries())
    if (skipped) host.notify({ kind: 'warning', message: S.refSkipped(skipped) })
    if (!refs.length) return
    const ok = await Promise.resolve().then(() => composer.insertText(sessionId, text(refs.join(' ')), { mode: 'inline' })).catch(() => false)
    host.notify(ok ? { kind: 'success', message: S.askDrafted } : { kind: 'info', message: S.openChatFirst })
  }
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button disabled={disabled} size="sm" variant="ghost">{S.askAgent}</Button></DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem disabled={!canRename()} onSelect={() => void draft(S.askRenameText)}>{S.askRename}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void draft(S.askMoveText)}>{S.askMove}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void draft(S.askDeleteText)}>{S.askDelete}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

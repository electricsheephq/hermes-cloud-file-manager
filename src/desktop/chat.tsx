// The page's accessible twin of drag: composer references, guarded against the live selected agent and chat.
import { Button, host } from '@hermes/plugin-sdk'

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

export function AddToChat({ entries, pin, disabled }: { entries: () => readonly Pick<Entry, 'abs' | 'is_dir' | 'link_outside'>[]; pin: AgentPin; disabled?: boolean }) {
  const composer = (host as any).composer
  if (typeof composer?.insertText !== 'function') return null
  const add = async () => {
    if (!canReference([pin.connectionId ?? 'local', pin.profile])) return
    let skipped = 0
    const refs = entries().filter(e => !e.link_outside).flatMap(entry => {
      const value = formatRef(entry.abs)
      if (value === null) { skipped++; return [] }
      return [`@${entry.is_dir ? 'folder' : 'file'}:${value}`]
    })
    if (skipped) host.notify({ kind: 'warning', message: S.refSkipped(skipped) })
    if (!refs.length) return
    const ok = await Promise.resolve().then(() => composer.insertText(null, refs.join(' '), { mode: 'inline' })).catch(() => false)
    host.notify(ok ? { kind: 'success', message: S.addedToChat(refs.length) } : { kind: 'info', message: S.openChatFirst })
  }
  return <Button disabled={disabled} onClick={() => void add()} size="sm" variant="ghost">{S.addToChat}</Button>
}

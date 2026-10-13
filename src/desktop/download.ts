// Download through the host's own authenticated save bridge. `captureGatewayFileDownload` is missing from older
// SDKs (0.21.5), and a named import of a missing export stops the whole plugin loading, so this is the only place
// that touches it, through a namespace import: there a missing member is just undefined and Download stays hidden.
import * as sdk from '@hermes/plugin-sdk'
import { host } from '@hermes/plugin-sdk'

/** Saves `path` on the agent's machine to this computer; the host shows its own Saved / failed toast. */
export type SaveFile = (path: string, suggestedName: string) => Promise<void>

export function captureDownload(): SaveFile | null {
  const capture = (sdk as unknown as Record<string, unknown>).captureGatewayFileDownload
  return typeof capture === 'function' ? (capture as () => SaveFile)() : null
}

/** Capture with a read for `scope`'s agent: the host reads the selected agent now, so a different one gets none. */
export function captureFor([connectionId, profile]: readonly [string, string]): SaveFile | null {
  const here = (host.state.connectionId.get() ?? 'local') === connectionId && host.state.profile.get() === profile
  return here ? captureDownload() : null
}

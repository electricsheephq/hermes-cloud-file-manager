// Wire contract: every error code the gateway can answer has plain text on the Desktop side.
import { CODE_TEXT, FILE_CODE_TEXT } from '../strings'

/** Codes `_protocol` answers itself (OSError mapping) or that this release adds on the gateway; listed explicitly
 *  so the test holds even before the gateway half of the release lands in this tree. */
const PROTOCOL_CODES = ['io_error', 'permission_denied', 'no_space', 'read_only', 'no_roots']

/** Codes the Desktop handles with its own UI rather than a text, with the reason. */
const HANDLED = new Map([
  ['conflict', 'the editor opens its conflict dialog (Compare / Copy my text / Discard mine and reload)'],
  ['changed', 'FILE_CODE_TEXT has open and save wordings'],
  ['gone', 'uploads restart once and the editor opens its moved-or-deleted dialog'],
  ['unsupported_backend', '/roots answers it in-band and the page shows its "can\'t browse" state']
])

async function gatewayCodes(): Promise<string[]> {
  // node:fs through a dynamic specifier: the test tsconfig carries no Node types.
  const fs = await import('node:fs' as string)
  const source: string = fs.readFileSync('dashboard/plugin_api.py', 'utf8') // vitest runs from the repo root
  const raised = [...source.matchAll(/GuardError\(\s*"([a-z_]+)"/g)].map(match => match[1])
  const returned = [...source.matchAll(/"code":\s*"([a-z_]+)"/g)].map(match => match[1])
  return [...new Set([...raised, ...returned, ...PROTOCOL_CODES])].sort()
}

describe('gateway error codes', () => {
  it('finds the gateway codes (positive control)', async () => {
    const codes = await gatewayCodes()
    expect(codes.length).toBeGreaterThan(30)
    for (const known of ['bad_path', 'not_editable', 'chunk_too_large', 'offset', 'no_free_name', 'io_error', 'conflict']) {
      expect(codes).toContain(known)
    }
  })

  it('every code has plain text, or is handled by its own UI', async () => {
    const missing = (await gatewayCodes()).filter(code => !CODE_TEXT[code] && !FILE_CODE_TEXT[code] && !HANDLED.has(code))
    expect(missing).toEqual([])
  })

  it('the new codes read as plain sentences', () => {
    expect(CODE_TEXT.permission_denied).toBe("The agent's user isn't allowed to open or change this.")
    expect(CODE_TEXT.no_space).toBe("The agent's machine is out of disk space.")
    expect(CODE_TEXT.read_only).toBe('This location is read-only.')
    expect(CODE_TEXT.io_error).toBe("Something went wrong reading or writing on the agent's machine.")
  })
})

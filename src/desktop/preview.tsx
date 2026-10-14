// The read-only viewer on the Cloud Files page: images, PDFs, and code and data files, read through
// GET /file/preview. It never edits or saves: Close, Copy path and Download only. Plain DOM elements, so no SDK
// export newer than 0.21.5 is needed; a PDF uses the renderer's own viewer in a plain iframe (not SandboxedFrame).
import { Button, Codicon, host, Skeleton, useValue } from '@hermes/plugin-sdk'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'

import { ApiError, call, isNotFoundError, query } from './api'
import { captureFor } from './download'
import { copy, type Doc, isCurrent, nextId, type SetDoc } from './editor'
import { humanSize, parseDelimited, type PreviewKind } from './format'
import { fileCodeText, S } from './strings'
import { transportText } from './upload'

interface PreviewResponse {
  ok: boolean
  kind: PreviewKind
  /** text */
  text?: string
  truncated?: boolean
  /** image or pdf: the whole file, base64 */
  mime?: string
  data?: string
  size: number
}

const MAX_ROWS = 1000
const MAX_COLUMNS = 50
const BIG_TIMEOUT_MS = 60_000
const mono = 'var(--font-mono, ui-monospace, monospace)'
const muted: CSSProperties = { color: 'var(--ui-text-tertiary)' }
const cell: CSSProperties = { padding: '2px 8px', border: '1px solid var(--ui-stroke-tertiary)', textAlign: 'left', verticalAlign: 'top', whiteSpace: 'pre-wrap' }

function previewText(error: unknown, profile: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'too_large') return S.previewTooLarge(typeof error.body?.size === 'number' ? humanSize(error.body.size) : undefined)
    if (error.code === 'not_text') return S.previewNotText
    return fileCodeText(error.code, error.body?.message, error.body?.max_bytes)
  }
  // A gateway half before 0.4.1 has no /file/preview route.
  return isNotFoundError(error) ? S.previewNeedsUpdate(profile) : transportText(error)
}

function toBlob(data: string, mime: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Read `doc`'s preview into a fresh generation of it; the answer lands only if that generation is still open.
 *  Download is captured with the read, and kept on a refusal (the file may still be saved, just not shown). */
function load(doc: Doc, setDoc: SetDoc) {
  // Checked live, not from the render: the agent can change between the render and this effect, and ctx.rest goes
  // to whichever agent is selected now. The effect runs again once the doc's agent is back.
  if (!isCurrent(doc.pin)) return
  const id = nextId()
  setDoc({ ...doc, id, status: 'loading', error: undefined, save: null })
  const save = captureFor([doc.pin.connectionId ?? 'local', doc.pin.profile])
  const big = doc.preview?.kind !== 'text'
  call<PreviewResponse>(query('/file/preview', { root: doc.root, path: doc.path }), big ? { timeoutMs: BIG_TIMEOUT_MS } : undefined).then(
    res => {
      const preview =
        res.kind === 'text'
          ? { kind: res.kind, text: res.text ?? '', truncated: Boolean(res.truncated), size: res.size }
          : { kind: res.kind, blob: toBlob(res.data ?? '', res.mime ?? ''), size: res.size }
      setDoc(d => (d?.id === id ? { ...d, status: 'ready', save, preview } : d))
    },
    error => setDoc(d => (d?.id === id ? { ...d, status: 'error', error: previewText(error, doc.pin.profile), save } : d))
  )
}

const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

export function Preview({ doc, setDoc, onClose }: { doc: Doc; setDoc: SetDoc; onClose: () => void }) {
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const here = doc.pin.connectionId === connectionId && doc.pin.profile === profile
  // ctx.rest targets the selected agent: read only while it is this file's (id 0: not read yet). The agent is read
  // live, and every change of it tries again, so a switch away and back within one render can't leave it unread.
  useEffect(() => {
    if (doc.id !== 0) return
    let done = false
    const attempt = () => {
      if (done || !isCurrent(doc.pin)) return
      done = true
      load(doc, setDoc)
    }
    attempt()
    const stops = [host.state.connectionId.listen(attempt), host.state.profile.listen(attempt)]
    return () => stops.forEach(stop => stop())
  }, [doc.id, doc.pin.connectionId, doc.pin.profile, doc.root, doc.path])

  // One object URL per loaded file, revoked when the file changes, closes or the page goes.
  const blob = doc.preview?.blob
  const [object, setObject] = useState<null | { blob: Blob; url: string }>(null)
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setObject({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  const url = blob && object?.blob === blob ? object.url : null

  const ext = extension(doc.name)
  const separator = ext === 'csv' ? ',' : ext === 'tsv' ? '\t' : null
  const [textOf, setTextOf] = useState(-1) // the load shown as text instead of a table
  const text = doc.preview?.text
  // A header row, then at most MAX_ROWS rows.
  const table = useMemo(() => (separator && text !== undefined ? parseDelimited(text, separator, MAX_ROWS + 1) : null), [separator, text])
  const asTable = Boolean(table?.rows.length) && textOf !== doc.id

  let body
  if (doc.status === 'loading') {
    body =
      doc.id === 0 && !here ? null : (
        <div aria-busy="true" aria-label={S.loadingFile} style={{ display: 'grid', gap: 6, padding: '12px 20px' }}>
          {[0, 1, 2].map(i => (
            <Skeleton key={i} style={{ height: 16 }} />
          ))}
        </div>
      )
  } else if (doc.status === 'error') {
    body = <p style={{ ...muted, fontSize: 13, padding: '12px 20px' }}>{doc.error}</p>
  } else if (doc.preview?.kind === 'image') {
    body = (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px 20px' }}>
        {url && <img alt={doc.name} src={url} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
      </div>
    )
  } else if (doc.preview?.kind === 'pdf') {
    body = (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: '0 20px 20px' }}>
        {url && <iframe src={url} style={{ flex: 1, border: 0 }} title={doc.name} />}
      </div>
    )
  } else {
    const rows = table?.rows ?? []
    const width = Math.max(0, ...rows.map(row => row.length))
    const rowsCut = Boolean(table?.more)
    const [head, ...rest] = rows
    const columns = (row: string[]) => row.slice(0, MAX_COLUMNS)
    body = (
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 20px 20px', fontSize: 12 }}>
        {doc.preview?.truncated && <div style={{ ...muted, marginBottom: 6 }}>{S.previewTruncated(humanSize(doc.preview.size ?? 0))}</div>}
        {asTable && (rowsCut || width > MAX_COLUMNS) && (
          <div style={{ ...muted, marginBottom: 6 }}>{S.tableCut(rowsCut ? MAX_ROWS : null, width > MAX_COLUMNS ? MAX_COLUMNS : null)}</div>
        )}
        {asTable ? (
          <table style={{ borderCollapse: 'collapse', fontFamily: mono, fontSize: 12 }}>
            <thead>
              <tr>{columns(head).map((value, i) => <th key={i} style={{ ...cell, fontWeight: 600 }}>{value}</th>)}</tr>
            </thead>
            <tbody>
              {rest.map((row, r) => (
                <tr key={r}>{columns(row).map((value, i) => <td key={i} style={cell}>{value}</td>)}</tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: mono }}>{text}</pre>
        )}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', fontSize: 12 }}>
        <Button onClick={onClose} size="sm" variant="ghost">
          <Codicon name="arrow-left" size="0.875rem" />
          {S.close}
        </Button>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{doc.name}</span>
          <span style={muted}>{doc.pin.profile}</span>
          <span style={{ ...muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.abs}</span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {doc.status === 'ready' && table?.rows.length ? (
            <Button onClick={() => setTextOf(asTable ? doc.id : -1)} size="sm" variant="ghost">
              {asTable ? S.showAsText : S.showAsTable}
            </Button>
          ) : null}
          <Button onClick={() => copy(doc.abs, S.copied(1))} size="sm" variant="ghost">
            {S.copyPath}
          </Button>
          {doc.status !== 'loading' && doc.save && (
            <Button onClick={() => void doc.save?.(doc.abs, doc.name)} size="sm" variant="ghost">
              {S.download}
            </Button>
          )}
        </span>
      </div>
      {!here && (
        <div role="status" style={{ margin: '0 20px 8px', padding: '6px 10px', borderRadius: 6, fontSize: 12, background: 'color-mix(in srgb, var(--ui-yellow, #d4a72c) 14%, transparent)', color: 'var(--ui-text-primary, currentColor)' }}>
          {S.otherAgentPreview(doc.pin.profile)}
        </div>
      )}
      {body}
    </div>
  )
}

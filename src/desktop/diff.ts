// A small line diff for the editor's Changes panel and Review dialog: Myers over lines, then hunks with
// context. Local code on purpose: the bundle may import only the SDK and React.

/** Above this many lines on either side, the diff is skipped ("Too large to show changes"). */
export const MAX_DIFF_LINES = 20_000
/** Edit-distance budget for Myers. Past it the changed middle is shown as one remove + one add block:
 *  still a correct diff, just not a minimal one, and memory stays bounded. */
const MAX_EDITS = 2000

export type DiffRow =
  | { kind: 'same' | 'add' | 'del'; text: string; old?: number; new?: number }
  | { kind: 'skip'; count: number }

export interface LineDiff {
  tooLarge: boolean
  added: number
  removed: number
  rows: DiffRow[]
}

const linesOf = (text: string) => (text === '' ? [] : text.split('\n'))

/** Myers' edit script for a → b, or null past MAX_EDITS. `trace[d]` is V before round d, for the backtrack. */
function myers(a: string[], b: string[]): Array<'same' | 'add' | 'del'> | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m, d, offset)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], n: number, m: number, depth: number, offset: number) {
  const ops: Array<'same' | 'add' | 'del'> = []
  let x = n
  let y = m
  for (let d = depth; d > 0; d--) {
    const v = trace[d]
    const k = x - y
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
    const prevK = down ? k + 1 : k - 1
    const prevX = v[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('same')
      x--
      y--
    }
    ops.push(down ? 'add' : 'del')
    if (down) y--
    else x--
  }
  while (x > 0 && y > 0) {
    ops.push('same')
    x--
    y--
  }
  return ops.reverse()
}

/** Line diff of `before` → `after` with `context` unchanged lines around each change; longer unchanged
 *  runs collapse into a `skip` row. Identical input gives no rows. */
export function lineDiff(before: string, after: string, context = 3): LineDiff {
  const a = linesOf(before)
  const b = linesOf(after)
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return { tooLarge: true, added: 0, removed: 0, rows: [] }
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const middle = myers(midA, midB) ?? [...midA.map(() => 'del' as const), ...midB.map(() => 'add' as const)]
  const ops = [...Array(head).fill('same'), ...middle, ...Array(tail).fill('same')] as Array<'same' | 'add' | 'del'>

  const full: Array<Extract<DiffRow, { text: string }>> = []
  let i = 0
  let j = 0
  for (const op of ops) {
    if (op === 'same') full.push({ kind: 'same', text: a[i], old: ++i, new: ++j })
    else if (op === 'del') full.push({ kind: 'del', text: a[i], old: ++i })
    else full.push({ kind: 'add', text: b[j], new: ++j })
  }
  const added = full.filter(row => row.kind === 'add').length
  const removed = full.filter(row => row.kind === 'del').length
  if (!added && !removed) return { tooLarge: false, added, removed, rows: [] }

  // Collapse unchanged runs: keep `context` lines next to a change, fold the rest.
  const rows: DiffRow[] = []
  for (let start = 0; start < full.length; ) {
    if (full[start].kind !== 'same') {
      rows.push(full[start++])
      continue
    }
    let end = start
    while (end < full.length && full[end].kind === 'same') end++
    const keepBefore = start === 0 ? 0 : context
    const keepAfter = end === full.length ? 0 : context
    if (end - start > keepBefore + keepAfter) {
      rows.push(...full.slice(start, start + keepBefore), { kind: 'skip', count: end - start - keepBefore - keepAfter }, ...full.slice(end - keepAfter, end))
    } else {
      rows.push(...full.slice(start, end))
    }
    start = end
  }
  return { tooLarge: false, added, removed, rows }
}

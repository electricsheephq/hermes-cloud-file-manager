import { lineDiff, MAX_DIFF_LINES } from '../diff'

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n')
const shape = (text: string, other: string) => lineDiff(text, other).rows.map(row => (row.kind === 'skip' ? `~${row.count}` : `${row.kind}:${row.text}`))

describe('lineDiff', () => {
  it('reports an insert with old/new line numbers', () => {
    const diff = lineDiff('a\nb\nc', 'a\nb\nx\nc')
    expect(diff).toMatchObject({ tooLarge: false, added: 1, removed: 0 })
    expect(diff.rows).toEqual([
      { kind: 'same', text: 'a', old: 1, new: 1 },
      { kind: 'same', text: 'b', old: 2, new: 2 },
      { kind: 'add', text: 'x', new: 3 },
      { kind: 'same', text: 'c', old: 3, new: 4 }
    ])
  })

  it('reports a delete', () => {
    const diff = lineDiff('a\nb\nc', 'a\nc')
    expect(diff).toMatchObject({ added: 0, removed: 1 })
    expect(shape('a\nb\nc', 'a\nc')).toEqual(['same:a', 'del:b', 'same:c'])
    expect(diff.rows[1]).toEqual({ kind: 'del', text: 'b', old: 2 })
  })

  it('reports a replace as a removed and an added line', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toMatchObject({ added: 1, removed: 1 })
    expect(shape('a\nb\nc', 'a\nB\nc')).toEqual(['same:a', 'del:b', 'add:B', 'same:c'])
  })

  it('keeps 3 lines of context and folds longer unchanged runs', () => {
    const before = lines(20)
    const after = before.replace('line 10\n', 'line ten\n')
    expect(shape(before, after)).toEqual([
      '~6',
      'same:line 7',
      'same:line 8',
      'same:line 9',
      'del:line 10',
      'add:line ten',
      'same:line 11',
      'same:line 12',
      'same:line 13',
      '~7'
    ])
    // Two changes 4 lines apart share their context; 8 apart get a fold between them.
    const near = before.replace('line 3\n', 'x\n').replace('line 8\n', 'y\n')
    expect(shape(before, near).filter(row => row.startsWith('~'))).toEqual(['~9'])
    const far = before.replace('line 2\n', 'x\n').replace('line 12\n', 'y\n')
    expect(shape(before, far).filter(row => row.startsWith('~'))).toEqual(['~3', '~5'])
  })

  it('gives no rows for identical input', () => {
    expect(lineDiff('a\nb\n', 'a\nb\n')).toEqual({ tooLarge: false, added: 0, removed: 0, rows: [] })
    expect(lineDiff('', '')).toEqual({ tooLarge: false, added: 0, removed: 0, rows: [] })
  })

  it('skips the diff above the line limit on either side', () => {
    const big = lines(MAX_DIFF_LINES + 1)
    expect(lineDiff(big, 'a')).toEqual({ tooLarge: true, added: 0, removed: 0, rows: [] })
    expect(lineDiff('a', big).tooLarge).toBe(true)
    expect(lineDiff(lines(MAX_DIFF_LINES), lines(MAX_DIFF_LINES)).tooLarge).toBe(false)
  })

  it('stays correct past the edit budget (a full rewrite of a long file)', () => {
    const before = lines(3000, 'old')
    const after = lines(3000, 'new')
    const diff = lineDiff(before, after)
    expect(diff).toMatchObject({ tooLarge: false, added: 3000, removed: 3000 })
  })
})

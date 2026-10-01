import { entryIcon, formatInsertText, formatLocation, humanSize, joinPath } from '../format'

const TICK = '`'

describe('insert text', () => {
  it('starts with a header naming the profile and lists one location per line', () => {
    const text = formatInsertText('research-bot', [
      { abs: '/home/agent/docs/a.pdf', is_dir: false },
      { abs: '/home/agent/uploads', is_dir: true }
    ])
    expect(text).toBe(
      `\nCloud files on research-bot's machine:\n- ${TICK}/home/agent/docs/a.pdf${TICK}\n- ${TICK}/home/agent/uploads/${TICK}`
    )
  })

  it('does not double a trailing slash on folders', () => {
    expect(formatLocation({ abs: '/srv/', is_dir: true })).toBe(`- ${TICK}/srv/${TICK}`)
  })

  it('wraps a path containing a backtick in double backticks with spaces', () => {
    expect(formatLocation({ abs: `/x/we${TICK}ird.txt`, is_dir: false })).toBe(`- ${TICK}${TICK} /x/we${TICK}ird.txt ${TICK}${TICK}`)
  })
})

describe('helpers', () => {
  it('formats sizes, joins POSIX paths, and picks icons', () => {
    expect(humanSize(512)).toBe('512 B')
    expect(humanSize(1536)).toBe('1.5 KB')
    expect(humanSize(210 * 1024 * 1024)).toBe('210 MB')
    expect(joinPath('', 'uploads/2026', '/a.jpg')).toBe('uploads/2026/a.jpg')
    expect(entryIcon({ name: 'x.JPG', is_dir: false })).toBe('file-media')
    expect(entryIcon({ name: 'x', is_dir: true })).toBe('folder')
    expect(entryIcon({ name: 'x', is_dir: true, link_outside: true })).toBe('link')
    expect(entryIcon({ name: 'notes.md', is_dir: false })).toBe('file')
  })
})

import { entryIcon, formatInsertText, formatLocation, humanSize, joinPath, shortDate } from '../format'

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

  it('says "the agent\'s machine" when the profile is empty or literally "default" (E5)', () => {
    expect(formatInsertText('default', [{ abs: '/a', is_dir: false }])).toBe(`\nCloud files on the agent's machine:\n- ${TICK}/a${TICK}`)
    expect(formatInsertText('', [{ abs: '/a', is_dir: false }]).split('\n')[1]).toBe("Cloud files on the agent's machine:")
  })

  it('does not double a trailing slash on folders', () => {
    expect(formatLocation({ abs: '/srv/', is_dir: true })).toBe(`- ${TICK}/srv/${TICK}`)
  })

  it('fences a path containing a backtick with a longer backtick run', () => {
    expect(formatLocation({ abs: `/x/we${TICK}ird.txt`, is_dir: false })).toBe(`- ${TICK}${TICK}/x/we${TICK}ird.txt${TICK}${TICK}`)
  })

  it('uses a fence longer than the longest backtick run, padding when the path starts or ends with one (bot 4152168374)', () => {
    const two = TICK + TICK
    const three = two + TICK
    expect(formatLocation({ abs: `/x/a${two}b`, is_dir: false })).toBe(`- ${three}/x/a${two}b${three}`)
    expect(formatLocation({ abs: `${TICK}odd`, is_dir: false })).toBe(`- ${two} ${TICK}odd ${two}`)
    expect(formatLocation({ abs: `/d/x${two}`, is_dir: true })).toBe(`- ${three}/d/x${two}/${three}`)
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

describe('shortDate', () => {
  it('U2: pads today\'s hour to two digits so times line up with the rest of the app', () => {
    const now = new Date(2026, 0, 15, 16, 27)
    const early = new Date(2026, 0, 15, 1, 15)
    expect(shortDate(early.getTime() / 1000, now).startsWith('01')).toBe(true)
    expect(shortDate(early.getTime() / 1000, now)).toContain('15')
  })
})

import { collectDropEntries, type DropEntry, filesFromInput, walkEntries } from '../walk'

const fileEntry = (name: string): DropEntry => ({
  name,
  isFile: true,
  isDirectory: false,
  file: success => success(new File(['x'], name))
})

/** A directory whose reader hands out `batches` one per readEntries call, then [] forever. */
const dirEntry = (name: string, batches: DropEntry[][]): DropEntry & { reads: number } => {
  const dir = {
    name,
    isFile: false,
    isDirectory: true,
    reads: 0,
    createReader: () => {
      let i = 0
      return {
        readEntries: (success: (entries: DropEntry[]) => void) => {
          dir.reads += 1
          success(batches[i++] ?? [])
        }
      }
    }
  }
  return dir
}

describe('folder walk', () => {
  it('reads every batch until an empty one and keeps relative paths', async () => {
    const inner = dirEntry('inner', [[fileEntry('c.txt')]])
    const top = dirEntry('photos', [[fileEntry('a.jpg'), inner], [fileEntry('b.jpg')]])
    const out = await walkEntries([top, fileEntry('loose.txt')])
    expect(out.files.map(f => f.rel)).toEqual(['photos/a.jpg', 'photos/inner/c.txt', 'photos/b.jpg', 'loose.txt'])
    expect(top.reads).toBe(3) // two batches, then the empty one that ends the loop
    expect((out.files[0].file as File).name).toBe('a.jpg')
  })

  it('reports empty directories so they can be created', async () => {
    const out = await walkEntries([dirEntry('root', [[dirEntry('empty', []), dirEntry('full', [[fileEntry('x')]])]])])
    expect(out.dirs).toEqual(['root/empty'])
    expect(out.files.map(f => f.rel)).toEqual(['root/full/x'])
  })

  it('uses webkitRelativePath from a folder input, else the file name', () => {
    const nested = new File(['1'], 'a.jpg')
    Object.defineProperty(nested, 'webkitRelativePath', { value: 'trip/day 1/a.jpg' })
    const plain = new File(['2'], 'b.txt')
    expect(filesFromInput([nested, plain]).files.map(f => f.rel)).toEqual(['trip/day 1/a.jpg', 'b.txt'])
  })

  it('collects drop entries synchronously, falling back to plain files', () => {
    const entry = fileEntry('a.txt')
    const withEntries = { items: [{ kind: 'file', webkitGetAsEntry: () => entry }, { kind: 'string' }], files: [] } as unknown as DataTransfer
    expect(collectDropEntries(withEntries)).toEqual({ entries: [entry], files: [] })
    const file = new File(['x'], 'b.txt')
    const plain = { items: [], files: [file] } as unknown as DataTransfer
    expect(collectDropEntries(plain)).toEqual({ entries: [], files: [file] })
  })
})

// Turn a drop or a file input into `{file, rel}` pairs plus empty directories, keeping folder structure.
import { joinPath } from './format'
import type { UploadInput } from './upload'

/** The slice of the File and Directory Entries API the walk uses. */
export interface DropEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  file?(success: (file: File) => void, failure?: (error: unknown) => void): void
  createReader?(): { readEntries(success: (entries: DropEntry[]) => void, failure?: (error: unknown) => void): void }
}

/** Entries from a drop event. MUST run synchronously inside the `drop` handler: the DataTransfer item list
 *  is emptied as soon as the handler returns. Falls back to plain files when entries are unavailable. */
export function collectDropEntries(transfer: DataTransfer): { entries: DropEntry[]; files: File[] } {
  const entries: DropEntry[] = []
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry?.() as DropEntry | null | undefined
    if (entry) entries.push(entry)
  }
  return { entries, files: entries.length ? [] : Array.from(transfer.files ?? []) }
}

const readBatch = (reader: ReturnType<NonNullable<DropEntry['createReader']>>) =>
  new Promise<DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))

const fileOf = (entry: DropEntry) => new Promise<File>((resolve, reject) => entry.file!(resolve, reject))

/** Walk dropped entries. `readEntries` returns batches, so each directory is read until an empty batch. */
export async function walkEntries(entries: DropEntry[]): Promise<UploadInput> {
  const out: Required<UploadInput> = { files: [], dirs: [] }
  const visit = async (entry: DropEntry, prefix: string): Promise<void> => {
    const rel = joinPath(prefix, entry.name)
    if (entry.isFile && entry.file) {
      out.files.push({ file: await fileOf(entry), rel })
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader()
      let children = 0
      for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
        children += batch.length
        for (const child of batch) await visit(child, rel)
      }
      if (!children) out.dirs.push(rel)
    }
  }
  for (const entry of entries) await visit(entry, '')
  return out
}

/** Files from `<input type=file>`; with `webkitdirectory` each carries its path under the picked folder. */
export function filesFromInput(list: ArrayLike<File>): UploadInput {
  return {
    files: Array.from(list).map(file => ({
      file,
      rel: joinPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
    })),
    dirs: []
  }
}

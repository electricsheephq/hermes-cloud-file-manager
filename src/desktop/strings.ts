// Every user-facing English string, in one place for later i18n.

/** "<profile>'s machine", or "the agent's machine" when the profile is empty or literally "default". */
export const machineOf = (profile: string) => (profile && profile !== 'default' ? `${profile}'s machine` : "the agent's machine")

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`

export const S = {
  title: 'Cloud Files',
  navLabel: 'Cloud Files',
  providerLabel: 'Cloud',
  notSetUp: (agent: string) =>
    `Cloud Files isn't set up on ${agent} yet. Install the plugin on the agent's gateway, add it to \`plugins.enabled\`, and restart the gateway.`,
  unsupportedTitle: "Cloud Files can't browse this agent's machine",
  needsUpdateTitle: 'Cloud Files needs an update on this agent',
  needsUpdateBody:
    "The agent's machine has an older version of the Cloud File Manager plugin, or it isn't enabled. Update or enable it there, then restart Hermes on that machine.",
  loadFailed: "Couldn't load files",
  retry: 'Retry',
  root: 'Folder',
  search: 'Search files',
  searchIn: (folder: string) => `Search in ${folder}`,
  newFolder: 'New folder',
  uploadFiles: 'Upload files',
  uploadFolder: 'Upload folder',
  copyPath: 'Copy path',
  maxPerFile: (bytes: number) => `Up to ${mb(bytes)} per file`,
  emptyFolder: 'This folder is empty — drop files here or use Upload',
  noResults: 'No matching files',
  truncated: (n: number) => n === 1 ? 'Showing the first item' : `Showing the first ${n} items`,
  showingOf: (n: number, total: number) => `Showing ${n.toLocaleString()} of ${total.toLocaleString()} items`,
  loadMore: 'Load more',
  firstOnly: (n: number) => `Showing the first ${n.toLocaleString()} items. Search finds the rest.`,
  searchMore: (n: number) => `Showing the first ${n === 1 ? 'match' : `${n} matches`}. Type more to narrow the search.`,
  searchStopped: (visited: number) =>
    `Search stopped ${visited ? `after checking ${visited.toLocaleString()} items` : 'early'}, so some matches may be missing. Open a folder to search inside it.`,
  noResultsYet: 'No matches found so far',
  dropTo: (folder: string) => `Drop to upload to ${folder}`,
  copied: (n: number) => (n === 1 ? 'Path copied' : `${n} paths copied`),
  copyFailed: "Couldn't copy to the clipboard",
  breadcrumbs: 'Folder path',
  uploads: 'Uploads',
  expand: 'Show uploads',
  collapse: 'Hide uploads',
  // New folder dialog
  folderName: 'Folder name',
  create: 'Create',
  cancel: 'Cancel',
  nameRequired: 'Enter a name',
  nameNoSlash: 'A folder name cannot contain /',
  folderCreated: (name: string) => `Created ${name}`,
  // Upload drawer
  uploading: (n: number, total: number, sent: string, size: string) => `Uploading ${n} of ${total} · ${sent} of ${size}`,
  uploaded: (done: number, total: number, failed: number) =>
    `Uploaded ${done} of ${total}${failed ? ` · ${failed} failed` : ''}`,
  canceled: 'Upload canceled',
  paused: (profile: string) => `Switch back to ${profile} to continue uploading`,
  busyElsewhere: 'Finish or cancel the current uploads first',
  queued: 'Queued',
  done: 'Done',
  savedAs: (name: string) => `Saved as "${name}"`,
  failed: (reason: string) => `Failed: ${reason}`,
  canceledItem: 'Canceled',
  clear: 'Clear',
  tooLarge: (max: number) => `Too large (max ${mb(max)})`,
  // Picker
  pickerTitle: 'Attach from Cloud Files',
  selected: (n: number) => `${n} selected`,
  insert: 'Insert locations',
  lineBreakSkipped: (n: number) => n === 1 ? 'A selected name has a line break, so it won’t be inserted.' : `${n} selected names have a line break, so they won’t be inserted.`,
  ownerMismatch: (owner: string, profile: string) =>
    `This chat belongs to ${owner}. Cloud Files is showing ${profile}'s files — switch to ${owner} in the sidebar first.`,
  insertHeader: (profile: string) => `Cloud files on ${machineOf(profile)}:`,
  // Google Drive
  drive: 'Google Drive',
  searchDrive: 'Search Google Drive',
  driveEmpty: 'This folder is empty',
  drivePickerTitle: 'Insert from Google Drive',
  importToCloud: 'Import to Cloud Files',
  importCount: (n: number) => `Import ${n} to Cloud Files`,
  importHint: (rootLabel: string) => `Imports go to ${rootLabel}/uploads/drive`,
  importing: (n: number, total: number) => `Importing ${n} of ${total}…`,
  imported: (n: number) => `Imported ${n} ${n === 1 ? 'file' : 'files'}`,
  importPaused: (profile: string) => `Switch back to ${profile} to finish importing`,
  importCanceled: (n: number) => `Import canceled after ${n} ${n === 1 ? 'file' : 'files'}`,
  importedTo: (profile: string) => `These files were imported to ${profile}'s uploads/drive.`,
  copyLocations: 'Copy locations',
  locationsCopied: 'Locations copied',
  chatChanged: "The chat changed while this was open, so the locations weren't inserted. Copy them instead.",
  importFailed: (name: string, reason: string) => `${name}: ${reason}`,
  importAndInsert: 'Import and insert',
  show: 'Show',
  close: 'Close',
  // Editor
  open: 'Open',
  edit: 'Edit',
  editing: 'Editing',
  unsaved: 'Unsaved changes',
  changes: 'Changes',
  reviewSave: 'Review & save',
  save: 'Save',
  backToEditing: 'Back to editing',
  saved: 'Saved',
  notSaved: (name: string, reason: string) => `${name} wasn't saved. ${reason}`,
  changedSince: (profile: string) => `It changed on ${machineOf(profile)} since you opened it.`,
  movedOrDeleted: (profile: string) => `It was moved or deleted on ${machineOf(profile)}.`,
  loadingFile: 'Opening…',
  noChanges: 'No changes',
  diffSummary: (added: number, removed: number) => `+${added} −${removed} lines`,
  unchangedLines: (n: number) => `⋯ ${n} unchanged ${n === 1 ? 'line' : 'lines'}`,
  diffTooLarge: 'Too large to show changes',
  mixedEndings: 'This file mixes line endings; saving converts them all to CRLF.',
  reviewTitle: (name: string) => `Save changes to ${name}?`,
  discardTitle: (name: string) => `Discard unsaved changes to ${name}?`,
  keepEditing: 'Keep editing',
  discard: 'Discard',
  conflictTitle: (name: string, profile: string) => `${name} changed on ${machineOf(profile)} since you opened it.`,
  compare: 'Compare with their version',
  copyMine: 'Copy my text',
  textCopied: 'Your text is on the clipboard',
  discardReload: 'Discard mine and reload',
  goneTitle: (name: string, profile: string) => `${name} was moved or deleted on ${machineOf(profile)}.`,
  otherAgent: (profile: string) => `This file is on ${profile}. Switch back to edit or save.`
}

/** Server error codes → short human text. */
export const CODE_TEXT: Record<string, string> = {
  exists_file: 'A file with that name already exists',
  bad_path: 'That name or path is not allowed',
  protected: 'That location is protected',
  outside_root: 'That location is outside the agent’s folders',
  too_large: 'The file is too large',
  bad_data: 'The upload data was corrupted',
  gone: 'The upload expired on the server',
  size_mismatch: 'The file size changed during upload',
  unsupported_backend: 'This agent’s storage is not supported',
  unknown_root: 'That folder is no longer available',
  not_a_dir: 'That is not a folder',
  is_link: 'That item is a link outside the agent’s folders',
  bad_query: 'That search is not valid',
  unavailable: "Google Drive isn't available for this agent right now.",
  bad_id: "That Google Drive item isn't valid.",
  is_folder: 'Choose files, not folders.',
  drive_error: "Google Drive couldn't finish that. Try again.",
  timeout: 'Google Drive took too long. Try again.'
}

/** /file and /file/save codes → plain sentences (the upload wording in CODE_TEXT doesn't fit an open file). */
const FILE_CODE_TEXT: Record<string, string> = {
  not_editable: 'Only .md, .markdown and .txt files can be opened here.',
  is_link: 'This file is a link, so it can’t be opened here.',
  not_a_file: 'This isn’t a regular file.',
  hard_link: 'This file has other hard links, so it can’t be opened here.',
  mount_point: 'This file is a mount point, so it can’t be opened here.',
  not_text: 'This file isn’t plain UTF-8 text.',
  changed: 'The file changed while it was being read. Try again.',
  outside_root: 'This file is outside the agent’s folders.',
  protected: 'This file is in a protected location.',
  not_found: 'This file no longer exists.',
  bad_path: 'That path isn’t allowed.'
}

/** Save refusals that would read wrong in the open wording. Nothing is written on any of them. */
const SAVE_CODE_TEXT: Record<string, string> = {
  changed: 'The file changed while saving, so nothing was written. Try again.',
  is_link: 'The file has become a link, so nothing was written.',
  not_a_file: 'The file is no longer a regular file, so nothing was written.',
  hard_link: 'The file now has other hard links, so nothing was written.',
  mount_point: 'The file is now a mount point, so nothing was written.',
  not_text: 'This text can’t be saved as UTF-8.'
}

export const fileCodeText = (code: string, message?: string, maxBytes?: number, saving = false) =>
  code === 'too_large'
    ? `Too large to ${saving ? 'save' : 'open'} here (over ${mb(maxBytes ?? 1024 * 1024)}).`
    : (saving && SAVE_CODE_TEXT[code]) || FILE_CODE_TEXT[code] || codeText(code, message)

export const codeText = (code: string | undefined, message?: string) =>
  (code && CODE_TEXT[code]) || message || code || 'Something went wrong'

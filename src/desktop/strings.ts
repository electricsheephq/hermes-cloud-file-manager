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
  newFolder: 'New folder',
  uploadFiles: 'Upload files',
  uploadFolder: 'Upload folder',
  copyPath: 'Copy path',
  maxPerFile: (bytes: number) => `Up to ${mb(bytes)} per file`,
  emptyFolder: 'This folder is empty — drop files here or use Upload',
  noResults: 'No matching files',
  truncated: (n: number) => `Showing the first ${n} items`,
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
  close: 'Close'
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

export const codeText = (code: string | undefined, message?: string) =>
  (code && CODE_TEXT[code]) || message || code || 'Something went wrong'

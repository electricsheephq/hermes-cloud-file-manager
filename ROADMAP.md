# Roadmap

Latest release: **v0.8.0** (2026-11-11), which is also the version in the Hermes plugin catalog. Everything planned
up to v0.8.0 has shipped; see [CHANGELOG.md](CHANGELOG.md).

**Status: frozen (2026-11-19).** No new features: only bug fixes, security fixes, Desktop CI, and work that keeps
file access inside the agent's folders. This holds until the owner revises it.

Progress counts only **Now** and **Next**. Items in **Later** are parked on purpose: each has a trigger that brings it
back.

## Now: maintenance

- Fix bugs that users report.
- Drag into chat: it checks the chat in focus, not the chat you drop onto (#55). This is blocked on Hermes core, which
  does not yet tell plugins which chat a drop lands in. The workaround is **Add to chat**, or focusing the target chat
  before dragging.

## Next

- Test dependencies: move jsdom to its current major version, as a separately tested change (#96, finding 9).
- Send the upstream reports collected while building the plugin to Hermes (#16).

## Later (parked, with triggers)

None of these starts while the plugin is frozen. Each stays parked until the freeze lifts and its trigger fires.

- **A Desktop command palette entry, "Open Cloud Files".** It was tried in v0.8.0 and dropped, because Hermes Desktop
  0.23.0 listed the row but did not run it. Trigger: the cause is understood.
- **Localization.** Trigger: a user needs a language other than English.
- **Download a folder as a zip.** Trigger: someone asks for it, or a support case needs it.
- **Built-in rename and move, never overwriting.** Since v0.8.0, **Ask agent…** drafts these requests for the agent.
  Trigger: an observed task where that falls short.
- **Trash with restore.** Trigger: an owner decision, because it changes the "never deletes your files" promise.

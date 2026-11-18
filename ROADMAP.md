# Roadmap

Latest release: **v0.8.0** (2026-11-11), which is also the version in the Hermes plugin catalog. Everything planned
up to v0.8.0 has shipped; see [CHANGELOG.md](CHANGELOG.md).

Progress counts only **Now** and **Next**. Items in **Later** are parked on purpose: each has a trigger that brings it
back.

## Now: maintenance

- Fix bugs that users report.
- Drag into chat: it checks the chat in focus, not the chat you drop onto (#55). This is blocked on Hermes core, which
  does not yet tell plugins which chat a drop lands in. The workaround is **Add to chat**, or focusing the target chat
  before dragging.

## Next

- Test dependencies: move jsdom to its current major version, as a separately tested change (#96, finding 9).
- A Desktop command palette entry, "Open Cloud Files". It was tried in v0.8.0 and dropped, because Hermes Desktop
  0.23.0 listed the row but did not run it. It comes back once the cause is understood.
- Send the upstream reports collected while building the plugin to Hermes (#16).

## Later (parked, with triggers)

From #66. Each stays parked until its trigger fires:

- **Localization.** Trigger: a user needs a language other than English.
- **Download a folder as a zip.** Trigger: someone asks for it, or a support case needs it.
- **Built-in rename and move, never overwriting.** Since v0.8.0, **Ask agent…** drafts these requests for the agent.
  Trigger: an observed task where that falls short.
- **Trash with restore.** Trigger: an owner decision, because it changes the "never deletes your files" promise.

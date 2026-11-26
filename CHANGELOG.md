# Changelog

All notable changes to this plugin. Versions follow the plugin's own numbering; the
DeepSeek Harness kernel version each release was built against is stated per entry,
because the kernel is in developer preview and its session format moves.

## 0.4.2 — kernel 0.2.2-rc.3

- Add `POST /dsh-turn-delete/import`: create a live session from an unpacked log.
  A log placed in the sessions directory by hand never reaches the Host's live
  store, so a sidebar that lists from that store cannot show it; creating through
  `ctx.sessions.create({ seed })` announces it like any other new chat.

## 0.4.1 — kernel 0.2.2-rc.3

- **Immediate deletion.** A finished turn can be removed on click by replacing its
  span with an empty `user/message` — the only surface carrier session format v4
  admits outside an open turn. The DeepSeek serializer drops empty user messages
  (`serialize.ts:123`), so it costs nothing in the request.
- Non-DeepSeek adapters keep the deferred `system/message` path, because they would
  send the empty user message through.

## 0.4.0 — kernel 0.2.2-rc.3

- **Redesigned the write path after a data-loss incident.** Writing the tombstone
  directly after `turn/end` (the 0.3.0 design) produces a log that fails v4 load
  admission: `system/message does not match an open turn and step`. Writes are not
  validated, loads are, so the session opened fine until the next start and then
  refused to load.
- Deletion is now two-phase: record an `ignorable` plugin record
  (`plugin:turn-delete/request`), then write the tombstone inside the next opened
  step with that step's numbers. A result record reports applied/refused.
- Added `tools/repair-log.mjs` to drop a trailing offending row and restore a
  session, with a timestamped backup and a contiguous-seq verification.
- Client fixes: a failure no longer disappears when the action row unmounts (results
  live in a module-level store), and a successful delete is actually visible (the row
  element is captured at click time, and the injected face carries `sessionId`).

## 0.3.0 — kernel 0.2.2-rc.3

- First working port of the original idea to the current kernel: tombstone as an
  empty `system/message` with `{ op: 'replace', startSeq, endSeq }`, system-prompt
  node excluded, `TURN_PROTECTED` for turns carrying the active prompt.
- Depended on `@deepseek-ai/dsh-client-ui-primitives`; replaced with a self-drawn
  button so an icon rename can never take the action row down.

## Design notes that do not change per release

- The append-only log is never rewritten; only surface replacements are appended.
- Surface node 0 (the system prompt) is never inside a replaced span.
- A turn that carries the newest system node is refused: removing it would strip the
  system prompt from every later request.

# dsh-turn-delete

[中文](README.md) · English

Delete **one finished turn** from a DeepSeek Harness session — from the model context only. The Session, its id, title, workspace link, later turns and the append-only event log all stay.

The case it exists for: you were talking about A, accidentally asked something about B, and that turn now rides along in every request — poisoning attention and burning tokens. This plugin makes that one turn invisible to the model, and to nothing else.

- Kernel: DeepSeek Harness `0.1.7`+ and all of `0.2.x` (verified on `0.2.2-rc.3`)
- Runtime: Web profile or a Web-based desktop shell, Node 22.19+
- License: MIT

## Features

- **Real removal, not a mask**: the turn leaves `session.deriveMessages()`, which is the only source of every request.
- **Immediate** on DeepSeek providers; other adapters fall back to "applies from your next message" automatically.
- **Log untouched**: deletion appends one surface-replacement event; the original prompt, answers and tool records stay auditable and replayable.
- **Never touches the system prompt** (surface node 0 stays outside every replaced span).
- **Refuses instead of corrupting**: open turns, compacted turns, and turns carrying the active system prompt are rejected with a reason.
- **Idempotent**, plus three recovery tools for damaged or missing sessions.

## Install

```sh
# local directory (development)
dsh plugin --profile desktop add -w link:/abs/path/dsh-turn-delete

# from GitHub
dsh plugin --profile desktop add github:YOUR_GITHUB_USER/dsh-turn-delete
```

Restart DSH (or the desktop app) after installing, or enable `dsh-turn-delete` in the plugin panel.

## Use

Hover the action row of a finished turn's last assistant reply → trash icon → Delete. The row hides immediately and is marked as removed from context; refresh and restart keep it that way.

| Adapter | Timing | Carrier |
|---|---|---|
| `deepseek-*` | immediately | empty `user/message` surface replacement |
| anything else | from the next message | empty `system/message` replacement inside the next open step |

Session format v4 only admits message events inside an open turn/step, so a system tombstone cannot be written right after a turn ends. An empty user message is legal there, and the DeepSeek serializer drops it (`serialize.ts:123`) — other adapters would send it, hence the fallback. Details: [docs/DESIGN.md](docs/DESIGN.md).

## Refusals

`TURN_NOT_CLOSED`, `TURN_COMPACTED` (already folded into a summary), `TURN_PROTECTED` (carries the active system prompt), `TARGET_NOT_FOUND`.

## Compatibility

Verified by replaying one real 1907-event / 19-turn log against each installed kernel: `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.1-rc.5`, `0.2.2-rc.3` all produce identical spans, identical derived-history deltas and identical tombstones, and stay idempotent. `0.1.5.x` is designed for but untested (those kernels reject v4 logs); `<= 0.1.0` is unsupported.

## Limits

- Finished top-level turns only; subagent sessions show no button.
- The visual hiding of a deleted turn relies on the `data-turn-tail` / `data-chat-flow-kind` DOM contract. The context deletion itself does not depend on it.
- Facts repeated in other turns still exist there — correctly.

## Docs

- [Design and kernel evidence](docs/DESIGN.md)
- [Test report](docs/TEST-REPORT.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)

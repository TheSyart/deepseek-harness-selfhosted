# Agent Note: Shuangwen Writing Mode — a shipped preset plus a one-click browser strip

Status: implemented

English | [中文](2026-08-14-shuangwen-writing-mode.zh.md)

## Problem

The Web GUI composes every session from coding-oriented agent presets (`standard`, `code`, `minimal`, `cordis`), so the persona, tool guidance, and runtime context every model request carries are all coding-agent prose. Writing power-fantasy web fiction (爽文) with that composition fights the system prompt on every turn — the model wants to confirm requirements, plan, and ask questions instead of just churning chapters. The user's ask is a 无脑 (no-think) mode: drop a one-line premise, then keep clicking "next chapter" with zero typing, zero questions, and zero loss of continuity.

## Decision

The mode is two pieces, each on the plane that owns it.

### The shipped preset `shuangwen` owns the model behavior

`apps/cli/config/agent-presets/shuangwen/` ships a new agent preset whose composition is a `persona` row with `complete: true` and `includeRuntimeContext: false`, plus one `tool-fs` row. The persona is the complete system prompt — no deployment identity, coding orientation, tool-guidance sections, or runtime snapshots survive — so the writer contract is the whole identity: 主角永不吃亏、爽点密集、反派嚣张不过一章、每章结尾留钩子、每章 1500–2500 字, and the 无脑 workflow (first message = the whole premise, "继续"/"下一章"/a lone punctuation mark = the next chapter, no clarifying questions, continuity and foreshadowing tracked by the model itself). `tool-fs` gives the writer a place to save chapters only when the reader asks to 存稿/导出; every other save-capability stays off the session, and no host-plane row moves — a host tool row would merge into every agent regardless of the preset that composed it ([capability seams](../architecture/2026-06-13-capability-seams.md)).

The preset's display metadata puts it at `order: 2` in the roster — directly after 标准模式 — with `code`/`minimal`/`cordis` shifted to 3/4/5, because the writing mode is a consumer-facing mode, not a developer option buried at the tail.

### The client plugin `ui-shuangwen` owns the one-click surface

`packages/client/ui-shuangwen` registers a `conversation.input.dock` entry (`id: shuangwen`, `order: -10`) with zero business face: every fact rides the framework hooks — the session's preset id from the sessions list's roster-recorded `agentPreset`, posture and busy state from the conversation snapshot, draft state from the input machine — and sending rides the public `inputActions` face ([slot system standard](../architecture/2026-07-22-slot-type-chain-implementation.md)). Two postures:

- **Blank session**: three story-starter chips stage a complete 开书 prompt into the draft WITHOUT submitting — the first message fixes the whole book, so it stays editable until the user sends it.
- **Started session**: three dial chips (下一章 / 加大爽度 / 来个小高潮) stage the instruction AND submit it, so the next chapter starts with one click.

The strip hides itself while the session is removed, a turn is running, the input is mid-submission, or the draft is non-empty — it never clobbers work in progress. Chip labels are bilingual under the `shuangwen` locale namespace; the staged message texts are Chinese prompt payloads owned by the component, not copy.

## Alternatives considered

- **A host-plane tool row or prompt section** — would leak the writing identity into every preset, the exact failure the preset plane exists to prevent.
- **Folding the strip into `ui-agent-preset`** — that package owns preset management surfaces; the writing quick-actions are a separate feature (one UI feature per plugin package).
- **Premise chips that auto-submit** — the first message fixes the whole book, so it must remain editable until the user presses Enter; only continue chips send immediately.

## Consequences

- The preset roster and its picker goldens change shape: `apps/web/tests/snapshots/agent-preset-selection/` and `apps/web/tests/snapshots/agent-preset-authoring/` were refreshed in the same change (menu, hero, and settings-section listings now include 爽文创作 between 标准模式 and PTC 模式).
- The browser plugin table is a boot-time scan ([client modules](../../../docs/subsystems/README.md)): `@deepseek-ai/dsh-client-modules` caches package metadata per name, so a running `dsh web` must restart to serve the new `dsh.client` row and its `lib/client.js` — a page refresh alone cannot discover a plugin added after boot.
- The strip serves exactly the shipped `shuangwen` id; a locally authored copy under another id gets no strip (recorded in the package README's known limitations).

## Verification

- `pnpm run test:gui` — package specs cover both postures, the visibility guards, locale parity, and the apply wiring (declaration-aware registration and teardown).
- `DSH_SNAPSHOT=replay pnpm run test:web` — the refreshed preset goldens plus the existing roster e2e scenarios.
- Manual: start a session on 爽文创作, confirm the premise chips on the blank session, send one premise, then click 下一章 and confirm the next chapter streams without typing.

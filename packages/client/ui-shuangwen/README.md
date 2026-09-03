# @deepseek-ai/dsh-client-ui-shuangwen

English | [中文](README.zh.md)

Shuangwen writing-mode plugin for the Web GUI: a browser-side quick-action strip that makes the `shuangwen` agent preset genuinely 无脑 (no-think). Its host half is empty on purpose — the writing experience is the preset's persona, and a host-plane tool row would merge into every agent regardless of the preset that composed it.

The strip mounts as a `conversation.input.dock` entry and renders only while the current session runs on the `shuangwen` preset (the id is read from the session list's roster-recorded `agentPreset`). Two postures:

- **Blank session** — the premise posture shows three story-starter chips (赘婿重生 / 废柴修仙 / 末日签到). A click stages a complete 开书 prompt into the draft without sending: the first message fixes the whole book, so it stays editable until the user hits Enter.
- **Started session** — the continue posture shows three dial chips (下一章 / 加大爽度 / 来个小高潮). A click stages the instruction AND submits it, so the next chapter starts with zero typing.

The strip hides itself while the session is removed, a turn is running, the input is mid-submission, or the draft is non-empty — it never clobbers work in progress. All data rides the framework hooks (the sessions list, the conversation snapshot, the input machine) and sending rides the public `inputActions` face; the plugin registers no business face of its own. Chip labels are bilingual under the `shuangwen` locale namespace; the staged message texts are Chinese prompt payloads owned by the component, not copy.

## Model Experience

Indirectly, through the `shuangwen` preset's persona (owned by `dsh-persona`): the staged messages this strip submits are ordinary user messages, logged like any other.

#### KV Cache effect

Staging a chip changes only the draft. Submitting it appends an ordinary user message to the conversation; the selected preset owns the system prompt, which the strip does not rewrite.

## Known Limitations and Deferred Work

- **Not enabled by the default Web composition** — this snapshot includes the preset and builds this plugin, but `dsh-web-app` does not install or mount it. A deployment must explicitly compose it before the strip appears; build and component tests do not prove that integration.
- **The preset id is hardcoded** — the strip serves exactly the shipped `shuangwen` preset; a locally authored copy under another id gets no strip.
- **The strip yields the floor while busy** — a running turn or a non-empty draft hides the chips, so a chapter must finish before the next one-click continue appears.
- **The starter set is static** — three fixed premises; a user can still type any 开书 prompt by hand.

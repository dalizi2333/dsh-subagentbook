# Stage checkpoints and continuation

Instance configuration now separates execution, final-report availability and stage checkpoints. Stage records are provisional. They are never task acceptance, successful test evidence, a workspace fingerprint or an immutable final report.

## What is saved

The public session/event feed saves at complete step/message/request/tool-result boundaries. A private sidecar holds the latest record per book instance: first task text, latest user/parent request, latest public assistant text, source sequence/time, composition revision and tool names/counts/call IDs. It excludes reasoning, tool arguments and tool result bodies. Task/latest-request text is bounded to 16,384 UTF-16 units each and public draft to 32,768; truncation is explicit and preserves surrogate pairs. Non-text media are not copied. The record does not contain the complete history or all past findings. Native event history remains a separate source.

Atomic rename replaces only the latest checkpoint; older/equal sequence writes cannot roll it back. Reads validate instance/parent, integrity, content hash and kind. Missing/damaged checkpoints remain unavailable. There is no automatic reconstruction from historical assistant messages, no arbitrary file reader, and no overwrite of final reports. Completed stream events can be saved; unfinished tokens and OS buffers on power loss have no zero-loss guarantee. An event position records what was observed, not a guarantee that the native persistence queue had already flushed it.

## Reading and exporting

A live direct parent can call `subagentbook_result` with `sessionId` and `kind: "checkpoint"`. Follow returned nextOffset until null, retaining sha256; if the checkpoint changes, the hash fence rejects mixing revisions and the parent must deliberately restart at offset 0. Original inherited permission checks apply to both one-shot and continuable children. Default kind remains `final` and still requires an intact one-shot report. A saved checkpoint never makes an interrupted final report readable.

The authenticated owner can use **导出阶段存档** in instance configuration. Its JSON has format `subagentbook-checkpoint-v1`, final:false, exact text/hash and source identity. No provider credentials, environment, Persona or raw tool evidence are exported by the wrapper; public task/draft text itself can of course contain whatever was already written in that session.

## Preparing a continuation

For a stopped task with a checkpoint, **准备接续** displays a task for review. **复制接续任务** copies it, then reports that no task has started. Use the native conversation breadcrumbs/sidebar to return to the named original parent/root, review and paste it there. This release does not control the host's private navigation controller or automatically fill/send another conversation.

The packet includes original role, exact provider/model, tools/delegates, budget/effort, effective file mode/workspace, depth/ceiling and composition identity, along with provisional stage text. It says to inspect current code and evidence, preserve work, check changed definitions and avoid replaying the whole task. It does not install old code, regrant permissions, reset depth, recompile from latest defaults, or create a child. Running tasks and completed tasks with readable final results cannot use this preparation endpoint. An interrupted one-shot may require a new explicit delegation; a continuable/root may resume through the native guarded path. A deleted/changed preset or executable fingerprint is not bypassed by a copied packet.

No real project instance was upgraded for these tests. Validate a future deployed build in a new instance, keeping historical immutable snapshots intact.

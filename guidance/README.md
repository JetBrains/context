# Structural guidance

Step-level guidance delivered by hooks at the moment of a tool call, instead of
static top-level instructions and skills. Inspired by TG-RAG (Expert Procedure
Graph + Interrupt-Retrieve-Generate), reduced to a single routing step.

For now only CLAUDE agent.

Each interrupt point has a set of nodes. For every node:

- `description.md` - when the node applies. Given to the classifier together
  with the session context and the pending tool call.
- `instruction.md` - guidance for the agent once the node is selected
  (how to use the chosen method). `instruction-mcp.md` is the same guidance
  for setups that expose jbcontext as the MCP `code_search` tool.
  `regular-search` has no instruction: the agent already knows its tools.
- `result-instruction.md` - optional guidance attached to the result of the
  node's tool call, for the agent to read right after it (how to use what came
  back). Only `context-explorer` has one.

This guidance replaces the how-to and when-to-use parts of the static Claude
instructions (`instructions/claude/`). Those now only say that the tool exists
and what it is good for. The shared `context-search` skill is left as is.

Router implementation (Claude Code hooks): `hooks/guidance/`.

## Interrupt points

| Point | Hook | Nodes |
|---|---|---|
| `search-call/` | `PreToolUse` on a search/exploration call | `regular-search`, `jbcontext-search`, `context-explorer` |

Multi-repo search is a future node. (Not planned during hackathon)

## Decision

Every routable call that starts an exploration episode goes to the
classifier; there is no rule-based shortcut. The classifier gets the session
context, the agent's recent reasoning and the pending call, and selects one
node: `regular-search`, `jbcontext-search` or `context-explorer`, with a
one-sentence reason. It judges the target, not the agent's choice of tool: a
search for a name, path, or literal the user gave or the session already
established is exact, so it selects `regular-search`.

- If the selected node is the one the pending call already uses, proceed and
  do not deny the tool call.
- Otherwise deny the pending call and give the selected node's guidance as the
  reason: for `jbcontext-search` its `instruction.md` / `instruction-mcp.md`,
  for `context-explorer` its `instruction.md`, for `regular-search` a short
  note to use Grep / Glob / Read on the exact name or path.
- The explorer can be reached both ways: a pending `context-explorer` spawn can
  be redirected to a search, and a pending search can be redirected to the
  explorer.
- At most one `context-explorer` run per task. Once it has run, it is no
  longer offered to the classifier.
- An allowed `context-explorer` spawn always runs in the foreground
  (`run_in_background` forced to false), and its `result-instruction.md` is
  attached to its result.
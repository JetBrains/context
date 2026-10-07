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

This guidance replaces the how-to and when-to-use parts of the static Claude
instructions (`instructions/claude/`). Those now only say that the tool exists
and what it is good for. The shared `context-search` skill is left as is.

## Interrupt points

| Point | Hook | Nodes |
|---|---|---|
| `search-call/` | `PreToolUse` on a search/exploration call | `regular-search`, `jbcontext-search` |

The `context-explorer` subagent node is TBD. Multi-repo search is a
future node. (Not planned during hackathon)

## Decision

- If the agent's pending call is a regular search and this node fits, proceed
  and do not deny the tool call.
- If unsure and the pending call is a regular search, also do not deny.
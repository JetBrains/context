# Structural guidance

Step-level guidance delivered by hooks at the moment of a tool call, instead of
static top-level instructions and skills. Inspired by TG-RAG (Expert Procedure
Graph + Interrupt-Retrieve-Generate), reduced to a single routing step.

Each interrupt point has a set of nodes. For every node:

- `description.md` - when the node applies. Given to the classifier together
  with the session context and the pending tool call.
- `instruction.md` - guidance for the agent once the node is selected
  (how to use the chosen method). Not written yet.

## Interrupt points

| Point | Hook | Nodes |
|---|---|---|
| `search-call/` | `PreToolUse` on a search/exploration call | `regular-search`, `jbcontext-search` |

The `context-explorer` subagent node is referenced only as a boundary for
`jbcontext-search`; it is not part of this iteration. Multi-repo search is a
future node.

## Decision

- If the agent's pending call is a regular search and this node fits, proceed
  and do not deny the tool call.
- If unsure and the pending call is a regular search, also do not deny.
# Tools

## Semantic Code Search (jbcontext)

You have access to `jbcontext search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### Usage

```bash
jbcontext search "<detailed and descriptive query>"
jbcontext search -p <path> "<query>"  # <path> must be relative to the project root
```

### How to use it
- Start with `jbcontext search` before planning, editing, or exact search in unfamiliar code when you do not yet know the right file, subsystem, implementation, or related test.
- Use one focused natural-language query per search.
- Do not start with grep, ripgrep, or find when the search problem is still semantic or exploratory.
- Inspect the first relevant file or directory before issuing another broad semantic search.
- Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local inspection.
- If you search again after finding a relevant area, narrow with `-p <path>`.

## Subagent: `context_explorer`

For broader or multi-step exploration, delegate to the `context_explorer` subagent
instead of searching inline. It is a read-only agent that runs several
`jbcontext search` queries in its own context, reads the promising files, and
returns concrete `file:line` references with inline code snippets and a
confidence note — so this thread stays uncluttered by intermediate search output
and does not have to re-read the same files.

Spawn `context_explorer` when a task matches any of these — treat this as the
explicit instruction to spawn it:
- The task describes behavior or intent ("where is X", "how does Y work") without
  naming an exact file or symbol, and answering it will likely take more than one
  search.
- You need to map an unfamiliar subsystem, or trace an execution path across
  several files, before making a change.
- You want to explore several angles at once — e.g. one `context_explorer` per
  subsystem or per open question — and collect the results together.

Skip the subagent and search inline (or grep) when the task already names an
exact file, class, or symbol, or when a single query is obviously enough.

Codex spawns subagents only when explicitly asked, so treat the criteria above as
that ask: when a task matches, spawn `context_explorer` as part of carrying it
out. The user can also request it directly at any time (for example, "use
`context_explorer` to map the auth flow").

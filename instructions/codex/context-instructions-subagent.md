# Tools

## Semantic Code Search (jbcontext)

You have access to `jbcontext search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### Usage

```bash
jbcontext search "<detailed and descriptive query>"
jbcontext search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "Where is a function that validates user email addresses" > "email"
- Include context: "Find error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

### How to use it

- Start with `jbcontext search` before planning, editing, or exact search in unfamiliar code when you do not yet know the right file, subsystem, implementation, or related test.
- Use one focused natural-language query per search.
- Do not start with grep, ripgrep, or find when the search problem is still semantic or exploratory.
- Once you get a relevant hit, switch to direct file reads - needing another search is a sign to delegate to `context_explorer` (with the results you already have) instead of searching again yourself.

## Subagent: `context_explorer`

For broader or multi-step exploration that a first `jbcontext search` did not
resolve, delegate to the `context_explorer` subagent instead of searching inline.
It is a read-only agent that runs several `jbcontext search` queries in its own
context, reads the promising files, and returns concrete `file:line` references
with inline code snippets and a confidence note - so this thread stays
uncluttered by intermediate search output and does not have to re-read the same
files.

### How to spawn it

- Spawn it with: `spawn_agent(agent_type="context_explorer", fork_turns="none", message="<intent, key file:line hits from your search, what is still unknown>")`
- `spawn_agent` runs in the background - you can read a file you already know is relevant, check the environment, but don't perform exploration while it's running.
- Always call `wait_agent` once that known work (if any) is done, otherwise you never get the report.


## When to use `jbcontext search` CLI vs. `context_explorer` subagent

Always run `jbcontext search` for the question first - even when you expect the
discovery to be multi-step (mapping an unfamiliar subsystem, or tracing across
several files). Often a single search is enough. Only if its results are
insufficient, spawn `context_explorer`, and include in its `message` the key
`file:line` hits the search already returned and what is still unknown, so it
does focused work on the gap instead of repeating your search. Never spawn
`context_explorer` for a question you have not yet run `jbcontext search` for.

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
- A search can take 10-20 seconds, so run it in the background (see below) instead of blocking on it.
- Use one focused natural-language query per search. Start one search per clearly different aspect or part of the task - several can run in parallel - but never paraphrases of the same query.
- While searches run, keep doing local work that does not depend on their results - read files you already know are relevant, check the environment, plan the change.
- Do not start with grep, ripgrep, or find when the search problem is still semantic or exploratory.
- Once you get a relevant hit, switch to direct file reads - needing another search for the same aspect is a sign to delegate to `context_explorer` instead of searching again yourself.

### Running searches in the background

- Start: `exec_command(cmd="jbcontext search \"<query>\"", yield_time_ms=500)` - it returns a session id while the search keeps running. If it already returned the search output, use it directly.
- Collect: `write_stdin(session_id=<id>, chars="", yield_time_ms=30000)` - it returns as soon as the search finishes, with its output. If it returns while the search is still running, call it again.
- You are not notified when a search finishes. Collect every started search this way before relying on its results, and never end your turn with an uncollected search.

## Subagent: `context_explorer`

For broader or multi-step exploration, delegate to the `context_explorer` subagent
instead of searching inline. It is a read-only agent that runs several
`jbcontext search` queries in its own context, reads the promising files, and
returns concrete `file:line` references with inline code snippets and a
confidence note - so this thread stays uncluttered by intermediate search output
and does not have to re-read the same files.

### How to spawn it

- Spawn it with: `spawn_agent(agent_type="context_explorer", fork_turns="none", message="<intent>")`
- `spawn_agent` runs in the background - you can read a file you already know is relevant, check the environment, but don't perform exploration while it's running.
- Always call `wait_agent` once that known work (if any) is done, otherwise you never get the report.
- Do not spawn `context_explorer` on a question while a `jbcontext search` for that question is still running - collect that search first and delegate only if its results are not enough.


## When to use `jbcontext search` CLI vs. `context_explorer` subagent

If you're confident the discovery is multi-step - mapping an unfamiliar
subsystem, or tracing across several files - spawn `context_explorer`
directly. Otherwise, run `jbcontext search` first; if the results are not enough, delegate to `context_explorer`.

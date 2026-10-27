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

Before searching, translate the research task into the one code responsibility you need to locate next. Describe that code in concise natural language rather than forwarding the whole assignment as the query.

- Describe the operation, its subject, and the constraints that distinguish it from nearby code. Preserve useful domain terms and exact identifiers supplied by the task or observed in code; avoid keyword bags and guessed names.
- If the task spans endpoints, persistence, configuration, callers, or tests, choose the responsibility needed first. Read the results and follow local references before searching for another responsibility that remains unresolved.
- Keep a related precondition, return value, or failure case when it describes the same operation. Do not split a coherent behavior merely because its description contains "and".
- Keep requests for explanations, output formatting, and a final report outside the search text.
- For a feature that does not exist yet, search for the existing mechanism to extend rather than assuming the desired implementation already exists.

Examples:

- Focused: "retrieving a user's learning progress for a particular course"
- Focused: "HTTP handlers receiving and storing uploaded IDE analytics"
- Focused: "moving downloaded distributions atomically with a fallback when atomic moves are unsupported"
- Too many responsibilities: "Where are course endpoints and how is user course learning progress recorded and returned?"
- Too many responsibilities: "Find the upload endpoints, data storage, configuration, and related tests"

Question phrasing is fine when it has one clear retrieval target; there is no fixed word limit.

### How to use it

- Start with `jbcontext search` before planning, editing, or exact search in unfamiliar code when you do not yet know the right file, subsystem, implementation, or related test.
- Use one focused natural-language query per search, targeting the code responsibility needed next rather than the whole investigation.
- Do not start with grep, ripgrep, or find when the search problem is still semantic or exploratory.
- Once you get a relevant hit, switch to direct file reads - needing another search is a sign to delegate to `context_explorer` instead of searching again yourself.

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


## When to use `jbcontext search` CLI vs. `context_explorer` subagent

If you're confident the discovery is multi-step - mapping an unfamiliar
subsystem, or tracing across several files - spawn `context_explorer`
directly. Otherwise, run `jbcontext search` first; if the results are not enough, delegate to `context_explorer`.

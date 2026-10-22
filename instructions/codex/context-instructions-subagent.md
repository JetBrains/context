# Tools

## Semantic Code Search (jbcontext)

You have access to `jbcontext search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### Usage

```bash
jbcontext search --no-agentic "<detailed and descriptive query>"   # single search, returns in a few seconds
jbcontext search "<query>"                                          # multi-step agentic search, about 10-15 seconds
jbcontext search --no-agentic -p <path> "<query>"                   # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "Where is a function that validates user email addresses" > "email"
- Include context: "Find error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

### How to use it

- If the issue names the exact file, class, or function to change, skip semantic search: locate it with `git grep -n` or `grep -rn` (`rg` may not be installed).
- Otherwise start with one `jbcontext search --no-agentic` before planning, editing, or exact search.
- Once a hit names relevant code, read it and edit. Read further only when the edit needs it, for example a caller or a type the change uses; do not survey neighbouring files first.
- If no hit names relevant code, retry once with the agentic `jbcontext search` (without `--no-agentic`). Reword the query in code terms - the layer and concept that implements the behavior (backend service, data model, API handler, settings, parser) - instead of repeating the issue's wording. A symptom seen in the UI is often fixed in backend or data code.

## Subagent: `context_explorer`

A read-only agent that runs several `jbcontext search` queries in its own
context, reads the promising files, and returns concrete `file:line` references
with inline code snippets and a confidence note.

### When to spawn it

Only when both of your searches missed, or when the task clearly spans several
separate areas you have not located yet. Never spawn it while a search hit
already names the code to change.

### How to spawn it

- Spawn it with: `spawn_agent(agent_type="context_explorer", fork_turns="none", message="<intent; files you already read and why they are not it; what is still unknown>")`
- `spawn_agent` runs in the background - you can read a file you already know is relevant or check the environment, but don't perform exploration while it's running.
- Always call `wait_agent` once that known work (if any) is done, otherwise you never get the report.

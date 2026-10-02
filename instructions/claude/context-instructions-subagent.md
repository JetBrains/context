# Tools

## Code discovery: jbcontext search first

When a task requires finding or understanding code whose location you don't
already know, your FIRST code-discovery step MUST be a `jbcontext search` for
that question (see below), run before your own `grep`/`glob`/`bash` searches or
git history.

Read the results and judge whether they answer the question. Often a single
search is enough - then switch to direct file reads. Only if the search result
is insufficient, delegate the remaining exploration to the context-explorer
subagent:

Task(subagent_type='context-explorer',
     description=<short label>,
     prompt=<1-2 sentence intent describing what to find, plus the key
             `file:line` hits the search already returned and what is still
             unknown>)

Never start context-explorer for a question you have not yet run
`jbcontext search` for. Handing it the results you already have lets it do
focused work on the gap instead of repeating your search, and it returns
concrete `file:line` references so you don't burn your context re-reading the
same files.

This governs *how* you begin code discovery - not whether every task needs it.
Do NOT run a discovery search or call context-explorer when the task doesn't
involve locating code:

- the task names the exact file, class, or symbol - open it or grep directly;
- the relevant file is already open or identified;
- the work is a git operation (rebase, merge, commit), a test/build run,
  shell/statusline/config setup, or a review of a diff you already have.

Searching or invoking context-explorer as a formality "to get started" on such
tasks wastes a round and returns irrelevant findings. It is a research step,
not a gate to clear - skip it and proceed directly.

When you do start context-explorer, it runs up to 3 semantic searches in its own
context (restricted to `jbcontext search` via `Bash` and `Read` only) and
returns a short report:

Searched: <one-line summary>
Findings:
- <relative/path>:<line> - <description>
- ...
Notes: <confidence; whether keyword grep would be more direct here>

Use its findings if they look useful, or ignore them entirely if `Notes:` flags
the task as keyword-based. You retain full freedom for the rest of the run.

## Semantic Code Search (jbcontext)

You have access to `jbcontext search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### Usage

```bash
jbcontext search "<detailed and descriptive query>"
jbcontext search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

### Single-Shot Policy

Use `jbcontext search` as a semantic bootstrap when the relevant file or subsystem is still unknown.

- If no relevant file is open yet, start with one `jbcontext search`.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code.
- If a semantic retry is still needed, use `jbcontext search -p <path> ...` with the directory of the best first hit.

### Examples

```bash
# Find authentication-related code
jbcontext search "user authentication login flow"

# Narrow to specific directory
jbcontext search -p src/auth "JWT token validation"
```

Use `jbcontext search` once to get the initial pointer, then inspect nearby code locally. If that still fails, do a narrowed retry with `-p`, or hand the results and the remaining gap to context-explorer as described above.
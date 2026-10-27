# Tools

## Code discovery: context-explorer first

When a task requires finding or understanding code whose location you don't
already know, your FIRST code-discovery step MUST be:

Task(subagent_type='context-explorer',
     description=<short label>,
     prompt=<1-2 sentence intent describing what to find>)

Start there instead of opening with your own `grep`/`glob`/`bash` searches or
git history: the subagent runs the semantic exploration in its own context and
hands back concrete `file:line` references, so you don't burn your context
re-reading the same files.

This governs *how* you begin code discovery - not whether every task needs it.
Do NOT call context-explorer when the task doesn't involve locating code:

- the task names the exact file, class, or symbol - open it or grep directly;
- the relevant file is already open or identified;
- the work is a git operation (rebase, merge, commit), a test/build run,
  shell/statusline/config setup, or a review of a diff you already have.

Invoking context-explorer as a formality "to get started" on such tasks wastes
a subagent round and returns irrelevant findings. It is a research step, not a
gate to clear - skip it and proceed directly.

When you do use it, the subagent runs up to 3 semantic searches in its own
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

Use `jbcontext search` once to get the initial pointer, then inspect nearby code locally. If that still fails, do a narrowed retry with `-p`.
# Tools

## Code discovery: background `jbcontext search` first

When a task requires finding or understanding code whose location you don't
already know, your first code-discovery step should be `jbcontext search`,
started in the background. A search can take 10-20 seconds, so do not block on
it:

- Run each search with the `Bash` tool and `run_in_background: true`. You are
  notified automatically when it completes; then read its output.
- Start one search per clearly different aspect or part of the task (e.g. where
  a request is parsed and where its result is persisted) - several searches can
  run in parallel. Never start paraphrases of the same query.
- While searches run, keep doing local work that does not depend on their
  results - read files you already know are relevant, check the environment,
  plan the change.
- Collect every started search's results before relying on them.

Start there instead of opening with your own `grep`/`glob`/`bash` searches or
git history.

This governs *how* you begin code discovery - not whether every task needs it.
Do NOT run semantic search when the task doesn't involve locating code:

- the task names the exact file, class, or symbol - open it or grep directly;
- the relevant file is already open or identified;
- the work is a git operation (rebase, merge, commit), a test/build run,
  shell/statusline/config setup, or a review of a diff you already have.

## Subagent: context-explorer

For broad multi-step exploration - mapping an unfamiliar subsystem, or tracing
a flow across several files - you can delegate to the context-explorer subagent:

Task(subagent_type='context-explorer',
     description=<short label>,
     prompt=<1-2 sentence intent describing what to find>)

The subagent runs the semantic exploration in its own context and hands back
concrete `file:line` references, so you don't burn your context re-reading the
same files. Do not start context-explorer on a question while a `jbcontext
search` for that question is still running - collect that search first and
delegate only if its results are not enough.

When you do use it, the subagent runs up to 3 semantic searches in its own
context (`jbcontext search` via `Bash`, plus `Read`) and returns a short report:

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

### Search Policy

Use `jbcontext search` as a semantic bootstrap when the relevant file or subsystem is still unknown.

- If no relevant file is open yet, start with `jbcontext search` in the background - one focused query per clearly different aspect of the task.
- Make each query specific to the issue's named feature, class, method, config flag, or behavior when available.
- Never run several paraphrases of the same query; one query per aspect.
- After the results arrive, open at least one returned file and inspect it locally.
- If a hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code.
- If a semantic retry for the same aspect is still needed, use `jbcontext search -p <path> ...` with the directory of the best first hit.

### Examples

```bash
# Find authentication-related code
jbcontext search "user authentication login flow"

# Narrow to specific directory
jbcontext search -p src/auth "JWT token validation"
```

Use background `jbcontext search` calls - one per aspect - to get the initial pointers, then inspect nearby code locally. If that still fails, do a narrowed retry with `-p`.

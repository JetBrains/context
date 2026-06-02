# Tools

## MANDATORY FIRST ACTION

Your FIRST tool call MUST be:

Task(subagent_type='embark-explorer',
     description=<short label>,
     prompt=<1-2 sentence intent describing what to find>)

A hook is enforcing this — every other tool will be denied until the
embark-explorer subagent has been invoked once. Do not attempt any read,
grep, glob, bash, or edit before the subagent has returned.

The subagent runs up to 3 semantic searches in its own context (restricted to
`embark search` via `Bash` and `Read` only) and returns a short report:

Searched: <one-line summary>
Findings:
- <relative/path>:<line> — <description>
- ...
Notes: <confidence; whether keyword grep would be more direct here>

After the subagent returns, ALL tools are unlocked. Use its findings if they look
useful, or ignore them entirely if the `Notes:` flag the task as keyword-based.
You retain full freedom for the rest of the run.

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### Usage

```bash
embark search "<detailed and descriptive query>"
embark search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

### Single-Shot Policy

Use `embark search` as a semantic bootstrap when the relevant file or subsystem is still unknown.

- If no relevant file is open yet, start with one `embark search`.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code.
- If a semantic retry is still needed, use `embark search -p <path> ...` with the directory of the best first hit.

### Examples

```bash
# Find authentication-related code
embark search "user authentication login flow"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"
```

Use `embark search` once to get the initial pointer, then inspect nearby code locally. If that still fails, do a narrowed retry with `-p`.
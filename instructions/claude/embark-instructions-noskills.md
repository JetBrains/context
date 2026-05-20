# Tools

## Semantic Code Search (EmbArk)

For a targeted semantic search, use `embark search` — it matches by meaning, not keywords.
For broader codebase exploration or multiple questions, delegate to the `embark-explore` subagent.

### Usage

```bash
embark search "<detailed and descriptive query>"
embark search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

Good examples: "function that validates user email addresses and returns boolean", "error handling middleware for HTTP requests with logging", "React component that renders a modal dialog with close button".
Avoid single words like "email" or "error", and avoid keyword-style queries that just concatenate terms, e.g. "product composite REST controller integration service reviews productId openapi tests".

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
embark search "backend logic for logging users into the application"

# Narrow to specific directory
embark search -p src/auth "Which code validates JWT tokens?"
```

Use `embark search` once to get the initial pointer, then inspect nearby code locally. If that still fails, do a narrowed retry with `-p`.
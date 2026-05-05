# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### MANDATORY: EmbArk First Bootstrap

When no relevant file or subsystem is known yet, you MUST start code search with `embark search`.

### Usage

```bash
embark search "<detailed and descriptive query>"
embark search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

- Do not start with grep, ripgrep, or find while no relevant file is open yet.
- Do one broad `embark search` first.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally before any second `embark search`.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code. Do not replace repeated broad semantic search with long grep/find/git exploration loops.
- A second semantic search is allowed at most once, only after reading at least one returned file, and only if that inspection still did not identify the needed adjacent area.
- If you search again, use `embark search -p <path> ...` with the directory of the best first hit. Do not issue a second broad `embark search`, and do not reformulate the first broad query into another repository-wide search.
- Do not use git history for initial discovery unless the task explicitly requires regression or history analysis.

### Examples

```bash
# Find authentication-related code
embark search "user authentication login flow"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"
```

Use `embark search` once to get the initial pointer, then inspect nearby code locally. If that still fails, do one narrowed retry with `-p`.

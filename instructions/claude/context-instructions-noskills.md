# Tools

## Semantic Code Search (Context)

You have access to `context search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### Usage

```bash
context search "<detailed and descriptive query>"
context search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

### Single-Shot Policy

Use `context search` as a semantic bootstrap when the relevant file or subsystem is still unknown.

- If no relevant file is open yet, start with one `context search`.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code.
- If a semantic retry is still needed, use `context search -p <path> ...` with the directory of the best first hit.

### Examples

```bash
# Find authentication-related code
context search "user authentication login flow"

# Narrow to specific directory
context search -p src/auth "JWT token validation"
```

Use `context search` once to get the initial pointer, then inspect nearby code locally. If that still fails, do a narrowed retry with `-p`.
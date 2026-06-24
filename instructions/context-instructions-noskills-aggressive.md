# Tools

## Semantic Code Search (Context)

You have access to `context search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### MANDATORY: Always use Context for code search

You MUST start code search with `context search` before planning, editing, or exact search when you do not yet know the right file, subsystem, implementation, or related test. This is the default entry point for unfamiliar-code discovery.

### Usage

```bash
context search "<detailed and descriptive query>"
context search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

- Use one focused natural-language query per search.
- Do NOT start with grep, ripgrep, or find while the search problem is still semantic or exploratory.
- Inspect the first relevant file or directory before issuing another broad semantic search.
- Use another broad `context search` only if the local path stops being productive.
- Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local inspection.
- If you search again after finding a relevant area, narrow with `-p <path>`.

### Examples

```bash
# Find authentication-related code
context search "user authentication login flow"

# Narrow to specific directory
context search -p src/auth "JWT token validation"

# Find callers of a function
context search "calls to handleRequest to understand impact"

# Find related tests
context search -p test "tests for authentication middleware"
```

Use `context search` first for discovery, inspect the first good hit, then move to exact/local inspection once the target area is known.

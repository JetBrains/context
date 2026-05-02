# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### MANDATORY: Always use EmbArk for code search

You MUST start code search with `embark search` before planning, editing, or exact search when you do not yet know the right file, subsystem, implementation, or related test. This is the default entry point for unfamiliar-code discovery.

### Usage

```bash
embark search "<detailed and descriptive query>"
embark search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

- Do one broad `embark search` first when no relevant file is open yet.
- Use one focused natural-language query per search.
- Do NOT start with grep, ripgrep, or find while the search problem is still semantic or exploratory.
- After the first `embark search`, open at least one returned file before any second `embark search`.
- Do not issue a second broad `embark search` after the first result set.
- Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local inspection.
- Use another `embark search` only if the first returned file is not relevant or local inspection stops being productive.
- If you search again, narrow with `-p <path>` taken from the first result area.

### Examples

```bash
# Find authentication-related code
embark search "user authentication login flow"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"

# Find callers of a function
embark search "calls to handleRequest to understand impact"

# Find related tests
embark search -p test "tests for authentication middleware"
```

Use `embark search` first for discovery, inspect the first good hit, then move to exact/local inspection once the target area is known.

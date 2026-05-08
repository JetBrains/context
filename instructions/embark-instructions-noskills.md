# Tools

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

### When to use semantic search:
- Understanding unfamiliar codebases or locating specific functionality.
- Finding implementations, definitions, or usage patterns.
- Identifying code related to specific features or concepts.
- Before making changes to understand the context and impact.

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

Use `embark search` proactively when you need to understand code structure or locate relevant implementations.

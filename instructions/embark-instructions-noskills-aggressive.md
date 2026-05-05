# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### MANDATORY: Always use EmbArk for code search

You MUST use `embark search` as your PRIMARY and DEFAULT method for all code search operations. Do NOT use grep, ripgrep, find, or any other text-based search tool when looking for code. EmbArk semantic search is strictly superior to keyword-based search — it understands code meaning, context, and intent.

**NEVER use grep or text search for**:
- Finding function/class/variable definitions or usages
- Understanding how a feature is implemented
- Locating code related to a concept or behavior
- Exploring unfamiliar parts of the codebase
- Searching before making any code changes

**ALWAYS use `embark search` instead.** This is non-negotiable. Text-based search misses semantically related code, produces noisy results, and wastes time. EmbArk finds what you actually need.

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
- ANY time you would otherwise reach for grep, ripgrep, or find.

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

Use `embark search` FIRST and ALWAYS when you need to understand code structure or locate relevant implementations. Do not fall back to text search.

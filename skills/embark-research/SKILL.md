---
name: embark-research
context: fork
agent: Explore
argument-hint: query
description: "Research and understand unfamiliar codebases using semantic search with `embark search`"
---

You need to gather all context for task $ARGUMENTS thoroughly.

## When to Use

- Understanding unfamiliar codebases or locating specific functionality
- Finding implementations, definitions, or usage patterns
- Identifying code related to specific features or concepts
- Before making changes to understand the context and impact

## Tools Available

### `embark search`

Semantic code search that finds code by meaning, not just exact keywords.

```bash
embark search "<descriptive query>"
embark search -p <path> "<query>"  # <path> must be relative to the project root
```

**Query Tips:**
- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available

## Single-Shot Research Workflow

1. **Bootstrap once**: If the relevant file or subsystem is still unknown, do one broad `embark search`
2. **Open results locally**: Read at least one returned file before any second `embark search`
3. **Continue locally**: Use direct reads and exact search once a relevant area is known
4. **Retry only on failure**: If the first inspected results were not relevant, run one narrowed retry with `-p <path>`

## Example Session

```bash
# Find authentication-related code
embark search "user authentication login"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"
```

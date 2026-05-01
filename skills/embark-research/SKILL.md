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
embark search "<descriptive query>" [path]
embark search -p <path> "<query>"  # <path> must be relative to the project root
```

**Query Tips:**
- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

## Research Workflow

1. **Start broad**: Use `embark search` with general terms to understand the landscape
2. **Inspect the first hit**: Read the first relevant file or directory before issuing another broad search
3. **Narrow down**: Add path filters (`-p`) once you identify relevant directories
4. **Switch local**: Once you find relevant files, use direct reads or exact search to inspect the local details

## Example Session

```bash
# Find authentication-related code
embark search "user authentication login"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"
```

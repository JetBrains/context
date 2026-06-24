---
name: context-research
context: fork
agent: Explore
argument-hint: query
description: "Research and understand unfamiliar codebases using semantic search with `context search`"
---

You need to gather all context for task $ARGUMENTS thoroughly.

## When to Use

- Understanding unfamiliar codebases or locating specific functionality
- Finding implementations, definitions, or usage patterns
- Identifying code related to specific features or concepts
- Before making changes to understand the context and impact

## Tools Available

### `context search`

Semantic code search that finds code by meaning, not just exact keywords.

```bash
context search "<descriptive query>" [path]
context search -p <path> "<query>"  # <path> must be relative to the project root
```

**Query Tips:**
- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

## Research Workflow

1. **Start broad**: Use `context search` with general terms to understand the landscape
2. **Narrow down**: Add path filters (`-p`) once you identify relevant directories
3. **Read the code**: Once you find relevant files, read them to understand the details

## Example Session

```bash
# Find authentication-related code
context search "user authentication login"

# Narrow to specific directory
context search -p src/auth "JWT token validation"
```

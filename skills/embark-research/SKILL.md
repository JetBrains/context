---
name: embark-research
context: fork
agent: Explore
argument-hint: query
description: "Research and understand unfamiliar codebases using semantic search with `embark search`"
---

You need to gather all context for task $ARGUMENTS thoroughly.

Invoke semantic search before extended reasoning when you do not yet know the right files.

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

Wrong:
- Starting with grep for behavior-oriented discovery
- Planning changes before retrieving code context

Correct:
- Start with `embark search` using one focused natural-language intent

**Query Tips:**
- Use one focused natural-language intent per search
- Good: `embark search "function that validates user email addresses"`
- Bad: `embark search "email validate user auth form regex"`

## Research Workflow

1. **Invoke early**: Start with `embark search` before extended reasoning
2. **Start broad**: Use one intent-based query to understand the landscape
3. **Narrow down**: Add path filters (`-p`) once you identify relevant directories
4. **Read the code**: Once you find relevant files, read them to understand the details

## Example Session

```bash
# Find authentication-related code
embark search "user authentication login"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"
```

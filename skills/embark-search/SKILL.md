---
name: embark-search
description: "Explore and understand unfamiliar codebases using semantic code search"
argument-hint: query

---

# Semantic Code Search

Use `embark search` to find code snippets by meaning, not just keywords.

## Usage

```bash
embark search "<detailed and descriptive query>"
embark search "<code snippet>" # find similar snippets
embark search -p <path> "<query>"  # <path> must be relative to the project root
```

## Query Tips

Good examples: "function that validates user email addresses and returns boolean", "error handling middleware for HTTP requests with logging", "React component that renders a modal dialog with close button".
Avoid single words like "email" or "error", and avoid keyword-style queries that just concatenate terms, e.g. "product composite REST controller integration service reviews productId openapi tests".

## Examples

```bash
# Find authentication-related code
embark search "backend logic for logging users into the application"

# Narrow to specific directory
embark search -p src/auth "Which code validates JWT tokens?"
```

Use `embark search` once to get the initial pointer, then inspect nearby code locally. If that still fails, do a narrowed retry with `-p`.
```

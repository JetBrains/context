---
name: embark-search
description: "Explore and understand unfamiliar codebases using semantic code search"
argument-hint: query

---

# Semantic Code Search

Use `embark search` to find code snippets by meaning, not just keywords. If it's not installed use embark-install skill.

## Usage

```bash
embark search "<detailed and descriptive query>"
embark search "<code snippet>" # find similar snippets
embark search -p <path> "<query>"  # <path> must be relative to the project root
```

## Query Tips

- Be descriptive: "function that validates user email addresses" > "email"
- Include context: "error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

## Examples

```bash
# Find authentication-related code
embark search "user authentication login flow"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"
```

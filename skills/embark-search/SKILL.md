---
name: embark-search
description: "Explore and understand unfamiliar codebases using semantic code search"
argument-hint: query

---

# Semantic Code Search

Use `embark search` to find code snippets by meaning, not just keywords. If it's not installed use embark-install skill.

Use it as a single semantic bootstrap when the relevant file or subsystem is unknown. Do one broad search, open and inspect at least one returned file locally, and only search again if that local inspection did not surface a relevant file. If you search again, use `embark search -p <path> ...` with the best path from the first result. Do not issue a second broad `embark search`.

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
- Make the first query specific to the issue's named feature, class, method, or behavior when available

## Examples

```bash
# Find authentication-related code
embark search "user authentication login flow"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"
```

---
name: embark-search
description: "Explore and understand unfamiliar codebases using semantic code search"
argument-hint: query

---

# Semantic Code Search

Use `embark search` to find code snippets by meaning, not just keywords. If it's not installed use embark-install skill.

Use it first for discovery when you do not yet know the right file, subsystem, implementation, or related test. Do one broad search first, inspect the first useful hit before any second broad search, and only search again if that local path stops being productive. Once you know the target area, switch to direct file reads or exact search for local inspection.

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
- Use one focused intent per search
- Make the first query specific to the issue's named feature, class, method, or behavior when available
- Prefer a short focused intent over a long multi-part query
- Narrow with `-p <path>` after the first useful hit

## Examples

```bash
# Find authentication-related code
embark search "user authentication login flow"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"
```

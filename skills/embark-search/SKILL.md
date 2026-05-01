---
name: embark-search
description: "Explore and understand unfamiliar codebases using semantic code search"
argument-hint: query

---

# Semantic Code Search

Use `embark search` to find code snippets by meaning, not just keywords. If it's not installed use embark-install skill.

## Tool Routing

Wrong:
- Using grep first to understand unfamiliar code
- Using text search first to find related implementations by behavior

Correct:
- Use `embark search "<descriptive query>"` for semantic code discovery

Invoke this skill immediately when:
- You need to understand unfamiliar code, features, or subsystems
- You need implementations, patterns, or usage examples
- You need caller, dependency, or impact analysis
- You need related tests described by behavior rather than exact filename

## Usage

```bash
embark search "<detailed and descriptive query>"
embark search "<code snippet>" # find similar snippets
embark search -p <path> "<query>"  # <path> must be relative to the project root
```

## Query Tips

- Use one focused natural-language intent per search
- Good: `embark search "function that validates user email addresses"`
- Bad: `embark search "email validate user auth form regex"`

## Examples

```bash
# Find authentication-related code
embark search "user authentication login flow"

# Narrow to specific directory
embark search -p src/auth "JWT token validation"
```

# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
Use the `/embark-search` skill or run `embark search "<query>"` to find code by meaning, not just keywords.

## Tool Routing

Use EmbArk before grep, ripgrep, or find when the task is semantic code discovery.

Wrong:
- Jumping to text search to understand an unfamiliar feature
- Using grep first to find related implementations or callers by behavior

Correct:
- Use `embark search "<descriptive query>"` to locate code by intent
- Use EmbArk before planning a change when you do not yet know the right files

## When to Invoke EmbArk

Invoke EmbArk immediately when:
- You need to understand unfamiliar code, features, or subsystems
- You need implementations, patterns, or usage examples
- You need caller, dependency, or impact analysis
- You need related tests described by behavior rather than exact filename
- You need to locate code before making changes

## Query Guidance

- Use one focused natural-language intent per search
- Good: `embark search "function that validates user email addresses"`
- Bad: `embark search "email validate user auth form regex"`

Use this tool proactively when you need to understand code structure or locate relevant implementations.

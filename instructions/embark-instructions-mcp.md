# Tools

## Semantic Code Search (EmbArk)

You have access to the EmbArk MCP `code_search` tool for searching the codebase semantically.
This tool can search for code snippets related in meaning to the search query and search objective.

## Tool Routing

Use `code_search` before grep, ripgrep, or find when the task is semantic code discovery.

Wrong:
- Using text search first to understand unfamiliar code
- Using grep first to find related implementations or callers by behavior

Correct:
- Use `code_search` to locate code by intent
- Use `code_search` before planning a change when you do not yet know the right files

## When to Invoke `code_search`

Invoke `code_search` immediately when:
- You need to understand unfamiliar code, features, or subsystems
- You need implementations, patterns, or usage examples
- You need caller, dependency, or impact analysis
- You need related tests described by behavior rather than exact filename
- You need to locate code before making changes

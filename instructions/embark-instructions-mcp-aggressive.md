# Tools

## Semantic Code Search (EmbArk)

You have access to the EmbArk MCP `code_search` tool for searching the codebase semantically.
This tool can search for code snippets related in meaning to the search query and search objective.

## CRITICAL: Tool Override

This mode REPLACES text-based code search with `code_search`. You MUST use `code_search` before grep, ripgrep, or find when locating code.

Wrong:
- Using grep, ripgrep, or find to locate code before trying `code_search`
- Searching for implementations, callers, tests, or related code with text search first

Correct:
- Use `code_search` for code discovery
- Use `code_search` before planning changes or concluding a change is isolated

Do NOT use grep or text search first for:
- Finding function/class/variable definitions or usages
- Understanding how a feature is implemented
- Locating code related to a concept or behavior
- Exploring unfamiliar parts of the codebase
- Searching before making any code changes

## When to Invoke `code_search`

Invoke `code_search` immediately when:
- You need to understand unfamiliar code, features, or subsystems
- You need implementations, patterns, or usage examples
- You need caller, dependency, or impact analysis
- You need related tests described by behavior rather than exact filename
- You need to locate code before making changes
- You would otherwise reach for grep, ripgrep, or find

## Query Guidance

- Use one focused natural-language intent per search
- Split unrelated intents into separate searches

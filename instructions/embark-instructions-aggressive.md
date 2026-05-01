# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
Use the `/embark-search` skill or run `embark search "<query>"` to find code by meaning, not just keywords.

## CRITICAL: Tool Override

This mode REPLACES text-based code search with EmbArk. You MUST use `embark search` before grep, ripgrep, or find when locating code.

Wrong:
- Using grep, ripgrep, or find to locate code before trying EmbArk
- Searching for implementations, callers, tests, or related code with text search first

Correct:
- Use `embark search "<descriptive query>"` for code discovery
- Use EmbArk before planning changes or concluding a change is isolated

Do NOT use grep or text search first for:
- Finding function/class/variable definitions or usages
- Understanding how a feature is implemented
- Locating code related to a concept or behavior
- Exploring unfamiliar parts of the codebase
- Searching before making any code changes

## When to Invoke EmbArk

Invoke EmbArk immediately when:
- You need to understand unfamiliar code, features, or subsystems
- You need implementations, patterns, or usage examples
- You need caller, dependency, or impact analysis
- You need related tests described by behavior rather than exact filename
- You need to locate code before making changes
- You would otherwise reach for grep, ripgrep, or find

## Query Guidance

- Use one focused natural-language intent per search
- Split unrelated intents into separate searches
- Good: `embark search "calls to handleRequest to understand impact"`
- Bad: `embark search "handleRequest calls impact callers test auth"`

Use `embark search` FIRST and ALWAYS when you need to understand code structure or locate relevant implementations.

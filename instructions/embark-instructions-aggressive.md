# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
Use the `/embark-search` skill or run `embark search "<query>"` to find code by meaning, not just keywords.

### MANDATORY: Use EmbArk first for code discovery

You MUST start code search with `embark search` before planning, editing, or exact search when you do not yet know the right file, subsystem, implementation, or related test. This is the default entry point for unfamiliar-code discovery.

- Use one focused natural-language query per search.
- Do NOT start with grep, ripgrep, or find while the search problem is still semantic or exploratory.
- Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local inspection.
- If you search again after finding a relevant area, narrow with `-p <path>` when possible.

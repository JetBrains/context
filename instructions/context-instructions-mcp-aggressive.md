# Tools

## Semantic Code Search (Context)

You have access to the Context MCP `code_search` tool for searching the codebase semantically.
This tool can search for code snippets related in meaning to the search query and search objective.

### MANDATORY: Use Context first for code discovery

You MUST start code search with `code_search` before planning, editing, or exact search when you do not yet know the right file, subsystem, implementation, or related test. This is the default entry point for unfamiliar-code discovery.

- Use one focused natural-language query per search.
- Do NOT start with grep, ripgrep, or find while the search problem is still semantic or exploratory.
- Inspect the first relevant file or directory before issuing another broad semantic search.
- Use another broad `code_search` only if the local path stops being productive.
- Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local inspection.
- If you search again after finding a relevant area, narrow with `pathFilter`.

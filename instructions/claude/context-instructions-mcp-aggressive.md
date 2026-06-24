# Tools

## Semantic Code Search (Context)

You have access to the Context MCP `code_search` tool for searching the codebase semantically.
This tool can search for code snippets related in meaning to the search query and search objective.

### MANDATORY: Context First Bootstrap

When no relevant file or subsystem is known yet, you MUST start code search with `code_search`.

- Do one broad `code_search` first.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code.
- If a semantic retry is still needed, set `pathFilter` to the directory of the best first hit.
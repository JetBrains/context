# Tools

## Semantic Code Search (jbcontext)

You have access to the jbcontext MCP `code_search` tool for searching the codebase semantically.
This tool can search for code snippets related in meaning to the search query and search objective.

### Single-Shot Policy

Use `code_search` as a semantic bootstrap when the relevant file or subsystem is still unknown.

- If no relevant file is open yet, start with one `code_search`.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code.
- If a semantic retry is still needed, set `pathFilter` to the directory of the best first hit.
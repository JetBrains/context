# Tools

## Semantic Code Search (EmbArk)

You have access to the EmbArk MCP `code_search` tool for searching the codebase semantically.
This tool can search for code snippets related in meaning to the search query and search objective.

### Single-Shot Policy

Use `code_search` as a semantic bootstrap when the relevant file or subsystem is still unknown.

- If no relevant file is open yet, start with one `code_search`.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally before any second `code_search`.
- Exact search and direct file reads are allowed after the first relevant file or path is known.
- Only search semantically again if inspecting the first returned files did not surface a relevant file.
- If you search again, set `pathFilter` to the most relevant path from the first result. Do not issue a second broad `code_search`.

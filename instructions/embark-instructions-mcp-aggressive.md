# Tools

## Semantic Code Search (EmbArk)

You have access to the EmbArk MCP `code_search` tool for searching the codebase semantically.
This tool can search for code snippets related in meaning to the search query and search objective.

### MANDATORY: EmbArk First Bootstrap

When no relevant file or subsystem is known yet, you MUST start code search with `code_search`.

- Do not start with grep, ripgrep, or find while no relevant file is open yet.
- Do one broad `code_search` first.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally before any second `code_search`.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code. Do not replace repeated broad semantic search with long grep/find/git exploration loops.
- A second semantic search is allowed at most once, only after reading at least one returned file, and only if that inspection still did not identify the needed adjacent area.
- If you search again, set `pathFilter` to the directory of the best first hit. Do not issue a second broad `code_search`, and do not reformulate the first broad query into another repository-wide search.
- Do not use git history for initial discovery unless the task explicitly requires regression or history analysis.

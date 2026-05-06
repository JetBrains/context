# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
Use the `/embark-search` skill or run `embark search "<query>"` to find code by meaning, not just keywords.

### MANDATORY: EmbArk First Bootstrap

When no relevant file or subsystem is known yet, you MUST start code search with `embark search`.

- Do one broad `embark search` first.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code.
- If a semantic retry is still needed, narrow it with `embark search -p <path> ...` using the directory of the best first hit.

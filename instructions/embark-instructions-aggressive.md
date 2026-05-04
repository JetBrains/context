# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
Use the `/embark-search` skill or run `embark search "<query>"` to find code by meaning, not just keywords.

### MANDATORY: EmbArk First Bootstrap

When no relevant file or subsystem is known yet, you MUST start code search with `embark search`.

- Do not start with grep, ripgrep, or find while no relevant file is open yet.
- Do one broad `embark search` first.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally before any second `embark search`.
- Exact search and direct file reads are allowed after the first relevant file or path is known.
- Only search semantically again if inspecting the first returned files did not surface a relevant file.
- If you search again, use `embark search -p <path> ...` with the most relevant path from the first result. Do not issue a second broad `embark search`.

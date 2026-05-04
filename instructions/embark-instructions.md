# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
Use the `/embark-search` skill or run `embark search "<query>"` to find code by meaning, not just keywords.

### Single-Shot Policy

Use `embark search` as a semantic bootstrap when the relevant file or subsystem is still unknown.

- If no relevant file is open yet, start with one `embark search`.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally before any second `embark search`.
- Exact search and direct file reads are allowed after the first relevant file or path is known.
- Only search semantically again if inspecting the first returned files did not surface a relevant file.
- If you search again, use `embark search -p <path> ...` with the most relevant path from the first result. Do not issue a second broad `embark search`.

# Tools

## Semantic Code Search (EmbArk)

For a targeted semantic search, use `embark search` command or `/embark-search` skill — it matches by meaning, not keywords.
For broader codebase exploration or multiple questions, delegate to the `embark-explore` subagent.

### Single-Shot Policy

Use `embark search` as a semantic bootstrap when the relevant file or subsystem is still unknown.

- If no relevant file is open yet, start with one `embark search`.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code.
- If a semantic retry is still needed, use `embark search -p <path> ...` with the directory of the best first hit.
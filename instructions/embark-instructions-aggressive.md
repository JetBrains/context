# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
Use the `/embark-search` skill or run `embark search "<query>"` to find code by meaning, not just keywords.

### MANDATORY: Use EmbArk first for code discovery

You MUST start code search with `embark search` before planning, editing, or exact search when you do not yet know the right file, subsystem, implementation, or related test. This is the default entry point for unfamiliar-code discovery.

- Do one broad `embark search` first when no relevant file is open yet.
- Use one focused natural-language query per search.
- Do NOT start with grep, ripgrep, or find while the search problem is still semantic or exploratory.
- After the first `embark search`, open at least one returned file before any second `embark search`.
- Do not issue a second broad `embark search` after the first result set.
- Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local inspection.
- Use another `embark search` only if the first returned file is not relevant or local inspection stops being productive.
- If you search again, narrow with `-p <path>` taken from the first result area.

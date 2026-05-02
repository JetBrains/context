# Tools

## Semantic Code Search (EmbArk)

You have access to `embark search` for searching the codebase semantically.
Use the `/embark-search` skill or run `embark search "<query>"` to find code by meaning, not just keywords.

### How to use it
- Start with `embark search` before planning, editing, or exact search in unfamiliar code when you do not yet know the right file, subsystem, implementation, or related test.
- Use one focused natural-language query per search.
- Do not start with grep, ripgrep, or find when the search problem is still semantic or exploratory.
- If the first search returns a plausible file or directory, inspect it before any second `embark search`.
- Do not issue another broad `embark search` once you have a plausible file or directory.
- Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local inspection.
- Use another `embark search` only if the first file or path is not relevant or local inspection stops being productive.
- If you search again after finding a relevant area, narrow with `-p <path>`.

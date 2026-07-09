# Tools

## Semantic Code Search (jbcontext)

You have access to the jbcontext MCP `code_search` tool for searching the codebase semantically.
This tool can search for code snippets related in meaning to the search query and search objective.

### When to use

`code_search` is a **code-discovery** tool. It applies only when a task requires finding or understanding code whose location you don't already know.

Skip it — go straight to the right tool — when:
- the task names the exact file, class, or symbol (keyword grep is faster);
- the relevant file is already open or identified;
- the task doesn't involve locating code at all — git operations (rebase, merge, commit), running tests or builds, shell/statusline/config setup, or reviewing a diff you already have.

### MANDATORY: jbcontext-first bootstrap

When code discovery *is* needed and no relevant file or subsystem is known yet, your first code-search action MUST be `code_search` — do not open with `rg`/`grep`/`find` or git history. This mandate governs *how* you start searching, not whether every task needs a search.

- Do one broad `code_search` first.
- Make the first query specific to the issue's named feature, class, method, config flag, or behavior when available.
- After the first search, open at least one returned file and inspect it locally.
- If the first hit is relevant but incomplete, inspect neighboring files locally in that same directory or subsystem before any semantic retry.
- After the first relevant file or path is known, prefer direct file reads and exact search to inspect nearby code.
- If a semantic retry is still needed, set `pathFilter` to the directory of the best first hit.
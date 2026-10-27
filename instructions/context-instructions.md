# Tools

## Semantic Code Search (jbcontext)

You have access to `jbcontext search` for searching the codebase semantically.
Use the `/context-search` skill or run `jbcontext search "<query>"` to find code by meaning, not just keywords.

### Query Tips

Before searching, translate the research task into the one code responsibility you need to locate next. Describe that code in concise natural language rather than forwarding the whole assignment as the query.

- Describe the operation, its subject, and the constraints that distinguish it from nearby code. Preserve useful domain terms and exact identifiers supplied by the task or observed in code; avoid keyword bags and guessed names.
- If the task spans endpoints, persistence, configuration, callers, or tests, choose the responsibility needed first. Read the results and follow local references before searching for another responsibility that remains unresolved.
- Keep a related precondition, return value, or failure case when it describes the same operation. Do not split a coherent behavior merely because its description contains "and".
- Keep requests for explanations, output formatting, and a final report outside the search text.
- For a feature that does not exist yet, search for the existing mechanism to extend rather than assuming the desired implementation already exists.

Examples:

- Focused: "retrieving a user's learning progress for a particular course"
- Focused: "HTTP handlers receiving and storing uploaded IDE analytics"
- Focused: "moving downloaded distributions atomically with a fallback when atomic moves are unsupported"
- Too many responsibilities: "Where are course endpoints and how is user course learning progress recorded and returned?"
- Too many responsibilities: "Find the upload endpoints, data storage, configuration, and related tests"

Question phrasing is fine when it has one clear retrieval target; there is no fixed word limit.

### When to use

`jbcontext search` is a **code-discovery** tool. Reach for it only when a task requires finding or understanding code whose location you don't already know.

Skip it - go straight to the right tool - when:

- the task names the exact file, class, or symbol (keyword grep is faster);
- the relevant file is already open or identified;
- the task doesn't involve locating code at all - git operations (rebase, merge, commit), running tests or builds, shell/statusline/config setup, or reviewing a diff you already have.

### How to use it

- Start with `jbcontext search` before planning, editing, or exact search in unfamiliar code when you do not yet know the right file, subsystem, implementation, or related test.
- Use one focused natural-language query per search, targeting the code responsibility needed next rather than the whole investigation.
- Do not start with grep, ripgrep, or find when the search problem is still semantic or exploratory.
- Inspect the first relevant file or directory before issuing another broad semantic search.
- Use another broad `jbcontext search` only if the local path stops being productive.
- Once you know the relevant file, symbol, or directory, switch to direct file reads or exact search for local inspection.
- If you search again after finding a relevant area, narrow with `-p <path>`.

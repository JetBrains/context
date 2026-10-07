# Tools

## Code discovery subagent (context-explorer)

You have access to the `context-explorer` subagent. It maps code across several
components with semantic search and targeted reads in its own context, and
returns verified `file:line` references with code snippets, so intermediate
search output stays out of your context.

Call the Agent tool with `subagent_type: "context-explorer"` and a 1-2 sentence
intent describing what to understand or locate.

Its report has four parts: `Searched`, `Read`, `Findings` (`file:line`
references with code snippets), and `Notes` (confidence, and whether keyword
grep would be more direct).

## Semantic Code Search (jbcontext)

You have access to `jbcontext search`, semantic code search over this repository.
It finds code by meaning rather than exact keywords, so it can help locate a behavior,
concept, or pattern, or code similar to a snippet, when you don't know the exact names.
Run it from the shell: `jbcontext search "<query>"`.
Results are ranked file paths with code snippets and line numbers.

More specific guidance on these tools may arrive during the task in a hook message on a tool call.
A search call may also be denied with a reason that names a better-suited search method; that is guidance, not an error - follow it.

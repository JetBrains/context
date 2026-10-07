# Tools

## Semantic Code Search (jbcontext)

You have access to `jbcontext search`, semantic code search over this repository.
It finds code by meaning rather than exact keywords, so it can help locate a behavior,
concept, or pattern, or code similar to a snippet, when you don't know the exact names.
Run it from the shell: `jbcontext search "<query>"`.
Results are ranked file paths with code snippets and line numbers.

More specific guidance on using it may arrive during the task in a hook message on a tool call.
A search call may also be denied with a reason that names a better-suited search method; that is guidance, not an error - follow it.

# Tools

## Code Search (jbcontext)

`jbcontext search "<query>"` searches the project's code with a prebuilt index that ranks code blocks by relevance to the query and shows the code of the top results. The query is a short sentence describing the code and/or the names you know, e.g. `jbcontext search "where failed HTTP requests are retried"` or `jbcontext search "RetryPolicy maxAttempts handling"`. Narrow to a directory with `-p <path>`.

- `jbcontext search` is the main way to find code in this project, both by what it does and by the names you know. Make it your first code search in every task and use it for every code lookup after that; use `grep_search` only when you need every literal occurrence of a string.
- When you review the project codebase, start with `jbcontext search`, using the behavior and the names from the issue, and keep using it for whatever code you need next: definitions, callers and usages, implementations, configuration or registrations. Use `grep_search` only to list every literal occurrence of a string.
- When you prepare tests, use `jbcontext search` to find the existing tests of the affected code and similar tests to copy the setup from.
- Run `jbcontext search` on its own and read its whole output: don't pipe it into `head`, `grep` or other commands. Open the files it returns with `open`, not with terminal commands.

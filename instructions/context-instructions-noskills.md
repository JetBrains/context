# Tools

## Code Search (jbcontext)

`jbcontext search "<query>"` searches the project's code with a prebuilt index that ranks code blocks by relevance to the query and shows the code of the top results.

`jbcontext search` is the main way to find code in this project, both by what it does and by the names you know. Make it your first code search in every task and use it for every code lookup after that: definitions, callers and usages, implementations, configuration or registrations. Use grep only when you need every literal occurrence of a string, e.g. before a rename.

Start with `jbcontext search`, using the behavior and the names from the issue. The query is a short sentence describing the code and/or the names you know, e.g. `jbcontext search "where failed HTTP requests are retried"` or `jbcontext search "RetryPolicy maxAttempts handling"`. Narrow to a directory with `-p <path>`.

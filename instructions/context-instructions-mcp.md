# Tools

## Code Search (jbcontext)

- `mcp_jbcontext_code_search` is the main way to find code in this project, both by what it does and by the names you know. Make it your first code search in every task and use it for every code lookup after that; use `grep_search` only when you need every literal occurrence of a string.
- When you review the project codebase, start with `mcp_jbcontext_code_search`, using the behavior and the names from the issue, and keep using it for whatever code you need next: definitions, callers and usages, implementations, configuration or registrations. Use `grep_search` only to list every literal occurrence of a string.
- When you prepare tests, use `mcp_jbcontext_code_search` to find the existing tests of the affected code and similar tests to copy the setup from.
- Don't use terminal `grep`, `find` or `glob` commands for searching. Use the designated special search tools (`glob_search`, `grep_search`, `mcp_jbcontext_code_search`) instead.

# Repository discovery: code, tests, and documentation

When you need to locate an implementation, callers, related tests, or documentation/specifications and do not know the relevant file, you MUST run `jbcontext search` before repository-wide grep, globbing, or guessing directories. Put it at the start of the same Bash call as your grep for names from the task, so neither waits for the other:

```bash
jbcontext search --limit 5 "<one discovery question, with relevant feature or symbol names>"; <your grep>
```

Apply this rule to each new unresolved discovery question, including tests or documentation needed after locating the implementation. Finding one file does not finish all discovery. No search is required merely upon receiving a task, for a fully located edit, or for running tests/builds, git operations, or reviewing a supplied diff.

Example queries:

- Implementation: "Where are expired login tokens rejected?"
- Callers: "Where is refreshToken invoked when a request receives HTTP 401?"
- Tests: "Tests covering token refresh failure and retry limits."
- Documentation/spec: "Markdown documentation or specification defining token expiry, refresh behavior, and configuration options."

Read the best hit before searching again. Use at most one reformulation per question, narrowed with `-p <dir>`.

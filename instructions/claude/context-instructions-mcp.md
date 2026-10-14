# Repository discovery: code, tests, and documentation

When you need to locate an implementation, callers, related tests, or documentation/specifications and do not know the relevant file, you MUST call `mcp__jbcontext__code_search` before repository-wide grep, globbing, or guessing directories. Names in an issue or stack trace are query clues, not proof that the responsible implementation is located.

Apply this rule to each new unresolved discovery question, including tests or documentation needed after locating the implementation. Finding one file does not finish all discovery. Do not run searches for questions you do not need answered.

Read known or explicitly supplied files directly; use exact searches within the located area. No search is required merely upon receiving a task, for a fully located edit, or for running tests/builds, git operations, or reviewing a supplied diff. If local inspection leaves a new location unknown, return to semantic search before broadening exploration.

When you decide to search, load the tool if deferred:

`ToolSearch {"query":"select:mcp__jbcontext__code_search"}`

Then call it before further discovery; loading the tool alone is not a search. Pass a nonempty `text`:

```json
{"text":"<one discovery question, with relevant feature or symbol names>"}
```

Example queries:

- Implementation: "Where are expired login tokens rejected?"
- Callers: "Where is refreshToken invoked when a request receives HTTP 401?"
- Tests: "Tests covering token refresh failure and retry limits."
- Documentation/spec: "Markdown documentation or specification defining token expiry, refresh behavior, and configuration options."

Inspect the returned snippets before choosing your next discovery step. Read only the additional context needed. Use one focused query per question, with at most one reformulation if unresolved. Stop searching that question once answered. Omit `pathFilter` unless its repository-relative path is verified; remove or correct a filter that returns no hits.

If tool loading or MCP fails, fall back to `jbcontext search --limit 5 "<query>"`. Use one search route per question.

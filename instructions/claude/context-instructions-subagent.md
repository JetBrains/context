# Code discovery

Call `mcp__jbcontext__code_search` directly once before broad repository discovery when the implementation responsible for the requested behavior is still unknown. Names in a bug report, example, or stack trace are query clues; they do not by themselves locate that implementation.

You may read a supplied implementation path or make one exact definition lookup first. If that leaves the responsible code unclear, use semantic search before another discovery query, a wider grep, or guessing another directory. Once the responsible code is located, use scoped reads and exact searches normally. Skip semantic search for work that needs no code discovery.

If the tool is deferred, load it with `ToolSearch {"query":"select:mcp__jbcontext__code_search"}` alongside any independent setup or issue-file read. Then call the loaded tool with a nonempty `text`:

```json
{"text":"<behavior to locate, with relevant feature or symbol names>"}
```

Omit `pathFilter` unless you have verified the directory relative to the repository root. Read the returned snippets, then only the additional context needed to edit and verify. Retry at most once for an unresolved discovery question; if a filter produced no hits, remove or correct it. Stop semantic searching once located.

If tool loading or MCP fails, fall back to `jbcontext search --limit 5 "<query>"`. Use one search route per question.

# Code search

Use direct reads or exact search for named files or symbols and code already located.

When only behavior is known, or an exact lookup has not located the relevant code, call jbcontext MCP `code_search` directly with one focused `text` query. Set `pathFilter` when the relevant scope is known.

Use returned snippets and line numbers to target any further reads needed for the edit. Once relevant code is located, continue locally. Retry semantic search at most once, only with a materially different query or a justified narrower scope.

If MCP is unavailable, use `jbcontext search --limit 5 "<query>"`, adding `-p <dir>` when the scope is known.

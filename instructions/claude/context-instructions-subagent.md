# Tools

## Code discovery: one semantic search first

When you need code whose location you don't already know, run one semantic
search yourself with `mcp__jbcontext__code_search` before broad `grep`/`find`/`Glob`:

```json
{"text": "<what the code does, in plain language>"}
```

For a narrowed retry, add the directory relative to the project root:

```json
{"text": "<query>", "pathFilter": "<dir>"}
```

It returns ranked files with line ranges and code snippets in about a second.
If the tool is listed as deferred, load it with ToolSearch
`select:mcp__jbcontext__code_search` first, then call it directly. Use
`jbcontext search "<query>"` through Bash only if the MCP tool is unavailable;
its narrowed retry is `jbcontext search -p <dir> "<query>"`.

- Make the query specific to the task's feature, behavior, error message or
  config flag: "inspection that reports redundant lambda parameter types" >
  "lambda".
- Read the best hit, then continue locally with Read/Grep in that directory or
  subsystem.
- Retry at most once, narrowed with `pathFilter` to the directory of the best hit. Don't
  run a second broad search.

Skip it - go straight to the right tool - when:

- the task names the exact file, class, or symbol (keyword grep is faster);
- the relevant file is already open or identified;
- the task doesn't involve locating code at all - git operations (rebase, merge,
  commit), running tests or builds, shell/config setup, or reviewing a diff you
  already have.

## context-explorer subagent (optional)

Use `context-explorer` only for broad research that spans several subsystems,
not to find where one thing lives - `mcp__jbcontext__code_search` does that in one call.
If you use it, launch it with `run_in_background: false` and wait for its report
before you search or edit yourself: a background launch reports after you have
moved on, and its work is wasted.

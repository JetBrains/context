# Tools

## Code discovery: one semantic search first

When you need code whose location you don't already know, run one semantic
search yourself before broad `grep`/`find`/`Glob`:

```bash
jbcontext search "<what the code does, in plain language>"
jbcontext search -p <dir> "<query>"  # narrowed retry; <dir> is relative to the project root
```

It returns ranked files with line ranges and code snippets in about a second.
The same search is the `mcp__jbcontext__code_search` tool; if that tool is
listed as deferred, load it with ToolSearch `select:mcp__jbcontext__code_search`
first. The Bash form needs no loading.

- If the task message already comes with jbcontext search results, that was
  your first search: start from its best hit instead of searching again.
- Make the query specific to the task's feature, behavior, error message or
  config flag: "inspection that reports redundant lambda parameter types" >
  "lambda".
- Read the best hit, then continue locally with Read/Grep in that directory or
  subsystem.
- Retry at most once, narrowed with `-p` to the directory of the best hit. Don't
  run a second broad search.

Skip it - go straight to the right tool - when:

- the task names the exact file, class, or symbol (keyword grep is faster);
- the relevant file is already open or identified;
- the task doesn't involve locating code at all - git operations (rebase, merge,
  commit), running tests or builds, shell/config setup, or reviewing a diff you
  already have.

## context-explorer subagent (optional)

Use `context-explorer` only for broad research that spans several subsystems,
not to find where one thing lives - `jbcontext search` does that in one call.
If you use it, launch it with `run_in_background: false` and wait for its report
before you search or edit yourself: a background launch reports after you have
moved on, and its work is wasted.

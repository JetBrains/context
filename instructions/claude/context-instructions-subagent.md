# Tools

## Code discovery: context-explorer first, in the foreground

When a task requires finding code whose location you don't already know, your
first code-discovery step is the `context-explorer` subagent, run in the
foreground:

Agent(subagent_type="context-explorer", run_in_background=false,
      description="<short label>",
      prompt="<1-2 sentence intent: what to find and why>")

- Always pass `run_in_background: false`. A background launch reports after you
  have already searched and edited on your own, so its work is wasted.
- Wait for the report. Don't grep, read, or edit until it arrives, and don't
  repeat its searches afterwards - start from the files and snippets it returns.
- Launch it once per task, not for every lookup.

Skip it - go straight to Read/Grep - when:

- the task names the exact file, class, or symbol (keyword grep is faster);
- the relevant file is already open or identified;
- the task doesn't involve locating code at all - git operations (rebase, merge,
  commit), running tests or builds, shell/config setup, or reviewing a diff you
  already have.

The subagent runs at most two semantic searches and three reads in its own
context and returns:

## Findings
[1] <path>:<line> - <why it matters>
<short code snippet>
## Notes
<confidence; whether keyword grep would have been more direct>

## Follow-up searches

If, after the report, you still need code in a different area, run one narrowed
semantic search yourself instead of launching the subagent again:

```bash
jbcontext search -p <dir> "<what the code does, in plain language>"  # <dir> is relative to the project root
```

# Tools

## Code discovery: context-explorer first

The `context-explorer` custom subagent (spawn it with `spawn_subagent`) searches the repository semantically in its own context and returns concrete `file:line` references with the code itself.

When the task requires code whose location you do not know yet, your first code-discovery step is to spawn `context-explorer` with a 1-2 sentence intent: the behaviour from the task, with the class, method, setting or message names it mentions, and what you need back (the code to change, the APIs it uses, an existing test to copy).

Its report quotes the code it saw with line numbers. Treat that code as already read: do not open or grep the same files and ranges again to confirm it; open only lines it did not show.

In a large repository a class or message named in the task usually has many usages, look-alikes and test fixtures, so the explorer is still the faster start; skip it only when you already know the exact file to change, or when the work does not involve locating code (git operations, builds, running tests).

Later in the task:
- for a single new "where is ..." question, run `jbcontext search "<full sentence with names from the task>"` via `bash` yourself;
- for a new question that would otherwise take you several opens and greps (tracing a flow, finding how an API is used elsewhere, finding a test to copy), spawn `context-explorer` again instead of exploring file by file yourself;
- for occurrences of an exact identifier you already know, use exact search.

## Semantic Code Search (jbcontext)

`jbcontext search "<query>"` returns the best matching code blocks: file path, line range and the code.

- Write a full sentence that describes the behaviour and includes names from the task.
- Read the returned code blocks first; often they already answer the question.
- `-p <path>` limits the search to a directory relative to the repository root, not to the current directory.
- Do not search again for something you have already found.

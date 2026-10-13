# Tools

## Code discovery: context-explorer first

The `context-explorer` custom subagent (spawn it with `spawn_subagent`) searches the repository semantically in its own context and returns concrete `file:line` references with the code itself.

When the task requires code whose location you do not know yet, your first code-discovery step is to spawn `context-explorer` with a 1-2 sentence intent: the behaviour from the task, with the class, method, setting or message names it mentions, and what you need back (the code to change, its callers, its tests). Use its findings directly: open only the line ranges you still need instead of re-searching the same code.

In a large repository a class or message named in the task usually has many usages, look-alikes and test fixtures, so the explorer is still the faster start; skip it only when you already know the exact file to change, or when the work does not involve locating code (git operations, builds, running tests).

Later in the task:
- for a single new "where is ..." question, run `jbcontext search "<full sentence with names from the task>"` via `bash` yourself;
- for a new multi-step question (tracing a flow across several files), spawn `context-explorer` again;
- for occurrences of an exact identifier you already know, use exact search.

## Semantic Code Search (jbcontext)

`jbcontext search "<query>"` returns the best matching code blocks: file path, line range and the code.

- Write a full sentence that describes the behaviour and includes names from the task.
- Read the returned code blocks first; often they already answer the question.
- `-p <path>` limits the search to a directory relative to the repository root, not to the current directory.
- Do not search again for something you have already found.

# Tools

## Semantic Code Search (jbcontext)

`jbcontext search "<query>"` searches the whole repository by meaning and returns the best matching code blocks: file path, line range and the code itself. It is usually the fastest way to find where something is implemented, which code a change affects, and which tests cover it. Use the `/context-search` skill for details.

### When to use

Use it whenever you need code whose location you do not know yet, at any point of the task, not only at the start:

- the implementation of the behaviour described in the issue;
- callers, related implementations, extension points or registrations of the code you are changing;
- existing tests for that code, and examples of similar tests to copy the setup from.

Prefer it over repeated grep/find rounds and over listing directories. Use exact search when you already know the exact identifier and only need its occurrences.

### How to use it

- Write a full sentence that describes the behaviour, and include the class, method, setting or message names from the task: "where the Gradle sync reports unresolved dependencies to the build tool window".
- Read the returned code blocks first: often they already answer the question, and you can edit or open the exact line range instead of reading whole files.
- One question per search. If the results are off, rephrase with different terms instead of repeating the same query.
- `-p <path>` limits the search to a directory; the path is relative to the repository root, not to the current directory.

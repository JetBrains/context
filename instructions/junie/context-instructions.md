# Tools

## Semantic Code Search (jbcontext)

`jbcontext search "<query>"` searches the whole repository by meaning and returns the best matching code blocks: file path, line range and the code itself. It is usually the fastest way to find where something is implemented, which code a change affects, and which tests cover it. Use the `/context-search` skill for details.

### When to use

Use it whenever you need code whose location you do not know yet, at any point of the task, not only at the start:

- the implementation of the behaviour described in the issue;
- callers, related implementations, extension points or registrations of the code you are changing;
- existing tests for that code, and examples of similar tests to copy the setup from.

Prefer it over repeated grep/find rounds and over listing directories. In a large repository a class or message named in the task usually has many usages, look-alikes and test fixtures; a search that combines the name with the described behaviour finds the implementation and its tests faster than grepping the name.

### When not to

- You already know the exact identifier and only need its occurrences, or the file is already open: use exact search or open it.
- Git operations, builds and running tests.
- Do not search again for something you have already found; search again only when a new question comes up. Most tasks need one to four searches.

### How to use it

- Write a full sentence that describes the behaviour, and include the class, method, setting or message names from the task: "where the Gradle sync reports unresolved dependencies to the build tool window".
- Run it as `jbcontext search --limit 6 "<sentence>"`: six results are enough, more only fill the context.
- Read the returned code blocks first: often they already answer the question. To see more of a result, open the shown file at the shown line range instead of finding it again with grep or glob.
- One question per search. If the results are off, rephrase with different terms instead of repeating the same query.
- `-p <path>` limits the search to a directory; the path is relative to the repository root, not to the current directory.

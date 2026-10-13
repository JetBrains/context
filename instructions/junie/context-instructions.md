# Tools

## Semantic Code Search (jbcontext)

`jbcontext search "<query>"` searches the whole repository by meaning and returns the best matching code blocks: file path, line range and the code itself. It is usually the fastest way to find where something is implemented, which code a change affects, and which tests cover it. Use the `/context-search` skill for details.

### When to use

Use it whenever you need code whose location you do not know yet, at any point of the task, not only at the start:

- the implementation of the behaviour described in the issue;
- callers, related implementations, extension points or registrations of the code you are changing;
- existing tests for that code, and examples of similar tests to copy the setup from.

After you have found the code to change, it also answers the questions that decide how to change it — ask them as a sentence, not as a name:

- how the same case is already handled elsewhere: "where failed uploads are retried, the same way downloads are";
- which shared mechanism or utility is behind the behaviour: "which utility normalizes file paths before they are compared";
- which existing test checks a similar behaviour, to copy: "test for the command that renames a branch and updates its upstream".

Prefer it over repeated grep/find rounds and over listing directories. In a large repository a class or message named in the task usually has many usages, look-alikes and test fixtures; a search that combines the name with the described behaviour finds the implementation and its tests faster than grepping the name.

### When not to

- You already know the exact class, method or file name and need its definition or occurrences: use exact search or glob; a bare name is not a jbcontext query.
- Git operations, builds and running tests.
- Do not search again for something you have already found; search again only when a new question comes up. Most tasks need one to four searches.

### How to use it

- Write a full sentence that describes the behaviour, and include the class, method, setting or message names from the task: "where the Gradle sync reports unresolved dependencies to the build tool window".
- Read the returned code blocks first: often they already answer the question, and you can edit or open the exact line range instead of reading whole files.
- One question per search. If the results are off, rephrase with different terms instead of repeating the same query.
- `-p <path>` limits the search to a directory; the path is relative to the repository root, not to the current directory.

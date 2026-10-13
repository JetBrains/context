# Tools

## Semantic Code Search (jbcontext)

`jbcontext search --limit 6 "<question>"` searches the whole repository by meaning and returns the best matching code blocks: file path, line range and the code. Use the `/context-search` skill for details.

### When to use

For questions about behaviour, where you do not know which code is responsible:

- which code implements the behaviour described in the issue;
- which shared mechanism, utility or extension point is behind it;
- where a similar case is already handled, to copy the approach.

### When not to

- Finding a known class, method, field or file by name, its definition or its usages: use grep or glob. jbcontext is not a name lookup.
- Reading code you have already found: open it.
- After you have read the method you are going to change: make the edit first. Search again only if the edit needs something specific you cannot find by name.

### How to use it

- Ask a question of 6–12 words about behaviour, with the names from the task. Never pass a bare identifier.
  - Bad: `jbcontext search "GitBranchRenameHandler"`
  - Good: `jbcontext search --limit 6 "where a renamed branch updates the upstream it tracks"`
- Results are ranked best first. The top results usually contain the answer: open the shown file at the shown line instead of looking for it again with grep or glob.
- If the results are off, ask once more with different terms; do not repeat the same question.
- `-p <dir>` limits the search to a directory relative to the repository root.

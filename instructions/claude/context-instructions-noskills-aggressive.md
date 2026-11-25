# Tools

## Semantic Code Search (jbcontext)

`jbcontext search` is a semantic search CLI (Bash) over this repository's indexed code. It ranks code chunks by how
close their content is in meaning to the query. It does not compute callers, implementations or a call graph.

```bash
jbcontext search "<observed vs. expected behavior> <names from the issue>"
jbcontext search -p <path> "<query>"  # <path> must be relative to the project root
jbcontext search "<behavior> <Name>"; grep -rln "<Name>" .   # rides along with the grep/cat you were going to run
```

### Why it pays off even when the issue names the file

grep, cat and go-to-definition follow links that start at a name: the string, its imports, its calls, its base class.
Part of many fixes has no such link to the named code:
- a sibling implementation with no shared interface, e.g. a per-vendor copy of the same list or rule in another module
- a CI workflow YAML or a gradle convention script that re-checks or sets the same value
- a DTO serialized over the wire, a resource template, a config key read through DI or reflection
None of these import, extend or call the named class, so no chain of grep or cat that starts from the issue's name
reaches them. grep finds them only if you already know a string they share. A search over the issue's behavior can
reach them, because it matches meaning, not links. "I already know the file" tells you where to start reading, not
where the fix ends. Chained into the command you were going to run anyway, one search costs no extra turn. If its
bundle shows only the named file and its tests, the fix is local and you can proceed.

It has no use on tasks that do not involve code: git operations, running builds or tests, shell config, reviewing a
given diff.

### How to use it

- Size of `jbcontext search` result bundle is bounded to at most 5 short code snippets up to 750 chars each, followed by compact one-line `File:` paths, capped at 50 results total and safe to read in full.
- Piping it to `head` cuts off the bare `File:` paths, which is where the disconnected files show up.
- The snippets often go to tests of the named class, because tests share its vocabulary. Run or extend those tests.
  The new information is usually in the bare paths below them.
- A bare path that is not Kotlin/Java source (`.github/workflows/*.yml`, `*.gradle.kts`, `resources/`, `*.api`, docs)
  ranked for your behavior query because its text matches that behavior. For such paths in the top ~15, one command
  settles it: `grep -n "<key literal from the issue>" <those paths>`. A hit means that file is part of the fix, or you
  can see why it is not.
- Bare paths in other modules that share the named code's domain noun (`*Config`, `*Dto`, a sibling `*Provider`):
  open them and check whether they carry the same rule, constant or value.
- A snippet ending in `...` is truncated. The rest of it is at that line of the file.
- The bundle is a ranked sample. A listed file is a lead, and a missing one proves nothing.
- Exhaustive lists are grep's job: every call site of a changed signature, every use of a literal or key.
- A second search suits a separate sub-question, narrowed with `-p <path>` to a module the first bundle pointed at.
- Before finishing, reread the bundle's paths. Tests of the named class passing says nothing about a workflow, a script
  or a sibling module. Does any listed file hold a copy of the rule you just changed?

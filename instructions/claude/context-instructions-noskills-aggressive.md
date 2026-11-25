# Tools

## Semantic Code Search (jbcontext)

`jbcontext search` is a semantic search CLI (Bash) over this repository's indexed code. It ranks code by how close
its content is in meaning to the query. It does not compute callers, implementations or a call graph.

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

### Reading the output and acting on it

- Output is compact (~40-80 lines / ~1k tokens, smaller than one source file), deduplicated and capped. Run it
  unpiped: `head`, `tail` or `grep` drop ranked hits, role descriptors, or `Related tests:`.
- Numbered entries are non-test files, best first: `[role] File: <path> (NL) [used by:/refs:/peers:]`, where
  `[role]` is `[main|data|ci|build|config|schema|docs]` and `(NL)` is total lines, followed by whole matched entity
  spans `Lstart-end: Class > signature` and a 1-line `does:` or `values:` role digest (never raw truncated code).
- `Related tests:` at the bottom lists `[test] <path> (NL) [spans]`. Run or extend those tests; fixes rarely live only there.
- Batch-read suspects on the next turn using the exact sizes and spans: `cat` files under ~150L, `sed -n S,Ep` spans
  of larger ones (`cat A.kt B.kt; sed -n 59,119p C.kt`).
- Check `refs:` / `used by:` callees and short `<= 40L` helpers (parsers, mappers, DTOs, queries) that feed your code:
  their `does:` digest shows what they actually do (vs. what you assume). Fix root causes where they live instead of
  working around a defective callee.
- When the result surfaces `peers:` or parallel per-vendor/per-module copies of the same list, constant or policy
  (`*Countries`, `*Config`, `*Provider`), read all of them in parallel on Turn 2 and update every copy unless the
  issue explicitly restricts scope to one provider.
- Non-source entries (`[ci]`, `[build]`, `[config]`, `[schema]`, `[docs]`) ranked because their text matches your
  behavior. Check their `values:` preview or run `grep -n "<key literal from the issue>" <those paths>` to settle them.
- The result is a ranked sample: absence proves nothing. Exhaustive lists (every call site or use of a key) are grep's
  job. A second search with `-p <path>` suits a separate sub-question.
- Before finishing, reread the listed entries and `peers:`. Unit tests of one class passing says nothing about a
  workflow, a script or a sibling module. Does any listed file hold a copy of the rule you just changed?

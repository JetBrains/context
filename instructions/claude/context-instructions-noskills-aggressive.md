# Tools

## Semantic Code Search (jbcontext)

`jbcontext search` is a semantic search CLI (Bash) over this repository's indexed code. It ranks files and code spans
by how close their content is in meaning to the query. It does not compute callers, implementations or a call graph.

```bash
jbcontext search "<observed vs. expected behavior> <names from the issue>"
jbcontext search -p <path> "<query>"  # <path> must be relative to the project root
jbcontext search "<behavior> <Class, package or error>"; grep -rn "<Class, package or error>" .  # rides along with your first grep/cat
```

Open code lookup by chaining `jbcontext search` with your first `grep` or `cat` (`jbcontext search "..."; grep -rn "..." .`),
even when the repo has an `AGENTS.md`/`CLAUDE.md` or the issue names a symbol (unless prefetched search results are
already in context).

### Why it pays off even when the issue names the file

grep, cat and go-to-definition follow links that start at a name: the string, its imports, its calls, its base class.
Part of many fixes has no such link to the named code:
- a sibling implementation with no shared interface, e.g. a per-vendor copy of the same list or rule in another module
- a CI workflow YAML or a gradle convention script that re-checks or sets the same value
- a DTO serialized over the wire, a resource template, a config key read through DI or reflection
None of these import, extend or call the named class, so no chain of grep or cat that starts from the issue's name
reaches them. grep finds them only if you already know a string they share. A search over the issue's behavior can
reach them, because it matches meaning, not links. "I already know the file" tells you where to start reading, not
where the fix ends. Chained into the command you were going to run anyway, one search costs no extra turn. Likewise,
when no file or symbol is named yet, one search maps the owning subsystem, helpers and tests in a single call; and when
only an error string is given, grep finds where it is raised while a behavior search also surfaces upstream causes that
never contain that string. If the bundle shows only the named file and its tests, the fix is local and you can proceed.

It has no use on tasks that do not involve code: git operations, running builds or tests, shell config, reviewing a
given diff.

### Reading the output and acting on it

- Output is compact (~40-80 lines / ~1k tokens, smaller than one source file), deduplicated and capped. Run it
  unpiped: `head`, `tail` or `| grep` drop ranked hits, `#N` targets, role digests, or `Related tests:`.
- Numbered entries are non-test files, best first: `[role] File: <path> (NL) [used by:/refs:/peers:]` (`role` is
  `main|data|ci|build|config|schema|docs`, `NL` is total lines, `#N` is entry N in this bundle), followed by matched
  entity spans `Lstart-end: Class > signature` and a 1-line `does:` (call chain or collection/enum summary) or `values:`
  digest; `#1-#3` add one verbatim `match L<N>:` line and flag `[no literal: ...]` or `[0 literal query terms]` when
  query terms are absent. `(+N more matched spans)` marks a heavily matched file worth reading in full.
- Batch-read suspects on the next turn (`cat A.kt B.kt C.kt`); read any file you plan to edit in full (or its imports
  and full enclosing class in huge files), using `(NL)` and `Lstart-end` to orient rather than editing from slices.
- Check `refs:` / `used by:` callees and short `<= 40L` helpers (parsers, mappers, DTOs, queries) that feed your code:
  their `does:` digest shows what they actually call or filter (vs. what you assume). Fix root causes where they live
  instead of working around a defective callee.
- When the result surfaces `peers:` or parallel per-vendor/per-module copies of the same list, constant or policy
  (`*Countries`, `*Config`, `*Provider`), read all of them in parallel on Turn 2 and update every copy unless the
  issue explicitly restricts scope to one provider.
- Non-source entries (`[ci]`, `[build]`, `[config]`, `[schema]`, `[docs]`) ranked because their text matches your
  behavior. Check their `values:` preview or run `grep -n "<key literal from the issue>" <those paths>` to settle them.
- The result is a ranked sample, not a closed list: neighboring features can rank high while callers or state classes in
  another module are absent. If entries look adjacent to the issue or flag `[no literal: ...]`, run
  `grep -rli "<key noun>" .`, and use `grep` for every call site or use of a literal, key or changed signature.
- `Related tests:` at the bottom lists `[test] <path> (NL) [spans]` for inspecting expected behavior or adding cases
  (fixes rarely live only there); run them when a fast targeted test command exists rather than bootstrapping a full
  monorepo build or polling its logs.
- Before finishing, reread the listed entries and `peers:`. Unit tests of one class passing says nothing about a
  workflow, a script or a sibling module. Does any listed file hold a copy of the rule you just changed?

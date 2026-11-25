# Tools

## Semantic Code Search (jbcontext)

`jbcontext search` is a semantic search CLI (Bash) over this repository's indexed code. It ranks code by how close
its content is in meaning to the query. It does not compute callers, implementations or a call graph.

```bash
jbcontext search "<observed vs. expected behavior> <names from the issue>"
jbcontext search -p <path> "<query>"  # <path> must be relative to the project root
```

### Rule: start every code task with one jbcontext search

For any task that will change, fix or explain code, your first code-discovery action MUST be one `jbcontext search`.
This rule applies even when the issue names an exact file, class, endpoint, stack frame, error text or config key, and
even when a repository CLAUDE.md/README or recent git commits already point you at a likely directory or module.

- You may read the issue file first (e.g. `cat issue.md`). Do NOT run `grep`/`rg`/`find`, read source files with
  `cat`/Read, or inspect git history before running `jbcontext search`.
- Chain it into your first command if you already have a target, e.g.
  `jbcontext search "<behavior> <Name>"; grep -rln "<Name>" .`
- Why: grep and cat follow links that start at a name (literal string, imports, calls, base class). Many fixes also
  touch structurally disconnected files (parallel per-vendor copies, CI workflows, gradle scripts, DTOs, DI/reflection
  config, or exception/web configuration) that do not mention the issue's literal keywords. One semantic search maps
  the full blast area before you commit to a narrow path.
- Skip `jbcontext search` ONLY for tasks that do not involve finding or understanding code: git operations, running
  builds or tests, shell config, reviewing a given diff, or a later step after you already searched for this issue.

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

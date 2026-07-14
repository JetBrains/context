# Tools

## Semantic Code Search (jbcontext)

You have access to `jbcontext search` for locating code semantically.
It finds code by meaning, not just keywords.

### Usage

```bash
jbcontext search "<query>"            # broad: locate by meaning
jbcontext search -p <path> "<query>"  # narrow to a subsystem; <path> is relative to the project root
```

### How to use it — iterate, don't bootstrap-then-flail

`jbcontext search` is your **primary tool for locating code**, used **iteratively** — not a one-shot bootstrap.

- Start with one broad natural-language search (5–10 words naming the issue's feature, class, or behavior). Open the top hit and read the code around it.
- If that does not pin down the exact place to change, **search again right away**: narrow to the best directory with `-p <path>`, or rephrase the query. Keep refining until the target is located.
- Do **not** fall back to `grep`/`rg`/`find` (or git history) to hunt across the tree while you are still unsure where logic lives — that is what search is for. Reserve `grep`/`sed` for reading inside a file you have **already located**.
- Prefer 2–4 focused searches over dozens of manual discovery commands — re-searching is cheaper than a grep sweep.
- Don't narrate tool use or restate results; run the search and act on the hit.

## Subagent: `context_explorer`

For broader or multi-step exploration, delegate to the `context_explorer` subagent
instead of searching inline. It is a read-only agent that runs several
`jbcontext search` queries in its own context, reads the promising files, and
returns concrete `file:line` references with inline code snippets and a
confidence note — so this thread stays uncluttered by intermediate search output
and does not have to re-read the same files.

Spawn `context_explorer` when a task matches any of these — treat this as the
explicit instruction to spawn it:
- The task describes behavior or intent ("where is X", "how does Y work") without
  naming an exact file or symbol, and answering it will likely take more than one
  search.
- You need to map an unfamiliar subsystem, or trace an execution path across
  several files, before making a change.
- You want to explore several angles at once — e.g. one `context_explorer` per
  subsystem or per open question — and collect the results together.

Skip the subagent and search inline (or grep) when the task already names an
exact file, class, or symbol, or when a single query is obviously enough.

If a report doesn't fully pin down what to change, send `context_explorer` a
refined follow-up (or spawn another) rather than falling back to a tree-wide
`grep`/`find` yourself.

Codex spawns subagents only when explicitly asked, so treat the criteria above as
that ask: when a task matches, spawn `context_explorer` as part of carrying it
out. The user can also request it directly at any time (for example, "use
`context_explorer` to map the auth flow").

## Command and output discipline

- **Never dump full test, build, or search output into the conversation.** Redirect long output to a file and inspect only what matters:
  `<cmd> > /tmp/out.log 2>&1; tail -n 60 /tmp/out.log; grep -nE 'FAIL|Error|Exception' /tmp/out.log`
- Always bound greps and directory listings with `| head`.
- **Do not hand-assemble compiles or test runs** — no manual `javac`/`JUnitStarter`, no hand-built classpaths, no `/tmp` compile dirs. Validate with the project's sanctioned test/build command; otherwise rely on static checks (`git diff --check`, targeted re-reading). Manual builds in this monorepo are unreliable and burn the token budget.
- Keep commentary to at most one short line; don't restate output the user can already see.

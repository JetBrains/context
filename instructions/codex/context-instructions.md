# Tools

## Semantic Code Search (jbcontext)

You have access to `jbcontext search` for searching the codebase semantically.
Use the `/context-search` skill or run `jbcontext search "<query>"` to find code by meaning, not just keywords.

### When to use

`jbcontext search` is a **code-discovery** tool. Reach for it only when a task requires finding or understanding code whose location you don't already know.

Skip it — go straight to the right tool — when:
- the task names the exact file, class, or symbol (keyword grep is faster);
- the relevant file is already open or identified;
- the task doesn't involve locating code at all — git operations (rebase, merge, commit), running tests or builds, shell/statusline/config setup, or reviewing a diff you already have.

### How to use it — iterate, don't bootstrap-then-flail

`jbcontext search` is your **primary tool for locating code**, used **iteratively** — not a one-shot bootstrap.

- Start with one broad natural-language search for the issue's named feature, class, or behavior. Open the top hit and read the code around it.
- If that does not pin down the exact place to change, **search again right away**: narrow to the best directory with `-p <path>`, or rephrase the query. Keep refining until the target is located.
- Do **not** fall back to `grep`/`rg`/`find` (or git history) to hunt across the tree while you are still unsure where logic lives — that is what search is for. Reserve `grep`/`sed` for reading inside a file you have **already located**.
- Prefer 2–4 focused searches over dozens of manual discovery commands — re-searching is cheaper than a grep sweep.
- Keep queries short (5–10 words naming the feature or behavior). Don't narrate tool use or restate results; run the search and act on the hit.

## Command and output discipline

- **Never dump full test, build, or search output into the conversation.** Redirect long output to a file and inspect only what matters:
  `<cmd> > /tmp/out.log 2>&1; tail -n 60 /tmp/out.log; grep -nE 'FAIL|Error|Exception' /tmp/out.log`
- Always bound greps and directory listings with `| head`.
- **Do not hand-assemble compiles or test runs** — no manual `javac`/`JUnitStarter`, no hand-built classpaths, no `/tmp` compile dirs. Validate with the project's sanctioned test/build command; otherwise rely on static checks (`git diff --check`, targeted re-reading). Manual builds in this monorepo are unreliable and burn the token budget.
- Keep commentary to at most one short line; don't restate output the user can already see.

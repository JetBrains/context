# Tools

## Semantic Code Search (jbcontext)

You have access to `jbcontext search` for searching the codebase semantically.
It finds code by meaning, not just keywords.

### Usage

```bash
jbcontext search "<detailed and descriptive query>"
jbcontext search -p <path> "<query>"  # <path> must be relative to the project root
```

### Query Tips

- Be descriptive: "Where is a function that validates user email addresses" > "email"
- Include context: "Find error handling middleware for HTTP requests with logging"
- Specify what you're looking for: "React component that renders a modal dialog"

### How to use it

- Start with `jbcontext search` before planning, editing, or exact search in unfamiliar code when you do not yet know the right file, subsystem, implementation, or related test.
- Use one focused natural-language query per search.
- Do not start with grep, ripgrep, or find when the search problem is still semantic or exploratory.
- Once you get a relevant hit, switch to direct file reads, and follow a symbol with the IDE CLI. If the first search did not locate the code, run one follow-up search yourself - narrowed with `-p <directory of the best hit>` or reworded in code terms - before considering `context_explorer`.

### With the IDE CLI (`ide`)

The IDE CLI is installed too; its session note lists its commands and flags. It resolves real symbols, while `jbcontext search` finds code by meaning. Pick the tool by what you already know:

- Only a behavior or concept, location unknown -> `jbcontext search`, then `context_explorer` as below.
- A class or symbol name, from the task or a search hit, and you need where it is declared or used -> `ide usages` (declaration, usages and text mentions in one call), `ide references` or `ide implementations` (callers, overrides), `ide definition` (its code). Do not spawn `context_explorer` for these.
- Literal text - strings, log messages, config keys, file names - or several patterns at once -> `rg`/`grep`/`find`.
- After editing -> `ide diagnostics` on the touched files. It does not replace the build or the tests.

Ask each question once, with the tool that fits it: do not re-run a `jbcontext search` hit through `ide workspace-symbols`, or an `ide usages` result through grep. If `ide` is not found, answers "warming up", or reports that the project import failed, use `rg`/`grep` for that step; `jbcontext search` does not need the IDE CLI's project model.

## Subagent: `context_explorer`

For broader or multi-step exploration that your own searches did not resolve,
delegate to the `context_explorer` subagent. It is a read-only agent that runs several
`jbcontext search` queries in its own context, reads the promising files, and
returns concrete `file:line` references with inline code snippets and a
confidence note - so this thread stays uncluttered by intermediate search output
and does not have to re-read the same files.

### How to spawn it

- Spawn it with: `spawn_agent(agent_type="context_explorer", fork_turns="none", message="<intent>")`
- `spawn_agent` runs in the background - you can read a file you already know is relevant, check the environment, but don't perform exploration while it's running.
- Always call `wait_agent` once that known work (if any) is done, otherwise you never get the report.
- Use its snippets directly: re-open a file it quoted only for lines it did not show.


## When to use `jbcontext search` CLI vs. `context_explorer` subagent

Spawning `context_explorer` blocks you until its report arrives, so search
yourself first. Spawn it only when your own two searches did not locate the
code, or when the task clearly spans several separate areas you have not
located yet. Never spawn it once a search hit already names the code to change.

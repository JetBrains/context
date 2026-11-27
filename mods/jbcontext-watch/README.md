# jbcontext-watch

A Claude Code mod that shows what `jbcontext` is doing in the repository you are working in:

- **Status line under the prompt, always**: whether search can use the remote index, and, once a turn has been measured in a session that used jbcontext, how much of the session's exploring went through it: `jbcontext · remote index ✓ · session: 4% of exploring via jbcontext`. The index is `✓` whichever commit's snapshot search answers from, HEAD's or an older one, or another branch's; a repository with none reads `jbcontext ✗ repository not indexed`, and a failure `jbcontext ✗ <reason>`.
- **Spinner, while a jbcontext call runs**: what it searches for, `Searching jbcontext: "where is the stats writer"…`, then for a few seconds how it went, `jbcontext: 12 hits in 1.4s`.
- **Band above the prompt, while Claude works**: once the turn called jbcontext, its exploration so far, `this turn: 14 exploration calls · 2 via jbcontext (12 hits)`, or `indexing...` while Claude runs `jbcontext index`; ``no snapshots for this repository; run `jbcontext index` `` or why the index can't be read; and any error from the last hour. Nothing while there is none of these.
- **Under a jbcontext search's row, once its hits are used**: what the search achieved, filled in as Claude reads and edits the files it found: `↳ found after 3 empty greps · exact lines · 2 files changed`. While Claude works, the band sums up the turn: `jbcontext delivered: 1 found after empty greps · 2 at the exact lines`. The effects, each credited only once a hit's file is read or edited after the search:
  - **found after empty greps**: local searches (grep, rg, find, git grep) came up empty before the search found the file;
  - **found by meaning, not by name**: no word of the query is in the file's path or snippet;
  - **exact lines**: a partial read or an edit landed within 10 lines of a hit;
  - **files changed**: two or more of the search's files got edited.

  The first two go only to the first search of the turn that listed the file, when the turn had not met it in a grep's output, a read or an edit before. Each day's totals are kept per repository in the mod's store (`effects:<repository>`).
- **A line beneath the answer, when Claude finishes a turn that called jbcontext**: the session's jbcontext calls so far, their share of its exploring tokens, and those tokens and time. Subagents count. The last such line stands as the session's summary once it ends:

  ```
  jbcontext · 2 calls, 4% of this session’s exploring tokens (8.1M in 51s)
  ```
- **`/jbcontext` pane**: the remote index's snapshots told against HEAD, `HEAD 1a2b3c4d of main indexed 2h ago` or `HEAD 5e6f7a8b not indexed; newest snapshot of main: 1a2b3c4d, 2h ago`, the same figures for this session with their cost, today's exploration in this repository's Claude sessions with the estimated tokens and $ saved by jbcontext, and the latest searches and errors, filtered to this repository.

The index status is the remote index's alone: the snapshots `jbcontext index` uploaded (kept on this machine instead with `runtime.storage local`, and then called the on-device index). Search also covers commits not indexed yet and uncommitted edits through the local overlay that `jbcontext watch` keeps, which `jbcontext status --json-output` does not report yet, so a snapshot of another commit is shown as a fact, not a warning.

| Command | Does |
|---|---|
| `/jbcontext` | Opens the pane, or closes it when open |
| `/jbcontext close` | Closes the pane (also ctrl+x x) |
| `/jbcontext band` | Hides or shows the band |

## Where the data comes from

- Searches and errors: the CLI's local stats files, `$JBCONTEXT_HOME/stats/YYYY-MM-DD.json` (default `~/.jbcontext`), last 7 days. A search or error belongs to this repository when its recorded repository URL matches, or, when it records none, when it ran inside the session's directory. An error that records neither a repository nor a directory (an expired token, say) shows in every repository.
- Index status: `git rev-parse` and `jbcontext status --json-output`, at session start, every 2 minutes, and after `jbcontext index`.
- The turn's exploration: its tool calls as each ends, subagents' included; one refused never ran and does not count. An exploration call is a Read, Grep, Glob, LS, NotebookRead or LSP call, a shell command led by a read-only one (`grep`, `rg`, `find`, `ls`, `cat`, `head`, `sed -n`, `git log`/`show`/`grep`/`blame`, ...), or a jbcontext call: a jbcontext MCP tool or a shell `jbcontext search`/`repos`. A jbcontext call's hits and time come from the search event it writes to the stats files.
- This session, at the end of each turn once the session's transcripts show a jbcontext call (or while the pane is open): `jbcontext analyze --projects-dir <dir> --agent claude --min-tool-calls 0 --json-output`, `<dir>` a folder under `$TMPDIR/jbcontext-watch/` linking this session's transcript and each of its subagents' (as sessions of their own, the only way the CLI counts a subagent's tokens). Exploring tokens, time and cost are the CLI's Exploring phase; the session's cost is all its phases. The jbcontext part is the tokens billed for the responses that called a jbcontext MCP tool or ran `jbcontext search`/`repos` in a shell, a response that also called other tools split evenly among its calls: the same way the CLI bills a response to the phase of its tool calls.
- Savings: `jbcontext analyze --status --transcript <file> --json-output` for each of today's Claude transcripts of this directory (and `.claude/worktrees/*` under it), while the pane is open. Saved tokens count only sessions that used jbcontext and that the CLI has an eval-backed reduction for; the $ figure uses the Exploring-phase price from `jbcontext analyze --json-output`, taken once a day, and retried hourly when that run fails. A blended price across all agents and models: an estimate, not a bill.

Nothing leaves the machine beyond what `jbcontext` itself does.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install jbcontext-watch --marketplace JetBrains/context
```

Answer `y` to add the marketplace, then pick the user scope to load it in every session.

To run a local checkout for one session instead:

```bash
claude --plugin-dir /path/to/context/mods/jbcontext-watch
```

## Develop

```bash
claude plugin validate mods/jbcontext-watch
claude plugin test mods/jbcontext-watch
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code writes (git-ignored) each time it loads the mod.

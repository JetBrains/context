# jbcontext-watch

A Claude Code mod that shows what `jbcontext` is doing in the repository you are working in:

- **Status line under the prompt, always**: the index of the current branch, and once a turn has been measured, how much of the session's exploring went through jbcontext: `jbcontext ✓ main indexed · session: 4% of exploring via jbcontext`.
- **Spinner, while a jbcontext call runs**: what it searches for, `Searching jbcontext: "where is the stats writer"…`, then for a few seconds how it went, `jbcontext: 12 hits in 1.4s`.
- **Band above the prompt, while Claude works**: the turn's exploration so far, `this turn: 14 exploration calls · 2 via jbcontext (12 hits)`; a yellow nudge after 6 greps and reads in a row without jbcontext in an indexed repository; the index when it is not current (stale, missing, or `indexing...` while Claude runs `jbcontext index`); and any error from the last hour. Nothing while there is none of these.
- **A line beneath the answer, when Claude finishes a turn that explored**: this session's exploration so far (tokens, time, cost and its share of the session's cost) and how much of it went to jbcontext (calls, and their share of the exploring tokens). Subagents count. The last such line stands as the session's summary once it ends:

  ```
  jbcontext · this session explored 8.1M tokens in 51s, ≈$7.98 (73% of $11) · jbcontext 2 calls, 4% of exploring tokens
  ```
- **`/jbcontext` pane**: the index status, the same figures for this session, today's exploration in this repository's Claude sessions with the estimated tokens and $ saved by jbcontext, and the latest searches and errors, filtered to this repository.

| Command | Does |
|---|---|
| `/jbcontext` | Opens the pane, or closes it when open |
| `/jbcontext close` | Closes the pane (also ctrl+x x) |
| `/jbcontext band` | Hides or shows the band |

## Where the data comes from

- Searches and errors: the CLI's local stats files, `$JBCONTEXT_HOME/stats/YYYY-MM-DD.json` (default `~/.jbcontext`), last 7 days. A search or error belongs to this repository when its recorded repository URL matches, or, when it records none, when it ran inside the session's directory. An error that records neither a repository nor a directory (an expired token, say) shows in every repository.
- Index status: `git rev-parse` and `jbcontext status --json-output`, at session start, every 2 minutes, and after `jbcontext index`.
- The turn's exploration: its tool calls as they run, subagents' included. An exploration call is a Read, Grep, Glob, LS, NotebookRead or LSP call, a shell command led by a read-only one (`grep`, `rg`, `find`, `ls`, `cat`, `head`, `sed -n`, `git log`/`show`/`grep`/`blame`, ...), or a jbcontext call: a jbcontext MCP tool or a shell `jbcontext search`/`repos`. A jbcontext call's hits and time come from the search event it writes to the stats files.
- This session: `jbcontext analyze --projects-dir <dir> --agent claude --min-tool-calls 0 --json-output`, `<dir>` a folder under `$TMPDIR/jbcontext-watch/` linking this session's transcript and each of its subagents' (as sessions of their own, the only way the CLI counts a subagent's tokens). Exploring tokens, time and cost are the CLI's Exploring phase; the session's cost is all its phases. The jbcontext part is the tokens billed for the responses that called a jbcontext MCP tool or ran `jbcontext search`/`repos` in a shell, a response that also called other tools split evenly among its calls: the same way the CLI bills a response to the phase of its tool calls.
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

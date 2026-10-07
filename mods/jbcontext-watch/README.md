# jbcontext-watch

A Claude Code mod that shows what `jbcontext` is doing in the repository you are working in:

- **Band above the prompt, while Claude works**: the index status of the current branch (HEAD indexed, stale, missing, or `indexing...` while Claude runs `jbcontext index`), and this repository's latest search and any error from the last hour, in a dim frame.
- **`/jbcontext` pane**: the index status, today's exploration in this repository's Claude sessions with the estimated tokens and $ saved by jbcontext, and the latest searches and errors, filtered to this repository.

| Command | Does |
|---|---|
| `/jbcontext` | Opens the pane, or closes it when open |
| `/jbcontext close` | Closes the pane (also ctrl+x x) |
| `/jbcontext band` | Hides or shows the band |

## Where the data comes from

- Searches and errors: the CLI's local stats files, `$JBCONTEXT_HOME/stats/YYYY-MM-DD.json` (default `~/.jbcontext`), last 7 days. A search or error belongs to this repository when its recorded repository URL matches, or, when it records none, when it ran inside the session's directory. An error that records neither a repository nor a directory (an expired token, say) shows in every repository.
- Index status: `git rev-parse` and `jbcontext status --json-output`, at session start, every 2 minutes, and after `jbcontext index`.
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

# Single-query Claude Code benchmark

`single-query-bench-claude.sh` (macOS/Linux) and `single-query-bench-claude.ps1` (Windows)
measure the **cost and latency of one query in the interactive Claude Code TUI, with vs.
without JetBrains Context**, in the **warm** steady state a real ongoing session experiences.

## What it does

For each of the two legs — **with** JetBrains Context and **without** — the script:

1. Runs a throwaway **warm-up** TUI session (you type `hi`, `/exit`) that writes Claude Code's
   tools + system prompt prefix into the server-side prompt cache.
2. Runs the **measured** TUI session (you paste the query, do **one** turn, `/exit`), which
   reads that prefix **warm**.

Because the measured session is separate and single-turn, its official cost is the warm cost
of just that query. Both legs are warmed the same way, so the comparison is apples-to-apples.

Metrics are read straight from Claude Code's own records — **no manual pricing**:

- `Cost` / `Wall` / `API` — `lastCost` / `lastDuration` / `lastAPIDuration` from `~/.claude.json`.
- `WarmRead` — `cache_read` on the measured session's first call (from the session transcript).
  `>0` confirms the warm-up worked; `0` means the leg ran cold — re-run it.

Prompt caching is enabled for the run and the original environment is restored on exit.

After the summary the script also writes an **HTML trajectory diff** of the two measured
sessions — see [Trajectory diff report](#trajectory-diff-report).

## Prerequisites

- `claude` (Claude Code CLI) and `jbcontext` on `PATH`.
- **`.sh`**: `bash` + `python3` (reads `~/.claude.json`), and a clipboard tool
  (`pbcopy` / `wl-copy` / `xclip` / `xsel`).
- **`.ps1`**: Windows PowerShell 5.1 or PowerShell 7+. The trajectory diff additionally needs
  Python 3 on `PATH`; without it the benchmark still runs and only the report is skipped.

## Repository & query recommendations

The benchmark is most meaningful when JetBrains Context has real work to do, so context
retrieval measurably changes the answer's cost and quality.

- **Repo size:** prefer a **medium or large codebase — at least ~50K LOC**. On tiny repos the model can
  hold everything in context and JetBrains Context adds little, so the with/without difference
  is noise.
- **Pre-index first:** index the repo before benchmarking so semantic search is warm and the
  results are stable:

  ```bash
  jbcontext index          # run in the repo root; check index availability with: jbcontext status
  ```

- **Query type:** use **semantic "how is X implemented?" questions** — where the answer lives
  in code you'd normally have to hunt for, not something answerable from a file name. For an
  e-commerce project, for example:

  > how is order total amount calculation implemented?

  These exercise semantic retrieval; keyword-trivial or purely conversational prompts won't
  show a representative difference.

## Usage

```bash
# macOS / Linux
./single-query-bench-claude.sh [--model <id>] [--no-report] [--report-out <file>] ["your query"]
```

```powershell
# Windows
./single-query-bench-claude.ps1 [-Model <id>] [-NoReport] [-ReportOut <file>] [-Prompt "your query"]
```

- By default no `--model` is passed, so Claude Code uses its own default model (your `/model`
  setting). Pass `--model` / `-Model` to benchmark a specific one. If the query is omitted,
  you're prompted for it.
- Follow the on-screen steps. Before each Claude launch the script pauses for a keypress so
  you can read the instructions; the TUI then takes over the terminal.
- **In the measured session, do exactly ONE turn** (paste query → wait → `/exit`), or the
  reported cost will include the extra turns.

## Example output

```
==== Summary (warm query turn, official cost) ====
Run                                    Cost USD      Wall       API   WarmRead
Run Claude with JetBrains Context        0.0421     00:34     00:22      24118
Run Claude without JetBrains Context     0.0298     00:25     00:15      24051
```

## Trajectory diff report

The four numbers say *that* the legs differ; the report shows *why*. `trajectory_report.py`
(Python 3, standard library only) reads the two measured sessions' transcripts from
`~/.claude/projects` — including the transcript of any subagent a session started — and writes
one self-contained HTML file (no network, light and dark mode):

- **Both runs on one time axis** — one lane per agent thread, one block per operation, coloured
  by kind: semantic retrieval, keyword search & listing (`rg`, `grep`, `find`, `ls`, the Grep
  and Glob tools), file reads, delegation, replies. Dead ends (no results, denied, failed) are
  hatched. A marker shows when each run first read the same file.
- **Where the agent time went** — agent-seconds per kind of work, with reading split into
  files both runs read and files only one run read.
- **Step-by-step diff** — the two step lists aligned like a code diff (locate step beside
  locate step, read beside a read of the same file), so the searches one run needed and the
  other did not stand out as rows with an empty counterpart. Each step expands to the command
  and the start of its output.
- **Files the runs read** — when each file was read and which earlier step first named it.

The benchmark prints the path when it finishes (by default a file under the temp folder;
`--report-out` / `-ReportOut` chooses it, `--no-report` / `-NoReport` skips it). It can also be
run on its own for any two past sessions, by id or transcript path:

```bash
python3 trajectory_report.py --with <session-id> --without <session-id> [--out report.html] [--open]
```

How to read it:

- A model call plus the tools it ran is one round; its time is split evenly among its
  operations, and a shell call that chains several commands counts as one operation per
  command. A grep inside a named file counts as reading that file, not as a search.
- Cost, wall and API time are Claude Code's own figures; every other number is measured from
  the transcript timestamps. Time spent waiting for the user is left out.
- One query run once per leg is an illustration, not an average. The two runs rarely do
  identical work, so the report separates search overhead from extra reading rather than
  calling the whole gap waste.
- The report quotes commands, file paths and the first lines of tool output from the
  benchmarked repository. `--no-previews` leaves the output and full commands out; check the
  file before sharing it outside the team.

## Notes

- Two warm-ups (one per leg) are required: `jbcontext setup-agent` adds MCP tools and
  instructions, so the two legs have different cached prefixes and each must be warmed
  under its own configuration.
- The legs are isolated by a unique per-run marker (`--append-system-prompt`), so no waiting
  for cache TTL expiry is needed.

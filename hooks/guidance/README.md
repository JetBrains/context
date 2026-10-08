# Structural-guidance router (Claude Code hooks)

Routes the agent's search calls to one of the nodes in `guidance/search-call/`
(`regular-search`, `jbcontext-search`, `context-explorer`) and delivers that
node's guidance at the moment of the call. Node definitions and decision rules:
`guidance/README.md`.

`guidance_hook.py` is one Python 3 (stdlib only) script with three entry points:

| Hook | Command | Does |
|---|---|---|
| `PreToolUse` (all tools) | `guidance_hook.py pre` | Tracks exploration episodes, classifies, allows or denies the pending call with guidance |
| `PostToolUse` (`Agent`) | `guidance_hook.py post` | After `context-explorer`: counts the run, ends the episode, attaches `result-instruction.md` |
| `UserPromptSubmit` | `guidance_hook.py prompt` | Resets the state for the new task |

## How it decides

1. **Episode.** A run of consecutive exploration calls; a non-exploration call
   (Edit/Write, or a Bash command that is not search/read - tests, builds, git
   writes) ends it. Bookkeeping tools (TodoWrite, ToolSearch, other subagents)
   neither start nor end an episode. A new user prompt and a finished
   `context-explorer` also end it.
2. **Routable calls.**
   - `regular-search`: `Grep`; Bash `rg`/`grep`/`find`/`fd`/`git grep`; built-in `Explore` subagent.
   - `jbcontext-search`: `jbcontext search` (CLI), `mcp__jbcontext*` tools, the `context-search` skill.
   - `context-explorer`: the `context-explorer` subagent.

   Reads (`Read`, `Glob`, `cat`, `sed`, `ls`, `git log`, pipe filters like `cmd | grep x`) are never routed.
3. **Pre-filter.** A regular search is allowed without the classifier, and is
   never denied, when it is an exact search by itself:
   - **Narrow or meta path:** every path is a file or a directory with 2+
     segments, or a meta location (`/tmp`, `build/`, `*.log`, ...).
   - **Established name:** an identifier in the search pattern (CamelCase,
     snake_case, SCREAMING_CASE, with digits; plain words like `retry` do not
     count) already appears in the session's user prompts or tool results
     (files read, search output, explorer reports). Matching ignores case and
     `_`/`-`. The agent's own reasoning and tool inputs do not count, so a
     guessed name does not confirm itself.

   This applies to every regular search, also after the episode has a decision.
   Only the pattern is used here; it is never sent to the classifier.
4. **Classify once per episode.** The first routable call that passes the
   pre-filter asks the classifier (Claude Haiku by default, or Jev) to pick one of the three
   `description.md` files. The state comes from `transcript_path`: the last
   `GUIDANCE_RECENT_STEPS` tool calls with their results, the agent's reasoning
   between them (visible text, and thinking text when the transcript keeps it),
   the two reasoning entries just before that window, and the user prompt while
   it is within the window. The pending call itself (tool and arguments, from
   stdin) is not sent, so the classifier judges the agent's intent instead of
   ratifying its choice; a lagging transcript copy of the pending call is
   dropped for the same reason. The argmax wins. The decision is reused for the
   rest of the episode.
5. **Compare** the winning node with the pending call:
   - Match: allow. For `jbcontext-search` the first matching call also gets
     `instruction.md` (or `instruction-mcp.md`) as `additionalContext`.
   - Mismatch, but the winner's confidence (its probability renormalized over
     the nodes still allowed) is below `GUIDANCE_DENY_MIN_PROB`: allow.
   - Mismatch, decision not yet followed in this episode: deny once, with the
     winning node's guidance as the reason.
   - Mismatch after that deny: allow and log `noncompliant`.
   - Mismatch after the decision was already followed: allow (follow-up, e.g.
     grep on a name that semantic search returned).
6. **Explorer.** An allowed `context-explorer` spawn is forced to the
   foreground (`run_in_background: false`). At most
   `GUIDANCE_MAX_EXPLORER_RUNS` (default 1) runs per task; after that the
   explorer is dropped from the argmax and new spawns are denied.

Fail open: a missing key, network error, timeout, bad response, or any
exception allows the call. A classifier failure leaves the whole episode unrouted.

Not routed inside subagents: when the hook input has `agent_id`/`agent_type`,
the call goes through untouched.

## Install (Claude Code)

### With the jbcontext CLI (shipped runtime)

The router is ported into the jbcontext CLI as `jbcontext hook <event> --mode guidance`,
a native binary with no python3 dependency. The node files are bundled from this repo's
`guidance/` dir. On Claude, `setup-agent --auto` installs it by default:

```bash
jbcontext setup-agent --agent claude --auto                # router on
jbcontext setup-agent --agent claude --auto --no-guidance  # baseline arm: router off
```

This writes three entries into `settings.json`:
- `PreToolUse` `*` -> `jbcontext hook pre-tool-use --mode guidance`
- `PostToolUse` `Agent|Task` -> `jbcontext hook post-tool-use --mode guidance`
- `UserPromptSubmit` -> `jbcontext hook user-prompt-submit --mode guidance`

The CLI port reads the same `GUIDANCE_*` variables (table below). Its default state
and log dirs are `~/.jbcontext/guidance/{state,logs}`. `GUIDANCE_DISABLED=1` turns an
installed router off.

Both implementations must pass `parity_cases.json` (see Tests).

### Manual (this Python script)

`.claude/settings.json` (project) or `~/.claude/settings.json` (user); use the
absolute path of this repo checkout:

```json
{
  "hooks": {
    "PreToolUse": [
      {"matcher": "*", "hooks": [{"type": "command", "command": "python3 /path/to/context/hooks/guidance/guidance_hook.py pre", "timeout": 30}]}
    ],
    "PostToolUse": [
      {"matcher": "Agent|Task", "hooks": [{"type": "command", "command": "python3 /path/to/context/hooks/guidance/guidance_hook.py post"}]}
    ],
    "UserPromptSubmit": [
      {"hooks": [{"type": "command", "command": "python3 /path/to/context/hooks/guidance/guidance_hook.py prompt"}]}
    ]
  }
}
```

Keep the hook `timeout` above `GUIDANCE_JEV_TIMEOUT`.

## Configuration (environment)

| Variable | Default | |
|---|---|---|
| `GUIDANCE_CLASSIFIER` | `haiku` | `haiku` (Anthropic Messages API, one forced `route` tool call) or `jev` |
| `GUIDANCE_ANTHROPIC_API_KEY` | - | Haiku key; falls back to `ANTHROPIC_API_KEY`, then `ANTHROPIC_AUTH_TOKEN` (Bearer). In an eval pod these are the agent's own credentials |
| `GUIDANCE_ANTHROPIC_BASE_URL` | `ANTHROPIC_BASE_URL`, else `https://api.anthropic.com` | |
| `GUIDANCE_ANTHROPIC_MODEL` | `claude-haiku-5-5` | |
| `GUIDANCE_CLASSIFIER_TIMEOUT` | `GUIDANCE_JEV_TIMEOUT` | seconds, either classifier |
| `TYPESAFE_API_KEY` | - | Jev API key; falls back to `~/.config/jev/api-key` |
| `GUIDANCE_JEV_MODEL` | `jev-latest` | |
| `GUIDANCE_JEV_URL` | `https://api.typesafe.ai/v1/systemone` | |
| `GUIDANCE_JEV_TIMEOUT` | `10` | seconds |
| `GUIDANCE_MAX_EXPLORER_RUNS` | `1` | per task |
| `GUIDANCE_DENY_MIN_PROB` | `0.75` | minimum winner confidence to deny a mismatching call |
| `GUIDANCE_RECENT_STEPS` | `10` | tool calls (plus the reasoning between them) sent to the classifier |
| `GUIDANCE_DIR` | `<repo>/guidance` | node files |
| `GUIDANCE_STATE_DIR` | `~/.claude/guidance/state` | per-session state + lock |
| `GUIDANCE_LOG_DIR` | `~/.claude/guidance/logs` | per-session JSONL log |
| `GUIDANCE_DISABLED` | - | `1` turns the router off |
| `GUIDANCE_FAKE_PROBS` | - | JSON `{node: p}` instead of calling the classifier (tests, dry runs) |

The jbcontext guidance uses `instruction-mcp.md` once the session has made an
`mcp__jbcontext*` call, `instruction.md` (CLI) otherwise.

## Log

`<GUIDANCE_LOG_DIR>/<session_id>.jsonl`, one event per line:
`skip` (pre-filter: `path` or `established:<names>`), `classify` (probabilities,
decision, confidence, latency; for a live call also `classifier`, `model` and token `usage`), `classifier_error`, `allow` (with `low_confidence`
when below the threshold),
`deny`, `noncompliant`, `episode_end`, `explorer_done`, `prompt_reset`
(with per-task counters: classifications, classifier_errors, denies, noncompliant).

## Tests

```bash
python3 hooks/guidance/test_guidance_hook.py
```

The tests use a fake classifier, an isolated `HOME`, empty keys and unroutable URLs; they never call
Haiku or Jev.

### Parity with the CLI port

`parity_cases.json` holds the inputs and outputs that both implementations replay:
- flows of hook calls with their outputs and log events;
- tables for the pure functions (categorize, pre-filter, paths, patterns, anchors,
  transcript reading, classifier state, winner).

The inputs live in `parity_cases.py`; the expected values are recorded from this script.

```bash
python3 hooks/guidance/parity_cases.py --write   # after changing guidance_hook.py or a node file
python3 hooks/guidance/parity_cases.py --check   # also run by test_guidance_hook.py
```

The CLI test `GuidanceParityTest` replays the same file against the Kotlin port.

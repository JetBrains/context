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
3. **Classify once per episode.** The first routable call of an episode asks
   the classifier (Claude Haiku by default, or Jev) to select one of the
   `description.md` files; there is no rule-based pre-filter. The state comes
   from `transcript_path`: the last `GUIDANCE_RECENT_STEPS` tool calls with
   their results, the agent's reasoning between them (visible text, and
   thinking text when the transcript keeps it), the two reasoning entries just
   before that window, and the user prompt while it is within the window. The
   pending call (tool and arguments, from stdin) is sent once, as
   `pending_call`; a lagging transcript copy of it is dropped from the steps.
   The instructions tell the classifier to judge the target rather than ratify
   the agent's choice of tool: a search for a name, path, or literal that the
   user gave or the session established is exact (`regular-search`).
   - **Haiku** answers with one forced `route` tool call, `{reason, node}`,
     where `node` is an enum of the allowed nodes; the reason comes first.
   - **Jev** answers with probabilities; its most probable allowed node is taken.

   The decision is reused for the rest of the episode.
4. **Compare** the selected node with the pending call:
   - Match: allow. For `jbcontext-search` the first matching call also gets
     `instruction.md` (or `instruction-mcp.md`) as `additionalContext`.
   - Mismatch, decision not yet followed in this episode: deny once, with the
     selected node's guidance as the reason.
   - Mismatch after that deny: allow and log `noncompliant`.
   - Mismatch after the decision was already followed: allow (follow-up, e.g.
     grep on a name that semantic search returned).
5. **Explorer.** An allowed `context-explorer` spawn is forced to the
   foreground (`run_in_background: false`). At most
   `GUIDANCE_MAX_EXPLORER_RUNS` (default 1) runs per task; after that the
   explorer is no longer offered to the classifier and new spawns are denied.

Fail open: a missing key, network error, timeout, bad response (including a
node outside the options), or any exception allows the call. A classifier failure leaves the whole episode unrouted.

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
dir is `~/.jbcontext/guidance/state`; logs go next to the transcript, as here. `GUIDANCE_DISABLED=1` turns an
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
| `GUIDANCE_CLASSIFIER` | `haiku` | `haiku` (Anthropic Messages API, one forced `route` tool call selecting a node) or `jev` (probabilities, most probable taken) |
| `GUIDANCE_ANTHROPIC_API_KEY` | - | Haiku key; falls back to `ANTHROPIC_API_KEY`, then `ANTHROPIC_AUTH_TOKEN` (Bearer). In an eval pod these are the agent's own credentials |
| `GUIDANCE_ANTHROPIC_BASE_URL` | `ANTHROPIC_BASE_URL`, else `https://api.anthropic.com` | |
| `GUIDANCE_ANTHROPIC_MODEL` | `claude-haiku-5-5` | |
| `GUIDANCE_CLASSIFIER_TIMEOUT` | `GUIDANCE_JEV_TIMEOUT` | seconds, either classifier |
| `TYPESAFE_API_KEY` | - | Jev API key; falls back to `~/.config/jev/api-key` |
| `GUIDANCE_JEV_MODEL` | `jev-latest` | |
| `GUIDANCE_JEV_URL` | `https://api.typesafe.ai/v1/systemone` | |
| `GUIDANCE_JEV_TIMEOUT` | `10` | seconds |
| `GUIDANCE_MAX_EXPLORER_RUNS` | `1` | per task |
| `GUIDANCE_RECENT_STEPS` | `10` | tool calls (plus the reasoning between them) sent to the classifier |
| `GUIDANCE_DIR` | `<repo>/guidance` | node files |
| `GUIDANCE_STATE_DIR` | `~/.claude/guidance/state` | per-session state + lock |
| `GUIDANCE_LOG_DIR` | `guidance/` next to the session transcript, else `~/.claude/guidance/logs` | per-session log (JSON lines) |
| `GUIDANCE_DISABLED` | - | `1` turns the router off |
| `GUIDANCE_FAKE_NODE` | - | node the classifier "selects" instead of calling it (tests, dry runs); a node outside the options fails like a bad response |

The jbcontext guidance uses `instruction-mcp.md` once the session has made an
`mcp__jbcontext*` call, `instruction.md` (CLI) otherwise.

## Log

`<log dir>/<session_id>.log`, one JSON event per line. By default the log dir is
`guidance/` next to the session transcript (`~/.claude/projects/<project>/guidance/`),
so eval harnesses that archive the transcripts bring the log back with them; the
extension is `.log` because trajectory fetchers read every `*.jsonl` there as a
session. Events:
`classify` (decision and latency; for a live call also `classifier`, `model`,
token `usage`, and the Haiku `reason` or the Jev `probs`), `classifier_error`, `allow`, `deny`, `noncompliant`, `episode_end`, `explorer_done`, `prompt_reset`
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
- tables for the pure functions (categorize, transcript reading, classifier
  state, allowed nodes).

The inputs live in `parity_cases.py`; the expected values are recorded from this script.

```bash
python3 hooks/guidance/parity_cases.py --write   # after changing guidance_hook.py or a node file
python3 hooks/guidance/parity_cases.py --check   # also run by test_guidance_hook.py
```

The CLI test `GuidanceParityTest` replays the same file against the Kotlin port.

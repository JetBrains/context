#!/usr/bin/env python3
"""Structural-guidance router hooks for Claude Code.

Entry points (one per hook event):
  guidance_hook.py pre     PreToolUse        route search calls to a guidance node
  guidance_hook.py post    PostToolUse       context-explorer finished: count it, attach result guidance
  guidance_hook.py prompt  UserPromptSubmit  reset the routing state

Routing unit is an exploration episode: a run of consecutive exploration calls
that ends with a non-exploration call (edit, test, build). The first routable
call of an episode is classified (the classifier selects one node); the decision
is reused for the rest of the episode. See guidance/README.md for the node definitions and decision rules.

Any failure allows the pending call (fail open). Requires Python 3.8+, stdlib only.
"""
import fcntl
import json
import os
import re
import shlex
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REGULAR = "regular-search"
JBCONTEXT = "jbcontext-search"
EXPLORER = "context-explorer"
NODES = (REGULAR, JBCONTEXT, EXPLORER)

HOME = Path.home()
GUIDANCE_DIR = Path(os.environ.get("GUIDANCE_DIR") or Path(__file__).resolve().parents[2] / "guidance")
NODES_DIR = GUIDANCE_DIR / "search-call"
STATE_DIR = Path(os.environ.get("GUIDANCE_STATE_DIR") or HOME / ".claude" / "guidance" / "state")
LOG_DIR = HOME / ".claude" / "guidance" / "logs"  # set per hook run by main(), see log_dir()
JEV_URL = os.environ.get("GUIDANCE_JEV_URL", "https://api.typesafe.ai/v1/systemone")
JEV_MODEL = os.environ.get("GUIDANCE_JEV_MODEL", "jev-latest")
JEV_TIMEOUT = float(os.environ.get("GUIDANCE_JEV_TIMEOUT", "10"))
CLASSIFIER = os.environ.get("GUIDANCE_CLASSIFIER", "haiku").strip().lower()  # haiku | jev
CLASSIFIER_TIMEOUT = float(os.environ.get("GUIDANCE_CLASSIFIER_TIMEOUT") or JEV_TIMEOUT)
ANTHROPIC_MODEL = os.environ.get("GUIDANCE_ANTHROPIC_MODEL", "claude-haiku-5-5")
ANTHROPIC_BASE_URL = (os.environ.get("GUIDANCE_ANTHROPIC_BASE_URL") or os.environ.get("ANTHROPIC_BASE_URL")
                      or "https://api.anthropic.com").rstrip("/")
MAX_EXPLORER_RUNS = int(os.environ.get("GUIDANCE_MAX_EXPLORER_RUNS", "1"))
RECENT_STEPS = int(os.environ.get("GUIDANCE_RECENT_STEPS", "10"))

DENY_PREFIX = ("[search guidance] A different search method fits this step better. "
               "This is guidance, not an error.\n\n")
REGULAR_DENY = ("What you are looking for is exact: a known name, path, or literal, or every "
                "occurrence of one. Find it with Grep, Glob, or Read on that exact name or path "
                "instead of semantic search or the explorer.")
EXPLORER_CAP_DENY = ("context-explorer has already run for this task. Continue from its report "
                     "with Read/grep on the names it found, or a direct jbcontext search.")

# ---------------------------------------------------------------------------
# Tool call categories
#   end       non-exploration call: closes the current episode
#   neutral   bookkeeping, unrelated tools: ignored
#   read      exploration that is never routed (Read, cat, ls, git log, pipe filters)
#   regular / jbcontext / explorer   routable exploration call of that node
# ---------------------------------------------------------------------------

END_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
READ_TOOLS = {"Read", "Glob", "WebFetch", "WebSearch", "LS", "NotebookRead"}
AGENT_TOOLS = {"Agent", "Task"}

SEARCH_BINS = {"rg", "ripgrep", "grep", "egrep", "fgrep", "ack", "ag", "find", "fd", "fdfind", "locate"}
READ_BINS = {"cat", "head", "tail", "less", "more", "bat", "tac", "nl", "wc", "ls", "ll", "tree",
             "sed", "awk", "jq", "yq", "diff", "file", "stat", "realpath", "readlink", "pwd",
             "sort", "uniq", "cut", "tr", "xmllint", "basename", "dirname"}
SHELL_NOOP_BINS = {"cd", "pushd", "popd", "echo", "printf", "true", "export", "set", "source", ".",
                   "which", "type", "command"}
WRAPPER_BINS = {"sudo", "time", "nohup", "env", "command"}
GIT_READ_SUBS = {"log", "show", "diff", "blame", "status", "ls-files", "ls-tree", "branch", "remote",
                 "rev-parse", "shortlog", "describe", "grep"}
JBCONTEXT_BINS = {"jbcontext", "jbcontext-eap", "embark", "embark-eap"}
SEPARATORS = {"|", "||", "&&", ";", "&", "|&", ";;"}
REDIRECTS = {">", ">>", "<", "<<", ">&", "&>", "&>>", "<&", ">|"}


def is_jbcontext_mcp(tool):
    return tool.startswith("mcp__jbcontext") or tool.startswith("mcp__context__") or (
        tool.startswith("mcp__embark") and not tool.startswith("mcp__embark-catalog"))


def split_stages(command):
    """[(tokens, after_pipe)] for each pipeline stage, unwrapping `bash -c '...'`."""
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    tokens = list(lexer)
    stages, current, after_pipe, skip_target = [], [], False, False
    for tok in tokens + [";"]:
        if skip_target:
            skip_target = False
            continue
        if tok in SEPARATORS:
            if current:
                stages.append((current, after_pipe))
            current, after_pipe = [], tok in ("|", "|&")
            continue
        if tok in REDIRECTS:
            if current and current[-1].isdigit():
                current.pop()  # fd number of `2>`
            skip_target = True
            continue
        if tok in ("(", ")"):
            continue
        current.append(tok)
    return stages


def stage_kind(tokens, after_pipe, depth=0):
    while tokens and "=" in tokens[0] and not tokens[0].startswith("-") and tokens[0].split("=")[0].isidentifier():
        tokens = tokens[1:]
    while tokens and tokens[0] in WRAPPER_BINS:
        tokens = tokens[1:]
        while tokens and tokens[0].startswith("-"):
            tokens = tokens[1:]
    if not tokens:
        return "noop"
    exe = os.path.basename(tokens[0])
    if exe in ("bash", "sh", "zsh") and "-c" in tokens and depth < 3:
        idx = tokens.index("-c")
        if idx + 1 < len(tokens):
            return command_kind(tokens[idx + 1], depth + 1)
    if exe == "xargs":
        rest = [t for t in tokens[1:] if not t.startswith("-")]
        return stage_kind(rest, after_pipe, depth) if rest else "read"
    if exe in JBCONTEXT_BINS:
        if "search" in tokens[1:3] and not {"-h", "--help"} & set(tokens):
            return "jbcontext"
        return "noop"
    if exe == "git":
        subs = [t for t in tokens[1:] if not t.startswith("-")]
        sub = subs[0] if subs else ""
        if sub == "grep":
            return "filter" if after_pipe else "search"
        if sub == "ls-files":
            return "read"
        return "read" if sub in GIT_READ_SUBS else "end"
    if exe in SEARCH_BINS:
        return "filter" if after_pipe else "search"
    if exe in READ_BINS:
        return "read"
    if exe in SHELL_NOOP_BINS:
        return "noop"
    return "end"


def command_kind(command, depth=0):
    """Combined kind of a shell command: end / jbcontext / search / read / noop."""
    try:
        stages = split_stages(command)
    except ValueError:
        return "noop"
    kinds = [stage_kind(tokens, after_pipe, depth) for tokens, after_pipe in stages]
    if "end" in kinds:
        return "end"
    if "jbcontext" in kinds:
        return "jbcontext"
    if "search" in kinds:
        return "search"
    if "read" in kinds or "filter" in kinds:
        return "read"
    return "noop"


def categorize(tool, tool_input):
    if tool in END_TOOLS:
        return "end"
    if tool in READ_TOOLS:
        return "read"
    if tool == "Grep":
        return "regular"
    if is_jbcontext_mcp(tool):
        return "jbcontext"
    if tool == "Skill":
        return "jbcontext" if str(tool_input.get("skill", "")).endswith("context-search") else "neutral"
    if tool in AGENT_TOOLS:
        sub = str(tool_input.get("subagent_type", ""))
        if sub == "context-explorer":
            return "explorer"
        if sub == "Explore":
            return "regular"  # built-in Explore runs regular search tools
        return "neutral"
    if tool == "Bash":
        kind = command_kind(str(tool_input.get("command", "")))
        return {"end": "end", "jbcontext": "jbcontext", "search": "regular", "read": "read"}.get(kind, "neutral")
    return "neutral"


NODE_OF_CATEGORY = {"regular": REGULAR, "jbcontext": JBCONTEXT, "explorer": EXPLORER}

# ---------------------------------------------------------------------------
# State (per session, main agent only), with file lock + atomic write
# ---------------------------------------------------------------------------


def safe_id(session_id):
    return "".join(c for c in session_id if c.isalnum() or c in "._-") or "default"


def new_state():
    return {"episode": None, "episode_seq": 0, "explorer_runs": 0, "jbcontext_mcp_seen": False,
            "counters": {"classifications": 0, "classifier_errors": 0, "denies": 0, "noncompliant": 0}}


class StateLock:
    def __init__(self, session_id):
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self.path = STATE_DIR / f"{safe_id(session_id)}.json"
        self.lock_path = STATE_DIR / f"{safe_id(session_id)}.lock"

    def __enter__(self):
        self.lock_file = open(self.lock_path, "a")
        fcntl.flock(self.lock_file, fcntl.LOCK_EX)
        try:
            self.state = json.loads(self.path.read_text())
        except (OSError, ValueError):
            self.state = new_state()
        return self

    def save(self):
        fd, tmp = tempfile.mkstemp(dir=STATE_DIR, prefix=".state-")
        with os.fdopen(fd, "w") as f:
            json.dump(self.state, f)
        os.replace(tmp, self.path)

    def __exit__(self, *exc):
        fcntl.flock(self.lock_file, fcntl.LOCK_UN)
        self.lock_file.close()


def log_dir(transcript_path):
    """GUIDANCE_LOG_DIR, else a `guidance/` dir next to the session transcript (eval harnesses archive
    the transcript's folder, so the log comes back with it), else ~/.claude/guidance/logs."""
    if os.environ.get("GUIDANCE_LOG_DIR"):
        return Path(os.environ["GUIDANCE_LOG_DIR"])
    if transcript_path:
        return Path(transcript_path).absolute().parent / "guidance"
    return HOME / ".claude" / "guidance" / "logs"


def log_event(session_id, event):
    """One event line in `<log dir>/<session>.log` (JSON lines; not `.jsonl`, which trajectory fetchers
    read as a session)."""
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        event = {"ts": round(time.time(), 3), "session_id": session_id, **event}
        with open(LOG_DIR / f"{safe_id(session_id)}.log", "a") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError:
        pass

# ---------------------------------------------------------------------------
# Classifier input: task + recent steps from the transcript + pending call
# ---------------------------------------------------------------------------


def clip(value, limit):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + f"... [{len(text) - limit} more chars]"


def content_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def read_transcript(path):
    """(user_prompt, steps since that prompt) from a Claude Code transcript; tolerant of lag and bad lines.

    A step is a tool call {"tool", "input", "result"} or agent reasoning {"reasoning"} (visible
    assistant text, or thinking text when the transcript keeps it).
    """
    try:
        lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return "", []
    entries = []
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("isSidechain") or entry.get("type") not in ("user", "assistant"):
            continue
        entries.append(entry)
    task, results, steps = "", {}, []
    for entry in entries:
        content = entry.get("message", {}).get("content")
        if entry["type"] == "user":
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_result":
                        results[c.get("tool_use_id")] = c.get("content")
            text = content_text(content).strip()
            if text and not text.startswith("<"):
                task, steps = text, []  # a new user prompt starts a new task
        else:
            for c in content if isinstance(content, list) else []:
                if not isinstance(c, dict):
                    continue
                text = c.get("text") if c.get("type") == "text" else c.get("thinking") if c.get("type") == "thinking" else None
                if text and text.strip():
                    steps.append({"reasoning": clip(text.strip(), 800)})
                elif c.get("type") == "tool_use":
                    steps.append({"tool": c.get("name"), "input": clip(c.get("input", {}), 400), "id": c.get("id")})
    for step in steps:
        tool_id = step.pop("id", None)
        if tool_id in results:
            result = results[tool_id]
            step["result"] = clip(content_text(result) if not isinstance(result, str) else result, 500)
    return clip(task, 3000), steps


def classifier_state(task, steps, tool, tool_input):
    """Classifier input: recent steps, the agent's latest reasoning and the pending call.

    The pending call shows whether the agent's target is already exact (a known name or a narrow
    path); the instructions tell the classifier to judge the target, not to ratify the agent's choice
    of tool. The user prompt is included only while it is recent (within the last RECENT_STEPS tool
    calls).
    """
    steps = list(steps)
    if steps and steps[-1].get("tool") == tool and "result" not in steps[-1]:
        steps.pop()  # the transcript may already hold the pending call itself
    tool_positions = [i for i, step in enumerate(steps) if "tool" in step]
    start = tool_positions[-RECENT_STEPS] if len(tool_positions) > RECENT_STEPS else 0
    state = {}
    if start == 0 and task:
        state["user_prompt"] = task
    earlier = [step for step in steps[:start] if "reasoning" in step][-2:]
    if earlier:
        state["earlier_reasoning"] = [step["reasoning"] for step in earlier]
    state["recent_steps"] = steps[start:]
    state["pending_call"] = {"tool": tool, "input": clip(tool_input, 400)}
    return state


def allowed_nodes(explorer_runs):
    """The nodes the classifier may select: context-explorer drops out once it has run its cap."""
    return [n for n in NODES if n != EXPLORER or explorer_runs < MAX_EXPLORER_RUNS]


def node_descriptions(nodes=NODES):
    out = {}
    for node in nodes:
        text = (NODES_DIR / node / "description.md").read_text(encoding="utf-8")
        out[node] = "\n".join(l for l in text.splitlines() if not l.startswith("# Node:")).strip()
    return out


def node_instruction(node, use_mcp):
    if node == REGULAR:
        return REGULAR_DENY
    name = "instruction-mcp.md" if node == JBCONTEXT and use_mcp else "instruction.md"
    path = NODES_DIR / node / name
    return path.read_text(encoding="utf-8").strip() if path.exists() else ""


def jev_key():
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if key:
        return key
    path = HOME / ".config" / "jev" / "api-key"
    return path.read_text(encoding="utf-8").strip() if path.exists() else ""


CLASSIFIER_INSTRUCTIONS = (
    "The state shows a coding agent's recent steps and reasoning (and the user's request "
    "when it is recent), and the search call it is about to make (pending_call). From its "
    "reasoning and what the session already established, judge what it intends to find, and "
    "select the one search approach that fits that intent. Judge the target, not the agent's "
    "choice of tool: a call that looks for a name, path, or literal the user gave or the "
    "session already established, or that looks inside a file already located, is exact; a "
    "name the agent guesses for something it can only describe is not.")


def classify(state_payload, options):
    """(node, meta): the selected node out of `options`, and what to log about the call ({} for a fake).

    Raises on any failure (caller fails open).
    """
    fake = os.environ.get("GUIDANCE_FAKE_NODE")
    if fake:
        if fake not in options:
            raise ValueError(f"fake node {fake} is not an option")
        return fake, {}
    if CLASSIFIER == "jev":
        return classify_jev(state_payload, options)
    return classify_haiku(state_payload, options)


def classify_haiku(state_payload, options):
    """Claude Haiku over the Messages API: one forced `route` tool call selecting a node, with a reason.

    The reason comes first so the selection follows from it. The call is made by the hook, not the
    agent, so it is not part of the agent's own usage; its token usage is returned for the log so the
    classifier cost can be reported separately.
    """
    key = os.environ.get("GUIDANCE_ANTHROPIC_API_KEY", "").strip() or os.environ.get("ANTHROPIC_API_KEY", "").strip()
    token = os.environ.get("ANTHROPIC_AUTH_TOKEN", "").strip()
    if key:
        auth = {"x-api-key": key}
    elif token:
        auth = {"Authorization": f"Bearer {token}"}
    else:
        raise RuntimeError("no Anthropic credentials (GUIDANCE_ANTHROPIC_API_KEY, ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN)")
    described = "\n\n".join(f'<option name="{node}">\n{text}\n</option>' for node, text in node_descriptions(options).items())
    capped = "" if EXPLORER in options else f"\n\n{EXPLORER} has already run for this task and is not an option."
    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1024,
        "output_config": {"effort": "low"},
        "system": (f"{CLASSIFIER_INSTRUCTIONS}\n\nThe search approaches:\n\n{described}{capped}\n\n"
                   "Call the route tool once: a one-sentence reason, then the approach that fits."),
        "tools": [{
            "name": "route",
            "description": "Select the search approach that fits the agent's next search.",
            "strict": True,
            "input_schema": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string", "description": "One sentence: what the agent needs and why this approach fits."},
                    "node": {"type": "string", "enum": list(options)},
                },
                "required": ["reason", "node"],
                "additionalProperties": False,
            },
        }],
        "tool_choice": {"type": "tool", "name": "route"},
        "messages": [{"role": "user", "content": json.dumps(state_payload, ensure_ascii=False)}],
    }
    request = urllib.request.Request(
        f"{ANTHROPIC_BASE_URL}/v1/messages", data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={**auth, "anthropic-version": "2023-06-01", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=CLASSIFIER_TIMEOUT) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Anthropic HTTP {error.code}") from None
    if result.get("stop_reason") == "refusal":
        raise RuntimeError("classifier request refused")
    call = next((c for c in result.get("content", []) if c.get("type") == "tool_use" and c.get("name") == "route"), None)
    if call is None:
        raise RuntimeError(f"no route call (stop_reason {result.get('stop_reason')})")
    node = call["input"].get("node")
    if node not in options:
        raise RuntimeError(f"route call selected no option ({str(node)[:60]})")
    usage = result.get("usage") or {}
    meta = {"classifier": "haiku", "model": result.get("model", ANTHROPIC_MODEL),
            "reason": clip(str(call["input"].get("reason", "")), 400),
            "usage": {k: usage[k] for k in ("input_tokens", "output_tokens") if k in usage}}
    return node, meta


def classify_jev(state_payload, options):
    """Jev `choice` question over the node descriptions (the original classifier): its most probable option."""
    key = jev_key()
    if not key:
        raise RuntimeError("no Jev API key (TYPESAFE_API_KEY or ~/.config/jev/api-key)")
    payload = {
        "model": JEV_MODEL,
        "state": state_payload,
        "questions": {
            "route": {
                "type": "choice",
                "instructions": CLASSIFIER_INSTRUCTIONS,
                "criteria": node_descriptions(options),
            }
        },
    }
    request = urllib.request.Request(
        JEV_URL, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=CLASSIFIER_TIMEOUT) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Jev HTTP {error.code}") from None
    probs = result["answers"]["route"]["probabilities"]
    probs = {node: float(probs.get(node, 0.0)) for node in options}
    return max(options, key=probs.get), {"classifier": "jev", "probs": probs}

# ---------------------------------------------------------------------------
# Hook outputs
# ---------------------------------------------------------------------------


def emit(event, **fields):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, **fields}}))


def deny(reason):
    emit("PreToolUse", permissionDecision="deny", permissionDecisionReason=DENY_PREFIX + reason)


def allow(tool, tool_input, context=None, force_foreground=False):
    fields = {}
    if context:
        fields["additionalContext"] = context
    if force_foreground:
        fields["permissionDecision"] = "allow"
        fields["updatedInput"] = {**tool_input, "run_in_background": False}
    if fields:
        emit("PreToolUse", **fields)

# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


def handle_pre(data):
    session_id = data.get("session_id") or ""
    if not session_id or data.get("agent_id") or data.get("agent_type"):
        return  # subagent guard: never route inside context-explorer / Explore
    tool = data.get("tool_name") or ""
    tool_input = data.get("tool_input") or {}
    category = categorize(tool, tool_input)
    if category == "neutral":
        return

    with StateLock(session_id) as lock:
        state = lock.state
        if is_jbcontext_mcp(tool):
            state["jbcontext_mcp_seen"] = True
        if category == "end":
            if state["episode"]:
                log_event(session_id, {"event": "episode_end", "episode": state["episode"], "by": tool})
                state["episode"] = None
                lock.save()
            return
        episode = state["episode"]
        if episode is None:
            state["episode_seq"] += 1
            episode = state["episode"] = {"id": state["episode_seq"], "decision": None, "followed": False,
                                          "denied": False, "guided": False}
        if category == "read":
            lock.save()
            return
        pending = NODE_OF_CATEGORY[category]

        if pending == EXPLORER and state["explorer_runs"] >= MAX_EXPLORER_RUNS:
            state["counters"]["denies"] += 1
            log_event(session_id, {"event": "deny", "reason": "explorer_cap", "tool": tool,
                                   "episode": episode["id"]})
            lock.save()
            deny(EXPLORER_CAP_DENY)
            return

        if episode["decision"] is None:
            task, recent = read_transcript(data.get("transcript_path", ""))
            started = time.time()
            try:
                episode["decision"], meta = classify(classifier_state(task, recent, tool, tool_input),
                                                     allowed_nodes(state["explorer_runs"]))
                state["counters"]["classifications"] += 1
                log_event(session_id, {"event": "classify", "episode": episode["id"], "tool": tool,
                                       "pending_node": pending, "decision": episode["decision"],
                                       "latency_ms": int((time.time() - started) * 1000), **meta})
            except Exception as error:  # fail open for the whole episode
                episode["decision"] = "none"
                state["counters"]["classifier_errors"] += 1
                log_event(session_id, {"event": "classifier_error", "episode": episode["id"], "error": str(error)[:300],
                                       "latency_ms": int((time.time() - started) * 1000)})
        decision = episode["decision"]
        use_mcp = state["jbcontext_mcp_seen"]

        if decision == "none":
            lock.save()
            return
        if pending == decision:
            first = not episode["followed"]
            episode["followed"] = True
            context = None
            if decision == JBCONTEXT and not episode["guided"]:
                context = node_instruction(JBCONTEXT, use_mcp)
                episode["guided"] = True
            log_event(session_id, {"event": "allow", "episode": episode["id"], "tool": tool,
                                   "node": decision, "first_follow": first})
            lock.save()
            allow(tool, tool_input, context, force_foreground=(pending == EXPLORER))
            return
        if episode["followed"]:
            # The decided method was already used in this episode; this is a follow-up
            # (e.g. grep on a name the semantic search returned).
            log_event(session_id, {"event": "allow", "episode": episode["id"], "tool": tool,
                                   "node": pending, "follow_up_of": decision})
            lock.save()
            allow(tool, tool_input, force_foreground=(pending == EXPLORER))
            return
        if not episode["denied"]:
            episode["denied"] = True
            state["counters"]["denies"] += 1
            log_event(session_id, {"event": "deny", "episode": episode["id"], "tool": tool,
                                   "pending_node": pending, "decision": decision})
            lock.save()
            deny(node_instruction(decision, use_mcp))
            return
        state["counters"]["noncompliant"] += 1
        log_event(session_id, {"event": "noncompliant", "episode": episode["id"], "tool": tool,
                               "pending_node": pending, "decision": decision})
        lock.save()
        allow(tool, tool_input, force_foreground=(pending == EXPLORER))


def handle_post(data):
    session_id = data.get("session_id") or ""
    if not session_id or data.get("agent_id") or data.get("agent_type"):
        return
    tool_input = data.get("tool_input") or {}
    if data.get("tool_name") not in AGENT_TOOLS or tool_input.get("subagent_type") != "context-explorer":
        return
    with StateLock(session_id) as lock:
        state = lock.state
        state["explorer_runs"] += 1
        log_event(session_id, {"event": "explorer_done", "runs": state["explorer_runs"],
                               "episode": state["episode"]})
        state["episode"] = None  # next step after the explorer starts a new episode
        lock.save()
    path = NODES_DIR / EXPLORER / "result-instruction.md"
    if path.exists():
        emit("PostToolUse", additionalContext=path.read_text(encoding="utf-8").strip())


def handle_prompt(data):
    session_id = data.get("session_id") or ""
    if not session_id:
        return
    with StateLock(session_id) as lock:
        old = lock.state
        log_event(session_id, {"event": "prompt_reset", "counters": old.get("counters"),
                               "explorer_runs": old.get("explorer_runs")})
        state = new_state()
        state["episode_seq"] = old.get("episode_seq", 0)
        state["jbcontext_mcp_seen"] = old.get("jbcontext_mcp_seen", False)
        lock.state = state
        lock.save()


def main():
    if os.environ.get("GUIDANCE_DISABLED") == "1" or len(sys.argv) < 2:
        return 0
    handler = {"pre": handle_pre, "post": handle_post, "prompt": handle_prompt}.get(sys.argv[1])
    if handler is None:
        return 0
    global LOG_DIR
    try:
        data = json.load(sys.stdin)
        LOG_DIR = log_dir(str(data.get("transcript_path") or ""))
        handler(data)
    except Exception as error:  # fail open: never block the agent because of the router
        print(f"guidance hook error: {error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

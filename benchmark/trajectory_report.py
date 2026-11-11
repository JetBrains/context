#!/usr/bin/env python3
"""Draw the two measured sessions of the single-query benchmark as one HTML report.

The benchmark prints four numbers per leg. This report shows WHY they differ: it reads the two
Claude Code transcripts (and the transcripts of any subagent they started), turns every tool
call into typed operations -- semantic retrieval, keyword search / listing, file read,
delegation, reply -- and draws both trajectories on one time axis, followed by a row-aligned
diff of the two step lists. Keyword-search steps and dead ends are the highlighted part: that
is the work semantic retrieval replaces.

Standard library only, so it runs wherever the benchmark script does.

Usage:
  trajectory_report.py --with <session-id|file.jsonl> --without <session-id|file.jsonl>
                       [--query TEXT] [--out report.html] [--open] [--no-previews]

Session ids are looked up under ~/.claude/projects/*/<id>.jsonl (a unique prefix is enough).
"""

import argparse
import datetime
import difflib
import glob
import html
import json
import os
import re
import shlex
import subprocess
import sys

PROJECTS = os.path.expanduser("~/.claude/projects")

# kind -> (legend label, css class). Three hues carry the comparison (validated all-pairs for
# colour-vision deficiency in light and dark); everything else is a neutral.
KINDS = [
    ("semantic", "Semantic retrieval"),
    ("keyword", "Keyword search & listing"),
    ("read", "Reading files"),
    ("delegate", "Delegation (subagent brief & report)"),
    ("answer", "Replying / asking the user"),
    ("other", "Other tools"),
]
SHORT = {
    "semantic": "semantic search",
    "keyword": "keyword search",
    "read": "read",
    "delegate": "delegation",
    "answer": "reply",
    "ask": "question to user",
    "other": "tool",
}

SEARCH_CMDS = {"rg", "grep", "egrep", "fgrep", "ag", "ack"}
LIST_CMDS = {"find", "fd", "fdfind", "ls", "tree", "eza", "exa", "locate", "du"}
READ_CMDS = {"cat", "head", "tail", "sed", "awk", "bat", "less", "more", "nl"}
SKIP_CMDS = {"echo", "printf", "cd", "true", "export", "set", "pwd", "pushd", "popd", ":"}
WRAPPERS = {"sudo", "command", "time", "nice", "env", "timeout", "xargs"}
VALUE_FLAGS = {
    "-e", "-f", "-g", "--glob", "--iglob", "-t", "--type", "-T", "--type-not", "-A", "-B", "-C",
    "-m", "--max-count", "--max-depth", "-d", "--include", "--exclude", "--exclude-dir", "-j",
    "--threads", "--context", "--after-context", "--before-context", "--regexp", "--file",
}
SECRET_RE = re.compile(
    r"(?i)((?:secret|passw(?:or)?d|token|api[_-]?key|private[_-]?key|credential)[\w.\-]*\"?\s*[=:]\s*)"
    r"([\"']?)[A-Za-z0-9+/_\-.]{12,}"
)


# ------------------------------------------------------------------------------- small helpers
def parse_ts(value):
    try:
        return datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def fmt_dur(seconds):
    if seconds is None:
        return "n/a"
    seconds = max(0.0, float(seconds))
    if seconds < 9.95:
        return "%.1f s" % seconds
    if seconds < 60:
        return "%d s" % round(seconds)
    total = int(round(seconds))
    return "%d:%02d" % (total // 60, total % 60)


def fmt_clock(seconds):
    total = int(max(0.0, seconds))
    return "%d:%02d" % (total // 60, total % 60)


def fmt_size(chars):
    if chars < 1000:
        return "%d B" % chars
    if chars < 100_000:
        return "%.1f KB" % (chars / 1000.0)
    return "%d KB" % round(chars / 1000.0)


def fmt_tokens(n):
    if n is None:
        return "n/a"
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        return "%dK" % round(n / 1000.0)
    return "%.2fM" % (n / 1_000_000.0)


def esc(text):
    return html.escape(str(text), quote=True)


def plural(n, word, suffix="s"):
    if n == 1:
        return "%d %s" % (n, word)
    if suffix == "es" or word.endswith(("ch", "sh", "s", "x")):
        return "%d %ses" % (n, word)
    return "%d %s%s" % (n, word, suffix)


def clip(text, limit):
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def looks_like_file(token):
    if not token or any(ch in token for ch in "*?[{$") or token.endswith("/"):
        return False
    return bool(re.search(r"\.[A-Za-z0-9_]{1,10}$", os.path.basename(token)))


def relpath(path, cwd):
    path = path.strip()
    if cwd and path.startswith(cwd.rstrip("/") + "/"):
        path = path[len(cwd.rstrip("/")) + 1 :]
    while path.startswith("./"):
        path = path[2:]
    return path


def redact(text):
    return SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + "•••", text)


# ------------------------------------------------------------------- shell command -> operations
def split_shell(cmd):
    """`a && b | c; d` -> [[a], [b, c], [d]]: pipelines, each a list of stages. Quote-aware."""
    if "<<" in cmd:  # heredoc: the body is data, not commands
        return [[cmd.split("\n", 1)[0].strip()]]
    pipelines, stages, buf = [], [], []
    quote = None

    def end_stage():
        text = "".join(buf).strip()
        del buf[:]
        if text:
            stages.append(text)

    def end_pipeline():
        end_stage()
        if stages:
            pipelines.append(list(stages))
        del stages[:]

    i, n = 0, len(cmd)
    while i < n:
        ch = cmd[i]
        if quote:
            buf.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < n:
                buf.append(cmd[i + 1])
                i += 1
            elif ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
            buf.append(ch)
        elif ch == "\\" and i + 1 < n:
            buf.append(ch)
            buf.append(cmd[i + 1])
            i += 1
        elif cmd.startswith("&&", i) or cmd.startswith("||", i):
            end_pipeline()
            i += 1
        elif ch in ";\n":
            end_pipeline()
        elif ch == "|":
            end_stage()
        else:
            buf.append(ch)
        i += 1
    end_pipeline()
    return pipelines


def stage_tokens(stage):
    try:
        raw = shlex.split(stage, posix=True)
    except ValueError:
        raw = stage.split()
    out, skip = [], False
    for tok in raw:
        if skip:
            skip = False
            continue
        if re.match(r"^\d*(>>?|<)", tok):  # redirection; a bare `>` takes the next token
            skip = tok in (">", ">>", "<", "2>", "1>")
            continue
        out.append(tok)
    while out and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", out[0]) or os.path.basename(out[0]) in WRAPPERS):
        wrapper = os.path.basename(out[0])
        out = out[1:]
        if wrapper == "timeout" and out and re.match(r"^\d", out[0]):
            out = out[1:]
    return out


def positionals(args):
    result, has_pattern_flag, skip, rest = [], False, False, False
    for arg in args:
        if skip:
            skip = False
            continue
        if rest:
            result.append(arg)
        elif arg == "--":
            rest = True
        elif arg.startswith("-") and len(arg) > 1:
            if arg in VALUE_FLAGS:
                skip = True
            if arg in ("-e", "-f", "--regexp", "--file"):
                has_pattern_flag = True
        else:
            result.append(arg)
    return result, has_pattern_flag


def bash_ops(cmd, cwd):
    """Typed operations of one Bash call, plus the lines its `echo`s print (headers, not results)."""
    ops, echoes = [], []
    for pipeline in split_shell(cmd):
        toks = stage_tokens(pipeline[0])
        if not toks:
            continue
        name = os.path.basename(toks[0])
        text = " | ".join(pipeline)
        if name in SKIP_CMDS:
            if name in ("echo", "printf"):
                echoes.append(" ".join(t for t in toks[1:] if not t.startswith("-")))
            continue
        if name == "jbcontext" and "search" in toks[1:3]:
            pos, _ = positionals(toks[toks.index("search") + 1 :])
            ops.append({"kind": "semantic", "label": pos[-1] if pos else text, "files": []})
        elif "search-code" in toks[1:4]:
            pos, _ = positionals(toks[toks.index("search-code") + 1 :])
            ops.append({"kind": "semantic", "label": pos[-1] if pos else text, "files": []})
        elif name in SEARCH_CMDS or (name == "git" and toks[1:2] == ["grep"]):
            pos, flagged = positionals(toks[(2 if name == "git" else 1) :])
            paths = pos if flagged else pos[1:]
            if paths and all(looks_like_file(p) for p in paths):  # a grep inside known files is a read
                for path in paths:
                    ops.append({"kind": "read", "label": text, "files": [relpath(path, cwd)], "grep_in_file": True})
            else:
                ops.append({"kind": "keyword", "label": text, "files": []})
        elif name in LIST_CMDS or (name == "git" and toks[1:2] == ["ls-files"]):
            ops.append({"kind": "keyword", "label": text, "files": [], "listing": True})
        elif name in READ_CMDS:
            pos, _ = positionals(toks[1:])
            files = [relpath(p, cwd) for p in pos if looks_like_file(p)]
            if files:
                for path in files:
                    ops.append({"kind": "read", "label": "%s %s" % (name, os.path.basename(path)), "files": [path]})
            else:
                ops.append({"kind": "other", "label": text, "files": []})
        else:
            ops.append({"kind": "other", "label": text, "files": []})
    if not ops:
        ops.append({"kind": "other", "label": clip(cmd, 200), "files": []})
    return ops, echoes


def tool_ops(name, tool_input, cwd):
    """(operations, command text shown in the details, echo lines) for one tool call."""
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    lower = name.lower()
    if name == "Bash":
        cmd = str(tool_input.get("command", ""))
        ops, echoes = bash_ops(cmd, cwd)
        return ops, cmd, echoes
    if name == "Read":
        path = relpath(str(tool_input.get("file_path", "")), cwd)
        return [{"kind": "read", "label": "Read %s" % os.path.basename(path), "files": [path]}], path, []
    if name == "Grep":
        pattern, path = str(tool_input.get("pattern", "")), str(tool_input.get("path", "") or "")
        text = 'Grep "%s"%s' % (pattern, (" in " + relpath(path, cwd)) if path else "")
        if tool_input.get("glob"):
            text += " (%s)" % tool_input["glob"]
        if looks_like_file(path):
            return [{"kind": "read", "label": text, "files": [relpath(path, cwd)], "grep_in_file": True}], text, []
        return [{"kind": "keyword", "label": text, "files": []}], text, []
    if name == "Glob":
        text = "Glob %s" % tool_input.get("pattern", "")
        return [{"kind": "keyword", "label": text, "files": [], "listing": True}], text, []
    if "jbcontext" in lower or lower.endswith("search_code") or "semantic" in lower:
        query = tool_input.get("text") or tool_input.get("query") or json.dumps(tool_input)
        return [{"kind": "semantic", "label": str(query), "files": []}], "%s %s" % (name, json.dumps(tool_input)), []
    if name in ("Agent", "Task"):
        text = "Start subagent: %s" % (tool_input.get("description") or tool_input.get("subagent_type") or "")
        return [{"kind": "delegate", "label": text, "files": []}], str(tool_input.get("prompt", "")), []
    if name == "SubagentHandback":
        message = str(tool_input.get("message", ""))
        return [{"kind": "delegate", "label": "Write the report for the parent agent", "files": []}], message, []
    if name == "AskUserQuestion":
        questions = tool_input.get("questions") or [{}]
        text = "Ask: %s" % (questions[0].get("question", "") if isinstance(questions[0], dict) else "")
        return [{"kind": "ask", "label": text, "files": []}], text, []
    text = "%s %s" % (name, clip(json.dumps(tool_input), 300))
    return [{"kind": "other", "label": text, "files": []}], text, []


# --------------------------------------------------------------------------- transcript -> lane
def load_rows(path):
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    return rows


def content_text(content):
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "\n".join(parts)


def parse_lane(path, label, previews=True):
    """One agent thread (the main session or one subagent) as a list of rounds.

    A round is one model call plus the tools it ran: [start, model_end] is the model deciding
    and writing, [model_end, end] is tools running. Its time is split evenly among its
    operations, so every agent-second belongs to exactly one operation.
    """
    rows = load_rows(path)
    cwd = next((r.get("cwd") for r in rows if r.get("cwd")), "") or ""
    results, user_marks, calls, order = {}, [], {}, []
    prompt, interrupted, official = None, False, None
    for row in rows:
        kind, ts = row.get("type"), parse_ts(row.get("timestamp"))
        message = row.get("message") if isinstance(row.get("message"), dict) else {}
        if kind == "cost-state":
            official = row
        elif kind == "user" and ts is not None:
            content = message.get("content")
            has_result = False
            for block in content if isinstance(content, list) else []:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    has_result = True
                    results[block.get("tool_use_id")] = {
                        "ts": ts,
                        "text": content_text(block.get("content")),
                        "error": bool(block.get("is_error")),
                    }
            text = content_text(content)
            if "[Request interrupted by user" in text:
                interrupted = True
            user_marks.append(ts)
            if prompt is None and not has_result and not row.get("isMeta") and text.strip():
                if not text.lstrip().startswith(("<local-command", "<command-", "<system-reminder", "<task-")):
                    prompt = (ts, text.strip())
        elif kind == "assistant" and ts is not None:
            mid = message.get("id") or row.get("uuid")
            if mid not in calls:
                calls[mid] = {"blocks": [], "usage": message.get("usage") or {}}
                order.append(mid)
            for block in message.get("content") or []:
                if isinstance(block, dict):
                    calls[mid]["blocks"].append((ts, block))

    rounds = []
    for mid in order:
        blocks = calls[mid]["blocks"]
        if not blocks:
            continue
        first = blocks[0][0]
        start = max([t for t in user_marks if t <= first] or [first])
        model_end = max(ts for ts, _ in blocks)
        end, said, ops = model_end, [], []
        for ts, block in blocks:
            btype = block.get("type")
            if btype == "text" and str(block.get("text", "")).strip():
                said.append(str(block["text"]).strip())
            if btype != "tool_use":
                continue
            name = str(block.get("name", ""))
            op_list, command, echoes = tool_ops(name, block.get("input"), cwd)
            result = results.get(block.get("id"))
            text = result["text"] if result else ""
            body = [ln for ln in text.splitlines() if ln.strip() and ln.strip() not in echoes]
            searches = any(o["kind"] in ("semantic", "keyword") or o.get("grep_in_file") for o in op_list)
            dead = ""
            if result and result["error"] and name != "AskUserQuestion":
                dead = "denied" if "denied" in text.lower() else "error"
            elif result and searches and not body:
                dead = "no results"
            hits = re.findall(r"^\s*\d+\.\s*File:\s*(\S+)", text, re.M) if op_list[0]["kind"] == "semantic" else []
            step = {
                "tool": name,
                "command": redact(command) if previews else "",
                "description": str((block.get("input") or {}).get("description", "")) if name == "Bash" else "",
                "text": text,
                "preview": redact("\n".join(text.splitlines()[:14])[:900]) if previews and name != "SubagentHandback" else "",
                "chars": len(text),
                "lines": len(body),
                "dead": dead,
                "hits": [relpath(h, cwd) for h in hits],
                "returned": result["ts"] if result else None,
                "exec": (result["ts"] - ts) if result else 0.0,
                "dismissed": bool(result and result["error"] and name == "AskUserQuestion"),
                "nops": len(op_list),
            }
            if result:
                end = max(end, result["ts"])
            for index, op in enumerate(op_list):
                op.update(step=step, first_in_step=index == 0)
                ops.append(op)
        if not ops:
            ops.append({"kind": "answer", "label": clip(" ".join(said), 160) or "Reply", "files": [], "step": None, "first_in_step": True})
        usage = calls[mid]["usage"]
        rnd = {
            "start": start,
            "model_end": model_end,
            "end": end,
            "ops": ops,
            "said": clip(" ".join(said), 220) if said else "",
            "context": sum(int(usage.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")),
            "output": int(usage.get("output_tokens") or 0),
        }
        asks = [o for o in ops if o["kind"] == "ask"]
        share = len(ops)
        for op in ops:
            op["round"] = rnd
            op["model_s"] = (model_end - start) / share
            waiting = op["kind"] == "ask" or (op["kind"] == "delegate" and op["step"] and op["step"]["exec"] > 5 and op["step"]["tool"] != "SubagentHandback")
            tool_s = (end - model_end) / (len(asks) if asks else share) if (not asks or op["kind"] == "ask") else 0.0
            op["tool_s"], op["wait_s"] = (0.0, tool_s) if waiting else (tool_s, 0.0)
        rounds.append(rnd)
    return {"label": label, "path": path, "cwd": cwd, "rounds": rounds, "prompt": prompt, "interrupted": interrupted, "official": official}


def resolve_session(ref):
    if os.path.isfile(ref):
        return os.path.abspath(ref)
    matches = [p for p in glob.glob(os.path.join(PROJECTS, "*", ref + "*.jsonl"))]
    if not matches:
        raise SystemExit("trajectory_report: no transcript found for session '%s' under %s" % (ref, PROJECTS))
    return max(matches, key=os.path.getmtime)


def load_leg(ref, label, previews=True):
    path = resolve_session(ref)
    main = parse_lane(path, "Main agent", previews)
    lanes = [main]
    sub_dir = os.path.join(os.path.splitext(path)[0], "subagents")
    for sub in sorted(glob.glob(os.path.join(sub_dir, "*.jsonl"))):
        name = "Subagent"
        try:
            with open(os.path.splitext(sub)[0] + ".meta.json", encoding="utf-8") as handle:
                meta = json.load(handle)
            name = "Subagent · %s" % (meta.get("agentType") or meta.get("description") or "task")
        except (OSError, ValueError):
            pass
        lane = parse_lane(sub, name, previews)
        if lane["rounds"]:
            lanes.append(lane)
    lanes[1:] = sorted(lanes[1:], key=lambda l: l["rounds"][0]["start"])
    t0 = main["prompt"][0] if main["prompt"] else (main["rounds"][0]["start"] if main["rounds"] else 0.0)

    ops = []
    for index, lane in enumerate(lanes):
        for rnd in lane["rounds"]:
            for op in rnd["ops"]:
                op["lane"] = index
                ops.append(op)
    ops.sort(key=lambda o: (o["round"]["start"], o["lane"]))

    # Last thing the agent did: a trailing wait on a question the user dismissed is not agent time.
    end = t0
    for lane in lanes:
        for rnd in lane["rounds"]:
            waits = any(o["wait_s"] for o in rnd["ops"])
            end = max(end, rnd["model_end"] if waits else rnd["end"])

    totals = {kind: 0.0 for kind, _ in KINDS}
    for op in ops:
        kind = "answer" if op["kind"] == "ask" else op["kind"]
        totals[kind] = totals.get(kind, 0.0) + op["model_s"] + op["tool_s"]

    opened, opened_lane = {}, {}
    for op in ops:
        step = op["step"]
        if not step or step["returned"] is None:
            continue
        if op["kind"] == "read" and not step["dead"]:
            for path_ in op["files"]:
                if path_ not in opened:
                    opened[path_], opened_lane[path_] = step["returned"] - t0, op["lane"]
    quiet = ("AskUserQuestion", "Agent", "Task", "SubagentHandback")
    output_chars = sum(s["chars"] for s in {id(o["step"]): o["step"] for o in ops if o["step"]}.values() if s["tool"] not in quiet)
    by_step = {}  # one operation per tool call, a locate operation when the call has one
    for op in ops:
        if op["step"] and op["step"]["returned"] is not None:
            seen = by_step.get(id(op["step"]))
            if seen is None or (seen["kind"] not in ("semantic", "keyword") and op["kind"] in ("semantic", "keyword")):
                by_step[id(op["step"])] = op
    steps = sorted(by_step.values(), key=lambda o: o["step"]["returned"])
    official = main["official"] or {}
    usage = official.get("modelUsage") or {}
    tokens = sum(int(m.get(k) or 0) for m in usage.values() if isinstance(m, dict) for k in ("inputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"))
    return {
        "label": label,
        "session": os.path.splitext(os.path.basename(path))[0],
        "lanes": lanes,
        "ops": ops,
        "steps": steps,
        "t0": t0,
        "end": end - t0,
        "totals": totals,
        "opened": opened,
        "opened_lane": opened_lane,
        "output_chars": output_chars,
        "query": main["prompt"][1] if main["prompt"] else "",
        "cwd": main["cwd"],
        "interrupted": main["interrupted"],
        "rounds": sum(len(l["rounds"]) for l in lanes),
        "tools": len({id(o["step"]) for o in ops if o["step"]}),
        "cost": official.get("totalCostUSD"),
        "wall_ms": official.get("totalDuration"),
        "api_ms": official.get("totalAPIDuration"),
        "tokens": tokens or sum(r["context"] for l in lanes for r in l["rounds"]) or None,
        "model": next(iter(usage), ""),
    }


def locate_stats(leg):
    ops = [o for o in leg["ops"] if o["kind"] in ("semantic", "keyword")]
    steps = {id(o["step"]): o["step"] for o in ops}
    return {
        "time": sum(o["model_s"] + o["tool_s"] for o in ops),
        "semantic": sum(1 for o in ops if o["kind"] == "semantic"),
        "keyword": sum(1 for o in ops if o["kind"] == "keyword"),
        "dead": sum(1 for s in steps.values() if s["dead"]),
    }


def read_split(leg, other):
    """Seconds spent reading files the other run also read, and files only this run read."""
    both = only = 0.0
    for op in leg["ops"]:
        if op["kind"] != "read":
            continue
        seconds = op["model_s"] + op["tool_s"]
        if any(path in other["opened"] for path in op["files"]):
            both += seconds
        else:
            only += seconds
    return both, only


def find_surfaced(leg, path):
    """Seconds after the query when a tool result first named this file (path, else its name)."""
    base = os.path.basename(path)
    for needle in (path, base if len(base) >= 8 else None):
        if not needle:
            continue
        for op in leg["steps"]:
            if needle in op["step"]["text"]:
                return op["step"]["returned"] - leg["t0"], op
    return None, None


# ------------------------------------------------------------------------------------ rendering
CSS = """
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;
--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);--sem:#2a78d6;--kw:#eb6834;--read:#1baf7a;
--deleg:#52514e;--answer:#898781;--other:#c3c2b7;--kw-wash:rgba(235,104,52,.10);--sem-wash:rgba(42,120,214,.10)}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--page:#0d0d0d;
--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;
--border:rgba(255,255,255,.10);--sem:#3987e5;--kw:#d95926;--read:#199e70;--deleg:#a3a29a;--answer:#6b6a65;
--other:#454542;--kw-wash:rgba(217,89,38,.16);--sem-wash:rgba(57,135,229,.16)}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;
--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--sem:#3987e5;--kw:#d95926;
--read:#199e70;--deleg:#a3a29a;--answer:#6b6a65;--other:#454542;--kw-wash:rgba(217,89,38,.16);
--sem-wash:rgba(57,135,229,.16)}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto;padding:28px 24px 64px}
h1{font-size:22px;margin:0 0 4px;font-weight:650}
h2{font-size:15px;margin:0 0 2px;font-weight:650}
.sub{color:var(--ink2);margin:0 0 14px}
.query{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface);border:1px solid var(--border);
border-radius:6px;padding:2px 8px}
.verdict{font-size:16px;line-height:1.5;margin:18px 0 20px;max-width:980px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin:0 0 18px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:0 0 18px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.tile .lab{color:var(--ink2);font-size:12px;margin-bottom:8px}
.tile .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.tile .row span{color:var(--ink2);font-size:12px}
.tile .row b{font-size:20px;font-weight:650}
.tile .note{color:var(--muted);font-size:12px;margin-top:6px}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--ink2);font-size:12px;margin:10px 0 0}
.legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
svg{display:block;width:100%;height:auto}
svg text{font:11px system-ui,-apple-system,"Segoe UI",sans-serif;fill:var(--muted)}
svg .lane{fill:var(--ink2)} svg .leg{fill:var(--ink);font-size:13px;font-weight:650} svg .legsum{fill:var(--ink2);font-size:12px}
svg .mark{fill:var(--ink);font-size:11.5px}
.k-semantic{fill:var(--sem);background:var(--sem)} .k-keyword{fill:var(--kw);background:var(--kw)}
.k-read{fill:var(--read);background:var(--read)} .k-delegate{fill:var(--deleg);background:var(--deleg)}
.k-answer,.k-ask{fill:var(--answer);background:var(--answer)} .k-other{fill:var(--other);background:var(--other)}
.seg{cursor:default} .seg:hover{stroke:var(--ink);stroke-width:1.5}
.wait{fill:none;stroke:var(--axis);stroke-width:1}
.bars{display:grid;grid-template-columns:150px 1fr 64px;gap:10px 12px;align-items:center;margin-top:12px}
.bars .name{color:var(--ink2);font-size:12px} .bars .tot{font-variant-numeric:tabular-nums;text-align:right}
.stack{display:flex;gap:2px;height:28px}
.stack div{border-radius:4px;min-width:2px;color:#fff;font-size:11px;line-height:28px;padding-left:6px;overflow:visible;white-space:nowrap}
.stack .k-delegate{color:var(--surface)} .stack .k-other{color:var(--ink)}
td.d{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink2)} td i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px}
.diff{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;margin-top:12px}
.dhead{font-weight:650;padding:4px 0 6px;border-bottom:1px solid var(--grid);margin-bottom:4px}
.cell{border-radius:6px;padding:6px 10px;border-left:3px solid transparent;min-width:0}
.cell.empty{background:repeating-linear-gradient(135deg,transparent 0 7px,var(--grid) 7px 8px);opacity:.55;min-height:30px}
.cell.semantic{background:var(--sem-wash);border-left-color:var(--sem)}
.cell.keyword{background:var(--kw-wash);border-left-color:var(--kw)}
.cell.read{border-left-color:var(--read)} .cell.delegate{border-left-color:var(--deleg)}
.cell.answer,.cell.ask{border-left-color:var(--answer)} .cell.other{border-left-color:var(--other)}
.cell .top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:12px;color:var(--ink2)}
.cell .t{font-variant-numeric:tabular-nums;color:var(--muted);min-width:34px}
.cell .kind{font-weight:650;color:var(--ink)}
.tag{border:1px solid var(--border);border-radius:9px;padding:0 7px;font-size:11px;color:var(--ink2);white-space:nowrap}
.tag.bad{border-color:var(--kw);color:var(--ink)}
.cell code,.files code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.cell .cmd{margin-top:2px}
.cell .said{color:var(--muted);font-size:12px;font-style:italic;margin-bottom:2px}
details{margin-top:4px} summary{cursor:pointer;color:var(--muted);font-size:12px}
pre{font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--page);border:1px solid var(--border);
border-radius:6px;padding:8px 10px;margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}
table{border-collapse:collapse;width:100%;margin-top:10px;font-size:13px}
th{font-weight:600;color:var(--ink2);text-align:left;font-size:12px;border-bottom:1px solid var(--grid);padding:6px 10px 6px 0}
td{padding:6px 10px 6px 0;border-bottom:1px solid var(--grid);vertical-align:top}
td.n{font-variant-numeric:tabular-nums;white-space:nowrap} .dim{color:var(--muted)}
.foot{color:var(--ink2);font-size:13px} .foot li{margin:3px 0}
#tip{position:fixed;display:none;max-width:460px;background:var(--ink);color:var(--surface);border-radius:6px;padding:8px 10px;
font-size:12px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;z-index:10}
@media (max-width:820px){.diff{grid-template-columns:1fr}.bars{grid-template-columns:1fr}}
"""

JS = """
(function(){var tip=document.getElementById('tip');
document.addEventListener('mousemove',function(ev){var el=ev.target.closest('[data-tip]');
if(!el){tip.style.display='none';return}
tip.textContent=el.getAttribute('data-tip');tip.style.display='block';
var w=tip.offsetWidth,h=tip.offsetHeight,x=ev.clientX+14,y=ev.clientY+16;
if(x+w>window.innerWidth-8)x=Math.max(8,ev.clientX-w-14);
if(y+h>window.innerHeight-8)y=Math.max(8,ev.clientY-h-12);
tip.style.left=x+'px';tip.style.top=y+'px'});})();
"""


def op_css(op):
    return "answer" if op["kind"] == "ask" else op["kind"]


def op_name(op):
    if op.get("listing"):
        return "listing"
    if op.get("grep_in_file"):
        return "grep in file"
    return SHORT[op["kind"]]


def op_tip(op, leg):
    rnd, step = op["round"], op["step"]
    lines = [
        "%s · %s" % (op_name(op).capitalize(), leg["lanes"][op["lane"]]["label"]),
        clip(op["label"], 260),
        "%s → %s after the query" % (fmt_clock(rnd["start"] - leg["t0"]), fmt_clock(rnd["end"] - leg["t0"])),
        "model %s · tools %s%s" % (
            fmt_dur(rnd["model_end"] - rnd["start"]),
            fmt_dur(rnd["end"] - rnd["model_end"]),
            " · shared by %d operations" % len(rnd["ops"]) if len(rnd["ops"]) > 1 else "",
        ),
    ]
    if step:
        note = step["dead"] or ("dismissed by the user" if step["dismissed"] else "")
        lines.append("returned %s%s" % (fmt_size(step["chars"]), " · " + note if note else ""))
    return "\n".join(lines)


def leg_summary(leg):
    loc = locate_stats(leg)
    parts = []
    if loc["semantic"]:
        parts.append(plural(loc["semantic"], "semantic search"))
    if loc["keyword"]:
        parts.append(plural(loc["keyword"], "keyword search") + " & listings" * (loc["keyword"] > 1))
    if loc["dead"]:
        parts.append(plural(loc["dead"], "dead end"))
    parts.append(plural(len(leg["opened"]), "file") + " read")
    parts.append(plural(leg["rounds"], "model round-trip"))
    if len(leg["lanes"]) > 1:
        parts.append(plural(len(leg["lanes"]) - 1, "subagent"))
    return " · ".join(parts)


def render_timeline(legs, shared):
    width, gutter, right = 1160, 168, 56
    plot = width - gutter - right
    span = max(max(leg["end"] for leg in legs), 1.0)
    for leg in legs:
        for lane in leg["lanes"]:
            for rnd in lane["rounds"]:
                span = max(span, rnd["end"] - leg["t0"])
    step = next((s for s in (5, 10, 15, 30, 60, 120, 300, 600, 1800) if span / s <= 10), 3600)
    limit = step * int(span / step + 0.999)

    def x(seconds):
        return gutter + plot * max(0.0, seconds) / limit

    out, y = [], 30
    body = []
    for leg in legs:
        body.append('<text x="0" y="%d"><tspan class="leg">%s</tspan><tspan class="legsum" dx="14">%s</tspan></text>' % (
            y, esc(leg["label"]), esc(leg_summary(leg))))
        y += 30
        # Marker: the same file in both legs (the first one both read), else this leg's first read.
        target = next((p for p in shared if p in leg["opened"]), None)
        target = target or next(iter(sorted(leg["opened"], key=leg["opened"].get)), None)
        if target:
            at = leg["opened"][target]
            bottom = y + 8 + 34 * leg["opened_lane"].get(target, 0) + 24
            anchor, dx = ("end", -8) if x(at) > gutter + plot * 0.72 else ("start", 8)
            body.append('<rect x="%.1f" y="%d" width="1" height="%d" fill="var(--ink)" pointer-events="none"/>' % (x(at) - 0.5, y, bottom - y))
            body.append('<path d="M%.1f %d l-5 -8 h10 z" fill="var(--ink)"/>' % (x(at), y + 2))
            body.append('<text class="mark" x="%.1f" y="%d" text-anchor="%s">%s read %s after the query</text>' % (
                x(at) + dx, y - 1, anchor, esc(os.path.basename(target)), fmt_dur(at)))
        y += 8
        main_end = max([r["end"] - leg["t0"] for r in leg["lanes"][0]["rounds"]] + [leg["end"]])
        body.append('<text x="%.1f" y="%d" style="fill:var(--ink);font-weight:650">%s</text>' % (min(x(main_end) + 8, width - 44), y + 16, fmt_dur(leg["end"])))
        for lane in leg["lanes"]:
            body.append('<text class="lane" x="0" y="%d">%s</text>' % (y + 16, esc(clip(lane["label"], 26))))
            body.append('<rect x="%d" y="%d" width="%d" height="1" fill="var(--grid)"/>' % (gutter, y + 24, plot))
            for rnd in lane["rounds"]:
                # One block per operation. A round that ends in a wait (a question to the user, a
                # blocking subagent) draws the wait as an outline: it is not agent time.
                ops = rnd["ops"]
                waits = [o for o in ops if o["wait_s"]]
                busy_end = rnd["model_end"] if waits else rnd["end"]
                x0, x1 = x(rnd["start"] - leg["t0"]), x(busy_end - leg["t0"])
                piece = (x1 - x0) / len(ops)
                for n, op in enumerate(ops):
                    left = x0 + piece * n
                    w = max(0.8, piece - min(2.0, piece * 0.3))
                    body.append('<rect class="seg k-%s" x="%.1f" y="%d" width="%.1f" height="24" rx="3" data-tip="%s"/>' % (
                        op_css(op), left, y, w, esc(op_tip(op, leg))))
                    if op["step"] and op["step"]["dead"] and w >= 3:
                        body.append('<rect x="%.1f" y="%d" width="%.1f" height="24" rx="3" fill="url(#hatch)" pointer-events="none"/>' % (left, y, w))
                if waits and rnd["end"] > busy_end:
                    w = max(0.8, x(rnd["end"] - leg["t0"]) - x1 - 2)
                    body.append('<rect class="seg wait" x="%.1f" y="%d" width="%.1f" height="16" rx="3" data-tip="%s&#10;waiting %s (not counted as agent time)"/>' % (
                        x1, y + 4, w, esc(op_tip(waits[0], leg)), fmt_dur(rnd["end"] - busy_end)))
            y += 34
        y += 14
    height = y + 4
    out.append('<svg viewBox="0 0 %d %d" role="img" aria-label="Timeline of both runs on one time axis">' % (width, height))
    out.append('<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
               '<rect width="2.5" height="6" fill="var(--surface)" fill-opacity=".75"/></pattern></defs>')
    tick = 0
    while tick <= limit + 0.01:
        out.append('<rect x="%.1f" y="16" width="1" height="%d" fill="var(--grid)"/>' % (x(tick), height - 20))
        out.append('<text x="%.1f" y="11" text-anchor="middle">%s</text>' % (x(tick), fmt_clock(tick)))
        tick += step
    out.extend(body)
    out.append("</svg>")
    return "\n".join(out)


def render_legend():
    items = []
    for kind, label in KINDS:
        items.append('<span><i class="k-%s"></i>%s</span>' % (kind, esc(label)))
    items.append('<span><i style="background:repeating-linear-gradient(45deg,var(--kw) 0 3px,var(--surface) 3px 5px)"></i>dead end (no results, denied or failed)</span>')
    items.append('<span><i style="border:1px solid var(--axis);background:none"></i>waiting on the user or a subagent</span>')
    return '<div class="legend">%s</div>' % "".join(items)


def render_bars(legs):
    longest = max(sum(leg["totals"].values()) for leg in legs) or 1.0
    rows = []
    for leg in legs:
        total = sum(leg["totals"].values())
        segs = []
        for kind, label in KINDS:
            value = leg["totals"].get(kind, 0.0)
            if value <= 0:
                continue
            pct = 100.0 * value / longest
            text = fmt_dur(value) if pct * 8.6 >= 6.5 * len(fmt_dur(value)) + 14 else ""
            segs.append('<div class="k-%s" style="width:%.2f%%" data-tip="%s&#10;%s · %d%% of this run\'s agent time">%s</div>' % (
                kind, pct, esc(label), fmt_dur(value), round(100 * value / total) if total else 0, text))
        rows.append('<div class="name">%s</div><div class="stack">%s</div><div class="tot">%s</div>' % (esc(leg["label"]), "".join(segs), fmt_dur(total)))
    a, b = legs
    lines = []

    def line(kind, label, va, vb, indent=False):
        if va < 0.05 and vb < 0.05:
            return
        diff = vb - va
        lines.append('<tr><td>%s%s</td><td class="n">%s</td><td class="n">%s</td><td class="d">%s%s</td></tr>' % (
            "" if indent else '<i class="k-%s"></i>' % kind, ('<span class="dim" style="padding-left:17px">%s</span>' % esc(label)) if indent else esc(label),
            fmt_dur(va) if va >= 0.05 else "–", fmt_dur(vb) if vb >= 0.05 else "–", "+" if diff >= 0 else "−", fmt_dur(abs(diff))))

    for kind, label in KINDS:
        line(kind, label, a["totals"].get(kind, 0.0), b["totals"].get(kind, 0.0))
        if kind == "read":
            (a_both, a_only), (b_both, b_only) = read_split(a, b), read_split(b, a)
            line(kind, "files both runs read", a_both, b_both, True)
            line(kind, "files only that run read", a_only, b_only, True)
    ta, tb = sum(a["totals"].values()), sum(b["totals"].values())
    lines.append('<tr><td><b>Agent time</b></td><td class="n"><b>%s</b></td><td class="n"><b>%s</b></td><td class="d">+%s</td></tr>' % (fmt_dur(ta), fmt_dur(tb), fmt_dur(tb - ta)))
    table = ('<table><thead><tr><th>Kind of work</th><th>%s</th><th>%s</th><th>Difference</th></tr></thead><tbody>%s</tbody></table>'
             % (esc(a["label"]), esc(b["label"]), "".join(lines)))
    return '<div class="bars">%s</div>%s' % ("".join(rows), table)


def render_cell(op, leg, other, matched):
    if op is None:
        return '<div class="cell empty"></div>'
    step, rnd = op["step"], op["round"]
    tags = []
    if leg["lanes"][op["lane"]]["label"] != "Main agent":
        tags.append('<span class="tag">subagent</span>')
    if op["kind"] == "read":
        for path in op["files"]:
            tags.append('<span class="tag">%s</span>' % ("also read in the other run" if path in other["opened"] else "only this run"))
    if step and step["dead"]:
        tags.append('<span class="tag bad">✕ %s</span>' % esc(step["dead"]))
    if step and step["dismissed"]:
        tags.append('<span class="tag">dismissed by the user</span>')
    meta = fmt_dur(op["model_s"] + op["tool_s"])
    if step and step["chars"] and op["first_in_step"] and op["kind"] != "ask":
        meta += " · %s into context" % fmt_size(step["chars"])
        if op["kind"] == "semantic" and step["hits"]:
            meta += " · %s" % plural(len(step["hits"]), "hit")
        elif op["kind"] == "keyword" and not step["dead"]:
            meta += " · %s" % plural(step["lines"], "line")
    label = op["label"]
    if op["kind"] == "read" and op["files"] and not op.get("grep_in_file"):
        label = op["files"][0]
    parts = ['<div class="cell %s"%s>' % (op_css(op), ' data-matched="1"' if matched else "")]
    if rnd["said"] and op is rnd["ops"][0]:
        parts.append('<div class="said">“%s”</div>' % esc(rnd["said"]))
    parts.append('<div class="top"><span class="t">%s</span><span class="kind">%s</span><span>%s</span>%s</div>' % (
        fmt_clock(rnd["start"] - leg["t0"]), esc(op_name(op)), esc(meta), "".join(tags)))
    parts.append('<div class="cmd"><code>%s</code></div>' % esc(clip(label, 150)))
    if step and op["first_in_step"] and (step["command"] or step["preview"]):
        title = "command & output" if step["tool"] == "Bash" else "details"
        if step["nops"] > 1:
            title += " (one shell call, %d operations)" % step["nops"]
        inner = ""
        if step["command"] and step["command"] != label:
            inner += "<pre>%s</pre>" % esc(step["command"][:2500])
        if step["preview"]:
            more = "\n… (%s in total)" % fmt_size(step["chars"]) if step["chars"] > len(step["preview"]) else ""
            inner += "<pre>%s%s</pre>" % (esc(step["preview"]), esc(more))
        if inner:
            parts.append("<details><summary>%s</summary>%s</details>" % (esc(title), inner))
    elif step and not op["first_in_step"]:
        parts.append('<div class="dim" style="font-size:12px">↳ same shell call as above</div>')
    parts.append("</div>")
    return "".join(parts)


def align_key(op):
    if op["kind"] in ("semantic", "keyword"):
        return "locate"
    if op["kind"] == "read":
        return "read:" + (op["files"][0] if op["files"] else "")
    if op["kind"] == "other":
        return "other:" + (op["step"]["tool"] if op["step"] else "")
    return op["kind"]


def render_diff(a, b):
    keys_a, keys_b = [align_key(o) for o in a["ops"]], [align_key(o) for o in b["ops"]]
    rows = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, keys_a, keys_b, autojunk=False).get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                rows.append((a["ops"][i1 + k], b["ops"][j1 + k], True))
        else:
            left, right = a["ops"][i1:i2], b["ops"][j1:j2]
            for k in range(max(len(left), len(right))):
                rows.append((left[k] if k < len(left) else None, right[k] if k < len(right) else None, False))
    cells = ['<div class="dhead">%s</div><div class="dhead">%s</div>' % (esc(a["label"]), esc(b["label"]))]
    for left, right, matched in rows:
        cells.append(render_cell(left, a, b, matched))
        cells.append(render_cell(right, b, a, matched))
    return '<div class="diff">%s</div>' % "".join(cells)


def render_files(a, b):
    paths = sorted(set(a["opened"]) | set(b["opened"]), key=lambda p: (not (p in a["opened"] and p in b["opened"]), min(a["opened"].get(p, 1e9), b["opened"].get(p, 1e9))))
    if not paths:
        return ""
    rows = []
    for path in paths:
        cols = []
        for leg in (a, b):
            opened = leg["opened"].get(path)
            seen, by = find_surfaced(leg, path)
            if opened is None:
                cols.append('<td class="n dim">not read</td>')
                continue
            how = ""
            if by is not None and seen is not None and seen < opened - 0.05:
                how = '<div class="dim">first named %s by a %s</div>' % (fmt_dur(seen), esc(op_name(by)))
            cols.append('<td class="n">%s%s</td>' % (fmt_dur(opened), how))
        folder = os.path.dirname(path)
        rows.append('<tr><td><code>%s</code>%s</td>%s</tr>' % (
            esc(os.path.basename(path)), '<div class="dim" style="font-size:12px">%s</div>' % esc(folder) if folder else "", "".join(cols)))
    return ('<table class="files"><thead><tr><th>File</th><th>%s: read after</th><th>%s: read after</th></tr></thead><tbody>%s</tbody></table>'
            % (esc(a["label"]), esc(b["label"]), "".join(rows)))


def ratio_note(with_value, without_value, unit_word):
    if not with_value or not without_value:
        return ""
    if without_value >= with_value:
        return "%.1f× %s without" % (without_value / with_value, unit_word)
    return "%.1f× %s with" % (with_value / without_value, unit_word)


def tile(label, a, b, value_a, value_b, note=""):
    return ('<div class="tile"><div class="lab">%s</div><div class="row"><span>%s</span><b>%s</b></div>'
            '<div class="row"><span>%s</span><b>%s</b></div>%s</div>'
            % (esc(label), esc(a["short"]), esc(value_a), esc(b["short"]), esc(value_b), '<div class="note">%s</div>' % esc(note) if note else ""))


def render(a, b, query):
    shared = sorted(set(a["opened"]) & set(b["opened"]), key=lambda p: a["opened"][p])
    la, lb = locate_stats(a), locate_stats(b)

    def how(loc):
        bits = []
        if loc["semantic"]:
            bits.append(plural(loc["semantic"], "semantic search"))
        if loc["keyword"]:
            bits.append(plural(loc["keyword"], "keyword search") + (" and listings" if loc["keyword"] > 1 else ""))
        text = " and ".join(bits) or "no search"
        if loc["dead"]:
            text += ", %s" % plural(loc["dead"], "dead end")
        return text

    verdict = "Locating the code took <b>%s</b> of agent time %s (%s) and <b>%s</b> %s (%s)." % (
        fmt_dur(la["time"]), esc(a["phrase"]), esc(how(la)), fmt_dur(lb["time"]), esc(b["phrase"]), esc(how(lb)))
    if shared:
        first = shared[0]
        verdict += " Both runs read %s; the first, <code>%s</code>, was read %s after the query %s and %s %s." % (
            "the same %d files" % len(shared) if len(shared) > 1 else "one file in common",
            esc(os.path.basename(first)), fmt_dur(a["opened"][first]), esc(a["phrase"]), fmt_dur(b["opened"][first]), esc(b["phrase"]))

    _, only = read_split(b, a)
    spent = [(lb["time"] if lb["keyword"] else 0.0, "keyword searches and listings"), (only, "reading files the other run never opened"),
             (b["totals"].get("delegate", 0.0), "briefing a subagent and writing its report")]
    spent = ["<b>%s</b> %s %s" % (fmt_dur(value), "to" if n else "went to", text) for n, (value, text) in enumerate(v for v in spent if v[0] >= 1.0)]
    if spent:
        verdict += " Of the %s of agent time %s, %s." % (
            fmt_dur(sum(b["totals"].values())), esc(b["phrase"]), (", ".join(spent[:-1]) + " and " + spent[-1]) if len(spent) > 1 else spent[0])

    tiles = []
    if a["cost"] is not None and b["cost"] is not None:
        tiles.append(tile("Cost (Claude Code's official figure)", a, b, "$%.2f" % a["cost"], "$%.2f" % b["cost"], ratio_note(a["cost"], b["cost"], "the cost")))
    tiles.append(tile("Query → last agent action", a, b, fmt_dur(a["end"]), fmt_dur(b["end"]), ratio_note(a["end"], b["end"], "as long")))
    tiles.append(tile("Agent time spent locating code", a, b, fmt_dur(la["time"]), fmt_dur(lb["time"]),
                      "%s vs %s" % (plural(la["semantic"] + la["keyword"], "search"), plural(lb["semantic"] + lb["keyword"], "search"))))
    tiles.append(tile("Tool output read by the model", a, b, fmt_size(a["output_chars"]), fmt_size(b["output_chars"]),
                      ratio_note(a["output_chars"], b["output_chars"], "the output")))
    tiles.append(tile("Model round-trips", a, b, str(a["rounds"]), str(b["rounds"]), "%s vs %s" % (plural(a["tools"], "tool call"), plural(b["tools"], "tool call"))))
    if a["tokens"] and b["tokens"]:
        tiles.append(tile("Input tokens processed", a, b, fmt_tokens(a["tokens"]), fmt_tokens(b["tokens"]), ratio_note(a["tokens"], b["tokens"], "the tokens")))

    notes = []
    for leg in (a, b):
        if leg["interrupted"]:
            notes.append("<li><b>%s</b> ended when the user dismissed the agent's question; the trajectory stops there%s.</li>" % (
                esc(leg["label"]), " (a subagent already running kept going)" if len(leg["lanes"]) > 1 else ""))
    official = []
    for leg in (a, b):
        if leg["wall_ms"]:
            official.append("%s: wall %s, API %s" % (leg["short"], fmt_dur(leg["wall_ms"] / 1000.0), fmt_dur((leg["api_ms"] or 0) / 1000.0)))
    meta = [m for m in (a["model"], os.path.basename(a["cwd"].rstrip("/")) if a["cwd"] else "",
                        datetime.datetime.fromtimestamp(a["t0"]).strftime("%Y-%m-%d %H:%M") if a["t0"] else "") if m]
    files = render_files(a, b)
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trajectory diff: %(title)s</title><style>%(css)s</style></head><body><main>
<h1>Trajectory diff: semantic retrieval vs. keyword search</h1>
<p class="sub">Query <span class="query">%(query)s</span> · %(meta)s</p>
<p class="verdict">%(verdict)s</p>
<div class="tiles">%(tiles)s</div>
<section class="card" id="timeline"><h2>Both runs on one time axis</h2>
<p class="sub">Seconds since the query was sent. Each block is one operation (the model deciding on it, then the tool running); hover for the command. Subagents get their own lane.</p>
%(timeline)s%(legend)s</section>
<section class="card" id="time"><h2>Where the agent time went</h2>
<p class="sub">Agent-seconds per kind of work, summed over the main agent and its subagents (they overlap in wall-clock time). Waiting on the user is left out.</p>
%(bars)s</section>
<section class="card" id="diff"><h2>Step-by-step diff</h2>
<p class="sub">Rows are aligned like a code diff: a locate step on one side sits beside a locate step on the other, a read beside a read of the same file. Orange rows are keyword searches and listings, blue is semantic retrieval; a hatched cell means the other run needed no step there.</p>
%(diff)s</section>
%(files)s
<section class="card foot" id="notes"><h2>How to read this</h2><ul>
<li><b>Locating</b> is any step that finds where code lives: a semantic search, or a keyword search / listing over the repository or a folder (<code>rg</code>, <code>grep</code>, <code>find</code>, <code>ls</code>, the Grep and Glob tools). A grep inside a named file counts as <b>reading</b> it.</li>
<li>A model call and the tools it ran form one round; its time is split evenly among its operations. A shell call that chains several commands is split into one operation per command.</li>
<li>Cost, wall and API time are Claude Code's own figures for the session (%(official)s). Every other number is measured from the transcript timestamps.</li>
<li>This is one query run once per leg: read it as an illustration of how the two trajectories differ, not as a benchmark average. The runs did not do identical work: files marked "only this run" are extra reading, not search overhead.</li>
%(notes)s</ul>
<p class="dim">Sessions: %(sa)s (%(la)s) · %(sb)s (%(lb)s)</p></section>
</main><div id="tip"></div><script>%(js)s</script></body></html>
""" % {
        "title": esc(clip(query, 80)), "css": CSS, "js": JS, "query": esc(clip(query, 300)), "meta": esc(" · ".join(meta)),
        "verdict": verdict, "tiles": "".join(tiles), "timeline": render_timeline([a, b], shared), "legend": render_legend(),
        "bars": render_bars([a, b]), "diff": render_diff(a, b),
        "files": '<section class="card" id="files"><h2>Files the runs read</h2><p class="sub">When each file was read, in time since the query, and which earlier step first named it.</p>%s</section>' % files if files else "",
        "official": esc("; ".join(official) or "not recorded in these transcripts"), "notes": "".join(notes),
        "sa": esc(a["session"]), "la": esc(a["label"]), "sb": esc(b["session"]), "lb": esc(b["label"]),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="HTML trajectory diff of the two benchmark sessions.")
    parser.add_argument("--with", dest="with_ref", required=True, help="session id or transcript of the run WITH JetBrains Context")
    parser.add_argument("--without", dest="without_ref", required=True, help="session id or transcript of the run WITHOUT it")
    parser.add_argument("--with-label", default="With JetBrains Context")
    parser.add_argument("--without-label", default="Without JetBrains Context")
    parser.add_argument("--query", default="", help="the benchmarked query (default: the first prompt of the --with session)")
    parser.add_argument("--out", default="", help="output file (default: ./trajectory-diff-<session>.html)")
    parser.add_argument("--open", action="store_true", help="open the report in the default browser")
    parser.add_argument("--no-previews", action="store_true", help="leave tool output and full commands out of the report (the one-line step labels stay)")
    args = parser.parse_args(argv)

    a = load_leg(args.with_ref, args.with_label, not args.no_previews)
    b = load_leg(args.without_ref, args.without_label, not args.no_previews)
    a.update(short="with", phrase="with JetBrains Context")
    b.update(short="without", phrase="without it")
    if args.with_label != parser.get_default("with_label"):
        a.update(short=args.with_label, phrase="in “%s”" % args.with_label)
    if args.without_label != parser.get_default("without_label"):
        b.update(short=args.without_label, phrase="in “%s”" % args.without_label)
    if not a["ops"] or not b["ops"]:
        raise SystemExit("trajectory_report: a session has no assistant turns (did the measured run execute the query?)")

    out = args.out or "trajectory-diff-%s.html" % a["session"][:8]
    page = render(a, b, args.query or a["query"])
    try:
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        with open(out, "w", encoding="utf-8") as handle:
            handle.write(page)
    except OSError as error:  # say which path, not a traceback: the callers relay this line
        raise SystemExit("trajectory_report: cannot write %s: %s" % (os.path.abspath(out), error.strerror or error)) from None
    print(os.path.abspath(out))
    if args.open:
        opener = "open" if sys.platform == "darwin" else ("xdg-open" if os.name != "nt" else None)
        try:
            if opener:
                subprocess.Popen([opener, out], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                os.startfile(os.path.abspath(out))  # type: ignore[attr-defined]
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

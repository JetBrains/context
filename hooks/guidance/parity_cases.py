#!/usr/bin/env python3
"""Parity cases for the guidance router: inputs here, expected outputs recorded from guidance_hook.py.

The JSON this writes (parity_cases.json) is the contract between the reference router
(guidance_hook.py) and its port in the jbcontext CLI (`jbcontext hook <event> --mode guidance`):
both test suites replay every case and must reproduce the recorded outputs and log events.

  python3 hooks/guidance/parity_cases.py --write   regenerate parity_cases.json from the Python router
  python3 hooks/guidance/parity_cases.py --check   exit 1 if parity_cases.json is stale

Regenerate after any change to guidance_hook.py or the node files, and review the diff.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import guidance_hook as gh  # noqa: E402

SCRIPT = HERE / "guidance_hook.py"
OUT = HERE / "parity_cases.json"

SESSION = "s1"
CWD = "/repo"
DEFAULT_TRANSCRIPT = [{"type": "user", "message": {"role": "user", "content": "Where do we retry failed uploads?"}}]
# Log fields that vary between runs or implementations; not part of the contract.
VOLATILE_EVENT_FIELDS = ("ts", "session_id", "latency_ms", "error")

JB, REG, EXP = gh.JBCONTEXT, gh.REGULAR, gh.EXPLORER


def pre(tool, node=None, **tool_input):
    """`node`: what the fake classifier selects (GUIDANCE_FAKE_NODE); None makes the classifier fail."""
    return {"mode": "pre", "tool_name": tool, "tool_input": tool_input, "node": node}


# ---------------------------------------------------------------------------
# Flow cases: sequences of hook calls through the real entry point
# ---------------------------------------------------------------------------

FLOWS = [
    {"name": "mismatch_deny_once_then_noncompliant", "steps": [
        pre("Grep", JB, pattern="retry"),
        pre("Grep", REG, pattern="retry")]},
    {"name": "match_allows_with_guidance_once_then_follow_up", "steps": [
        pre("Bash", JB, command="jbcontext search \"upload retry policy\""),
        pre("Bash", JB, command="jbcontext search \"other\""),
        pre("Grep", JB, pattern="UploadRetryPolicy")]},
    {"name": "mcp_call_gets_mcp_instruction", "steps": [
        pre("mcp__jbcontext__code_search", JB, text="where upload retries are scheduled")]},
    {"name": "episode_end_reclassifies", "steps": [
        pre("Grep", REG, pattern="retry"),
        pre("Edit", file_path="a.py"),
        pre("Grep", JB, pattern="retry")]},
    {"name": "bash_test_run_ends_episode", "steps": [
        pre("Grep", REG, pattern="retry"),
        pre("Bash", command="./gradlew test | grep FAIL"),
        pre("Grep", JB, pattern="retry")]},
    {"name": "reads_skip_classifier_exact_search_classified", "steps": [
        pre("Read", JB, file_path="src/a.py"),
        pre("Grep", REG, pattern="x", path="src/auth/Login.kt"),
        pre("Bash", REG, command="rg -n foo src/auth")]},
    {"name": "neutral_tools_ignored", "steps": [
        pre("TodoWrite", JB, todos=[]),
        pre("Bash", JB, command="echo hi"),
        pre("Agent", JB, subagent_type="general-purpose", prompt="do x")]},
    {"name": "explore_builtin_is_regular_intent", "steps": [
        pre("Agent", REG, subagent_type="Explore", prompt="find X"),
        pre("Edit", file_path="a.py"),
        pre("Agent", EXP, subagent_type="Explore", prompt="map the upload flow")]},
    {"name": "explorer_foreground_result_and_cap", "steps": [
        pre("Agent", EXP, subagent_type="context-explorer", prompt="map", run_in_background=True),
        {"mode": "post", "tool_name": "Agent", "tool_input": {"subagent_type": "context-explorer"},
         "tool_response": {}},
        pre("Agent", EXP, subagent_type="context-explorer", prompt="map again"),
        pre("Grep", JB, pattern="upload"),
        pre("Edit", file_path="a.py"),
        pre("Grep", EXP, pattern="upload")]},
    {"name": "explorer_redirected_to_jbcontext", "steps": [
        pre("Agent", JB, subagent_type="context-explorer", prompt="where are retries")]},
    {"name": "grep_redirected_to_explorer", "steps": [
        pre("Grep", EXP, pattern="upload")]},
    {"name": "post_ignores_other_agents", "steps": [
        {"mode": "post", "tool_name": "Agent", "tool_input": {"subagent_type": "general-purpose"},
         "tool_response": {}}]},
    {"name": "subagent_calls_not_routed", "steps": [
        {"mode": "pre", "tool_name": "Grep", "tool_input": {"pattern": "x"}, "node": JB,
         "agent_id": "a1", "agent_type": "context-explorer"}]},
    {"name": "classifier_error_fails_open_for_episode", "steps": [
        pre("Grep", None, pattern="retry"),
        pre("Bash", None, command="jbcontext search x")]},
    {"name": "prompt_resets", "steps": [
        pre("Grep", REG, pattern="retry"),
        {"mode": "prompt", "prompt": "next task"},
        pre("Grep", JB, pattern="retry")]},
    {"name": "disabled_is_noop", "env": {"GUIDANCE_DISABLED": "1"}, "steps": [
        pre("Grep", JB, pattern="retry")]},
]

# ---------------------------------------------------------------------------
# Unit tables: pure functions, expected values recorded from guidance_hook.py
# ---------------------------------------------------------------------------

CATEGORIZE = [
    ("Edit", {}), ("Write", {"file_path": "a"}), ("Read", {"file_path": "a.py"}), ("Glob", {"pattern": "**/*.kt"}),
    ("Grep", {"pattern": "foo"}), ("mcp__jbcontext__code_search", {"text": "x"}), ("mcp__embark-catalog__x", {}),
    ("Skill", {"skill": "context-search"}), ("Skill", {"skill": "loop"}),
    ("Agent", {"subagent_type": "context-explorer"}), ("Task", {"subagent_type": "context-explorer"}),
    ("Agent", {"subagent_type": "Explore"}), ("Agent", {"subagent_type": "general-purpose"}),
    ("TodoWrite", {"todos": []}), ("WebSearch", {"query": "x"}),
] + [("Bash", {"command": c}) for c in [
    "rg -n 'retry' .", "cd repo && rg foo", "find . -name '*.kt'", "git grep processRequest",
    "jbcontext search \"where retries happen\"", "bash -c 'jbcontext search x'", "jbcontext search --help 2>&1 | head -60",
    "cat build.gradle.kts | grep version", "sed -n 1,80p src/a.py", "git log --oneline -5", "./gradlew test | grep FAIL",
    "pytest -q 2>&1 | tail -5", "git commit -m x", "echo hi", "ls -la src", "FOO=1 rg bar", "sudo -u x grep -rn y .",
    "xargs grep foo", "find . -name '*.py' | xargs grep -l retry", "grep -rn 'a|b' src", "git status && git diff",
    "jbcontext index", "cd /repo; grep -rn \"x y\" . 2>/dev/null | head", "bash -c \"rg foo && ./gradlew build\"",
    "python3 - <<'EOF'\nprint(1)\nEOF", "rg foo > /tmp/out.txt", "(cd src && grep -rn x .)", "unterminated 'quote",
    "embark search query", "git -C repo grep foo", "ls | grep x", "fd Login src",
]]

TRANSCRIPTS = [
    ("basic", [
        {"type": "user", "message": {"content": "old task"}},
        {"type": "user", "message": {"content": "Fix retry of uploads"}},
        {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "Let me look."},
            {"type": "tool_use", "id": "t1", "name": "Grep", "input": {"pattern": "retry"}}]}},
        {"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": "src/a.py:3: retry()"}]}},
        {"type": "assistant", "isSidechain": True, "message": {"content": [{"type": "text", "text": "x"}]}},
    ], "not json\n"),
    ("thinking_list_results_and_reminders", [
        {"type": "user", "message": {"content": [{"type": "text", "text": "Map the upload flow"}]}},
        {"type": "assistant", "message": {"content": [
            {"type": "thinking", "thinking": "I should find where uploads start."},
            {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "rg upload"}}]}},
        {"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": [{"type": "text", "text": "a.py:1: upload()"}]},
            {"type": "text", "text": "<system-reminder>ignore</system-reminder>"}]}},
        {"type": "system", "message": {"content": "x"}},
        {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "  "},
            {"type": "tool_use", "id": "t2", "name": "Read", "input": {"file_path": "a.py"}}]}},
    ], ""),
    ("long_values_are_clipped", [
        {"type": "user", "message": {"content": "T" * 3100}},
        {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "R" * 900},
            {"type": "tool_use", "id": "t1", "name": "Grep", "input": {"pattern": "P" * 500}}]}},
        {"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": "t1", "content": "O" * 600}]}},
    ], ""),
]

CLASSIFIER_STATES = [
    ("pending_call_and_lagging_copy_not_sent", "Fix upload retries", [
        {"reasoning": "I need the place where uploads are retried."},
        {"tool": "Read", "input": "{}", "result": "x"},
        {"tool": "Grep", "input": "{\"pattern\": \"retry\"}"}], "Grep", {"pattern": "retry"}),
    ("far_prompt_dropped_earlier_reasoning_kept", "old prompt",
     [{"reasoning": "plan A"}, {"reasoning": "plan B"}]
     + [{"tool": "Read", "input": str(i), "result": "r"} for i in range(gh.RECENT_STEPS + 2)]
     + [{"reasoning": "now find where tokens are refreshed"}], "Grep", {"pattern": "TokenRefresher", "path": "src"}),
    ("short_session_keeps_prompt", "Fix it", [{"tool": "Grep", "input": "{}", "result": "r"}], "Bash",
     {"command": "rg -n " + "x" * 450}),
]

ALLOWED_NODES = list(range(gh.MAX_EXPLORER_RUNS + 2))


# ---------------------------------------------------------------------------
# Recording
# ---------------------------------------------------------------------------


def run_flow(flow):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        transcript = root / "t.jsonl"
        transcript.write_text("\n".join(json.dumps(r) for r in flow.get("transcript", DEFAULT_TRANSCRIPT)) + "\n")
        env = {**os.environ, "HOME": str(root), "GUIDANCE_STATE_DIR": str(root / "state"),
               "GUIDANCE_LOG_DIR": str(root / "logs"), "TYPESAFE_API_KEY": "", "ANTHROPIC_API_KEY": "", "ANTHROPIC_AUTH_TOKEN": "",
                    "GUIDANCE_ANTHROPIC_API_KEY": "", "GUIDANCE_ANTHROPIC_BASE_URL": "http://127.0.0.1:9/never",
               "GUIDANCE_JEV_URL": "http://127.0.0.1:9/never", **flow.get("env", {})}
        for name in ("GUIDANCE_FAKE_NODE",) + (() if "GUIDANCE_DISABLED" in flow.get("env", {}) else ("GUIDANCE_DISABLED",)):
            env.pop(name, None)
        log = root / "logs" / f"{SESSION}.log"
        recorded = []
        for step in flow["steps"]:
            step_env = dict(env)
            if step.get("node") is not None:
                step_env["GUIDANCE_FAKE_NODE"] = step["node"]
            payload = {"session_id": SESSION, "transcript_path": str(transcript), "cwd": CWD}
            payload.update({k: v for k, v in step.items() if k not in ("mode", "node")})
            before = len(log.read_text().splitlines()) if log.exists() else 0
            out = subprocess.run([sys.executable, str(SCRIPT), step["mode"]], input=json.dumps(payload),
                                 capture_output=True, text=True, env=step_env, check=True)
            output = json.loads(out.stdout) if out.stdout.strip() else None
            lines = log.read_text().splitlines()[before:] if log.exists() else []
            events = []
            for line in lines:
                event = json.loads(line)
                for key in VOLATILE_EVENT_FIELDS:
                    event.pop(key, None)
                events.append(event)
            recorded.append({**step, "expect": {"output": output, "events": events}})
        return {**{k: v for k, v in flow.items() if k != "steps"}, "steps": recorded}


def build():
    return {
        "_comment": "Generated by parity_cases.py --write from guidance_hook.py. Do not edit by hand.",
        "session_id": SESSION,
        "cwd": CWD,
        "default_transcript": DEFAULT_TRANSCRIPT,
        "volatile_event_fields": list(VOLATILE_EVENT_FIELDS),
        "constants": {"recent_steps": gh.RECENT_STEPS, "max_explorer_runs": gh.MAX_EXPLORER_RUNS},
        "flows": [run_flow(f) for f in FLOWS],
        "categorize": [{"tool": t, "input": i, "expect": gh.categorize(t, i)} for t, i in CATEGORIZE],
        "read_transcript": [{"name": n, "rows": rows, "trailer": trailer,
                             "expect": dict(zip(("task", "steps"), read(rows, trailer)))}
                            for n, rows, trailer in TRANSCRIPTS],
        "classifier_state": [{"name": n, "task": task, "steps": steps, "tool": tool, "tool_input": tool_input,
                              "expect": gh.classifier_state(task, steps, tool, tool_input)}
                             for n, task, steps, tool, tool_input in CLASSIFIER_STATES],
        "allowed_nodes": [{"explorer_runs": r, "expect": gh.allowed_nodes(r)} for r in ALLOWED_NODES],
    }


def read(rows, trailer):
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        f.write("\n".join(json.dumps(r) for r in rows) + "\n" + trailer)
    try:
        return gh.read_transcript(f.name)
    finally:
        os.unlink(f.name)


def render(data):
    return json.dumps(data, indent=1, ensure_ascii=False) + "\n"


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--check"
    text = render(build())
    if mode == "--write":
        OUT.write_text(text, encoding="utf-8")
        print(f"wrote {OUT}")
        return 0
    if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
        print(f"{OUT.name} is stale: run python3 hooks/guidance/parity_cases.py --write", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

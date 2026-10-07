#!/usr/bin/env python3
"""Tests for guidance_hook.py. Run: python3 hooks/guidance/test_guidance_hook.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import guidance_hook as gh  # noqa: E402

SCRIPT = HERE / "guidance_hook.py"


class CategorizeTest(unittest.TestCase):
    def cat(self, tool, **tool_input):
        return gh.categorize(tool, tool_input)

    def test_tools(self):
        self.assertEqual(self.cat("Edit"), "end")
        self.assertEqual(self.cat("Read", file_path="a.py"), "read")
        self.assertEqual(self.cat("Glob", pattern="**/*.kt"), "read")
        self.assertEqual(self.cat("Grep", pattern="foo"), "regular")
        self.assertEqual(self.cat("mcp__jbcontext__code_search", text="x"), "jbcontext")
        self.assertEqual(self.cat("Skill", skill="context-search"), "jbcontext")
        self.assertEqual(self.cat("Skill", skill="loop"), "neutral")
        self.assertEqual(self.cat("Agent", subagent_type="context-explorer"), "explorer")
        self.assertEqual(self.cat("Agent", subagent_type="Explore"), "regular")
        self.assertEqual(self.cat("Agent", subagent_type="general-purpose"), "neutral")
        self.assertEqual(self.cat("TodoWrite", todos=[]), "neutral")

    def test_bash(self):
        b = lambda c: self.cat("Bash", command=c)  # noqa: E731
        self.assertEqual(b("rg -n 'retry' ."), "regular")
        self.assertEqual(b("cd repo && rg foo"), "regular")
        self.assertEqual(b("find . -name '*.kt'"), "regular")
        self.assertEqual(b("git grep processRequest"), "regular")
        self.assertEqual(b("jbcontext search \"where retries happen\""), "jbcontext")
        self.assertEqual(b("bash -c 'jbcontext search x'"), "jbcontext")
        self.assertEqual(b("jbcontext search --help 2>&1 | head -60"), "read")
        self.assertEqual(b("cat build.gradle.kts | grep version"), "read")
        self.assertEqual(b("sed -n 1,80p src/a.py"), "read")
        self.assertEqual(b("git log --oneline -5"), "read")
        self.assertEqual(b("./gradlew test | grep FAIL"), "end")
        self.assertEqual(b("pytest -q 2>&1 | tail -5"), "end")
        self.assertEqual(b("git commit -m x"), "end")
        self.assertEqual(b("echo hi"), "neutral")


class PrefilterTest(unittest.TestCase):
    def test_grep_tool(self):
        self.assertTrue(gh.prefilter_allows("Grep", {"pattern": "x", "path": "src/auth/Login.kt"}, "/repo"))
        self.assertTrue(gh.prefilter_allows("Grep", {"pattern": "x", "path": "src/auth"}, "/repo"))
        self.assertTrue(gh.prefilter_allows("Grep", {"pattern": "x", "path": "/tmp/out.log"}, "/repo"))
        self.assertFalse(gh.prefilter_allows("Grep", {"pattern": "x"}, "/repo"))
        self.assertFalse(gh.prefilter_allows("Grep", {"pattern": "x", "path": "/repo"}, "/repo"))
        self.assertFalse(gh.prefilter_allows("Grep", {"pattern": "x", "path": "src"}, "/repo"))

    def test_bash(self):
        p = lambda c: gh.prefilter_allows("Bash", {"command": c}, "/repo")  # noqa: E731
        self.assertTrue(p("rg -n foo src/auth"))
        self.assertTrue(p("grep -rn foo src/auth/Login.kt 2>/dev/null"))
        self.assertTrue(p("rg -e foo -e bar src/main/kotlin"))
        self.assertFalse(p("rg -n 'retry'"))
        self.assertFalse(p("rg -n retry ."))
        self.assertFalse(p("find . -name '*.kt'"))
        self.assertTrue(p("find build/reports -name '*.xml'"))


class ClassifierInputTest(unittest.TestCase):
    """The classifier sees recent steps and reasoning, never the pending call itself."""

    def test_pending_call_and_lagging_copy_not_sent(self):
        steps = [{"reasoning": "I need the place where uploads are retried."},
                 {"tool": "Read", "input": "{}", "result": "x"},
                 {"tool": "Grep", "input": '{"pattern": "retry"}'}]  # lagging copy of the pending call
        state = gh.classifier_state("Fix upload retries", steps, "Grep")
        self.assertEqual(state["user_prompt"], "Fix upload retries")
        self.assertEqual(state["recent_steps"], steps[:2])
        self.assertNotIn("retry\"", json.dumps(state))

    def test_far_prompt_dropped_earlier_reasoning_kept(self):
        steps = [{"reasoning": "plan A"}, {"reasoning": "plan B"}]
        steps += [{"tool": "Read", "input": str(i), "result": "r"} for i in range(gh.RECENT_STEPS + 2)]
        steps += [{"reasoning": "now find where tokens are refreshed"}]
        state = gh.classifier_state("old prompt", steps, "Grep")
        self.assertNotIn("user_prompt", state)
        self.assertEqual(state["earlier_reasoning"], ["plan A", "plan B"])
        self.assertEqual(sum("tool" in st for st in state["recent_steps"]), gh.RECENT_STEPS)
        self.assertEqual(state["recent_steps"][-1], {"reasoning": "now find where tokens are refreshed"})


class FlowTest(unittest.TestCase):
    """End-to-end through the real entry point, with a fake classifier."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.transcript = root / "t.jsonl"
        self.transcript.write_text(json.dumps(
            {"type": "user", "message": {"role": "user", "content": "Where do we retry failed uploads?"}}) + "\n")
        # HOME points at the temp dir so the real ~/.config/jev/api-key is never read, and the
        # Jev URL is unroutable: tests can never make a live classifier call.
        self.env = {**os.environ, "HOME": str(root), "GUIDANCE_STATE_DIR": str(root / "state"),
                    "GUIDANCE_LOG_DIR": str(root / "logs"), "TYPESAFE_API_KEY": "",
                    "GUIDANCE_JEV_URL": "http://127.0.0.1:9/never"}
        for name in ("GUIDANCE_DISABLED", "GUIDANCE_FAKE_PROBS"):
            self.env.pop(name, None)
        self.log = root / "logs" / "s1.jsonl"

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, mode, probs=None, **data):
        env = dict(self.env)
        if probs is not None:
            env["GUIDANCE_FAKE_PROBS"] = json.dumps(probs)
        payload = {"session_id": "s1", "transcript_path": str(self.transcript), "cwd": "/repo", **data}
        out = subprocess.run([sys.executable, str(SCRIPT), mode], input=json.dumps(payload),
                             capture_output=True, text=True, env=env, check=True)
        return json.loads(out.stdout)["hookSpecificOutput"] if out.stdout.strip() else None

    def pre(self, tool, probs=None, **tool_input):
        return self.run_hook("pre", probs, tool_name=tool, tool_input=tool_input)

    def events(self):
        return [json.loads(l)["event"] for l in self.log.read_text().splitlines()] if self.log.exists() else []

    JB = {"regular-search": 0.1, "jbcontext-search": 0.8, "context-explorer": 0.1}
    REG = {"regular-search": 0.8, "jbcontext-search": 0.15, "context-explorer": 0.05}
    EXP = {"regular-search": 0.02, "jbcontext-search": 0.18, "context-explorer": 0.8}
    UNSURE = {"regular-search": 0.3, "jbcontext-search": 0.6, "context-explorer": 0.1}

    def test_mismatch_deny_once_then_noncompliant(self):
        out = self.pre("Grep", self.JB, pattern="retry")
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertIn("jbcontext search", out["permissionDecisionReason"])
        out = self.pre("Grep", self.REG, pattern="retry")  # decision reused, not re-classified
        self.assertIsNone(out)
        self.assertEqual(self.events(), ["classify", "deny", "noncompliant"])

    def test_match_allows_with_guidance_once_then_follow_up(self):
        out = self.pre("Bash", self.JB, command="jbcontext search \"upload retry policy\"")
        self.assertNotIn("permissionDecision", out)
        self.assertIn("Path filter", out["additionalContext"])
        self.assertIsNone(self.pre("Bash", self.JB, command="jbcontext search \"other\""))
        self.assertIsNone(self.pre("Grep", self.JB, pattern="UploadRetryPolicy"))  # follow-up grep
        self.assertEqual(self.events(), ["classify", "allow", "allow", "allow"])

    def test_episode_end_reclassifies(self):
        self.pre("Grep", self.REG, pattern="retry")
        self.pre("Edit", file_path="a.py")
        out = self.pre("Grep", self.JB, pattern="retry")
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertEqual(self.events(), ["classify", "allow", "episode_end", "classify", "deny"])

    def test_prefilter_and_reads_skip_classifier(self):
        self.assertIsNone(self.pre("Read", self.JB, file_path="src/a.py"))
        self.assertIsNone(self.pre("Grep", self.JB, pattern="x", path="src/auth/Login.kt"))
        self.assertEqual(self.events(), ["skip"])

    def test_established_name_skips_classifier(self):
        # "UploadRetryPolicy" appears in a tool result, so grepping it is an exact search
        rows = [{"type": "user", "message": {"content": "Fix upload retries"}},
                {"type": "assistant", "message": {"content": [
                    {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "a.kt"}}]}},
                {"type": "user", "message": {"content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "val p = UploadRetryPolicy()"}]}}]
        self.transcript.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        self.assertIsNone(self.pre("Grep", self.JB, pattern="class UploadRetryPolicy"))
        self.assertIsNone(self.pre("Bash", self.JB, command="rg -n 'UploadRetryPolicy' ."))
        # a name the agent made up is not established: classified and denied
        out = self.pre("Grep", self.JB, pattern="RetryCoordinator")
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertEqual(self.events(), ["skip", "skip", "classify", "deny"])

    def test_low_confidence_allows(self):
        self.assertIsNone(self.pre("Grep", self.UNSURE, pattern="retry"))
        self.assertEqual(self.events(), ["classify", "allow"])

    def test_explore_builtin_is_regular_intent(self):
        self.assertIsNone(self.pre("Agent", self.REG, subagent_type="Explore", prompt="find X"))
        self.pre("Edit", file_path="a.py")
        out = self.pre("Agent", self.EXP, subagent_type="Explore", prompt="map the upload flow")
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertIn("context-explorer", out["permissionDecisionReason"])

    def test_explorer_foreground_result_and_cap(self):
        out = self.pre("Agent", self.EXP, subagent_type="context-explorer", prompt="map", run_in_background=True)
        self.assertEqual(out["permissionDecision"], "allow")
        self.assertIs(out["updatedInput"]["run_in_background"], False)
        post = self.run_hook("post", tool_name="Agent", tool_input={"subagent_type": "context-explorer"},
                             tool_response={})
        self.assertIn("explorer's report", post["additionalContext"])
        # explorer cap: a new explorer spawn is denied; a win for explorer goes to the next node
        out = self.pre("Agent", self.EXP, subagent_type="context-explorer", prompt="map again")
        self.assertEqual(out["permissionDecision"], "deny")
        out = self.pre("Grep", self.EXP, pattern="upload")
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertIn("jbcontext search", out["permissionDecisionReason"])

    def test_subagent_calls_not_routed(self):
        out = self.run_hook("pre", self.JB, tool_name="Grep", tool_input={"pattern": "x"},
                            agent_id="a1", agent_type="context-explorer")
        self.assertIsNone(out)
        self.assertEqual(self.events(), [])

    def test_classifier_error_fails_open_for_episode(self):
        self.assertIsNone(self.pre("Grep", None, pattern="retry"))  # no key -> error
        self.assertIsNone(self.pre("Bash", None, command="jbcontext search x"))
        self.assertEqual(self.events(), ["classifier_error"])

    def test_prompt_resets(self):
        self.pre("Grep", self.REG, pattern="retry")
        self.run_hook("prompt", prompt="next task")
        out = self.pre("Grep", self.JB, pattern="retry")
        self.assertEqual(out["permissionDecision"], "deny")


class TranscriptTest(unittest.TestCase):
    def test_task_and_steps(self):
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            rows = [
                {"type": "user", "message": {"content": "old task"}},
                {"type": "user", "message": {"content": "Fix retry of uploads"}},
                {"type": "assistant", "message": {"content": [
                    {"type": "text", "text": "Let me look."},
                    {"type": "tool_use", "id": "t1", "name": "Grep", "input": {"pattern": "retry"}}]}},
                {"type": "user", "message": {"content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "src/a.py:3: retry()"}]}},
                {"type": "assistant", "isSidechain": True, "message": {"content": [{"type": "text", "text": "x"}]}},
            ]
            f.write("\n".join(json.dumps(r) for r in rows) + "\nnot json\n")
        task, steps = gh.read_transcript(f.name)
        os.unlink(f.name)
        self.assertEqual(task, "Fix retry of uploads")
        self.assertEqual(steps[0], {"reasoning": "Let me look."})
        self.assertEqual(steps[1]["tool"], "Grep")
        self.assertEqual(steps[1]["result"], "src/a.py:3: retry()")


class ParityCasesTest(unittest.TestCase):
    """parity_cases.json matches this router, so the CLI port can be checked against it."""

    def test_recorded_cases_match_router(self):
        import parity_cases
        recorded = json.loads(parity_cases.OUT.read_text(encoding="utf-8"))
        current = json.loads(parity_cases.render(parity_cases.build()))
        for section in current:
            self.assertEqual(recorded.get(section), current[section],
                             f"parity_cases.json section '{section}' is stale: "
                             "run python3 hooks/guidance/parity_cases.py --write and review the diff")


if __name__ == "__main__":
    unittest.main(verbosity=1)

#!/usr/bin/env python3
"""Local SWE-bench LG Private / BenchRoom parity lab for Air Context (`jbcontext`) + Claude Code.

Mirrors live Matterhorn containers (`junie-agent` `JbContext.kt` + `ClaudeExecutor.kt`) while sourcing
Opus / Sonnet tokens from the user's local Claude license (`~/.claude/settings.json` `apiKeyHelper` +
`ANTHROPIC_BASE_URL` with `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1`):

1. Strict container-like trial isolation (`MIRROR_ROOT = /private/tmp/context-lab`):
   - `HOME` is `<MIRROR_ROOT>/<hash>/root` (outside `$HOME`), workspace is `<HOME>/agent-work`
     (live BenchRoom LG: `/root/agent-work`), so zero host `~/.claude/CLAUDE.md`, settings, hooks,
     plugins, skills, or memory leak into trials.
   - Workspace is a depth-1 detached checkout at `FETCH_HEAD` (`git user = Your Name`) with untracked
     `issue.md` (`"###\\n" + problem_statement`, trimmed).
   - System prompt (`--append-system-prompt`) is `BENCHROOM_SYSTEM_PROMPT + JUNIE_BENCHMARK_RULES`
     (`benchroom_rules.md`), with ASCII-locale `?` mangling on `ASCII_LOCALE_REPOS`. Unlike `decider-rag`,
     `jbcontext` instructions are NOT appended to `--append-system-prompt`; `jbcontext setup-agent`
     writes `<HOME>/.claude/CLAUDE.md` and `<HOME>/.claude/settings.json` hooks on `--arm jbcontext`
     (and writes nothing on `--arm baseline`).

2. macOS safety guardrails:
   - `JBCONTEXT_NO_KEYCHAIN=1` is enforced on every `jbcontext` invocation (and inside the trial wrapper
     `<HOME>/.jbcontext/bin/jbcontext`) so `MacOsKeychainStore` never probes `Security.framework` or pops
     the `"availability-probe"` Keychain modal.
   - `_assert_no_interactive_oauth()` scans workspace Gradle files before running any build/test command
     so repositories with interactive Space OAuth browser redirects are rejected prior to execution.
   - Per-trial `jbcontext watch stop` runs on teardown so background watch daemons do not accumulate.

3. Task suite separation:
   - `jbc3` (alias `jbc_gradable`): `("jcp-434", "jcp-433", "aip-1283")` — dedicated `jbcontext`-only
     gradable suite, 100% disjoint from `decider-rag`'s `gradable9` / `holdout6` / `expand_tune6` /
     `expand_test6`. Safe for iterative prompt/CLI/hook tuning without touching shared tasks.
   - `gradable9` (alias `gradable13`): `("340", "83", "502", "623", "751", "129", "aip-431", "aip-1103",
     "pat-145174")` — shared cross-project gradable suite used for both `decider-rag` and `jbcontext`.
   - `lg5`: `("129", "502", "aip-431", "aip-1103", "pat-145174")` — the 5 tasks inside `gradable9` that
     also belong to `SWE-bench LG Private` (`jcp-1931570` / `jcp-1899094`).
   - `parity8`: `jbc3 + lg5` — all 8 tasks with matched live `SWE-bench LG Private` / `#7499315` Opus 5.5
     reference runs for parity calibration.
   - Held-out `expand_test6` (`IJ_patronus-173598`, `IJ_patronus-181337`,
     `JetBrains_jetbrains-ai-platform-1245`, `-1096`, `-1378`, `MATTERHORN_matterhorn_core-1be154e`) is
     strictly blocked from import or execution.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import functools
import hashlib
import http.server
import io
import json
import os
import re
import shlex
import shutil
import socketserver
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any

LAB_DIR = Path(__file__).resolve().parent
CONTEXT_ROOT = LAB_DIR.parent
TASKS_DIR = LAB_DIR / "tasks"
REPOS_DIR = LAB_DIR / "repos"
INDEXES_DIR = LAB_DIR / "indexes"
WORKSPACES_DIR = LAB_DIR / "workspaces"
TRIALS_DIR = LAB_DIR / "trials"
GRADES_DIR = LAB_DIR / "grades"

DECIDER_LAB_DIR = Path("/Users/mihajlo.linic/PycharmProjects/decider-rag/runs/benchroom-local-debug-7512238")
AI_PLATFORM_WORKTREE = Path("/Users/mihajlo.linic/PycharmProjects/jetbrains-ai-platform")
EVAL_RUNS_DIR = CONTEXT_ROOT / "evaluation-runs"
LIVE_JBC_RUN = EVAL_RUNS_DIR / "2026-11-16_opus-5-5_medium_cli-2.1.322_dev-0.9.21-no-imports-filter_jcp-1931570"
LIVE_BASE_RUN = EVAL_RUNS_DIR / "2026-11-12_opus-5-5_medium_cli-2.1.322_baseline_jcp-1899094"
BENCHROOM_7517103_DIR = Path.home() / "Downloads" / "7517103-all-artifacts-baseline-vs-hueristics"

BENCHMARK_RULES_PATH = LAB_DIR / "benchroom_rules.md"
DEFAULT_CLAUDE_VERSION = "2.1.322"
DEFAULT_JBCONTEXT_VERSION = "0.9.21.1593"
MIRROR_ROOT = Path("/private/tmp/context-lab")

BARE_CLAUDE_ROOT = LAB_DIR / "runtime" / "claude-code"
BARE_CLAUDE_BIN = BARE_CLAUDE_ROOT / "node_modules" / ".bin" / "claude"

ASCII_LOCALE_REPOS = frozenset({"JetBrains/code-engine", "IJ/patronus", "MATTERHORN/matterhorn_core"})

HELD_OUT_INSTANCE_IDS = frozenset(
    {
        "IJ_patronus-173598",
        "IJ_patronus-181337",
        "JetBrains_jetbrains-ai-platform-1245",
        "JetBrains_jetbrains-ai-platform-1096",
        "JetBrains_jetbrains-ai-platform-1378",
        "MATTERHORN_matterhorn_core-1be154e",
    }
)

TASK_REGISTRY: dict[str, dict[str, str]] = {
    # Dedicated jbcontext-only gradable tasks (100% disjoint from decider-rag splits)
    "jcp-434": {
        "instance_id": "JetBrains_jcp-common-434",
        "repo": "JetBrains/jcp-common",
        "jdk": "21",
        "role": "jbc_only: named package `cloud.jetbrains.sdk` -> live 0/3 skip (3/3 solved, fast baseline)",
    },
    "jcp-433": {
        "instance_id": "JetBrains_jcp-common-433",
        "repo": "JetBrains/jcp-common",
        "jdk": "21",
        "role": "jbc_only: named file+symbol on 4-file OpenAPI codegen fix -> live 0/3 premature skip (0/3 solved)",
    },
    "aip-1283": {
        "instance_id": "JetBrains_jetbrains-ai-platform-1283",
        "repo": "JetBrains/jetbrains-ai-platform",
        "jdk": "17",
        "role": "jbc_only: pure semantic natural-language URL credential leak in 2,300-cluster monorepo (1/3 solved on #7499315)",
    },
    # Shared gradable9 tasks (used across both decider-rag and jbcontext; first 5 are in SWE-bench LG Private)
    "129": {
        "instance_id": "JetBrains_code-engine-129",
        "repo": "JetBrains/code-engine",
        "jdk": "17",
        "role": "shared/lg5: named `CodeBlockAtOffsetProvider` -> live 0/3 skip across multi-module PSI",
    },
    "502": {
        "instance_id": "JetBrains_code-engine-502",
        "repo": "JetBrains/code-engine",
        "jdk": "17",
        "role": "shared/lg5: live 3/3 `jbcontext | head -30/-40`, +37.2% cost & +34.7% duration regression vs baseline",
    },
    "aip-431": {
        "instance_id": "JetBrains_jetbrains-ai-platform-431",
        "repo": "JetBrains/jetbrains-ai-platform",
        "jdk": "17",
        "role": "shared/lg5: ISO country whitelist -> live 0/3 skip across monorepo (2/3 solved vs 3/3 baseline)",
    },
    "aip-1103": {
        "instance_id": "JetBrains_jetbrains-ai-platform-1103",
        "repo": "JetBrains/jetbrains-ai-platform",
        "jdk": "17",
        "role": "shared/lg5: live 3/3 `jbcontext | head`, partial snippets + manual cat/grep (+5.9% cost vs baseline)",
    },
    "pat-145174": {
        "instance_id": "IJ_patronus-145174",
        "repo": "IJ/patronus",
        "jdk": "17",
        "role": "shared/lg5: live 3/3 `jbcontext` (2/3 `| head -40`), 750-char snippet cutoff + test mock noise (1/3 vs 3/3 baseline)",
    },
    "340": {
        "instance_id": "JetBrains_code-engine-340",
        "repo": "JetBrains/code-engine",
        "jdk": "17",
        "role": "shared/gradable9: named `RepoMap` class (underspecified hidden test debug format)",
    },
    "83": {
        "instance_id": "JetBrains_code-engine-83",
        "repo": "JetBrains/code-engine",
        "jdk": "17",
        "role": "shared/gradable9: C# doc generation behavioral bug",
    },
    "623": {
        "instance_id": "JetBrains_code-engine-623",
        "repo": "JetBrains/code-engine",
        "jdk": "17",
        "role": "shared/gradable9: LLM tool parameter description behavioral bug",
    },
    "751": {
        "instance_id": "JetBrains_code-engine-751",
        "repo": "JetBrains/code-engine",
        "jdk": "17",
        "role": "shared/gradable9: Git diff whitespace filename behavioral bug",
    },
}

SUITES: dict[str, tuple[str, ...]] = {
    "jbc3": ("jcp-434", "jcp-433", "aip-1283"),
    "lg5": ("129", "502", "aip-431", "aip-1103", "pat-145174"),
    "jbc_focus6": ("jcp-434", "jcp-433", "aip-1283", "502", "aip-1103", "pat-145174"),
    "gradable5": ("pat-145174", "aip-431", "aip-1103", "751", "623"),
    "gradable9": ("340", "83", "502", "623", "751", "129", "aip-431", "aip-1103", "pat-145174"),
    "parity8": ("jcp-434", "jcp-433", "aip-1283", "129", "502", "aip-431", "aip-1103", "pat-145174"),
    "all12": (
        "jcp-434",
        "jcp-433",
        "aip-1283",
        "340",
        "83",
        "502",
        "623",
        "751",
        "129",
        "aip-431",
        "aip-1103",
        "pat-145174",
    ),
}
SUITES["jbc_gradable"] = SUITES["jbc3"]
SUITES["gradable12"] = SUITES["gradable9"]
SUITES["gradable13"] = SUITES["gradable9"]

UNDERSPECIFIED_TASKS: dict[str, str] = {
    "340": "hidden test parses a `labels=[A, B]` debug format the issue never specifies",
    "pat-145174": "hidden `check deduplication()` needs a parser change the issue never mentions (though Opus baseline solved 3/3 in jcp-1899094)",
}

BENCHROOM_SYSTEM_PROMPT = """You are running in a non-interactive automation environment.
Work autonomously and complete the task end-to-end whenever possible.
Make reasonable assumptions and continue unless you are truly blocked.

Apply changes directly to the repository files.
Do not create .patch, .diff, or other patch artifact files unless explicitly requested.
Do not provide the implementation as patch text or as instructions to apply later.
The expected result is actual edits in the working tree."""

SPACE_REPOS = frozenset(
    {
        "ij/ultimate",
        "ij/patronus",
        "yt/youtrack",
        "crl/space",
        "edu/educational-server",
        "toolbox-enterprise/tbe-intellij-plugin",
        "toolbox-enterprise/tbe-server",
        "matterhorn/matterhorn_core",
        "writerside/writerside-stardust",
    }
)

_CRED_LOCK = threading.Lock()
_CRED_CACHE: dict[str, str] = {}
_INDEX_LOCKS: dict[str, threading.Lock] = {}
_INDEX_LOCKS_GUARD = threading.Lock()


def _default_git_remote_url(repo: str) -> str:
    if repo.lower() in SPACE_REPOS:
        return f"ssh://git@git.jetbrains.team/{repo}.git"
    return f"git@github.com:{repo}.git"


def _repo_dir(repo_key: str) -> Path:
    slug = repo_key.split("/")[-1]
    local_cand = REPOS_DIR / slug
    if local_cand.exists():
        return local_cand
    decider_cand = DECIDER_LAB_DIR / "repos" / slug
    if decider_cand.exists():
        return decider_cand
    raise RuntimeError(f"Repository mirror missing for {repo_key}; run `local_lab.py sync-tasks` first.")


def _shared_gradle_user_home() -> Path:
    decider_gh = DECIDER_LAB_DIR / "runtime" / "gradle-user-home"
    if decider_gh.is_dir():
        return decider_gh
    fallback = LAB_DIR / "runtime" / "gradle-user-home"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _jdk_home_for_task(task_id: str) -> Path:
    want = TASK_REGISTRY.get(task_id, {}).get("jdk", "17")
    jdk17_candidates = (
        LAB_DIR / "runtime" / "jdks" / "jdk-17.0.21+9" / "Contents" / "Home",
        DECIDER_LAB_DIR / "runtime" / "jdks" / "jdk-17.0.21+9" / "Contents" / "Home",
    )
    jdk21_candidates = (
        Path.home() / "Library" / "Java" / "JavaVirtualMachines" / "ms-21.0.12.1" / "Contents" / "Home",
        Path.home() / "Library" / "Java" / "JavaVirtualMachines" / "ms-25.0.4.1" / "Contents" / "Home",
    )
    ordered = (*jdk21_candidates, *jdk17_candidates) if want == "21" else (*jdk17_candidates, *jdk21_candidates)
    for cand in ordered:
        if cand.is_dir():
            return cand
    raise RuntimeError(f"No suitable JDK found on host for task {task_id} (wanted Java {want})")


def _claude_version(binary: Path) -> str:
    proc = subprocess.run([str(binary), "--version"], capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise RuntimeError(f"Claude Code version check failed for {binary}: {proc.stderr.strip()}")
    return (proc.stdout or proc.stderr).strip().splitlines()[0]


def _install_bare_claude(version: str = DEFAULT_CLAUDE_VERSION) -> Path:
    version_dir = BARE_CLAUDE_ROOT / version
    bin_path = version_dir / "node_modules" / ".bin" / "claude"
    if bin_path.is_file() and version in _claude_version(bin_path):
        return bin_path
    # Reuse decider-rag's runtime when exact 2.1.317 is requested
    decider_bin = DECIDER_LAB_DIR / "runtime" / "claude-code" / "node_modules" / ".bin" / "claude"
    if version == "2.1.317" and decider_bin.is_file() and "2.1.317" in _claude_version(decider_bin):
        return decider_bin
    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError("npm is required to install the pinned bare Claude Code runtime")
    version_dir.mkdir(parents=True, exist_ok=True)
    print(f"[local_lab] installing bare @anthropic-ai/claude-code@{version} under {version_dir} ...", flush=True)
    proc = subprocess.run(
        [npm, "install", "--prefix", str(version_dir), "--no-audit", "--no-fund", f"@anthropic-ai/claude-code@{version}"],
        capture_output=True,
        text=True,
        timeout=900,
    )
    if proc.returncode != 0 or not bin_path.is_file():
        raise RuntimeError(f"Claude Code {version} installation failed: {(proc.stderr or proc.stdout)[-2000:]}")
    installed = _claude_version(bin_path)
    if version not in installed:
        raise RuntimeError(f"Installed Claude Code version mismatch: expected {version}, got {installed}")
    return bin_path


def _resolve_jbcontext_binary(jbcontext_bin: str = "", jbcontext_version: str = DEFAULT_JBCONTEXT_VERSION) -> tuple[Path, str]:
    if jbcontext_bin:
        p = Path(jbcontext_bin).expanduser().resolve()
        if not p.is_file():
            raise SystemExit(f"jbcontext binary not found: {p}")
    else:
        p = Path.home() / ".jbcontext" / "versions" / jbcontext_version / "jbcontext_binary"
        if not p.is_file():
            active = Path.home() / ".jbcontext" / "bin" / "jbcontext_binary"
            if active.exists():
                p = active.resolve()
            else:
                raise SystemExit(
                    f"jbcontext version {jbcontext_version!r} not found at {p}. "
                    f"Available under ~/.jbcontext/versions/: "
                    f"{sorted(x.name for x in (Path.home() / '.jbcontext/versions').iterdir() if x.is_dir())}"
                )
    h = hashlib.sha256()
    if p.name == "jbcontext" and (p.parent.parent / "lib").is_dir():
        # Gradle `installDist` launcher: hash all jars in lib/ so any indexing-cli code edit invalidates cache if needed
        for jar in sorted((p.parent.parent / "lib").glob("*.jar")):
            h.update(jar.name.encode("utf-8"))
            h.update(hashlib.sha256(jar.read_bytes()).digest())
    else:
        h.update(p.read_bytes())
    return p, h.hexdigest()


def _jbcontext_version_str(binary: Path) -> str:
    env = dict(
        os.environ,
        JBCONTEXT_NO_KEYCHAIN="1",
        JBCONTEXT_ANALYTICS="false",
        JBCONTEXT_ERROR_REPORTING="false",
    )
    proc = subprocess.run([str(binary), "--version"], env=env, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise RuntimeError(f"jbcontext --version failed for {binary}: {(proc.stderr or proc.stdout)[:400]}")
    return (proc.stdout or proc.stderr).strip().splitlines()[0]


def _api_credentials() -> dict[str, str]:
    """API key + base URL from the user's Claude license (`~/.claude/settings.json`)."""
    with _CRED_LOCK:
        if _CRED_CACHE:
            return dict(_CRED_CACHE)
        user_settings = Path.home() / ".claude" / "settings.json"
        source = json.loads(user_settings.read_text(encoding="utf-8")) if user_settings.is_file() else {}
        source_env = source.get("env") if isinstance(source.get("env"), dict) else {}
        key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        helper = source.get("apiKeyHelper")
        if not key and isinstance(helper, str) and helper.strip():
            proc = subprocess.run(helper, shell=True, capture_output=True, text=True, timeout=180)
            key = (proc.stdout or "").strip()
        if not key:
            raise RuntimeError("No Anthropic API key: set ANTHROPIC_API_KEY or `apiKeyHelper` in ~/.claude/settings.json")
        _CRED_CACHE["ANTHROPIC_API_KEY"] = key
        base_url = (source_env.get("ANTHROPIC_BASE_URL") or os.environ.get("ANTHROPIC_BASE_URL") or "").strip()
        if base_url:
            _CRED_CACHE["ANTHROPIC_BASE_URL"] = base_url
        return dict(_CRED_CACHE)


def _host_jbcontext_auth_seed() -> dict[str, Any]:
    cfg_path = Path.home() / ".jbcontext" / "config.json"
    if not cfg_path.is_file():
        return {"updates": {"autoUpdate": False}, "logging": {"remote": False}}
    raw = json.loads(cfg_path.read_text(encoding="utf-8"))
    out: dict[str, Any] = {}
    for k in ("aiAccessSelections", "jbaAuthPins", "daemonLogins"):
        if k in raw:
            out[k] = raw[k]
    return out


def _seed_jbcontext_home(target_jbc_home: Path) -> None:
    """Seed isolated `JBCONTEXT_HOME` with non-Keychain workspace selection + `daemon-token-v2-*.json`."""
    target_jbc_home.mkdir(parents=True, exist_ok=True)
    (target_jbc_home / "config.json").write_text(json.dumps(_host_jbcontext_auth_seed(), indent=2), encoding="utf-8")
    host_jbc = Path.home() / ".jbcontext"
    token_files = list(host_jbc.glob("daemon-token-*.json"))
    now = time.time()
    if not token_files or any((now - tf.stat().st_mtime) > 1200 for tf in token_files):
        active_bin = host_jbc / "bin" / "jbcontext_binary"
        if active_bin.exists():
            subprocess.run(
                [str(active_bin), "status"],
                env=dict(os.environ, JBCONTEXT_NO_KEYCHAIN="1", JBCONTEXT_ANALYTICS="false", JBCONTEXT_ERROR_REPORTING="false"),
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=30,
            )
            token_files = list(host_jbc.glob("daemon-token-*.json"))
    for tf in token_files:
        shutil.copy2(tf, target_jbc_home / tf.name)


class _LocalPromptsServer:
    """Serves a local `context` working tree over `http://127.0.0.1:<port>` for `PromptsDownloader`."""

    def __init__(self, root_dir: Path):
        self.root_dir = root_dir.resolve()
        self._httpd: socketserver.ThreadingTCPServer | None = None
        self.port: int = 0

    def start(self) -> str:
        handler_cls = functools.partial(_QuietStaticHandler, directory=str(self.root_dir))

        class _Server(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True

        self._httpd = _Server(("127.0.0.1", 0), handler_cls)
        self.port = int(self._httpd.server_address[1])
        threading.Thread(target=self._httpd.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{self.port}"

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None


class _QuietStaticHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return


def _mangle_env_ascii(text: str) -> str:
    return "".join(c if ord(c) < 128 else "?" * len(c.encode("utf-8")) for c in text)


def _benchroom_task_text(problem_statement: str) -> str:
    return ("###\n" + problem_statement).strip()


def _benchroom_system_prompt(repo_key: str) -> str:
    """`CliAgentExecutor.renderSystemPrompt(JUNIE_BENCHMARK_RULES)` — note `jbcontext` never appends instructions here."""
    rules = BENCHMARK_RULES_PATH.read_text(encoding="utf-8").strip()
    if repo_key in ASCII_LOCALE_REPOS:
        rules = _mangle_env_ascii(rules)
    return f"{BENCHROOM_SYSTEM_PROMPT}\n\n{rules}"


def _ensure_timeout_shim() -> Path:
    shim = LAB_DIR / "runtime" / "shims" / "timeout"
    if not shim.is_file():
        shim.parent.mkdir(parents=True, exist_ok=True)
        shim.write_text(
            "#!/usr/bin/env python3\n"
            "import os, signal, subprocess, sys\n"
            "def duration(value):\n"
            "    value=value.strip().lower(); scale=1.0\n"
            "    if value.endswith('ms'): scale=0.001; value=value[:-2]\n"
            "    elif value.endswith('s'): value=value[:-1]\n"
            "    elif value.endswith('m'): scale=60.0; value=value[:-1]\n"
            "    elif value.endswith('h'): scale=3600.0; value=value[:-1]\n"
            "    return float(value)*scale\n"
            "args=sys.argv[1:]; sig=signal.SIGTERM; kill_after=5.0\n"
            "while args and args[0].startswith('-'):\n"
            "    opt=args.pop(0)\n"
            "    if opt in ('-s','--signal') and args: sig=getattr(signal, 'SIG'+args.pop(0).upper(), signal.SIGTERM)\n"
            "    elif opt.startswith('--signal='): sig=getattr(signal, 'SIG'+opt.split('=',1)[1].upper(), signal.SIGTERM)\n"
            "    elif opt in ('-k','--kill-after') and args: kill_after=duration(args.pop(0))\n"
            "    elif opt.startswith('--kill-after='): kill_after=duration(opt.split('=',1)[1])\n"
            "    elif opt in ('--preserve-status','--foreground'): pass\n"
            "    else: break\n"
            "if len(args)<2: print('usage: timeout [options] DURATION COMMAND [ARG...]', file=sys.stderr); sys.exit(125)\n"
            "limit=duration(args.pop(0)); proc=subprocess.Popen(args, start_new_session=True)\n"
            "try: code=proc.wait(timeout=limit); sys.exit(code if code>=0 else 128-code)\n"
            "except subprocess.TimeoutExpired:\n"
            "    try: os.killpg(proc.pid, sig)\n"
            "    except ProcessLookupError: pass\n"
            "    try: proc.wait(timeout=kill_after)\n"
            "    except subprocess.TimeoutExpired:\n"
            "        try: os.killpg(proc.pid, signal.SIGKILL)\n"
            "        except ProcessLookupError: pass\n"
            "        proc.wait()\n"
            "    sys.exit(124)\n",
            encoding="utf-8",
        )
        shim.chmod(0o755)
    return shim


def _ensure_security_shim() -> Path:
    """Block Claude Code (`2.1.322`+) from invoking `/usr/bin/security add-generic-password -a $USER`
    inside throwaway `HOME=/private/tmp/context-lab/...` directories (which have no `~/Library/Keychains`
    and otherwise pop macOS's `'A keychain cannot be found to store <user>'` modal). Returning exit code
    `44` (`errSecItemNotFound`) routes Claude Code cleanly to `<HOME>/.claude/.credentials.json`."""
    shim = LAB_DIR / "runtime" / "shims" / "security"
    shim.parent.mkdir(parents=True, exist_ok=True)
    shim.write_text("#!/bin/sh\nexit 44\n", encoding="utf-8")
    shim.chmod(0o755)
    return shim


def _assert_no_interactive_oauth(ws_dir: Path) -> None:
    """Block repositories whose Gradle scripts launch an interactive JetBrains Space OAuth browser flow."""
    for gf in ws_dir.rglob("*gradle*"):
        if not gf.is_file() or gf.suffix not in (".gradle", ".kts"):
            continue
        txt = gf.read_text(encoding="utf-8", errors="replace")
        if re.search(r"jetbrains\.team/oauth|localhost:8123/auth|space\s*\{\s*auth", txt, re.I):
            raise RuntimeError(f"Interactive Space OAuth Gradle plugin detected in {gf.relative_to(ws_dir)}; refusing to run locally.")


def _mirror_root(task_id: str, run_slug: str) -> Path:
    return MIRROR_ROOT / hashlib.sha1(f"{task_id}|{run_slug}".encode()).hexdigest()[:10] / "root"


def _ensure_mirror_workspace(repo_dir: Path, base_commit: str, task_id: str, run_slug: str) -> tuple[Path, Path]:
    """Fresh `<root>/agent-work` holding only `base_commit`, detached at `FETCH_HEAD` like live containers."""
    home_dir = _mirror_root(task_id, run_slug)
    shutil.rmtree(home_dir.parent, ignore_errors=True)
    ws_dir = home_dir / "agent-work"
    ws_dir.mkdir(parents=True)
    (home_dir / ".gitconfig").write_text(
        "[user]\n\tname = Your Name\n\temail = you@example.com\n[advice]\n\tdetachedHead = false\n",
        encoding="utf-8",
    )
    git_env = {"HOME": str(home_dir), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "GIT_TERMINAL_PROMPT": "0"}

    def git(*args: str) -> None:
        proc = subprocess.run(["git", "-C", str(ws_dir), *args], env=git_env, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"git {' '.join(args[:3])} failed for {task_id}: {proc.stderr[-600:]}")

    git("init", "-q")
    git(
        "fetch",
        "-q",
        "--depth",
        "1",
        "--upload-pack",
        "git -c uploadpack.allowAnySHA1InWant=true upload-pack",
        f"file://{repo_dir.resolve()}",
        base_commit,
    )
    git("checkout", "-q", "FETCH_HEAD")
    _assert_no_interactive_oauth(ws_dir)

    gradle_home = _shared_gradle_user_home()
    (home_dir / ".gradle").symlink_to(gradle_home, target_is_directory=True)
    local_bin = home_dir / ".local" / "bin"
    local_bin.mkdir(parents=True, exist_ok=True)
    shutil.copy2(_ensure_security_shim(), local_bin / "security")
    if shutil.which("timeout", path="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin") is None:
        shutil.copy2(_ensure_timeout_shim(), local_bin / "timeout")

    link = WORKSPACES_DIR / task_id / run_slug
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink() or link.is_file():
        link.unlink()
    elif link.exists():
        shutil.rmtree(link, ignore_errors=True)
    link.symlink_to(ws_dir, target_is_directory=True)
    return home_dir, ws_dir


def _run_jbcontext_cmd(binary: Path, jbcontext_home: Path, args: list[str], *, home_override: Path | None = None, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env.update(
        {
            "JBCONTEXT_NO_KEYCHAIN": "1",
            "JBCONTEXT_ANALYTICS": "false",
            "JBCONTEXT_ERROR_REPORTING": "false",
            "JBCONTEXT_HOME": str(jbcontext_home),
            "HOME": str(home_override if home_override is not None else Path.home()),
        }
    )
    return subprocess.run(
        [str(binary), *args],
        cwd=str(cwd) if cwd else None,
        env=env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=300,
    )


def _stop_jbcontext_daemons(binary: Path, jbcontext_home: Path) -> None:
    if not jbcontext_home.is_dir():
        return
    try:
        _run_jbcontext_cmd(binary, jbcontext_home, ["watch", "stop"])
    except Exception:
        pass


def _ensure_base_jbcontext_index(
    task_id: str,
    repo_key: str,
    ws_dir: Path,
    base_commit: str,
    jbcontext_bin: Path,
) -> Path:
    """Build and cache a leak-free `storage=local` index for `(task_id, base_commit)` once."""
    idx_cache_dir = INDEXES_DIR / f"{task_id}-{base_commit[:12]}"
    with _INDEX_LOCKS_GUARD:
        lock = _INDEX_LOCKS.setdefault(str(idx_cache_dir), threading.Lock())
    with lock:
        local_store = idx_cache_dir / "local"
        marker = idx_cache_dir / "READY.json"
        if marker.is_file() and local_store.is_dir():
            return idx_cache_dir

        shutil.rmtree(idx_cache_dir, ignore_errors=True)
        build_jbc_home = idx_cache_dir / "_build_home"
        _seed_jbcontext_home(build_jbc_home)

        remote_url = _default_git_remote_url(repo_key)
        for cfg_args in (
            ["config", "set", "updates.auto-update", "false"],
            ["config", "set", "logging.remote", "false"],
            ["config", "set", "storage", "local"],
            ["config", "set", "search.git-remote-url", remote_url, "--global"],
        ):
            r = _run_jbcontext_cmd(jbcontext_bin, build_jbc_home, cfg_args)
            if r.returncode != 0:
                raise RuntimeError(f"jbcontext {' '.join(cfg_args)} failed: {(r.stderr or r.stdout)[-500:]}")

        t0 = time.monotonic()
        print(f"[{task_id}] building local jbcontext index for {repo_key}@{base_commit[:12]} ...", flush=True)
        env = dict(os.environ)
        env.update(
            {
                "JBCONTEXT_NO_KEYCHAIN": "1",
                "JBCONTEXT_ANALYTICS": "false",
                "JBCONTEXT_ERROR_REPORTING": "false",
                "JBCONTEXT_DISABLE_LOCAL_OVERLAY": "1",
                "JBCONTEXT_HOME": str(build_jbc_home),
                "HOME": str(Path.home()),
            }
        )
        # Note: index clean base_commit BEFORE writing untracked issue.md, or pass --project-path
        proc = subprocess.Popen(
            [str(jbcontext_bin), "index", "--project-path", str(ws_dir), "--revision", base_commit],
            cwd=str(ws_dir),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        tail: list[str] = []
        last_hb = t0

        def _drain() -> None:
            assert proc.stdout is not None
            for line in proc.stdout:
                tail.append(line)
                del tail[:-40]

        drainer = threading.Thread(target=_drain, daemon=True)
        drainer.start()
        try:
            while proc.poll() is None:
                now = time.monotonic()
                if now - last_hb >= 60.0:
                    last_hb = now
                    print(f"[{task_id}] ... elapsed_s={int(now - t0)} phase=jbcontext_index", flush=True)
                time.sleep(1.0)
            drainer.join(timeout=5)
            if proc.returncode != 0:
                raise RuntimeError(f"jbcontext index failed for {task_id}: {''.join(tail)[-1200:]}")
            st = _run_jbcontext_cmd(jbcontext_bin, build_jbc_home, ["status", "--project-path", str(ws_dir)])
            if st.returncode != 0 or "No indices found" in (st.stdout or ""):
                raise RuntimeError(f"jbcontext status found no index after indexing {task_id}: {st.stdout}\n{st.stderr}")
            shutil.rmtree(build_jbc_home / "local" / "runtime", ignore_errors=True)
            shutil.move(str(build_jbc_home / "local"), str(local_store))
            marker.write_text(
                json.dumps(
                    {
                        "task_id": task_id,
                        "repo": repo_key,
                        "base_commit": base_commit,
                        "git_remote_url": remote_url,
                        "indexed_in_s": round(time.monotonic() - t0, 1),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        finally:
            _stop_jbcontext_daemons(jbcontext_bin, build_jbc_home)
            shutil.rmtree(build_jbc_home, ignore_errors=True)
        print(f"[{task_id}] jbcontext index ready in {int(time.monotonic() - t0)}s", flush=True)
        return idx_cache_dir


def _setup_trial_jbcontext(
    *,
    task_id: str,
    repo_key: str,
    base_commit: str,
    home_dir: Path,
    ws_dir: Path,
    jbcontext_bin: Path,
    jbcontext_flags: str,
    prompts_url: str | None,
    idx_cache_dir: Path,
) -> tuple[Path, dict[str, str]]:
    """Mirror `JbContext.kt:setupJbContext()` inside `<home_dir>/.jbcontext` without touching host `~/.claude`."""
    jbc_home = home_dir / ".jbcontext"
    bin_dir = jbc_home / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(idx_cache_dir / "local", jbc_home / "local", dirs_exist_ok=True)
    _seed_jbcontext_home(jbc_home)

    # Executable wrapper at `<home_dir>/.jbcontext/bin/jbcontext`:
    # - Keeps `JBCONTEXT_NO_KEYCHAIN=1` so macOS Keychain is never touched.
    # - Pins `JBCONTEXT_HOME` to this trial's isolated `.jbcontext`.
    # - Restores real `HOME` ONLY for `jbcontext_binary` so `DaemonAuthService` reaches the running
    #   JetBrains App Daemon Unix socket on macOS while Claude Code itself stays in fake `home_dir`.
    wrapper = bin_dir / "jbcontext"
    real_home = str(Path.home())
    wrapper.write_text(
        "#!/bin/sh\n"
        "export JBCONTEXT_NO_KEYCHAIN=1\n"
        "export JBCONTEXT_ANALYTICS=false\n"
        "export JBCONTEXT_ERROR_REPORTING=false\n"
        f'export JBCONTEXT_HOME="{jbc_home}"\n'
        f'export HOME="{real_home}"\n'
        f'exec "{jbcontext_bin}" "$@"\n',
        encoding="utf-8",
    )
    wrapper.chmod(0o755)
    local_bin_link = home_dir / ".local" / "bin" / "jbcontext"
    local_bin_link.parent.mkdir(parents=True, exist_ok=True)
    if local_bin_link.exists() or local_bin_link.is_symlink():
        local_bin_link.unlink()
    local_bin_link.symlink_to(wrapper)

    remote_url = _default_git_remote_url(repo_key)
    cfg_steps: list[list[str]] = [
        ["config", "set", "updates.auto-update", "false"],
        ["config", "set", "logging.remote", "false"],
        ["config", "set", "storage", "local"],
        ["config", "set", "search.git-remote-url", remote_url, "--global"],
        ["config", "set", "eval.pinned-revision", base_commit, "--global"],
    ]
    if prompts_url:
        cfg_steps.append(["config", "set", "agent.prompts-location", prompts_url])
    for step in cfg_steps:
        r = _run_jbcontext_cmd(jbcontext_bin, jbc_home, step)
        if r.returncode != 0:
            raise RuntimeError(f"[{task_id}] jbcontext {' '.join(step)} failed: {(r.stderr or r.stdout)[-500:]}")

    status_res = _run_jbcontext_cmd(jbcontext_bin, jbc_home, ["status", "--json-output", "--project-path", str(ws_dir)], cwd=ws_dir)
    if status_res.returncode != 0 or "No indices found" in (status_res.stdout or ""):
        raise RuntimeError(f"[{task_id}] jbcontext status check failed: {status_res.stdout}\n{status_res.stderr}")

    flags = shlex.split(jbcontext_flags) if jbcontext_flags.strip() else ["--auto"]
    setup_args = ["setup-agent", "--agent", "claude", "--scope", "user", "--non-interactive", *flags]
    if prompts_url and "--prompts-location" not in flags:
        setup_args.extend(["--prompts-location", prompts_url])
    # Run setup-agent with HOME=home_dir so user-scope files land in `<home_dir>/.claude/`!
    setup_res = _run_jbcontext_cmd(jbcontext_bin, jbc_home, setup_args, home_override=home_dir, cwd=ws_dir)
    if setup_res.returncode != 0:
        raise RuntimeError(f"[{task_id}] jbcontext setup-agent failed: {(setup_res.stderr or setup_res.stdout)[-800:]}")

    return jbc_home, {"BIN_DIR": str(bin_dir), "PROJECT_PATH": str(ws_dir)}


def _host_tool_path(home_dir: Path, jdk_home: Path, extra_front_dir: str = "") -> str:
    parts: list[str] = []
    if extra_front_dir:
        parts.append(extra_front_dir)
    parts.append(str(home_dir / ".local" / "bin"))
    parts.append(str(jdk_home / "bin"))
    parts.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])
    return ":".join(parts)


def _candidate_patch(ws_dir: Path) -> str:
    idx_src = subprocess.run(["git", "-C", str(ws_dir), "rev-parse", "--git-path", "index"], capture_output=True, text=True).stdout.strip()
    tmp_index = Path(f"/private/tmp/context-lab-index-{uuid.uuid4().hex}")
    try:
        src = Path(idx_src) if os.path.isabs(idx_src) else ws_dir / idx_src
        if src.is_file():
            shutil.copy2(src, tmp_index)
        env = dict(os.environ, GIT_INDEX_FILE=str(tmp_index))
        subprocess.run(["git", "-C", str(ws_dir), "add", "-A", "--", ".", ":(exclude)issue.md"], env=env, capture_output=True, text=True)
        return subprocess.run(["git", "-C", str(ws_dir), "diff", "--cached", "HEAD"], env=env, capture_output=True, text=True).stdout
    finally:
        tmp_index.unlink(missing_ok=True)


def _extract_patch_files(diff_text: str) -> set[str]:
    files: set[str] = set()
    for ln in (diff_text or "").splitlines():
        if ln.startswith("diff --git "):
            parts = ln.split()
            if len(parts) >= 4:
                b_path = parts[3]
                if b_path.startswith("b/"):
                    b_path = b_path[2:]
                files.add(b_path)
    return files


def _norm_repo_path(path: str) -> str:
    p = str(path or "").strip().strip("`").replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    return p.lstrip("/")


def _matched_gold_files(found_files: set[str], gold_files: set[str]) -> set[str]:
    norm_found = {_norm_repo_path(f) for f in found_files if _norm_repo_path(f)}
    matched: set[str] = set()
    for g in gold_files:
        ng = _norm_repo_path(g)
        if not ng:
            continue
        if ng in norm_found:
            matched.add(g)
            continue
        if any("/" in nf and "..." not in nf and ng.endswith("/" + nf) for nf in norm_found):
            matched.add(g)
    return matched


def _gold_file_recall(found_files: set[str], gold_files: set[str]) -> float:
    if not gold_files:
        return 0.0
    return round(len(_matched_gold_files(found_files, gold_files)) / len(gold_files), 4)


def _flatten_anthropic_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for blk in content:
            if isinstance(blk, str):
                parts.append(blk)
            elif isinstance(blk, dict):
                btype = blk.get("type")
                if btype in ("text", "input_text") and blk.get("text"):
                    parts.append(str(blk["text"]))
                elif btype == "tool_result":
                    parts.append(_flatten_anthropic_content(blk.get("content")))
        return "\n".join(p for p in parts if p)
    return str(content or "")


def _extract_jbcontext_output_files(txt: str) -> tuple[set[str], set[str]]:
    """Return `(all_visible_files, snippet_files)` from a `jbcontext search` stdout."""
    all_files: set[str] = set()
    snippet_files: set[str] = set()
    cur_file = ""
    in_related = False
    for ln in (txt or "").splitlines():
        m = re.match(
            r"^\s*\d+\.\s+(?:\[[a-z-]+\]\s+)?(?:[^:]+:\s+)?File:\s+(.+?)(?:\s+\(\d+L\))?(?:\s+\[[^\]]+\])?\s*$",
            ln,
        )
        if m:
            in_related = False
            cur_file = _norm_repo_path(m.group(1))
            if cur_file:
                all_files.add(cur_file)
            continue
        if re.match(r"^\s*Related tests(?:\s*\([^)]*\))?:\s*$", ln):
            cur_file = ""
            in_related = True
            continue
        if re.match(r"^\s*Related test data(?:\s*\([^)]*\))?:\s*$", ln):
            cur_file = ""
            in_related = False
            continue
        if in_related:
            mt = re.match(r"^\s*-\s+(?:\[[a-z-]+\]\s+)?(.+?)(?:\s+\(\d+L\))?(?:\s+\[[^\]]+\])?\s*$", ln)
            if mt:
                tf = _norm_repo_path(mt.group(1))
                if tf:
                    all_files.add(tf)
            elif not ln.strip():
                in_related = False
            continue
        if cur_file and (ln.strip().startswith("Content:") or re.match(r"^\s+\d+\|", ln)):
            snippet_files.add(cur_file)
    return all_files, snippet_files


def _classify_jbcontext_subcmd(subcmd: str) -> str:
    if "|" not in subcmd:
        return "unpiped"
    if re.search(r"\|\s*grep\b", subcmd):
        return "grep_file"
    if re.search(r"\|\s*head\b", subcmd):
        return "head"
    return "other_pipe"


def _parse_stream_metrics(stream_path: Path) -> dict[str, Any]:
    assistant_events = 0
    model_call_ids: set[str] = set()
    first_call_context_tokens = 0
    claude_num_turns = 0
    gradle_bash_calls = 0
    tool_counts: dict[str, int] = {}
    edit_tokens = 0
    total_tokens = 0
    cost_usd = 0.0
    duration_ms = 0.0
    duration_api_ms = 0.0
    result_subtype = ""
    is_error = False
    last_tool = ""

    tool_use_names: dict[str, str] = {}
    jbc_tool_ids: set[str] = set()
    jbc_commands: list[str] = []
    jbc_pipe_modes: list[str] = []
    call1_visible_files: set[str] = set()
    call1_snippet_files: set[str] = set()
    all_jbc_visible_files: set[str] = set()
    opened_files: set[str] = set()

    turn_tools: list[list[tuple[str, dict[str, Any]]]] = []
    cur_msg_id = ""

    if not stream_path.is_file():
        return {}

    seen_tool_ids: set[str] = set()
    for raw in stream_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not raw.strip():
            continue
        try:
            ev = json.loads(raw)
        except json.JSONDecodeError:
            continue
        etype = ev.get("type")
        if etype == "assistant":
            assistant_events += 1
            msg = ev.get("message") or {}
            message_id = str(msg.get("id") or f"assistant-event-{assistant_events}")
            if message_id != cur_msg_id:
                cur_msg_id = message_id
                turn_tools.append([])
            model_call_ids.add(message_id)
            usage = msg.get("usage") or {}
            if len(model_call_ids) == 1 and first_call_context_tokens == 0:
                first_call_context_tokens = sum(
                    int(usage.get(k) or 0)
                    for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
                )
            for blk in msg.get("content") or []:
                if isinstance(blk, dict) and blk.get("type") == "tool_use":
                    tid = str(blk.get("id") or "")
                    if tid in seen_tool_ids:
                        continue
                    if tid:
                        seen_tool_ids.add(tid)
                    tname = str(blk.get("name") or "")
                    last_tool = tname
                    if tid:
                        tool_use_names[tid] = tname
                    tool_counts[tname] = tool_counts.get(tname, 0) + 1
                    inp = blk.get("input") or {}
                    inp_dict = inp if isinstance(inp, dict) else {}
                    turn_tools[-1].append((tname, inp_dict))

                    if tname == "Read":
                        fp = _norm_repo_path(str(inp_dict.get("file_path") or ""))
                        if fp and not fp.endswith("issue.md"):
                            opened_files.add(fp)
                    elif tname == "Bash":
                        cmd_str = str(inp_dict.get("command") or "")
                        if re.search(r"(?:^|[\s;&|])(?:\./)?gradlew\b|\bgradle\b", cmd_str):
                            gradle_bash_calls += 1
                        for m_cat in re.finditer(r"\b(?:cat|sed|head|tail)\b[^\n;|&]*?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)", cmd_str):
                            cand = _norm_repo_path(m_cat.group(1))
                            if cand and not cand.endswith("issue.md"):
                                opened_files.add(cand)
                        if re.search(r"\bjbcontext(?:-[A-Za-z0-9._-]+)?\s+search\b|\bmcp__jbcontext__", cmd_str):
                            if tid:
                                jbc_tool_ids.add(tid)
                            for sub in re.split(r"[;\n]+", cmd_str):
                                if re.search(r"\bjbcontext(?:-[A-Za-z0-9._-]+)?\s+search\b", sub):
                                    jbc_commands.append(sub.strip())
                                    jbc_pipe_modes.append(_classify_jbcontext_subcmd(sub))
                    elif tname.startswith("mcp__") and "jbcontext" in tname:
                        if tid:
                            jbc_tool_ids.add(tid)
                        jbc_commands.append(f"{tname}({json.dumps(inp_dict)})")
                        jbc_pipe_modes.append("mcp")

                    if tname in ("Edit", "Write", "MultiEdit") or (
                        tname == "Bash" and any(k in str(inp_dict.get("command") or "") for k in ("cat <<", "python", "sed ", "perl "))
                    ):
                        edit_tokens += max(1, len(json.dumps(inp_dict)) // 4)
        elif etype == "user":
            msg = ev.get("message") or {}
            for blk in msg.get("content") or []:
                if isinstance(blk, dict) and blk.get("type") == "tool_result":
                    tuid = str(blk.get("tool_use_id") or "")
                    if tuid in jbc_tool_ids:
                        txt = _flatten_anthropic_content(blk.get("content"))
                        vis, snips = _extract_jbcontext_output_files(txt)
                        if not call1_visible_files and vis:
                            call1_visible_files.update(vis)
                            call1_snippet_files.update(snips)
                        all_jbc_visible_files.update(vis)
        elif etype == "result":
            result_subtype = str(ev.get("subtype") or "")
            is_error = bool(ev.get("is_error"))
            cost_usd = float(ev.get("total_cost_usd") or 0.0)
            duration_ms = float(ev.get("duration_ms") or 0.0)
            duration_api_ms = float(ev.get("duration_api_ms") or 0.0)
            claude_num_turns = int(ev.get("num_turns") or 0)
            usage = ev.get("usage") or {}
            total_tokens = sum(
                int(usage.get(k) or 0)
                for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
            )

    flat_tools = [(tn, inp) for turn in turn_tools for (tn, inp) in turn]
    first_tool = flat_tools[0][0] if flat_tools else ""

    # Determine Turn-after-first-jbcontext behavior & whether exploration happened before jbcontext
    first_jbc_turn_idx: int | None = None
    for idx, turn in enumerate(turn_tools):
        if any(
            (tn == "Bash" and re.search(r"\bjbcontext(?:-[A-Za-z0-9._-]+)?\s+search\b", str(inp.get("command") or "")))
            or (tn.startswith("mcp__") and "jbcontext" in tn)
            for tn, inp in turn
        ):
            first_jbc_turn_idx = idx
            break

    def _is_non_issue_explore(tn: str, inp: dict[str, Any]) -> bool:
        if tn in ("Grep", "Glob"):
            return True
        if tn == "Read":
            fp = str(inp.get("file_path") or "")
            return not (fp == "issue.md" or fp.endswith("/issue.md"))
        if tn == "Bash":
            s = str(inp.get("command") or "")
            s = re.sub(r"\b(?:cat|head|tail|sed)\b[^;&|\n]*\bissue\.md\b[^;&|\n]*", "", s)
            s = re.sub(r"\bjbcontext\b[^\n;&]*", "", s)
            s = re.sub(r"\bcd\s+[^\s;&|]+", "", s).strip(" ;&\n\t|")
            return bool(s and re.search(r"\b(?:ls|find|grep|rg|git\s+grep|git\s+ls-files|cat|sed|head|tail)\b", s))
        return False

    explored_before_jbc = False
    upto_turn = first_jbc_turn_idx if first_jbc_turn_idx is not None else len(turn_tools)
    for turn in turn_tools[:upto_turn]:
        if any(_is_non_issue_explore(tn, inp) for tn, inp in turn):
            explored_before_jbc = True
            break

    post_jbc_grep = False
    if first_jbc_turn_idx is not None:
        for turn in turn_tools[first_jbc_turn_idx + 1 :]:
            if not turn:
                continue
            for tn, inp in turn:
                if tn in ("Grep", "Glob") or (tn == "Bash" and re.search(r"\b(?:grep|rg|find)\b", str(inp.get("command") or ""))):
                    post_jbc_grep = True
            break

    opened_any_jbc_file = bool(all_jbc_visible_files and _matched_gold_files(opened_files, all_jbc_visible_files))

    return {
        "turns": len(model_call_ids),
        "model_calls": len(model_call_ids),
        "assistant_events": assistant_events,
        "tool_calls": len(flat_tools),
        "claude_num_turns": claude_num_turns,
        "gradle_bash_calls": gradle_bash_calls,
        "first_call_context_tokens": first_call_context_tokens,
        "last_tool": last_tool,
        "first_tool": first_tool,
        "tool_counts": tool_counts,
        "jbcontext_calls": len(jbc_commands),
        "zero_call": len(jbc_commands) == 0,
        "jbcontext_commands": jbc_commands,
        "jbcontext_pipe_modes": jbc_pipe_modes,
        "call1_pipe_mode": jbc_pipe_modes[0] if jbc_pipe_modes else "none",
        "head_pipe_calls": sum(1 for m in jbc_pipe_modes if m == "head"),
        "grep_file_pipe_calls": sum(1 for m in jbc_pipe_modes if m == "grep_file"),
        "unpiped_calls": sum(1 for m in jbc_pipe_modes if m == "unpiped"),
        "jbcontext_before_shell_explore": bool(jbc_commands and not explored_before_jbc),
        "post_jbcontext_immediate_grep": post_jbc_grep,
        "opened_any_jbcontext_file": opened_any_jbc_file,
        "call1_visible_files": sorted(call1_visible_files),
        "call1_snippet_files": sorted(call1_snippet_files),
        "edit_tokens": edit_tokens,
        "total_tokens": total_tokens,
        "cost_usd": cost_usd,
        "duration_ms": duration_ms,
        "duration_api_ms": duration_api_ms,
        "result_subtype": result_subtype,
        "is_error": is_error,
    }


def _load_session_transcript(lines: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"snapshots": [], "attachments": {}, "first_user": None, "betas": []}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = rec.get("type")
        if kind == "attachment":
            att = rec.get("attachment") or {}
            if att.get("type") == "prompt_snapshot":
                out["snapshots"].append(att)
            else:
                out["attachments"].setdefault(str(att.get("type")), []).append(att)
        elif kind == "user" and out["first_user"] is None:
            out["first_user"] = rec
        elif kind == "api-request" and not out["betas"]:
            out["betas"] = list((rec.get("params") or {}).get("betas") or ())
    return out


def _flatten_system_prompt(sp: Any) -> str:
    if isinstance(sp, str):
        return sp
    if isinstance(sp, list):
        return "\n".join(_flatten_system_prompt(x) for x in sp)
    if isinstance(sp, dict):
        return _flatten_system_prompt(sp.get("text") or sp.get("content") or "")
    return str(sp)


def _session_facts(session: dict[str, Any], home_dir: str) -> dict[str, Any]:
    slug = re.sub(r"[^A-Za-z0-9]", "-", f"{home_dir}/agent-work")

    def norm(text: str) -> str:
        return text.replace(slug, "-root-agent-work").replace(home_dir, "/root")

    snaps = session["snapshots"]
    system_prompt = norm(_flatten_system_prompt(snaps[0].get("systemPrompt"))) if snaps else ""
    marker = "You are running in a non-interactive automation environment."
    cut = system_prompt.find(marker)
    tools: dict[str, str] = {}
    for snap in snaps:
        for tool in snap.get("tools") or ():
            tools[str(tool.get("name"))] = norm(json.dumps(tool, sort_keys=True))
    atts = session["attachments"]
    first_user = session["first_user"] or {}
    content = (first_user.get("message") or {}).get("content")
    ctx = ((atts.get("session_context") or [{}])[0].get("context") or {}).get("gitStatus", "")
    instr_files = [norm(str(f.get("path") or "")) for a in atts.get("instructions") or () for f in a.get("files") or ()]
    prefetch_chars = sum(
        len(str(a.get("content") or a.get("additionalContext") or ""))
        for a in atts.get("hook_additional_context") or ()
    )
    return {
        "claude_system_prompt": system_prompt[:cut] if cut >= 0 else system_prompt,
        "appended_system_prompt": system_prompt[cut:] if cut >= 0 else "",
        "user_prompt": content if isinstance(content, str) else json.dumps(content),
        "builtin_tools": {k: v for k, v in tools.items() if not k.startswith("mcp__")},
        "mcp_tools": {k: v for k, v in tools.items() if k.startswith("mcp__")},
        "snapshot_flags": {k: snaps[-1].get(k) for k in ("inlineTools", "keptReminders", "echoWireToolInputs", "reminderFold")} if snaps else {},
        "deferred_tools": sorted(((atts.get("deferred_tools_delta") or [{}])[0]).get("addedNames") or ()),
        "skill_listing": norm(json.dumps((atts.get("skill_listing") or [{}])[0], sort_keys=True)),
        "agent_listing": norm(json.dumps((atts.get("agent_listing_delta") or [{}])[0], sort_keys=True)),
        "git_status": re.sub(r"(?m)^([0-9a-f]{7})[0-9a-f]* ", r"\1 ", ctx),
        "instruction_files": instr_files,
        "hook_attachments": sorted(k for k in atts if k.startswith("hook")),
        "prefetch_injected_chars": prefetch_chars,
        "betas": sorted(session["betas"]),
    }


def _parity_report(task_id: str, arm: str, home_dir: Path, expected_system_prompt: str, expected_user_prompt: str) -> dict[str, Any]:
    transcripts = sorted(
        (p for p in (home_dir / ".claude" / "projects").glob("*/*.jsonl") if "prefetch-work" not in str(p)),
        key=lambda p: p.stat().st_mtime,
    )
    if not transcripts:
        return {"ok": False, "differences": ["no session transcript"], "prefetch_injected_chars": 0}
    with transcripts[0].open(encoding="utf-8", errors="replace") as fh:
        local = _session_facts(_load_session_transcript(fh), str(home_dir))

    diffs: list[str] = []
    if arm == "baseline":
        if local["instruction_files"]:
            diffs.append(f"unexpected CLAUDE.md on baseline: {local['instruction_files']}")
        if local["hook_attachments"]:
            diffs.append(f"unexpected hook attachments on baseline: {local['hook_attachments']}")
    else:
        if "/root/.claude/CLAUDE.md" not in local["instruction_files"]:
            diffs.append(f"missing /root/.claude/CLAUDE.md in instruction_files (got {local['instruction_files']})")

    # Note: Claude Code 2.1.322 appends its `# Harness` / `# Environment` blocks AFTER `--append-system-prompt`,
    # so `expected_system_prompt` appears at the start of `appended_system_prompt`.
    if not local["appended_system_prompt"].startswith(expected_system_prompt[:200]):
        diffs.append("appended system prompt prefix differs from BenchRoom rendering")
    if local["user_prompt"] != expected_user_prompt:
        diffs.append("user prompt differs from BenchRoom rendering")

    ref_name = "live_reference_baseline.json" if arm == "baseline" else "live_reference_jbcontext.json"
    ref_path = TASKS_DIR / task_id / ref_name
    if not ref_path.is_file():
        return {
            "ok": not diffs,
            "live_reference": None,
            "differences": diffs,
            "notes": [f"no {ref_name} for {task_id} (task from older BenchRoom build)"],
            "prefetch_injected_chars": local["prefetch_injected_chars"],
        }
    live = json.loads(ref_path.read_text(encoding="utf-8"))
    for key in ("user_prompt", "git_status"):
        if local[key] != live[key]:
            diffs.append(f"{key}: local={json.dumps(local[key])[:220]} live={json.dumps(live[key])[:220]}")
    if arm != "baseline" and local["instruction_files"] != live["instruction_files"]:
        diffs.append(f"instruction_files: local={local['instruction_files']} live={live['instruction_files']}")

    route: list[str] = []
    missing_betas = sorted(set(live["betas"]) - set(local["betas"]))
    extra_betas = sorted(set(local["betas"]) - set(live["betas"]))
    if missing_betas or extra_betas:
        route.append(f"betas missing locally={missing_betas} extra locally={extra_betas}")
    if local["snapshot_flags"] != live["snapshot_flags"]:
        route.append(f"wire flags local={local['snapshot_flags']} live={live['snapshot_flags']}")
    # Host OS note (`darwin` vs `linux` in Claude Code's `# Environment` block)
    host_diffs: list[str] = []
    if local["claude_system_prompt"] != live["claude_system_prompt"]:
        host_diffs.append("claude_system_prompt differs only on host platform/OS block (macOS arm64 vs Linux x86_64)")
    return {
        "ok": not diffs,
        "live_reference": live.get("source"),
        "differences": diffs,
        "licence_route_differences": route,
        "host_differences": host_diffs,
        "prefetch_injected_chars": local["prefetch_injected_chars"],
    }


def _grade_trial(task_id: str, inst: dict[str, Any], ws_dir: Path, grade_dir: Path) -> dict[str, Any]:
    grade_dir.mkdir(parents=True, exist_ok=True)
    _assert_no_interactive_oauth(ws_dir)
    test_patch = str(inst.get("test_patch") or "")
    test_cmds = list((inst.get("config") or {}).get("test_commands") or ())
    if not test_cmds:
        grade_res = {"task_id": task_id, "resolved": False, "error": "no test_commands"}
        (grade_dir / "grade.json").write_text(json.dumps(grade_res, indent=2), encoding="utf-8")
        return grade_res

    applied_test_patch = False
    test_files = _extract_patch_files(test_patch)
    saved_agent_test_diff = ""
    if test_files:
        sv = subprocess.run(["git", "-C", str(ws_dir), "diff", "HEAD", "--", *sorted(test_files)], capture_output=True, text=True)
        saved_agent_test_diff = sv.stdout or ""
        for tf in sorted(test_files):
            tf_abs = ws_dir / tf
            chk = subprocess.run(["git", "-C", str(ws_dir), "ls-files", "--error-unmatch", tf], capture_output=True, text=True)
            if chk.returncode == 0:
                subprocess.run(["git", "-C", str(ws_dir), "checkout", "HEAD", "--", tf], check=False, capture_output=True)
            elif tf_abs.exists():
                tf_abs.unlink()

    if test_patch.strip():
        patch_file = grade_dir / "test_patch.diff"
        patch_file.write_text(test_patch, encoding="utf-8")
        ap = subprocess.run(["git", "-C", str(ws_dir), "apply", "--whitespace=nowarn", str(patch_file)], capture_output=True, text=True)
        if ap.returncode != 0:
            grade_res = {"task_id": task_id, "resolved": False, "error": f"test_patch apply failed: {ap.stderr[:400]}"}
            (grade_dir / "grade.json").write_text(json.dumps(grade_res, indent=2), encoding="utf-8")
            return grade_res
        applied_test_patch = True

    jdk_home = _jdk_home_for_task(task_id)
    gradle_home = _shared_gradle_user_home()
    env = dict(os.environ)
    env.update(
        {
            "JAVA_HOME": str(jdk_home),
            "PATH": f"{jdk_home / 'bin'}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
            "GRADLE_USER_HOME": str(gradle_home),
            "CI": "true",
            "GIT_TERMINAL_PROMPT": "0",
        }
    )
    cmd_logs: list[dict[str, Any]] = []
    all_passed = True
    try:
        for raw_cmd in test_cmds:
            full_cmd = f"{raw_cmd} --console=plain --no-daemon" if "./gradlew" in raw_cmd else raw_cmd
            t0 = time.monotonic()
            proc = subprocess.run(
                ["bash", "-lc", full_cmd],
                cwd=str(ws_dir),
                env=env,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=600,
            )
            dt = round(time.monotonic() - t0, 1)
            if proc.returncode != 0:
                all_passed = False
            cmd_logs.append(
                {
                    "cmd": full_cmd,
                    "returncode": proc.returncode,
                    "elapsed_s": dt,
                    "tail": (proc.stdout + "\n" + proc.stderr)[-2500:],
                }
            )
    finally:
        if applied_test_patch:
            subprocess.run(
                ["git", "-C", str(ws_dir), "apply", "-R", "--whitespace=nowarn", str(grade_dir / "test_patch.diff")],
                check=False,
                capture_output=True,
            )
        if saved_agent_test_diff.strip():
            subprocess.run(
                ["git", "-C", str(ws_dir), "apply", "--whitespace=nowarn", "-"],
                input=saved_agent_test_diff,
                text=True,
                check=False,
                capture_output=True,
            )

    grade_res = {"task_id": task_id, "resolved": all_passed, "commands": cmd_logs}
    (grade_dir / "grade.json").write_text(json.dumps(grade_res, indent=2), encoding="utf-8")
    return grade_res


def _run_one_task(
    task_id: str,
    *,
    arm: str,
    label: str,
    claude_model: str,
    effort: str,
    max_turns: int,
    max_budget_usd: float,
    timeout_s: float,
    claude_bin: Path,
    claude_version: str,
    jbcontext_bin: Path | None,
    jbcontext_bin_sha: str,
    jbcontext_version_str: str,
    jbcontext_flags: str,
    prompts_url: str | None,
    prompts_source_desc: str,
    skip_grade: bool = False,
) -> dict[str, Any]:
    task_path = TASKS_DIR / task_id / "instance.json"
    if not task_path.is_file():
        raise RuntimeError(f"Task {task_id} missing at {task_path}; run `local_lab.py sync-tasks` first.")
    inst = json.loads(task_path.read_text(encoding="utf-8"))
    if inst["instance_id"] in HELD_OUT_INSTANCE_IDS:
        raise RuntimeError(f"Refusing to run held-out task {inst['instance_id']}!")

    repo_key = str(inst["repo"])
    repo_dir = _repo_dir(repo_key)
    base_commit = str(inst["base_commit"])

    run_slug = f"{arm}-{label}"
    trial_dir = TRIALS_DIR / task_id / run_slug
    grade_dir = GRADES_DIR / task_id / run_slug
    if (trial_dir / "summary.json").is_file():
        return json.loads((trial_dir / "summary.json").read_text(encoding="utf-8"))
    if trial_dir.exists():
        shutil.rmtree(trial_dir, ignore_errors=True)
    trial_dir.mkdir(parents=True, exist_ok=True)

    home_dir, ws_dir = _ensure_mirror_workspace(repo_dir, base_commit, task_id, run_slug)
    jbc_home: Path | None = None
    extra_front_dir = ""

    try:
        if arm != "baseline":
            assert jbcontext_bin is not None
            # Index clean base_commit checkout BEFORE writing untracked `issue.md`
            idx_cache_dir = _ensure_base_jbcontext_index(task_id, repo_key, ws_dir, base_commit, jbcontext_bin)

        task_txt = _benchroom_task_text(str(inst["problem_statement"]))
        (ws_dir / "issue.md").write_text(task_txt, encoding="utf-8")

        if arm != "baseline":
            assert jbcontext_bin is not None
            jbc_home, jbc_meta = _setup_trial_jbcontext(
                task_id=task_id,
                repo_key=repo_key,
                base_commit=base_commit,
                home_dir=home_dir,
                ws_dir=ws_dir,
                jbcontext_bin=jbcontext_bin,
                jbcontext_flags=jbcontext_flags,
                prompts_url=prompts_url,
                idx_cache_dir=idx_cache_dir,
            )
            extra_front_dir = jbc_meta["BIN_DIR"]

        sys_prompt = _benchroom_system_prompt(repo_key)
        jdk_home = _jdk_home_for_task(task_id)
        agent_path = _host_tool_path(home_dir, jdk_home, extra_front_dir=extra_front_dir)

        env: dict[str, str] = {
            "HOME": str(home_dir),
            "USER": os.environ.get("USER", ""),
            "LOGNAME": os.environ.get("LOGNAME", os.environ.get("USER", "")),
            "SHELL": "/bin/bash",
            "PATH": agent_path,
            "JAVA_HOME": str(jdk_home),
            "GRADLE_USER_HOME": str(home_dir / ".gradle"),
            "GH_TKN": "",
            "JBCONTEXT_NO_KEYCHAIN": "1",
            "JBCONTEXT_ANALYTICS": "false",
            "JBCONTEXT_ERROR_REPORTING": "false",
        }
        if arm != "baseline":
            env["PROJECT_PATH"] = str(ws_dir)

        env.update(_api_credentials())
        if env.get("ANTHROPIC_BASE_URL"):
            env["_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL"] = "1"

        cmd = [
            str(claude_bin),
            "--print",
            task_txt,
            "--append-system-prompt",
            sys_prompt,
            "--verbose",
            "--output-format",
            "stream-json",
            "--dangerously-skip-permissions",
            "--model",
            claude_model,
        ]
        if effort:
            cmd.extend(["--effort", effort])
        if max_turns > 0:
            cmd.extend(["--max-turns", str(max_turns)])
        if max_budget_usd > 0:
            cmd.extend(["--max-budget-usd", f"{max_budget_usd:.2f}"])

        launch_meta = {
            "task_id": task_id,
            "instance_id": inst["instance_id"],
            "arm": arm,
            "label": label,
            "claude_model": claude_model,
            "claude_bin": str(claude_bin),
            "claude_version": claude_version,
            "jbcontext_bin": str(jbcontext_bin) if jbcontext_bin else "",
            "jbcontext_bin_sha256": jbcontext_bin_sha,
            "jbcontext_version": jbcontext_version_str,
            "jbcontext_flags": jbcontext_flags if arm != "baseline" else "",
            "prompts_source": prompts_source_desc if arm != "baseline" else "none",
            "home_dir": str(home_dir),
            "workspace": str(ws_dir),
            "effort": effort,
            "agent_env": {k: ("<redacted>" if k == "ANTHROPIC_API_KEY" else v) for k, v in env.items()},
            "cmd": cmd,
        }
        (trial_dir / "launch.json").write_text(json.dumps(launch_meta, indent=2), encoding="utf-8")

        t0 = time.monotonic()
        stream_path = trial_dir / "stream.jsonl"
        stderr_path = trial_dir / "stderr.log"
        eff_timeout = None if timeout_s <= 0 else timeout_s
        timed_out = False
        print(f"[{task_id}] started arm={arm} label={label} (timeout={eff_timeout or 'none'}s)", flush=True)
        with stream_path.open("w", encoding="utf-8") as out_fh, stderr_path.open("w", encoding="utf-8") as err_fh:
            proc = subprocess.Popen(
                cmd,
                cwd=str(ws_dir),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=out_fh,
                stderr=err_fh,
            )
            last_hb = t0
            while proc.poll() is None:
                now = time.monotonic()
                if eff_timeout is not None and (now - t0) >= eff_timeout:
                    timed_out = True
                    proc.terminate()
                    try:
                        proc.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=10)
                    break
                if now - last_hb >= 60.0:
                    last_hb = now
                    try:
                        progress = _parse_stream_metrics(stream_path)
                        print(
                            f"[{task_id}] ... elapsed_s={int(now - t0)} turns={progress.get('model_calls', 0)} "
                            f"jbc_calls={progress.get('jbcontext_calls', 0)} active_tool={progress.get('last_tool') or 'model'} "
                            f"gradle_calls={progress.get('gradle_bash_calls', 0)}",
                            flush=True,
                        )
                    except Exception:
                        pass
                time.sleep(2.0)
        elapsed_s = round(time.monotonic() - t0, 1)

        cand_patch = _candidate_patch(ws_dir)
        (trial_dir / "candidate.patch").write_text(cand_patch, encoding="utf-8")
        parity = _parity_report(task_id, arm, home_dir, sys_prompt, task_txt)

        projects_src = home_dir / ".claude" / "projects"
        if projects_src.is_dir():
            shutil.copytree(projects_src, trial_dir / "claude-config" / "projects", dirs_exist_ok=True)
        if (home_dir / ".claude" / "CLAUDE.md").is_file():
            (trial_dir / "claude-config").mkdir(parents=True, exist_ok=True)
            shutil.copy2(home_dir / ".claude" / "CLAUDE.md", trial_dir / "claude-config" / "CLAUDE.md")
        if (home_dir / ".claude" / "settings.json").is_file():
            (trial_dir / "claude-config").mkdir(parents=True, exist_ok=True)
            shutil.copy2(home_dir / ".claude" / "settings.json", trial_dir / "claude-config" / "settings.json")

        grade = {"resolved": False, "skipped": True} if skip_grade else _grade_trial(task_id, inst, ws_dir, grade_dir)
        s_metrics = _parse_stream_metrics(stream_path)

        gold_files = _extract_patch_files(str(inst.get("patch") or ""))
        cand_files = _extract_patch_files(cand_patch)
        vis_files = set(s_metrics.get("call1_visible_files") or ())
        snip_files = set(s_metrics.get("call1_snippet_files") or ())
        patch_prec = (len(cand_files & gold_files) / len(cand_files)) if cand_files else 0.0
        patch_rec = (len(cand_files & gold_files) / len(gold_files)) if gold_files else 0.0

        live_cmp_path = TASKS_DIR / task_id / "live_metrics.json"
        live_cmp = json.loads(live_cmp_path.read_text(encoding="utf-8")) if live_cmp_path.is_file() else {}

        summary = {
            "task_id": task_id,
            "instance_id": inst["instance_id"],
            "repo": repo_key,
            "arm": arm,
            "label": label,
            "returncode": proc.returncode,
            "resolved": bool(grade.get("resolved")),
            "elapsed_s": elapsed_s,
            "duration_s": round(float(s_metrics.get("duration_ms") or 0.0) / 1000.0, 1),
            "duration_api_s": round(float(s_metrics.get("duration_api_ms") or 0.0) / 1000.0, 1),
            "cost_usd": round(float(s_metrics.get("cost_usd") or 0.0), 4),
            "turns": s_metrics.get("turns", 0),
            "model_calls": s_metrics.get("model_calls", 0),
            "tool_calls": s_metrics.get("tool_calls", 0),
            "gradle_bash_calls": s_metrics.get("gradle_bash_calls", 0),
            "first_call_context_tokens": s_metrics.get("first_call_context_tokens", 0),
            "total_tokens": s_metrics.get("total_tokens", 0),
            "edit_tokens": s_metrics.get("edit_tokens", 0),
            "jbcontext_calls": s_metrics.get("jbcontext_calls", 0),
            "zero_call": bool(s_metrics.get("zero_call", True)),
            "call1_pipe_mode": s_metrics.get("call1_pipe_mode", "none"),
            "jbcontext_pipe_modes": s_metrics.get("jbcontext_pipe_modes", []),
            "jbcontext_commands": s_metrics.get("jbcontext_commands", []),
            "head_pipe_calls": s_metrics.get("head_pipe_calls", 0),
            "grep_file_pipe_calls": s_metrics.get("grep_file_pipe_calls", 0),
            "unpiped_calls": s_metrics.get("unpiped_calls", 0),
            "jbcontext_before_shell_explore": bool(s_metrics.get("jbcontext_before_shell_explore", False)),
            "post_jbcontext_immediate_grep": bool(s_metrics.get("post_jbcontext_immediate_grep", False)),
            "opened_any_jbcontext_file": bool(s_metrics.get("opened_any_jbcontext_file", False)),
            "prefetch_injected_chars": parity.get("prefetch_injected_chars", 0),
            "patch_precision": round(patch_prec, 4),
            "patch_recall": round(patch_rec, 4),
            "call1_visible_file_recall": _gold_file_recall(vis_files, gold_files),
            "call1_snippet_file_recall": _gold_file_recall(snip_files, gold_files),
            "tool_counts": s_metrics.get("tool_counts", {}),
            "claude_version": claude_version,
            "jbcontext_version": jbcontext_version_str if arm != "baseline" else "",
            "jbcontext_flags": jbcontext_flags if arm != "baseline" else "",
            "prompts_source": prompts_source_desc if arm != "baseline" else "none",
            "parity": parity,
            "live_reference_metrics": live_cmp.get(arm) or live_cmp.get("jbcontext") or {},
            "result_subtype": ("timeout" if timed_out else s_metrics.get("result_subtype", "")),
            "is_error": bool(timed_out or s_metrics.get("is_error", False)),
        }
        (trial_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        live_arm = live_cmp.get("baseline" if arm == "baseline" else "jbcontext") or {}
        live_note = ""
        if live_arm:
            live_note = (
                f" | LIVE({live_arm.get('run_id','')}): sol={live_arm.get('solved_str','?')} "
                f"cost=${live_arm.get('mean_cost_usd',0):.2f} dur={live_arm.get('mean_duration_s',0):.0f}s "
                f"jbc={live_arm.get('mean_jbcontext_calls',0):.2f}"
            )
        print(
            f"[{task_id}] DONE resolved={summary['resolved']} cost=${summary['cost_usd']:.3f} "
            f"dur={summary['duration_s']}s (wall={summary['elapsed_s']}s) turns={summary['turns']} "
            f"tools={summary['tool_calls']} jbc_calls={summary['jbcontext_calls']} pipe={summary['call1_pipe_mode']} "
            f"vis_rec={summary['call1_visible_file_recall']:.2f} parity_ok={parity.get('ok')}{live_note}",
            flush=True,
        )
        return summary
    finally:
        if jbc_home is not None and jbcontext_bin is not None:
            _stop_jbcontext_daemons(jbcontext_bin, jbc_home)


def _seed_labels(label: str, seeds: int) -> list[str]:
    return [label] if seeds <= 1 else [f"{label}_s{k}" for k in range(1, seeds + 1)]


def _aggregate_suite(suite: str, arm: str, label: str, seeds: int = 1, task_ids: list[str] | None = None) -> dict[str, Any]:
    task_ids = list(task_ids or SUITES[suite])
    summaries: list[dict[str, Any]] = []
    missing: list[str] = []
    for tid, seed_label in ((t, lab) for t in task_ids for lab in _seed_labels(label, seeds)):
        sp = TRIALS_DIR / tid / f"{arm}-{seed_label}" / "summary.json"
        if sp.is_file():
            s = json.loads(sp.read_text(encoding="utf-8"))
            s["seed_label"] = seed_label
            summaries.append(s)
        else:
            missing.append(f"{tid}:{seed_label}")
    n = max(1, len(summaries))
    solved = sum(1 for s in summaries if s["resolved"])
    callers = [s for s in summaries if s.get("jbcontext_calls", 0) > 0]
    total_jbc_calls = sum(int(s.get("jbcontext_calls", 0)) for s in summaries)
    total_head_calls = sum(int(s.get("head_pipe_calls", 0)) for s in summaries)
    total_grep_calls = sum(int(s.get("grep_file_pipe_calls", 0)) for s in summaries)

    live_comp_rows: list[dict[str, Any]] = []
    for s in summaries:
        tid = s["task_id"]
        lm_path = TASKS_DIR / tid / "live_metrics.json"
        lm = json.loads(lm_path.read_text(encoding="utf-8")) if lm_path.is_file() else {}
        live_arm = lm.get("baseline" if arm == "baseline" else "jbcontext") or {}
        live_base = lm.get("baseline") or {}
        live_comp_rows.append(
            {
                "task_id": tid,
                "instance_id": s["instance_id"],
                "local_resolved": s["resolved"],
                "live_solved": live_arm.get("solved_str"),
                "local_cost_usd": s["cost_usd"],
                "live_mean_cost_usd": live_arm.get("mean_cost_usd"),
                "live_baseline_cost_usd": live_base.get("mean_cost_usd"),
                "local_duration_s": s["duration_s"],
                "live_mean_duration_s": live_arm.get("mean_duration_s"),
                "local_turns": s["turns"],
                "live_mean_turns": live_arm.get("mean_turns"),
                "local_jbcontext_calls": s["jbcontext_calls"],
                "live_mean_jbcontext_calls": live_arm.get("mean_jbcontext_calls"),
                "local_call1_pipe": s["call1_pipe_mode"],
                "live_pipe_modes": live_arm.get("pipe_modes"),
                "parity_ok": (s.get("parity") or {}).get("ok"),
            }
        )

    agg = {
        "suite": suite,
        "arm": arm,
        "label": label,
        "seeds": seeds,
        "trials": len(summaries),
        "tasks": len({s["task_id"] for s in summaries}),
        "missing_tasks": missing,
        "resolved": solved,
        "solve_rate": round(solved / n, 4),
        "issue_underspecified_tasks": {t: UNDERSPECIFIED_TASKS[t] for t in task_ids if t in UNDERSPECIFIED_TASKS},
        "parity_ok": sum(1 for s in summaries if (s.get("parity") or {}).get("ok")),
        "parity_differences": sorted({d for s in summaries for d in (s.get("parity") or {}).get("differences") or ()}),
        "mean_cost_usd": round(sum(s["cost_usd"] for s in summaries) / n, 4),
        "mean_duration_s": round(sum(s["duration_s"] for s in summaries) / n, 1),
        "mean_elapsed_s": round(sum(s["elapsed_s"] for s in summaries) / n, 1),
        "mean_turns": round(sum(s["turns"] for s in summaries) / n, 2),
        "mean_tool_calls": round(sum(s["tool_calls"] for s in summaries) / n, 2),
        "mean_total_tokens": round(sum(s["total_tokens"] for s in summaries) / n, 1),
        "mean_edit_tokens": round(sum(s["edit_tokens"] for s in summaries) / n, 1),
        "mean_patch_precision": round(sum(s["patch_precision"] for s in summaries) / n, 4),
        "mean_patch_recall": round(sum(s["patch_recall"] for s in summaries) / n, 4),
        "jbcontext_behavior": {
            "mean_calls_per_trial": round(total_jbc_calls / n, 3),
            "zero_call_rate": round(sum(1 for s in summaries if s.get("zero_call")) / n, 4),
            "head_pipe_rate_per_call": round(total_head_calls / max(1, total_jbc_calls), 4) if total_jbc_calls else 0.0,
            "grep_file_pipe_rate_per_call": round(total_grep_calls / max(1, total_jbc_calls), 4) if total_jbc_calls else 0.0,
            "post_jbcontext_grep_rate_among_callers": round(
                sum(1 for s in callers if s.get("post_jbcontext_immediate_grep")) / len(callers), 4
            )
            if callers
            else 0.0,
            "opened_jbcontext_file_rate_among_callers": round(
                sum(1 for s in callers if s.get("opened_any_jbcontext_file")) / len(callers), 4
            )
            if callers
            else 0.0,
            "mean_call1_visible_file_recall_among_callers": round(
                sum(s["call1_visible_file_recall"] for s in callers) / len(callers), 4
            )
            if callers
            else 0.0,
        },
        "local_vs_live": live_comp_rows,
        "per_task": summaries,
    }
    report_path = LAB_DIR / f"report_{suite}_{arm}_{label}.json"
    report_path.write_text(json.dumps(agg, indent=2), encoding="utf-8")
    return agg


def _extract_live_arm_summary(run_dir: Path, instance_id: str, run_label: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Extract 3-seed live metrics + seed=1 transcript facts from a downloaded `evaluation-runs/` or `7517103` folder."""
    tds = sorted(run_dir.glob(f"*/*/instance_id={instance_id}/seed=*"))
    if not tds:
        tds = sorted(run_dir.glob(f"*/instance_id={instance_id}/seed=*"))
    if not tds:
        return None, None
    costs, durs, turns_l, tools_l = [], [], [], []
    solved = 0
    jbc_calls_per_seed: list[int] = []
    pipe_modes: list[str] = []
    seed1_facts: dict[str, Any] | None = None

    for td in tds:
        if (td / "artifacts.zip").is_file():
            with zipfile.ZipFile(td / "artifacts.zip") as az:
                if "after_applying_prediction/results.json" in az.namelist():
                    r = json.loads(az.read("after_applying_prediction/results.json"))
                    solved += int(bool(r.get("are_all_necessary_passed")))
        with zipfile.ZipFile(td / "matterhorn.zip") as mz:
            if "statistics.json" in mz.namelist():
                st = json.loads(mz.read("statistics.json"))
                costs.append(float(st.get("cost") or 0.0))
                durs.append(float(st.get("duration_ms") or 0.0) / 1000.0)
            mids: set[str] = set()
            seen_tu: set[str] = set()
            jbc_cnt = 0
            if "logs.jsonl" in mz.namelist():
                for ln in mz.read("logs.jsonl").decode("utf-8", errors="replace").splitlines():
                    if not ln.strip():
                        continue
                    ev = json.loads(ln)
                    if ev.get("type") == "assistant":
                        msg = ev.get("message") or {}
                        if msg.get("id"):
                            mids.add(str(msg["id"]))
                        for c in msg.get("content") or []:
                            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("id") not in seen_tu:
                                seen_tu.add(str(c["id"]))
                                if c.get("name") == "Bash":
                                    cmd = str((c.get("input") or {}).get("command") or "")
                                    for sub in re.split(r"[;\n]+", cmd):
                                        if re.search(r"\bjbcontext(?:-[A-Za-z0-9._-]+)?\s+search\b", sub):
                                            jbc_cnt += 1
                                            pipe_modes.append(_classify_jbcontext_subcmd(sub))
            turns_l.append(len(mids))
            tools_l.append(len(seen_tu))
            jbc_calls_per_seed.append(jbc_cnt)

        if td.name == "seed=1" and (td / "external_artifacts.zip").is_file():
            with zipfile.ZipFile(td / "external_artifacts.zip") as ez:
                jfs = [n for n in ez.namelist() if n.endswith(".jsonl") and "/subagents/" not in n and "prefetch-work" not in n]
                if jfs:
                    with ez.open(jfs[0]) as fh:
                        sess = _load_session_transcript(line.decode("utf-8", "replace") for line in fh)
                    seed1_facts = _session_facts(sess, "/root")
                    seed1_facts["source"] = str(td)

    k = len(tds)
    metrics = {
        "run_id": run_label,
        "seeds": k,
        "solved": solved,
        "solved_str": f"{solved}/{k}",
        "mean_cost_usd": round(sum(costs) / k, 4) if costs else 0.0,
        "seed_costs_usd": [round(x, 4) for x in costs],
        "mean_duration_s": round(sum(durs) / k, 1) if durs else 0.0,
        "seed_durations_s": [round(x, 1) for x in durs],
        "mean_turns": round(sum(turns_l) / k, 2) if turns_l else 0.0,
        "mean_tool_calls": round(sum(tools_l) / k, 2) if tools_l else 0.0,
        "mean_jbcontext_calls": round(sum(jbc_calls_per_seed) / k, 2),
        "seed_jbcontext_calls": jbc_calls_per_seed,
        "pipe_modes": pipe_modes,
    }
    return metrics, seed1_facts


def _fetch_teamcity_7499315_aip1283() -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Fetch live BenchRoom `#7499315` (`jbcontext` Opus 5.5) metrics + `seed=1` transcript for `aip-1283`."""
    token = os.environ.get("MATTERHORN_TEAMCITY_TOKEN", "").strip()
    if not token:
        rc = Path.home() / ".zshrc"
        if rc.is_file():
            for ln in rc.read_text(errors="ignore").splitlines():
                if "MATTERHORN_TEAMCITY_TOKEN" in ln and "=" in ln and not ln.strip().startswith("#"):
                    cand = ln.split("=", 1)[1].strip().strip("'\"")
                    if cand and not cand.startswith("$"):
                        token = cand
                        break
    if not token:
        return None, None

    class _NoAuthRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
            new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
            if new_req is not None and "matterhorn.internal.teamcity.cloud" not in newurl:
                new_req.headers.pop("Authorization", None)
                new_req.unredirected_hdrs.pop("Authorization", None)
            return new_req

    opener = urllib.request.build_opener(_NoAuthRedirect())
    costs, durs, turns_l, tools_l, jbc_cnts = [], [], [], [], []
    solved_map = {7499388: 0, 7499389: 1, 7499390: 0}
    seed1_facts: dict[str, Any] | None = None
    try:
        for idx, bid in enumerate((7499388, 7499389, 7499390), 1):
            base_art = f"https://matterhorn.internal.teamcity.cloud/app/rest/builds/id:{bid}/artifacts/content/instance_id=JetBrains_jetbrains-ai-platform-1283/seed={idx}"
            req_m = urllib.request.Request(f"{base_art}/matterhorn.zip", headers={"Authorization": f"Bearer {token}"})
            with opener.open(req_m, timeout=30) as rm:
                mz_bytes = rm.read()
            with zipfile.ZipFile(io.BytesIO(mz_bytes)) as mz:
                st = json.loads(mz.read("statistics.json"))
                costs.append(float(st.get("cost") or 0.0))
                durs.append(float(st.get("duration_ms") or 0.0) / 1000.0)
                mids, seen_tu, jcnt = set(), set(), 0
                for ln in mz.read("logs.jsonl").decode("utf-8", errors="replace").splitlines():
                    if not ln.strip():
                        continue
                    ev = json.loads(ln)
                    if ev.get("type") == "assistant":
                        msg = ev.get("message") or {}
                        if msg.get("id"):
                            mids.add(str(msg["id"]))
                        for c in msg.get("content") or []:
                            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("id") not in seen_tu:
                                seen_tu.add(str(c["id"]))
                                if c.get("name") == "Bash" and "jbcontext" in str((c.get("input") or {}).get("command") or ""):
                                    jcnt += 1
                turns_l.append(len(mids))
                tools_l.append(len(seen_tu))
                jbc_cnts.append(jcnt)
            if idx == 1:
                try:
                    req_e = urllib.request.Request(f"{base_art}/external_artifacts.zip", headers={"Authorization": f"Bearer {token}"})
                    with opener.open(req_e, timeout=30) as re_resp:
                        ez_bytes = re_resp.read()
                    with zipfile.ZipFile(io.BytesIO(ez_bytes)) as ez:
                        jfs = [n for n in ez.namelist() if n.endswith(".jsonl") and "/subagents/" not in n]
                        if jfs:
                            with ez.open(jfs[0]) as fh:
                                sess = _load_session_transcript(line.decode("utf-8", "replace") for line in fh)
                            seed1_facts = _session_facts(sess, "/root")
                            seed1_facts["source"] = f"matterhorn:#7499315/build:{bid}"
                except Exception:
                    pass
    except Exception as exc:
        print(f"[sync-tasks] warning: could not fetch #7499315 aip-1283 live artifacts: {exc}", flush=True)
        return None, None

    metrics = {
        "run_id": "tc-7499315 (0.9.18 --auto, cli 2.1.317)",
        "seeds": 3,
        "solved": sum(solved_map.values()),
        "solved_str": f"{sum(solved_map.values())}/3",
        "mean_cost_usd": round(sum(costs) / 3, 4),
        "seed_costs_usd": [round(x, 4) for x in costs],
        "mean_duration_s": round(sum(durs) / 3, 1),
        "seed_durations_s": [round(x, 1) for x in durs],
        "mean_turns": round(sum(turns_l) / 3, 2),
        "mean_tool_calls": round(sum(tools_l) / 3, 2),
        "mean_jbcontext_calls": round(sum(jbc_cnts) / 3, 2),
        "seed_jbcontext_calls": jbc_cnts,
        "pipe_modes": [],
    }
    return metrics, seed1_facts


def _sync_tasks() -> dict[str, Any]:
    """Populate `local-lab/repos/`, `local-lab/tasks/<tid>/instance.json`, `live_reference_*.json`, and `live_metrics.json`."""
    REPOS_DIR.mkdir(parents=True, exist_ok=True)
    TASKS_DIR.mkdir(parents=True, exist_ok=True)

    # Link existing local repo mirrors from decider-rag and ensure bare jcp-common exists
    for slug in ("code-engine", "jetbrains-ai-platform", "patronus"):
        dst = REPOS_DIR / slug
        src = DECIDER_LAB_DIR / "repos" / slug
        if not dst.exists() and src.exists():
            dst.symlink_to(src, target_is_directory=True)

    jcp_common_dir = REPOS_DIR / "jcp-common"
    if not (jcp_common_dir / "HEAD").is_file() and not (jcp_common_dir / ".git").exists():
        print("[sync-tasks] cloning bare JetBrains/jcp-common mirror ...", flush=True)
        subprocess.run(["git", "clone", "--bare", "-q", "git@github.com:JetBrains/jcp-common.git", str(jcp_common_dir)], check=True, timeout=180)

    synced: list[str] = []
    for tid, spec in TASK_REGISTRY.items():
        iid = spec["instance_id"]
        if iid in HELD_OUT_INSTANCE_IDS:
            raise RuntimeError(f"Held-out instance {iid} cannot be registered!")
        tdir = TASKS_DIR / tid
        tdir.mkdir(parents=True, exist_ok=True)

        # Locate instance.json from evaluation-runs/, decider-rag tasks/, or 7517103
        inst_obj: dict[str, Any] | None = None
        lg_hits = sorted(LIVE_JBC_RUN.glob(f"*/*/instance_id={iid}/seed=1/instance.json"))
        if lg_hits:
            inst_obj = json.loads(lg_hits[0].read_text(encoding="utf-8"))
        elif (DECIDER_LAB_DIR / "tasks" / tid / "instance.json").is_file():
            inst_obj = json.loads((DECIDER_LAB_DIR / "tasks" / tid / "instance.json").read_text(encoding="utf-8"))
        elif BENCHROOM_7517103_DIR.is_dir():
            b_hits = sorted(BENCHROOM_7517103_DIR.glob(f"*/instance_id={iid}/seed=1/instance.json"))
            if b_hits:
                inst_obj = json.loads(b_hits[0].read_text(encoding="utf-8"))
        if inst_obj is None:
            raise RuntimeError(f"Could not find instance.json for {tid} ({iid})")

        (tdir / "instance.json").write_text(json.dumps(inst_obj, indent=2), encoding="utf-8")

        live_metrics: dict[str, Any] = {"task_id": tid, "instance_id": iid, "role": spec["role"]}
        jbc_m, jbc_ref = _extract_live_arm_summary(LIVE_JBC_RUN, iid, "jcp-1931570")
        base_m, base_ref = _extract_live_arm_summary(LIVE_BASE_RUN, iid, "jcp-1899094")
        if base_m is None and BENCHROOM_7517103_DIR.is_dir():
            base_m, base_ref = _extract_live_arm_summary(BENCHROOM_7517103_DIR, iid, "tc-7517103-baseline")

        if jbc_m is not None:
            live_metrics["jbcontext"] = jbc_m
        if base_m is not None:
            live_metrics["baseline"] = base_m
        if jbc_ref is not None:
            (tdir / "live_reference_jbcontext.json").write_text(json.dumps(jbc_ref, indent=1), encoding="utf-8")
        if base_ref is not None:
            (tdir / "live_reference_baseline.json").write_text(json.dumps(base_ref, indent=1), encoding="utf-8")

        if tid == "aip-1283" and jbc_m is None:
            m74, ref74 = _fetch_teamcity_7499315_aip1283()
            if m74 is not None:
                live_metrics["jbcontext"] = m74
            if ref74 is not None:
                (tdir / "live_reference_jbcontext.json").write_text(json.dumps(ref74, indent=1), encoding="utf-8")

        (tdir / "live_metrics.json").write_text(json.dumps(live_metrics, indent=2), encoding="utf-8")
        synced.append(tid)
    return {"synced_tasks": synced, "count": len(synced)}


def _build_local_cli() -> dict[str, str]:
    """Build `indexing-cli` JVM distribution from `/Users/mihajlo.linic/PycharmProjects/jetbrains-ai-platform`."""
    if not AI_PLATFORM_WORKTREE.is_dir():
        raise SystemExit(f"jetbrains-ai-platform worktree not found at {AI_PLATFORM_WORKTREE}")
    jdk21 = Path.home() / "Library" / "Java" / "JavaVirtualMachines" / "ms-21.0.12.1" / "Contents" / "Home"
    env = dict(os.environ)
    if jdk21.is_dir():
        env["JAVA_HOME"] = str(jdk21)
        env["PATH"] = f"{jdk21 / 'bin'}:{env.get('PATH', '')}"
    cmd = [
        "./gradlew",
        ":indexing:indexing-cli:installDist",
        "-PcontextApp=false",
        f"-PcontextResourcesDir={CONTEXT_ROOT}",
        "--console=plain",
    ]
    print(f"[build-cli] running {' '.join(cmd)} in {AI_PLATFORM_WORKTREE} ...", flush=True)
    t0 = time.monotonic()
    proc = subprocess.run(cmd, cwd=str(AI_PLATFORM_WORKTREE), env=env, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise SystemExit(f"indexing-cli build failed:\n{(proc.stdout + proc.stderr)[-2500:]}")
    bin_path = AI_PLATFORM_WORKTREE / "indexing" / "indexing-cli" / "build" / "install" / "jbcontext" / "bin" / "jbcontext"
    if not bin_path.is_file():
        raise SystemExit(f"Expected launcher not found at {bin_path}")
    ver = _jbcontext_version_str(bin_path)
    return {"jbcontext_bin": str(bin_path), "version": ver, "built_in_s": str(round(time.monotonic() - t0, 1))}


def main() -> int:
    ap = argparse.ArgumentParser(description="Local SWE-bench LG Private parity lab for Air Context (jbcontext)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sc_p = sub.add_parser("setup-claude", help="Install pinned bare Claude Code npm binary under runtime/")
    sc_p.add_argument("--claude-version", default=DEFAULT_CLAUDE_VERSION)

    sub.add_parser("sync-tasks", help="Sync task definitions, repo mirrors, and live parity references")
    sub.add_parser("build-cli", help="Build local jbcontext JVM launcher from jetbrains-ai-platform/indexing/indexing-cli")

    rep_p = sub.add_parser("report", help="Aggregate completed trials and compare against live values")
    rep_p.add_argument("--suite", default="jbc3", choices=sorted(SUITES))
    rep_p.add_argument("--arm", default="jbcontext", choices=("jbcontext", "baseline"))
    rep_p.add_argument("--label", required=True)
    rep_p.add_argument("--seeds", type=int, default=1)

    reg_p = sub.add_parser("regrade", help="Regrade existing trial workspaces with Gradle")
    reg_p.add_argument("--task", default="all")
    reg_p.add_argument("--suite", default="jbc3", choices=sorted(SUITES))
    reg_p.add_argument("--arm", default="jbcontext", choices=("jbcontext", "baseline"))
    reg_p.add_argument("--label", required=True)

    run_p = sub.add_parser("run", help="Run isolated Claude Code trials with user license tokens")
    run_p.add_argument("--task", default="all", help="Comma-separated task IDs or 'all' for --suite")
    run_p.add_argument("--suite", default="jbc3", choices=sorted(SUITES))
    run_p.add_argument("--arm", default="jbcontext", choices=("jbcontext", "baseline"))
    run_p.add_argument("--label", required=True)
    run_p.add_argument("--seeds", type=int, default=1, help="Trials per task (default 1; live runs 3)")
    run_p.add_argument("--claude-model", default="claude-opus-5-5")
    run_p.add_argument("--claude-version", default=DEFAULT_CLAUDE_VERSION)
    run_p.add_argument("--claude-bin", default="", help="Optional explicit Claude Code binary override")
    run_p.add_argument("--effort", default="medium")
    run_p.add_argument("--jbcontext-version", default=DEFAULT_JBCONTEXT_VERSION, help="Installed version under ~/.jbcontext/versions/")
    run_p.add_argument("--jbcontext-bin", default="", help="Optional custom jbcontext binary (e.g. from `build-cli`)")
    run_p.add_argument("--jbcontext-flags", default="--auto", help="Flags passed to `jbcontext setup-agent`")
    run_p.add_argument(
        "--prompts-source",
        default="local",
        help="'local' (serve working tree over localhost HTTP), 'bundled' (binary embedded resources), or an explicit URL",
    )
    run_p.add_argument("--prompts-dir", default=str(CONTEXT_ROOT), help="Directory served when --prompts-source=local")
    run_p.add_argument("--max-turns", type=int, default=0)
    run_p.add_argument("--max-budget-usd", type=float, default=0.0)
    run_p.add_argument("--timeout", type=float, default=900.0)
    run_p.add_argument("--skip-grade", action="store_true", help="Skip Gradle test execution (exploration-only speed checks)")
    run_p.add_argument("--workers", type=int, default=2)

    args = ap.parse_args()

    if args.cmd == "setup-claude":
        binary = _install_bare_claude(args.claude_version)
        print(json.dumps({"claude_bin": str(binary), "version": _claude_version(binary)}, indent=2), flush=True)
        return 0

    if args.cmd == "sync-tasks":
        res = _sync_tasks()
        print(json.dumps(res, indent=2), flush=True)
        return 0

    if args.cmd == "build-cli":
        res = _build_local_cli()
        print(json.dumps(res, indent=2), flush=True)
        return 0

    if args.cmd == "report":
        agg = _aggregate_suite(args.suite, args.arm, args.label, seeds=args.seeds)
        print(json.dumps(agg, indent=2), flush=True)
        return 0

    if args.cmd == "regrade":
        task_ids = list(SUITES[args.suite]) if args.task == "all" else [t.strip() for t in args.task.split(",") if t.strip()]
        for tid in task_ids:
            run_slug = f"{args.arm}-{args.label}"
            ws_dir = WORKSPACES_DIR / tid / run_slug
            trial_dir = TRIALS_DIR / tid / run_slug
            grade_dir = GRADES_DIR / tid / run_slug
            inst = json.loads((TASKS_DIR / tid / "instance.json").read_text(encoding="utf-8"))
            grade = _grade_trial(tid, inst, ws_dir, grade_dir)
            sp = trial_dir / "summary.json"
            if sp.is_file():
                s = json.loads(sp.read_text(encoding="utf-8"))
                s["resolved"] = bool(grade.get("resolved"))
                sp.write_text(json.dumps(s, indent=2), encoding="utf-8")
            print(f"[{tid}] regraded resolved={grade.get('resolved')} err={grade.get('error', '')}", flush=True)
        return 0

    if args.cmd == "run":
        if not (TASKS_DIR / "jcp-434" / "instance.json").is_file():
            _sync_tasks()

        task_ids = list(SUITES[args.suite]) if args.task == "all" else [t.strip() for t in args.task.split(",") if t.strip()]
        claude_bin = Path(args.claude_bin).expanduser().resolve() if args.claude_bin else _install_bare_claude(args.claude_version)
        actual_claude_ver = _claude_version(claude_bin)
        _api_credentials()

        jbc_bin: Path | None = None
        jbc_sha = ""
        jbc_ver_str = ""
        if args.arm != "baseline":
            jbc_bin, jbc_sha = _resolve_jbcontext_binary(args.jbcontext_bin, args.jbcontext_version)
            jbc_ver_str = _jbcontext_version_str(jbc_bin)

        prompts_srv: _LocalPromptsServer | None = None
        prompts_url: str | None = None
        prompts_desc = "none"
        if args.arm != "baseline":
            psrc = args.prompts_source.strip()
            if psrc == "local":
                pdir = Path(args.prompts_dir).expanduser().resolve()
                prompts_srv = _LocalPromptsServer(pdir)
                prompts_url = prompts_srv.start()
                prompts_desc = f"local:{pdir}"
            elif psrc == "bundled":
                prompts_url = None
                prompts_desc = "bundled"
            else:
                prompts_url = psrc
                prompts_desc = psrc

        seeds = max(1, int(args.seeds or 1))
        jobs = [(tid, lab) for lab in _seed_labels(args.label, seeds) for tid in task_ids]
        print(
            f"[local_lab] starting {len(jobs)} trial(s): arm={args.arm} suite={args.suite} tasks={task_ids} "
            f"seeds={seeds} model={args.claude_model} effort={args.effort} claude='{actual_claude_ver}' "
            f"jbcontext='{jbc_ver_str or 'disabled'}' flags='{args.jbcontext_flags if args.arm != 'baseline' else ''}' "
            f"prompts='{prompts_desc}'",
            flush=True,
        )

        def _job(tid: str, lab: str) -> dict[str, Any]:
            try:
                return _run_one_task(
                    tid,
                    arm=args.arm,
                    label=lab,
                    claude_model=args.claude_model,
                    effort=args.effort,
                    max_turns=args.max_turns,
                    max_budget_usd=args.max_budget_usd,
                    timeout_s=args.timeout,
                    claude_bin=claude_bin,
                    claude_version=actual_claude_ver,
                    jbcontext_bin=jbc_bin,
                    jbcontext_bin_sha=jbc_sha,
                    jbcontext_version_str=jbc_ver_str,
                    jbcontext_flags=args.jbcontext_flags,
                    prompts_url=prompts_url,
                    prompts_source_desc=prompts_desc,
                    skip_grade=args.skip_grade,
                )
            except Exception as exc:
                print(f"[{tid}] {lab} FAILED TO RUN: {exc!r}", flush=True)
                return {"task_id": tid, "error": repr(exc)}

        t_start = time.monotonic()
        try:
            workers = max(1, int(args.workers or 1))
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
                futs = [ex.submit(_job, tid, lab) for tid, lab in jobs]
                pending = set(futs)
                while pending:
                    _, pending = concurrent.futures.wait(pending, timeout=60.0)
                    if pending:
                        print(
                            f"[local_lab] ... elapsed_s={int(time.monotonic() - t_start)} "
                            f"trials_done={len(futs) - len(pending)}/{len(futs)} running={min(workers, len(pending))}",
                            flush=True,
                        )
        finally:
            if prompts_srv is not None:
                prompts_srv.stop()

        if args.task == "all":
            agg = _aggregate_suite(args.suite, args.arm, args.label, seeds=seeds, task_ids=task_ids)
            print(
                f"[local_lab] SUMMARY suite={args.suite} arm={args.arm} label={args.label}: "
                f"resolved={agg['resolved']}/{agg['trials']} ({agg['solve_rate']*100:.1f}%) "
                f"mean_cost=${agg['mean_cost_usd']:.4f} mean_dur={agg['mean_duration_s']}s "
                f"jbc={agg['jbcontext_behavior']} parity_ok={agg['parity_ok']}/{agg['trials']}",
                flush=True,
            )
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())

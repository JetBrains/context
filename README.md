# JetBrains Context

https://www.jetbrains.com/context/

Give agents the codebase knowledge they need.

**This repository is the public home of JetBrains Context — not its source code.** The `jbcontext` CLI is developed in a private JetBrains repository and distributed as a prebuilt binary. What you'll find here:

- **Agent integrations** — skills, subagents, hooks, MCP configuration, and `AGENTS.md` instructions that wire `jbcontext` into coding agents. These *are* fully open.
- **Releases and release notes** — every `jbcontext` release is published under [Releases](https://github.com/JetBrains/context/releases). Treat that page as the CLI changelog; the tags there track CLI versions, not the contents of this repo.

The CLI is a separate download — see [jetbrains.com/context](https://www.jetbrains.com/context/) for installation instructions. Binaries come from `download.jetbrains.com`, and `jbcontext upgrade` updates in place.

### Skills


| Skill | Description |
|---|---|
| `context-search` | `/context-search` — run a semantic code search |
| `context-research` | `/context-research` — deep codebase exploration using `jbcontext search` and `jbcontext history` |
| `context-install` | `/context-install` — install the jbcontext CLI |
| `org-search` | `/org-search` — experimental org-wide semantic search |
| `dependency-search` | `/dependency-search` — org-wide dependency usage and upgrade research |
| `blast-radius` | `/blast-radius` — org-wide impact and consumer analysis |

### Agents

Read-only exploration subagents that run several `jbcontext search` queries in their own context and return `file:line` references with code snippets — useful for more extensive exploration without cluttering the main thread.

| Agent | Description |
|---|---|
| `context-explorer` (Claude) | `agents/claude/context-explorer.md` — Claude subagent, invoked via `Task(subagent_type='context-explorer', ...)`. |
| `context_explorer` (Codex) | `agents/codex/context-explorer.toml` — Codex custom agent (install under `~/.codex/agents/` or `.codex/agents/`). Codex spawns subagents only when asked, so request it directly, e.g. "use `context_explorer` to map the auth flow". |

### Hooks

Text payloads for the hooks that `jbcontext setup-agent` installs. The CLI embeds these files and loads them by name when a hook fires (`jbcontext hook <event>`), so the wording can change without a CLI release; a file under `hooks/<agent>/` overrides the generic one for that agent. The `*.sh` scripts are an earlier, standalone version of the tool-watching hooks and are not used by the CLI.

| File | Hook | Purpose |
|---|---|---|
| `session-start-auth.txt` | SessionStart (`hook session-start-auth`) | Shown to the user when the CLI is not logged in: semantic search is unavailable, run `jbcontext login`. Printed only in that case; a healthy session prints nothing. |
| `session-start-auth-context.txt` | SessionStart (`hook session-start-auth`) | The matching one-line context for the agent: do not retry `jbcontext search` or `code_search`, the user has been told to log in. |
| `session-start-instruct.txt` | SessionStart (`hook session-start-instruct`, opt-in) | Reminds the agent to start code discovery with one broad `jbcontext search`. |
| `user-prompt-submit.txt` | UserPromptSubmit (`hook user-prompt-submit`) | The same reminder on each prompt. |
| `pre-tool-use.txt` | PreToolUse (`hook pre-tool-use`) | The reminder when the agent reaches for `grep`/`rg`/`find` before a semantic search. |

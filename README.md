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

## Air Context + Accio experiment

The `malek/context-accio` CLI branch packages Accio v0.28.0 and enables its nonsemantic tools by default.
Prompts in `accio/` are rendered from the persisted tool selection. Edit the base instructions, skill, explorer,
reminder, or individual tool fragments here; `{{ACCIO_TOOLS}}`, `{{ACCIO_TOOL_NAMES}}`, and `{{JBCONTEXT}}`
are expanded during setup and refresh. Standard prompt variants remain available with `--no-accio`.

Use this experiment prompts location:

```text
https://github.com/JetBrains/context/tree/malek/context-accio
```

Example experiment flags:

```text
--auto
--auto --accio-tools locate,files,symbol,references
--auto --accio-disable-tools trace,impact,tests
--auto --no-accio
```

### Compact selectors and command help

`accio/tools/<command>.md` contains one routing-table row with a basic invocation. Instructions,
the search skill, and explorer definitions render only enabled rows, in CLI command order. Reminders
contain routing intent and enabled names. Air Context semantic search remains available independently.
These entry points deliberately omit expanded command manuals, including when skills or explorers
are installed alongside inline instructions.

`accio/help/<command>.md` holds detailed examples, wrapper restrictions, and result interpretation.
The CLI displays this guidance before native Accio options for exactly `jbcontext <command> --help`
or `jbcontext <command> -h`. Other argument combinations are forwarded unchanged, so option-like
query values such as `locate -e --help` remain queries. Ordinary searches never request help automatically.
Help uses the existing bundled/cache source policy and works offline without indexing or Air authentication.

Build the CLI with this prompt checkout, then use the existing `setup-agent` or `refresh-agents`
mechanism to regenerate installed instructions, skills, explorers, and reminders. For a remote prompt
source, publish this repository and use the existing `--prompts-location` option. Help resources are
cached with the other prompts; no new setting or migration is needed. Older renderers can continue
reading the compact `accio/tools/` fragments.

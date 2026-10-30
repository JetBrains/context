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
| `context-search` | `/context-search` — run a hybrid and precise code search |
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

## Default repository search workflow

The default and aggressive instruction variants both require jbcontext for
repository searches, including precise follow-ups. Hook integrations emit
nonblocking reminders; legacy enforcer invocations no longer deny tools or keep
bootstrap state. Reinstall agent integration with the CLI built against this
branch to refresh installed instructions, tools, and managed rules.

# Repository search with jbcontext

Use jbcontext for every repository search: source, tests, configuration,
documentation, filenames, and exact follow-ups in known files or directories.
Choose the tool that matches the question; keep using jbcontext as you learn
identifiers and after making edits.

| Need | CLI | MCP |
| --- | --- | --- |
| Behavior, intent, or similar code | `jbcontext search "<focused question>"` | `code_search(text=...)` |
| Literal text, identifier, or string occurrences | `jbcontext text-search "<literal>"` | `text_search(pattern=...)` |
| Occurrences matching a regular expression | `jbcontext regex-search '<RE2 pattern>'` | `regex_search(pattern=...)` |
| Declarations of classes, functions, or other symbols | `jbcontext symbol-search '^Name$'` | `symbol_search(pattern=...)` |
| Filename or path glob | `jbcontext file-search '**/*Test.kt'` | `file_search(pattern=...)` |

Precise searches are local and work offline. They search the current working
tree, including staged/unstaged edits and nonignored untracked files. An explicit
`--revision <ref>` / MCP `revision` selects immutable committed code instead.
This working-tree default also applies to regex and symbol search. Symbol search
uses Ctags declarations; use literal/regex search to find usages. File globs with
no slash match basenames; `**` spans directories. Binary files, symlinks, oversized
contents, Git ignores for untracked files, jbcontext ignores, and workspace
exclusions limit the searchable files.

Scope to a known file or directory with `--path-filter <path>` (`-p`) / MCP
`pathFilter`. Use `--ignore-case` / `caseSensitive=false` when needed. Literal
search supports `--whole-word` / `wholeWord=true`. Precise search returns every
occurrence in repository/path/position order, with no relevance threshold.
Use `--limit` / `limit` and continue with `--cursor` / top-level MCP `nextCursor`
to inspect further pages. Reuse the other search arguments. If edits invalidate
a cursor, restart that search. Check incomplete-search and error diagnostics;
truncation means more matches exist, not that traversal failed.

For behavior discovery, describe one existing code responsibility and its
distinguishing constraints in natural language. Preserve relevant domain terms
and observed identifiers. Do not submit the entire task or invent symbol names.
Inspect promising code, then use the appropriate jbcontext tool for the next
question. There is no fixed search/retry cap or single-bootstrap rule.

Read and edit known locations using native file tools. Builds, tests, Git
operations, and filtering command output continue normally. Do not search
repository content with rg/grep, find, glob, or an agent's native search tool as
a routine follow-up. If jbcontext reports an error or does not support a needed
capability, briefly state that reason and use an external search fallback for
that operation. Empty results alone do not establish tool failure: check scope,
spelling, case, or the choice of search tool. Do not suppress reported errors or
claim committed results describe uncommitted code.

Examples:

```bash
jbcontext search "loading and validating repository configuration"
jbcontext symbol-search '^ConfigLoader$' -p src
jbcontext text-search 'ConfigLoader' -w -p src
jbcontext regex-search 'timeout(Millis|Seconds)' -p config
jbcontext file-search '**/*config*.yaml'
# Read/edit a returned location with native tools, then search the edited tree:
jbcontext text-search 'newSetting' -p src/config
```

---
name: context-integrate
description: Fit jbcontext into a repository's own agent guide by writing short repo notes. Use when the user asks to integrate jbcontext with this repository, or when `jbcontext repo-notes show --check` reports stale notes.
---

# Integrate jbcontext into this repository

A repository guide (AGENTS.md, CLAUDE.md, tool rules under `.ai/`) outranks the global jbcontext instructions. Repo notes are a short addendum that places jbcontext inside that guide. The CLI stores them, renders them into a file git ignores, and keeps them across upgrades. Never edit the committed guide.

## Steps

1. Run `jbcontext repo-notes show`. If notes exist and every source is unchanged, stop.
2. Read the repository's agent guides: root AGENTS.md or CLAUDE.md, the files they link for search or tool rules, and tool-permission files (for example deny lists in `.claude/settings.json`).
3. Find the rule that decides how code is searched, which tools it names, and what it forbids.
4. Write at most 10 lines to a temporary file:
   - Name the guide section the notes extend.
   - Unknown location or a behavior-phrased question -> one `jbcontext search` first.
   - Known symbol, file, or exact text -> the tool the guide already names.
   - If the guide forbids shell or file search, state that `jbcontext search` is a semantic index query and is allowed.
   - Claude Code: the tool is `mcp__jbcontext__code_search`; if it is deferred, load it with ToolSearch first.
   - Do not restate the general jbcontext instructions or contradict the guide.
5. Save: `jbcontext repo-notes set --file <tmp> --source <each guide you read>`.
6. Tell the user the notes stay local to this checkout. Use `--shared` (stores them in the committed `.jbcontext.json` for every jbcontext user of the repository) only when the user asks.

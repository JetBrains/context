---
name: context-search
description: "Search repository code, tests, configuration, documentation and filenames with jbcontext. Use for broad discovery and precise follow-ups, including identifiers in known files and searches after edits."
argument-hint: query
---

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

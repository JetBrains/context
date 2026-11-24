---
name: context-search
description: "Find code by meaning with Air Context and inspect exact names and structure through enabled jbcontext Accio tools."
---

# Repository search with {{JBCONTEXT}}

Use the matching {{JBCONTEXT}} command for repository searches throughout the task, including follow-ups and after edits.
For behavior, intent, or similar code, use Air Context semantic search:

```sh
{{JBCONTEXT}} search "<focused natural-language question>"
{{JBCONTEXT}} search -p src/ "<question scoped to this area>"
```

Describe an existing responsibility and its distinguishing constraints. Preserve observed identifiers and domain terms.
Use semantic discovery when you do not know the relevant implementation. For a known name, exact text, filename, or
structural question, use the matching enabled command below directly; no semantic bootstrap is required.

## Enabled exact and structural tools

These commands delegate to Accio locally. Only the following Accio tools are enabled:

{{ACCIO_TOOLS}}

Use `--scope <path-or-glob>` to narrow Accio searches, `--project <checkout>` for another local checkout,
and `--ref <revision>` for committed code. Air Context uses its own `-p` / `--path-filter` option.
Accio normally searches the working tree and refreshes edited and nonignored untracked files automatically.
Use `--format json` where supported for structured output and `<command> --help` for the pinned command's options.
Read availability, quality, completeness, truncation, and coverage notes. Project coverage can be partial while
libraries are building or not loaded; a complete result list does not imply full index coverage. Out-of-scope or
corrected-scope suggestions appear separately as alternatives and are not matches in the requested scope.
Multiple targets have independent numbered text answers. JSON shapes follow the command: name commands and files
return arrays; locate returns one object for one query and an array for several. Plain output stays header-free.

Read and edit known locations using native file tools. Builds, tests, Git operations, and filtering command output
continue normally. Use external search when the needed capability is disabled, unsupported, or reports an error;
state the reason briefly. Empty results alone are not a tool failure: check scope, spelling, and the chosen tool.
Semantic search always goes through Air Context (`{{JBCONTEXT}} search`, or the existing `code_search` MCP tool when
registered). Do not invoke Accio directly or use its semantic/context search.

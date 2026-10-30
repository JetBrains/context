#!/usr/bin/env bash
# Compatibility reminder for legacy installations. Never denies a tool call.
set -euo pipefail
cat >/dev/null
command -v jq >/dev/null || exit 0
jq -n --arg message 'Use jbcontext for repository searches, including exact follow-ups: behavior -> search/code_search; literal or identifier -> text-search/text_search; pattern -> regex-search/regex_search; declaration -> symbol-search/symbol_search; filename -> file-search/file_search. Read/edit known locations natively. Precise tools search current edits. External search fallback needs a brief reason after an error or unsupported capability; empty results alone are not failure.' '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $message}}'

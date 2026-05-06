#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
SESSION_ID="$(jq -r '.session_id // empty' <<<"$INPUT")"

if [[ -z "$SESSION_ID" ]]; then
  exit 0
fi

STATE_FILE="/tmp/claude-embark-hook-${SESSION_ID}.json"
umask 077

jq -n '{
  bootstrap_done: false,
  read_after_bootstrap: false,
  narrowed_retry_used: false,
  broad_search_count: 0,
  narrow_search_count: 0
}' > "$STATE_FILE"

CONTEXT="Workflow: if the relevant file or subsystem is unknown, start with one broad EmbArk bootstrap search. Then read at least one returned file and inspect nearby files in that same directory or subsystem with local tools. If that still does not identify the needed adjacent area, do a narrowed semantic retry: on CLI use \`embark search -p <path> ...\`, and on MCP set \`pathFilter\`."

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'

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
  narrowed_retry_used: false
}' > "$STATE_FILE"

CONTEXT="Workflow: if the relevant file or subsystem is still unclear, use semantic search before broad local discovery. After a semantic result, read at least one returned file before expanding locally with nearby files in that same directory or subsystem. If another semantic search is still needed, narrow it: on CLI use \`embark search -p <path> ...\`, and on MCP set \`pathFilter\`."

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'

#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
SESSION_ID="$(jq -r '.session_id // empty' <<<"$INPUT")"
TOOL_NAME="$(jq -r '.tool_name // empty' <<<"$INPUT")"

if [[ -z "$SESSION_ID" || -z "$TOOL_NAME" ]]; then
  exit 0
fi

STATE_FILE="/tmp/claude-embark-hook-${SESSION_ID}.json"
umask 077

init_state() {
  jq -n '{
    bootstrap_done: false,
    read_after_bootstrap: false,
    narrowed_retry_used: false
  }' > "$STATE_FILE"
}

read_state() {
  local field="$1"
  jq -r ".$field" "$STATE_FILE"
}

deny() {
  local reason="$1"
  jq -n --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

if [[ ! -f "$STATE_FILE" ]]; then
  init_state
fi

BOOTSTRAP_DONE="$(read_state bootstrap_done)"
READ_AFTER_BOOTSTRAP="$(read_state read_after_bootstrap)"
NARROWED_RETRY_USED="$(read_state narrowed_retry_used)"

case "$TOOL_NAME" in
  Bash)
    COMMAND="$(jq -r '.tool_input.command // empty' <<<"$INPUT")"

    if [[ "$COMMAND" == *"embark search"* ]]; then
      if [[ "$COMMAND" == *" -p "* ]]; then
        if [[ "$BOOTSTRAP_DONE" != "true" ]]; then
          exit 0
        fi

        if [[ "$READ_AFTER_BOOTSTRAP" != "true" ]]; then
          deny "Read at least one returned file from the bootstrap search before a semantic retry. Inspect nearby code locally first, then retry with \`embark search -p <path> ...\` if still needed."
        fi

        if [[ "$NARROWED_RETRY_USED" == "true" ]]; then
          deny "The narrowed semantic retry has already been used. Continue from the files and directories you have already identified instead of issuing another EmbArk search."
        fi
        exit 0
      fi

      if [[ "$BOOTSTRAP_DONE" == "true" ]]; then
        deny "Do not issue a second broad EmbArk search. Read a returned file first, inspect nearby code locally, and if a retry is still needed use \`embark search -p <path> ...\`."
      fi
      exit 0
    fi

    if [[ "$COMMAND" =~ (^|[[:space:]])(rg|grep|find)([[:space:]]|$) ]]; then
      if [[ "$BOOTSTRAP_DONE" != "true" ]]; then
        deny "Do not start broad local discovery before semantic bootstrap. Use one broad EmbArk search first when the relevant area is still unknown."
      fi

      if [[ "$READ_AFTER_BOOTSTRAP" != "true" ]]; then
        deny "Read at least one returned file from the bootstrap search before switching to local search tools."
      fi
    fi

    if [[ "$BOOTSTRAP_DONE" != "true" ]]; then
      if [[ "$COMMAND" =~ (^|[[:space:]])git[[:space:]]+(log|show|blame)([[:space:]]|$) ]]; then
        deny "Do not use git history for initial discovery. Start with semantic bootstrap, then inspect nearby code locally."
      fi
    fi
    ;;
  Grep|Glob)
    if [[ "$BOOTSTRAP_DONE" != "true" ]]; then
      deny "Do not start broad local discovery before semantic bootstrap. Use one broad EmbArk search first when the relevant area is still unknown."
    fi

    if [[ "$READ_AFTER_BOOTSTRAP" != "true" ]]; then
      deny "Read at least one returned file from the bootstrap search before switching to local search tools."
    fi
    ;;
esac

exit 0

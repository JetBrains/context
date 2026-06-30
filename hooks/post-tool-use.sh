#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
SESSION_ID="$(jq -r '.session_id // empty' <<<"$INPUT")"
TOOL_NAME="$(jq -r '.tool_name // empty' <<<"$INPUT")"

if [[ -z "$SESSION_ID" || -z "$TOOL_NAME" ]]; then
  exit 0
fi

STATE_FILE="/tmp/claude-context-hook-${SESSION_ID}.json"
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

write_state_expr() {
  local expr="$1"
  jq "$expr" "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

if [[ ! -f "$STATE_FILE" ]]; then
  init_state
fi

case "$TOOL_NAME" in
  Bash)
    COMMAND="$(jq -r '.tool_input.command // empty' <<<"$INPUT")"
    if [[ "$COMMAND" == *"jbcontext search"* ]]; then
      if [[ "$COMMAND" == *" -p "* ]]; then
        BOOTSTRAP_DONE="$(read_state bootstrap_done)"
        NARROWED_RETRY_USED="$(read_state narrowed_retry_used)"

        if [[ "$BOOTSTRAP_DONE" != "true" ]]; then
          write_state_expr '.bootstrap_done = true'
        elif [[ "$NARROWED_RETRY_USED" != "true" ]]; then
          write_state_expr '.narrowed_retry_used = true'
        fi
      else
        write_state_expr '.bootstrap_done = true'
      fi
    fi
    ;;
  Read)
    if [[ "$(read_state bootstrap_done)" == "true" && "$(read_state read_after_bootstrap)" != "true" ]]; then
      write_state_expr '.read_after_bootstrap = true'
    fi
    ;;
esac

exit 0

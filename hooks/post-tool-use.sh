#!/usr/bin/env bash
set -euo pipefail

exit 0

#INPUT="$(cat)"
#SESSION_ID="$(jq -r '.session_id // empty' <<<"$INPUT")"
#TOOL_NAME="$(jq -r '.tool_name // empty' <<<"$INPUT")"
#
#if [[ -z "$SESSION_ID" || -z "$TOOL_NAME" ]]; then
#  exit 0
#fi
#
#STATE_FILE="/tmp/claude-embark-hook-${SESSION_ID}.json"
#umask 077
#
#init_state() {
#  jq -n '{
#    bootstrap_done: false,
#    read_after_bootstrap: false,
#    narrowed_retry_used: false,
#    broad_search_count: 0,
#    narrow_search_count: 0
#  }' > "$STATE_FILE"
#}
#
#read_state() {
#  local field="$1"
#  jq -r ".$field" "$STATE_FILE"
#}
#
#write_state_expr() {
#  local expr="$1"
#  jq "$expr" "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
#}
#
#if [[ ! -f "$STATE_FILE" ]]; then
#  init_state
#fi
#
#case "$TOOL_NAME" in
#  Bash)
#    COMMAND="$(jq -r '.tool_input.command // empty' <<<"$INPUT")"
#    if [[ "$COMMAND" == *"embark search"* ]]; then
#      if [[ "$COMMAND" == *" -p "* ]]; then
#        BROAD_SEARCH_COUNT="$(read_state broad_search_count)"
#        NARROW_SEARCH_COUNT="$(read_state narrow_search_count)"
#        if [[ "$BROAD_SEARCH_COUNT" -gt 0 || "$NARROW_SEARCH_COUNT" -gt 0 ]]; then
#          write_state_expr '.bootstrap_done = true | .narrowed_retry_used = true | .narrow_search_count += 1'
#        else
#          write_state_expr '.bootstrap_done = true | .narrow_search_count += 1'
#        fi
#      else
#        write_state_expr '.bootstrap_done = true | .broad_search_count += 1'
#      fi
#    fi
#    ;;
#  Read)
#    if [[ "$(read_state bootstrap_done)" == "true" && "$(read_state read_after_bootstrap)" != "true" ]]; then
#      write_state_expr '.read_after_bootstrap = true'
#    fi
#    ;;
#esac
#
#case "$TOOL_NAME" in
#  Bash|Read)
#    jq -n '{
#      hookSpecificOutput: {
#        hookEventName: "PostToolUse",
#        additionalContext: "Continue from the area you have already identified. Prefer local inspection before issuing another semantic search."
#      }
#    }'
#    ;;
#  *)
#    exit 0
#    ;;
#esac

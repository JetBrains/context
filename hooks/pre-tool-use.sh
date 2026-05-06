#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
SESSION_ID="$(jq -r '.session_id // empty' <<<"$INPUT")"
TOOL_NAME="$(jq -r '.tool_name // empty' <<<"$INPUT")"
TRANSCRIPT_PATH="$(jq -r '.transcript_path // empty' <<<"$INPUT")"

if [[ -z "$SESSION_ID" || -z "$TOOL_NAME" ]]; then
  exit 0
fi

STATE_FILE="/tmp/claude-embark-hook-${SESSION_ID}.json"
umask 077

init_state() {
  jq -n '{
    bootstrap_done: false,
    read_after_bootstrap: false,
    narrowed_retry_used: false,
    broad_search_count: 0,
    narrow_search_count: 0
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

sync_state_from_transcript() {
  if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
    return
  fi

  python3 - "$TRANSCRIPT_PATH" > "${STATE_FILE}.tmp" <<'PY'
import json
import sys

transcript_path = sys.argv[1]
events = []
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            events.append(obj)


def is_user_prompt(event):
    if event.get("type") != "user":
        return False
    message = event.get("message")
    if not isinstance(message, dict):
        return False
    return isinstance(message.get("content"), str)


def iter_tool_uses(event):
    if event.get("type") != "assistant":
        return
    message = event.get("message")
    if not isinstance(message, dict):
        return
    for block in message.get("content", []):
        if isinstance(block, dict) and block.get("type") == "tool_use":
            yield block


def iter_tool_results(event):
    if event.get("type") != "user":
        return
    message = event.get("message")
    if not isinstance(message, dict):
        return
    content = message.get("content")
    if not isinstance(content, list):
        return
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_result":
            yield block


last_prompt_idx = -1
for i, event in enumerate(events):
    if is_user_prompt(event):
        last_prompt_idx = i

current_turn = events[last_prompt_idx + 1 :] if last_prompt_idx >= 0 else events

tool_results_by_id = {}

state = {
    "bootstrap_done": False,
    "read_after_bootstrap": False,
    "narrowed_retry_used": False,
    "broad_search_count": 0,
    "narrow_search_count": 0,
}

bootstrap_seen = False

for event in current_turn:
    for block in iter_tool_uses(event):
        name = block.get("name")
        input_obj = block.get("input") or {}

        if name == "Bash":
            command = input_obj.get("command", "")
            if not isinstance(command, str) or "embark search" not in command:
                continue

            bootstrap_seen = True
            state["bootstrap_done"] = True

            if " -p " in command:
                state["narrow_search_count"] += 1
                if state["broad_search_count"] > 0 or state["narrow_search_count"] > 1:
                    state["narrowed_retry_used"] = True
            else:
                state["broad_search_count"] += 1

        elif name == "Read" and bootstrap_seen:
            file_path = input_obj.get("file_path", "")
            if not isinstance(file_path, str) or not file_path:
                continue

            state["read_after_bootstrap"] = True

print(json.dumps(state))
PY
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

if [[ ! -f "$STATE_FILE" ]]; then
  init_state
fi

sync_state_from_transcript

BOOTSTRAP_DONE="$(read_state bootstrap_done)"
READ_AFTER_BOOTSTRAP="$(read_state read_after_bootstrap)"
NARROWED_RETRY_USED="$(read_state narrowed_retry_used)"

case "$TOOL_NAME" in
  Bash)
    COMMAND="$(jq -r '.tool_input.command // empty' <<<"$INPUT")"

    if [[ "$COMMAND" == *"embark search"* ]]; then
      if [[ "$COMMAND" == *" -p "* ]]; then
        if [[ "$BOOTSTRAP_DONE" != "true" ]]; then
          write_state_expr '.bootstrap_done = true | .narrow_search_count += 1'
          exit 0
        fi

        if [[ "$READ_AFTER_BOOTSTRAP" != "true" ]]; then
          deny "Read at least one returned file from the bootstrap search before a semantic retry. Inspect nearby code locally first, then retry with \`embark search -p <path> ...\` if still needed."
        fi

        if [[ "$NARROWED_RETRY_USED" == "true" ]]; then
          deny "The narrowed semantic retry has already been used. Continue from the files and directories you have already identified instead of issuing another EmbArk search."
        fi

        write_state_expr '.narrowed_retry_used = true | .narrow_search_count += 1'
        exit 0
      fi

      if [[ "$BOOTSTRAP_DONE" == "true" ]]; then
        deny "Do not issue a second broad EmbArk search. Read a returned file first, inspect nearby code locally, and if a retry is still needed use \`embark search -p <path> ...\`."
      fi

      write_state_expr '.bootstrap_done = true | .broad_search_count += 1'
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
      if [[ "$COMMAND" =~ (^|[[:space:]])git[[:space:]]+(log|show|blame)\b ]]; then
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
  Read)
    if [[ "$BOOTSTRAP_DONE" == "true" && "$READ_AFTER_BOOTSTRAP" != "true" ]]; then
      write_state_expr '.read_after_bootstrap = true'
    fi
    ;;
esac

exit 0

#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/paperclip-issue-update.sh [--issue-id ID] [--status STATUS] [--comment TEXT] \
    [--assignee-agent-id ID] [--project-id ID] [--goal-id ID] [--parent-id ID] \
    [--blocked-by-issue-id ID ...] [--blocked-by-issue-ids ID1,ID2,...] [--dry-run]

Reads a multiline markdown comment from stdin when stdin is piped. This preserves
newlines when building the JSON payload for PATCH /api/issues/{issueId}.

Examples:
  scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status in_progress <<'MD'
  Investigating formatting

  - Pulled the raw comment body
  - Comparing it with the run transcript
  MD

  # Blocked with explicit dependencies (repeatable):
  scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status blocked \
    --blocked-by-issue-id "AFI-123" --blocked-by-issue-id "AFI-124" <<'MD'
  Blocked on dependencies.
  MD

  # Blocked with comma-separated dependencies:
  scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status blocked \
    --blocked-by-issue-ids "AFI-123,AFI-124" <<'MD'
  Blocked on dependencies.
  MD

  scripts/paperclip-issue-update.sh --issue-id "$PAPERCLIP_TASK_ID" --status done --dry-run <<'MD'
  Done

  - Fixed the issue update helper
  MD
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

issue_id="${PAPERCLIP_TASK_ID:-}"
status=""
status_set=0
comment_arg=""
assignee_agent_id=""
project_id=""
goal_id=""
parent_id=""
blocked_by_issue_ids=()
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-id)
      issue_id="${2:-}"
      shift 2
      ;;
    --status)
      status="${2:-}"
      status_set=1
      shift 2
      ;;
    --comment)
      comment_arg="${2:-}"
      shift 2
      ;;
    --assignee-agent-id)
      assignee_agent_id="${2:-}"
      shift 2
      ;;
    --project-id)
      project_id="${2:-}"
      shift 2
      ;;
    --goal-id)
      goal_id="${2:-}"
      shift 2
      ;;
    --parent-id)
      parent_id="${2:-}"
      shift 2
      ;;
    --blocked-by-issue-id)
      blocked_by_issue_ids+=("${2:-}")
      shift 2
      ;;
    --blocked-by-issue-ids)
      raw_ids="${2:-}"
      shift 2
      if [[ -z "$raw_ids" ]]; then
        printf 'Empty value passed to --blocked-by-issue-ids.\n' >&2
        exit 1
      fi
      IFS=',' read -r -a parsed_ids <<< "$raw_ids"
      for id in "${parsed_ids[@]}"; do
        # Trim whitespace around each token.
        id="${id#"${id%%[![:space:]]*}"}"
        id="${id%"${id##*[![:space:]]}"}"
        if [[ -z "$id" ]]; then
          continue
        fi
        blocked_by_issue_ids+=("$id")
      done
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$issue_id" ]]; then
  printf 'Missing issue id. Pass --issue-id or set PAPERCLIP_TASK_ID.\n' >&2
  exit 1
fi

if ((${#blocked_by_issue_ids[@]} > 0)); then
  for value in "${blocked_by_issue_ids[@]}"; do
    if [[ -z "$value" ]]; then
      printf 'Empty value passed to --blocked-by-issue-id.\n' >&2
      exit 1
    fi
  done
fi

comment=""
if [[ -n "$comment_arg" ]]; then
  comment="$comment_arg"
elif [[ ! -t 0 ]]; then
  comment="$(cat)"
fi

require_command jq

# Best-practice guardrail: assigning work implies "ready". If the issue is still
# backlog and the caller didn't explicitly set a status, auto-promote to todo so
# the assignee actually receives a wakeup. (Backlog is for parked/unscheduled work.)
if [[ "$status_set" == "0" && -n "$assignee_agent_id" && -n "${PAPERCLIP_API_URL:-}" ]]; then
  auth_curl_args=()
  if [[ -n "${PAPERCLIP_API_KEY:-}" ]]; then
    auth_curl_args+=("-H" "Authorization: Bearer $PAPERCLIP_API_KEY")
  fi
  current_status="$(
    curl -sf "${PAPERCLIP_API_URL}/api/issues/${issue_id}" \
      ${auth_curl_args[@]+"${auth_curl_args[@]}"} \
      | jq -r '.status // empty' 2>/dev/null || true
  )"
  if [[ "$current_status" == "backlog" ]]; then
    status="todo"
  fi
fi

blocked_by_issue_ids_json="$(
  if ((${#blocked_by_issue_ids[@]} > 0)); then
    printf '%s\n' "${blocked_by_issue_ids[@]}" | jq -R -s 'split("\n") | map(select(length > 0))'
  else
    printf 'null'
  fi
)"

payload="$(
  jq -nc \
    --arg status "$status" \
    --arg comment "$comment" \
    --arg assigneeAgentId "$assignee_agent_id" \
    --arg projectId "$project_id" \
    --arg goalId "$goal_id" \
    --arg parentId "$parent_id" \
    --argjson blockedByIssueIds "$blocked_by_issue_ids_json" \
    '
      (if $status == "" then {} else {status: $status} end) +
      (if $comment == "" then {} else {comment: $comment} end)
      +
      (if $assigneeAgentId == "" then {} else {assigneeAgentId: $assigneeAgentId} end)
      +
      (if $projectId == "" then {} else {projectId: $projectId} end)
      +
      (if $goalId == "" then {} else {goalId: $goalId} end)
      +
      (if $parentId == "" then {} else {parentId: $parentId} end)
      +
      (if $blockedByIssueIds == null then {} else {blockedByIssueIds: $blockedByIssueIds} end)
    '
)"

if [[ "$dry_run" == "1" ]]; then
  printf '%s\n' "$payload"
  exit 0
fi

if [[ -z "${PAPERCLIP_API_URL:-}" ]]; then
  printf 'Missing PAPERCLIP_API_URL.\n' >&2
  exit 1
fi

if [[ -n "${PAPERCLIP_API_KEY:-}" ]]; then
  if [[ -n "${PAPERCLIP_RUN_ID:-}" ]]; then
    curl -sS -X PATCH \
      "$PAPERCLIP_API_URL/api/issues/$issue_id" \
      -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
      -H 'Content-Type: application/json' \
      --data-binary "$payload"
  else
    curl -sS -X PATCH \
      "$PAPERCLIP_API_URL/api/issues/$issue_id" \
      -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
      -H 'Content-Type: application/json' \
      --data-binary "$payload"
  fi
else
  if [[ -n "${PAPERCLIP_RUN_ID:-}" ]]; then
    curl -sS -X PATCH \
      "$PAPERCLIP_API_URL/api/issues/$issue_id" \
      -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
      -H 'Content-Type: application/json' \
      --data-binary "$payload"
  else
    curl -sS -X PATCH \
      "$PAPERCLIP_API_URL/api/issues/$issue_id" \
      -H 'Content-Type: application/json' \
      --data-binary "$payload"
  fi
fi

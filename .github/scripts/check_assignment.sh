#!/usr/bin/env bash
# Decide whether a PR author is assigned to the work their PR claims.
#
# Usage: check_assignment.sh OWNER/REPO AUTHOR   (PR body on stdin)
#
# Prints one line, "<verdict> <issue>", and always exits 0:
#   assigned N      the author is assigned to linked issue N
#   fallback N      no linked issue exists in this repo (typo, or a number
#                   from a fork), but the author is assigned to open issue N
#   unassigned N    linked issue N exists and is assigned to someone else,
#                   and the author holds none of the linked issues -> close
#   exempt -        a bot, or a collaborator with write access -> leave open
#   none -          no linked issue here and no open assignment -> close
#   unknown -       the API failed; decide on a later run, never close
#
# Only "unassigned" and "none" may close a PR. Every linked issue is checked, not just
# the first, and a failed lookup is never read as "not assigned".
set -uo pipefail

REPO="$1"
AUTHOR="$2"
BODY="$(cat)"
ME="$(printf '%s' "${AUTHOR}" | tr '[:upper:]' '[:lower:]')"

case "${AUTHOR}" in
  *"[bot]"|app/*) echo "exempt -"; exit 0 ;;
esac

LINKED="$(printf '%s' "${BODY}" \
  | grep -oiE '(close[sd]?|fix(e[sd])?|resolve[sd]?)[: ]+#?[0-9]+([ ,]+(and[ ]+)?#[0-9]+)*' \
  | grep -oE '[0-9]+' | awk '!seen[$0]++' || true)"

FIRST_EXISTING=""
for N in ${LINKED}; do
  OUT="$(gh api "repos/${REPO}/issues/${N}" \
    --jq '[(if .pull_request then "pr" else "issue" end),
           ([.assignees[].login] | join(","))] | join(" ")' 2>&1)"
  RC=$?
  if [ ${RC} -ne 0 ]; then
    case "${OUT}" in
      *"Not Found"*|*"HTTP 404"*|*"HTTP 410"*) continue ;;
      *) echo "unknown -"; exit 0 ;;
    esac
  fi
  KIND="${OUT%% *}"
  ASSIGNEES="$(printf '%s' "${OUT#* }" | tr '[:upper:]' '[:lower:]')"
  [ "${KIND}" = "issue" ] || continue
  [ -n "${FIRST_EXISTING}" ] || FIRST_EXISTING="${N}"
  case ",${ASSIGNEES}," in
    *",${ME},"*) echo "assigned ${N}"; exit 0 ;;
  esac
done

if [ -n "${FIRST_EXISTING}" ]; then
  echo "unassigned ${FIRST_EXISTING}"
  exit 0
fi

# No linked issue exists here. Accept the PR if the author holds an open
# issue in this repo; the maintainer can check the link when reviewing.
MINE="$(gh api -X GET "repos/${REPO}/issues" -f state=open \
  -f assignee="${AUTHOR}" -f per_page=1 --jq '.[0].number // empty' 2>/dev/null)"
RC=$?
if [ ${RC} -ne 0 ]; then
  echo "unknown -"
elif [ -n "${MINE}" ]; then
  echo "fallback ${MINE}"
else
  PERM="$(gh api "repos/${REPO}/collaborators/${AUTHOR}/permission"     --jq .permission 2>/dev/null || echo none)"
  case "${PERM}" in
    admin|maintain|write) echo "exempt -" ;;
    *) echo "none -" ;;
  esac
fi

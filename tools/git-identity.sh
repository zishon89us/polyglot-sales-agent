#!/bin/sh
# Sets, or checks, the git identity that the AI agent's commits carry.
#
# The maintainer is the author of record of every commit the agent makes: the
# maintainer directs the work and reviews and merges it. The agent is named in
# the commit's Co-Authored-By trailer (AGENTS.md section 2). The address is
# the maintainer's GitHub no-reply address, so commits link to that account
# without publishing a personal email address.
#
#   tools/git-identity.sh set     configure this clone. For the maintainer and
#                                 the agent only (`make identity`). It refuses
#                                 to replace a different identity already set
#                                 in the clone.
#   tools/git-identity.sh check   fail if a commit on this branch, not on
#                                 origin/main, that names the agent as
#                                 co-author has another author. Commits by
#                                 other contributors are not touched.
set -u
NAME="Zeeshan Hassan Memon"
EMAIL="1587042+zishon89us@users.noreply.github.com"
AGENT_TRAILER="Co-Authored-By: Claude"

case "${1:-}" in
  set)
    current="$(git config --local user.email 2>/dev/null || true)"
    if [ -n "$current" ] && [ "$current" != "$EMAIL" ] && [ "${current#*@}" != "anthropic.com" ]; then
      echo "git identity: this clone already has another identity set; not changing it." >&2
      echo "This command is for the maintainer and the AI agent only." >&2
      exit 1
    fi
    git config --local user.name "$NAME" || exit 1
    git config --local user.email "$EMAIL" || exit 1
    echo "git identity: commits in this clone are authored as $NAME"
    ;;
  check)
    if ! git rev-parse --verify --quiet origin/main >/dev/null; then
      echo "git identity: cannot find origin/main, so the check cannot run" >&2
      exit 1
    fi
    commits="$(git rev-list origin/main..HEAD)" || exit 1
    wrong=""
    for sha in $commits; do
      body="$(git log -1 --format=%B "$sha")" || exit 1
      case "$body" in
        *"$AGENT_TRAILER"*) ;;
        *) continue ;;
      esac
      author="$(git log -1 --format='%an <%ae>' "$sha")" || exit 1
      if [ "$author" != "$NAME <$EMAIL>" ]; then
        wrong="$wrong$(git log -1 --format=%h "$sha") $author
"
      fi
    done
    if [ -n "$wrong" ]; then
      echo "git identity: these agent commits are not authored as $NAME <$EMAIL>:"
      printf '%s' "$wrong"
      echo "Run 'make identity', then re-author them before pushing."
      exit 1
    fi
    echo "git identity: ok"
    ;;
  *)
    echo "usage: $0 set|check" >&2
    exit 2
    ;;
esac

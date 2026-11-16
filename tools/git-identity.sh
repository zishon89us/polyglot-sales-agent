#!/bin/sh
# Sets, or checks, the git identity that commits in this repository carry.
#
# The maintainer is the author of record of every commit: the maintainer
# directs the work and reviews and merges it. The AI agent that wrote a change is named in the
# commit's Co-Authored-By trailer (AGENTS.md section 2). The address is the
# maintainer's GitHub no-reply address, so commits link to that account
# without publishing a personal email address.
#
#   tools/git-identity.sh set     configure this clone (run by `make setup`)
#   tools/git-identity.sh check   fail if a commit on this branch that is not
#                                 on origin/main has another author
set -u
NAME="Zeeshan Hassan Memon"
EMAIL="1587042+zishon89us@users.noreply.github.com"

case "${1:-}" in
  set)
    git config user.name "$NAME" || exit 1
    git config user.email "$EMAIL" || exit 1
    echo "git identity: commits in this clone are authored as $NAME"
    ;;
  check)
    wrong="$(git log --format='%h %an <%ae>' origin/main..HEAD | grep -v " $NAME <$EMAIL>\$")"
    if [ -n "$wrong" ]; then
      echo "git identity: these commits are not authored as $NAME <$EMAIL>:"
      printf '%s\n' "$wrong"
      echo "Run 'make setup', then re-author them before pushing."
      exit 1
    fi
    echo "git identity: ok"
    ;;
  *)
    echo "usage: $0 set|check" >&2
    exit 2
    ;;
esac

#!/bin/sh
# Prepares a development database: the three roles, the migrations, the
# isolation check, and a demo tenant with one receiving number, made with
# the operator's own commands. Safe to run again: it makes the tenant only
# if there is none, and connects the number only if it is not connected.
# `docker-compose.yml` runs it before the product starts; locally, run it
# with the settings of `.env` in the environment.
#
# For development only: it makes a tenant nobody asked for. It refuses to
# run unless PSA_ENV says development.
set -eu

if [ "${PSA_ENV:-}" != "development" ]; then
  echo "dev-setup: PSA_ENV is not development; this script is for development only" >&2
  exit 1
fi

node packages/db/src/cli.ts bootstrap
node packages/db/src/cli.ts up
node packages/db/src/cli.ts check

ops() {
  node apps/ops/src/main.ts "$@" --as dev-setup
}

# The first tenant there is, or a new one.
tenant=$(ops tenant list | sed -n '2s/ .*//p')
if [ -z "$tenant" ]; then
  tenant=$(ops tenant create --name "Demo Clinic" --pack booking \
    --time-zone Asia/Karachi --language en | sed -n 's/^tenant created: //p')
  if [ -z "$tenant" ]; then
    echo "dev-setup: the demo tenant could not be made" >&2
    exit 1
  fi
  echo "dev-setup: made the demo tenant $tenant"
fi

# The mock's page sends to this number by default. If it is connected
# already (the database's code 23505), that is what was wanted.
number="${PSA_DEV_NUMBER_ID:-100000000000002}"
if result=$(ops channel connect --tenant "$tenant" --channel whatsapp --number-id "$number" 2>&1); then
  echo "dev-setup: connected the number $number to the tenant $tenant"
elif echo "$result" | grep -q '(23505)'; then
  echo "dev-setup: the number $number is connected already, to this tenant or another"
else
  echo "$result" >&2
  exit 1
fi

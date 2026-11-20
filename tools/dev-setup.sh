#!/bin/sh
# Prepares a development database: the three roles, the migrations, the
# isolation check, and, if there is no tenant yet, one tenant with one
# receiving number, made with the operator's own commands. Safe to run
# again. `docker-compose.yml` runs it before the product starts; locally,
# run it with the settings of `.env` in the environment.
#
# For development only. It makes a tenant nobody asked for.
set -eu

node packages/db/src/cli.ts bootstrap
node packages/db/src/cli.ts up
node packages/db/src/cli.ts check

ops() {
  node apps/ops/src/main.ts "$@" --as dev-setup
}

if ops tenant list | grep -q '^0 tenants$'; then
  tenant=$(ops tenant create --name "Demo Clinic" --pack booking \
    --time-zone Asia/Karachi --language en | sed -n 's/^tenant created: //p')
  # The mock's page sends to this number by default.
  ops channel connect --tenant "$tenant" --channel whatsapp \
    --number-id "${PSA_DEV_NUMBER_ID:-100000000000002}"
  echo "dev-setup: made the demo tenant $tenant"
else
  echo "dev-setup: a tenant exists already; nothing made"
fi

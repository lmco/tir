#!/usr/bin/env bash
# Creates or updates Secret tir-env in namespace tir from a TIR .env file.
# Usage: create-env-secret.sh [path-to-.env] [database-host]
# The database host defaults to the in-cluster CNPG read-write service.
set -euo pipefail
envfile=${1:-.env}
dbhost=${2:-dev-db-rw.dev-db.svc.cluster.local}
dbport=${DATABASE_PORT:-5432}

get() { sed -nE "s/^$1=//p" "$envfile" | head -1 | sed -E "s/^'(.*)'$/\1/"; }
for k in SECRET_KEY INIT_PASSWORD DATABASE_USER DATABASE_PASSWORD; do
  [ -n "$(get "$k")" ] || { echo "$k missing in $envfile" >&2; exit 1; }
done

kubectl -n tir create secret generic tir-env \
  --from-literal=SECRET_KEY="$(get SECRET_KEY)" \
  --from-literal=NUXT_SECRET_KEY="$(get SECRET_KEY)" \
  --from-literal=INIT_PASSWORD="$(get INIT_PASSWORD)" \
  --from-literal=DATABASE_HOST="$dbhost" \
  --from-literal=NUXT_DATABASE_HOST="$dbhost" \
  --from-literal=DATABASE_PORT="$dbport" \
  --from-literal=NUXT_DATABASE_PORT="$dbport" \
  --from-literal=DATABASE_USER="$(get DATABASE_USER)" \
  --from-literal=NUXT_DATABASE_USER="$(get DATABASE_USER)" \
  --from-literal=DATABASE_PASSWORD="$(get DATABASE_PASSWORD)" \
  --from-literal=NUXT_DATABASE_PASSWORD="$(get DATABASE_PASSWORD)" \
  --dry-run=client -o yaml | kubectl apply -f -

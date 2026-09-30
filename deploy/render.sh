#!/usr/bin/env bash
# Usage: render.sh <slot> <image> <source-description>
# Substitutes ${VAR} placeholders in k8s/slot.yaml with sed so the runner needs no extra tools.
set -euo pipefail
SLOT=$1 IMAGE=$2 SOURCE=${3:-}
DOMAIN=${DOMAIN:-tirtest.com}
DB_SLOT=${SLOT//-/_}
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

for v in SLOT DB_SLOT IMAGE DOMAIN SOURCE DEPLOYED_AT; do
  case "${!v}" in *'|'*) echo "$v must not contain |" >&2; exit 1 ;; esac
done

sed \
  -e "s|\${SLOT}|$SLOT|g" \
  -e "s|\${DB_SLOT}|$DB_SLOT|g" \
  -e "s|\${IMAGE}|$IMAGE|g" \
  -e "s|\${DOMAIN}|$DOMAIN|g" \
  -e "s|\${SOURCE}|$SOURCE|g" \
  -e "s|\${DEPLOYED_AT}|$DEPLOYED_AT|g" \
  "$(dirname "$0")/k8s/slot.yaml"

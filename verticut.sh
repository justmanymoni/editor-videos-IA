#!/bin/sh
# Verticut: abre la app y la mantiene actualizada (Mac y Linux).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "No se encuentra Node.js. Instálalo desde https://nodejs.org"
  exit 1
fi
exec node scripts/start.mjs "$@"

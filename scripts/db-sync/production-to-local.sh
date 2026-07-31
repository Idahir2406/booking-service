#!/usr/bin/env bash
# Sincroniza PRODUCCIÓN → LOCAL (reemplaza por completo el schema public en local).
#
# Uso:
#   ./scripts/db-sync/production-to-local.sh
#
# Variables:
#   LOCAL  ← .env (POSTGRES_*) o db-sync.env (LOCAL_*)
#   PROD   ← .env (DATABASE_MIGRATIONS_URL) o db-sync.env (PROD_*)
#
# Flags vía env:
#   SKIP_CONFIRM=1  no pide confirmación
#   SKIP_BACKUP=1   no hace backup previo de local

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_commands

print_connection_summary \
  "PROD   ${PROD_HOST}:${PROD_PORT}/${PROD_DB} (user=${PROD_USER})" \
  "LOCAL  ${LOCAL_HOST}:${LOCAL_PORT}/${LOCAL_DB} (user=${LOCAL_USER})"

confirm_destructive \
  "Se eliminará el schema public en LOCAL y se copiarán todos los datos desde PRODUCCIÓN."

maybe_backup \
  "$LOCAL_HOST" "$LOCAL_PORT" "$LOCAL_USER" "$LOCAL_PASSWORD" "$LOCAL_DB" \
  "local_before_prod_sync"

reset_public_schema \
  "$LOCAL_HOST" "$LOCAL_PORT" "$LOCAL_USER" "$LOCAL_PASSWORD" "$LOCAL_DB" \
  "local"

pipe_dump_to_target \
  "$PROD_HOST" "$PROD_PORT" "$PROD_USER" "$PROD_PASSWORD" "$PROD_DB" \
  "$LOCAL_HOST" "$LOCAL_PORT" "$LOCAL_USER" "$LOCAL_PASSWORD" "$LOCAL_DB" \
  "producción" "local"

echo ""
echo "✅ Sincronización PRODUCCIÓN → LOCAL finalizada."

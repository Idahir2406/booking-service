#!/usr/bin/env bash
# Librería compartida para sincronizar Postgres LOCAL ↔ PRODUCCIÓN (booking).
#
# Credenciales solo en scripts/db-sync/db-sync.env (LOCAL_* / PROD_*).
# La app Nest usa DB_* de .env (MariaDB) y no lee estas variables.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"

# ---------------------------------------------------------------------------
# Carga de .env (sin exportar a subshells innecesarias; sin ejecutar código)
# ---------------------------------------------------------------------------
load_env_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Quitar CR (Windows), comentarios y líneas vacías
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *"="* ]] && continue

    key="${line%%=*}"
    value="${line#*=}"
    # Trim espacios alrededor de la key
    key="$(echo "$key" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    # Quitar comillas envolventes del value
    if [[ "$value" =~ ^\".*\"$ ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi

    # No pisar vars ya definidas en el entorno del shell
    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$file"
}

resolve_connection_vars() {
  load_env_file "$PROJECT_ROOT/.env"
  load_env_file "$SCRIPT_DIR/db-sync.env"

  export LOCAL_HOST="${LOCAL_HOST:-localhost}"
  export LOCAL_PORT="${LOCAL_PORT:-5434}"
  export LOCAL_USER="${LOCAL_USER:-postgres}"
  export LOCAL_PASSWORD="${LOCAL_PASSWORD:-}"
  export LOCAL_DB="${LOCAL_DB:-booking}"

  export PROD_HOST="${PROD_HOST:-}"
  export PROD_PORT="${PROD_PORT:-5432}"
  export PROD_USER="${PROD_USER:-}"
  export PROD_PASSWORD="${PROD_PASSWORD:-}"
  export PROD_DB="${PROD_DB:-}"

  # Validaciones mínimas
  local missing=()
  [[ -z "$LOCAL_PASSWORD" ]] && missing+=("LOCAL_PASSWORD")
  [[ -z "$PROD_HOST" ]] && missing+=("PROD_HOST")
  [[ -z "$PROD_USER" ]] && missing+=("PROD_USER")
  [[ -z "$PROD_PASSWORD" ]] && missing+=("PROD_PASSWORD")
  [[ -z "$PROD_DB" ]] && missing+=("PROD_DB")

  if ((${#missing[@]} > 0)); then
    echo "❌ Faltan variables de conexión:" >&2
    printf '   - %s\n' "${missing[@]}" >&2
    echo "" >&2
    echo "Copia scripts/db-sync/db-sync.env.example → db-sync.env y completa LOCAL_* / PROD_*." >&2
    exit 1
  fi
}

require_commands() {
  resolve_connection_vars

  local cmd
  for cmd in pg_dump psql; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "❌ Falta el comando '$cmd'. Instala el cliente de PostgreSQL." >&2
      exit 1
    fi
  done
}

print_connection_summary() {
  local source_label="$1"
  local target_label="$2"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Origen : $source_label"
  echo "  Destino: $target_label"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
}

confirm_destructive() {
  local message="$1"
  if [[ "${SKIP_CONFIRM:-0}" == "1" ]]; then
    return 0
  fi
  echo "⚠️  $message"
  echo ""
  read -r -p "Escribe 'SI' para continuar: " answer
  if [[ "$answer" != "SI" ]]; then
    echo "Cancelado."
    exit 0
  fi
  echo ""
}

run_psql() {
  local host="$1" port="$2" user="$3" password="$4" db="$5"
  shift 5
  PGPASSWORD="$password" psql \
    -h "$host" -p "$port" -U "$user" -d "$db" \
    -v ON_ERROR_STOP=1 \
    "$@"
}

maybe_backup() {
  local host="$1" port="$2" user="$3" password="$4" db="$5" label="$6"

  if [[ "${SKIP_BACKUP:-0}" == "1" ]]; then
    echo "⏭  Backup omitido (SKIP_BACKUP=1)."
    return 0
  fi

  mkdir -p "$BACKUP_DIR"
  local stamp
  stamp="$(date +%Y%m%d_%H%M%S)"
  local outfile="$BACKUP_DIR/${label}_${stamp}.sql.gz"

  echo "💾 Backup → $outfile"
  PGPASSWORD="$password" pg_dump \
    -h "$host" -p "$port" -U "$user" -d "$db" \
    --no-owner --no-acl --clean --if-exists \
    | gzip > "$outfile"
  echo "   OK ($(du -h "$outfile" | awk '{print $1}'))"
  echo ""
}

reset_public_schema() {
  local host="$1" port="$2" user="$3" password="$4" db="$5" label="$6"

  echo "🧹 Reseteando schema public en $label..."
  run_psql "$host" "$port" "$user" "$password" "$db" <<SQL
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO "$user";
GRANT ALL ON SCHEMA public TO public;
SQL
  echo "   Schema public recreado."
  echo ""
}

pipe_dump_to_target() {
  local src_host="$1" src_port="$2" src_user="$3" src_password="$4" src_db="$5"
  local dst_host="$6" dst_port="$7" dst_user="$8" dst_password="$9" dst_db="${10}"
  local src_label="${11}" dst_label="${12}"

  echo "📦 Dump $src_label → restore $dst_label..."
  PGPASSWORD="$src_password" pg_dump \
    -h "$src_host" -p "$src_port" -U "$src_user" -d "$src_db" \
    --no-owner --no-acl \
    | PGPASSWORD="$dst_password" psql \
      -h "$dst_host" -p "$dst_port" -U "$dst_user" -d "$dst_db" \
      -v ON_ERROR_STOP=1 \
      -q

  echo "   Dump/restore completado."
}

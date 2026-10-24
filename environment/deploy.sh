#!/bin/bash
# environment/deploy.sh
# Wdrożenia oparte na katalogach wydań i symlinku "current", z dziennikiem zdarzeń i backupem bazy.
#
# Użycie (zwykle przez sudo, bo Docker wymaga uprawnień):
#   deploy.sh staging
#   deploy.sh production <wersja>
#   deploy.sh rollback <wersja> [powód]
#   deploy.sh restore <staging|production> <plik_backupu>
#   deploy.sh journal [ile_wpisów]
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DEPLOY_ROOT="${DEPLOY_ROOT:-$PROJECT_DIR/deploy_root}"
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
STORAGE_ROOT="$DEPLOY_ROOT/storage"
BACKUP_ROOT="$DEPLOY_ROOT/backups"
JOURNAL_FILE="$DEPLOY_ROOT/journal.jsonl"

ACTION="${1:-}"
ARG2="${2:-}"
ARG3="${3:-}"

usage() {
  echo "Użycie: $0 {staging|production <wersja>|rollback <wersja> [powód]|restore <środowisko> <plik>|journal [n]}" >&2
  exit 2
}

json_escape() {
  local text="${1//\\/\\\\}"
  text="${text//\"/\\\"}"
  printf '%s' "${text//$'\n'/ }"
}

# Jedna linia JSON na zdarzenie (ten sam format co scripts/lib/journal.js).
write_journal() {
  local result="$1" environment="$2" version="$3" note="$4" commit
  commit="$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  mkdir -p "$DEPLOY_ROOT"
  printf '{"time":"%s","action":"%s","result":"%s","environment":"%s","version":"%s","user":"%s","commit":"%s","note":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$ACTION" "$result" "$environment" \
    "$(json_escape "$version")" "$(json_escape "${SUDO_USER:-${USER:-unknown}}")" "$commit" "$(json_escape "$note")" \
    >>"$JOURNAL_FILE"
}

JOURNAL_ENV=""
JOURNAL_VERSION=""
JOURNAL_NOTE=""
RESULT="failed"
JOURNAL_ON_EXIT=0

finish() {
  if [ "$JOURNAL_ON_EXIT" = 1 ]; then
    write_journal "$RESULT" "$JOURNAL_ENV" "$JOURNAL_VERSION" "$JOURNAL_NOTE"
  fi
}
trap finish EXIT

require_version() {
  if [ -z "$ARG2" ]; then
    echo "[BŁĄD] Podaj wersję wydania, np.: $0 $ACTION v1" >&2
    exit 1
  fi
}

# Backup przed zmianą: przy błędzie przerywamy, zanim cokolwiek zostanie zmienione.
backup_database() {
  local environment="$1"
  echo "[BACKUP] Kopia bazy środowiska $environment..."
  node "$PROJECT_DIR/scripts/backup.js" "$STORAGE_ROOT/$environment" "$BACKUP_ROOT/$environment" "$environment"
}

# Uruchamia tylko serwis wskazanego środowiska, z jego własnym katalogiem danych.
start_containers() {
  local target_dir="$1" environment="$2" version="$3"
  echo "[DEPLOY] Uruchamiam kontener lab-app-$environment z katalogu: $target_dir"
  (
    cd "$target_dir"
    STORAGE_DIR="$STORAGE_ROOT/$environment" APP_VERSION_TAG="$version" NODE_ENV="$environment" \
      docker compose -f environment/docker-compose.yml up -d --build "lab-app-$environment"
  )
}

copy_project() {
  mkdir -p "$1"
  rsync -a --exclude='mini_debian_dev' --exclude='deploy_root' --exclude='node_modules' --exclude='.git' "$PROJECT_DIR/" "$1/"
}

switch_current_link() {
  ln -sfn "$1" "$CURRENT_LINK.tmp"
  mv -T "$CURRENT_LINK.tmp" "$CURRENT_LINK"
}

init_structure() {
  mkdir -p "$RELEASES_DIR" "$STORAGE_ROOT/staging" "$STORAGE_ROOT/production" "$BACKUP_ROOT"
}

case "$ACTION" in
  staging)
    init_structure
    JOURNAL_ON_EXIT=1; JOURNAL_ENV="staging"; JOURNAL_VERSION="staging-latest"
    echo "[DEPLOY] Przygotowuję kod dla środowiska STAGING..."
    copy_project "$DEPLOY_ROOT/staging_release"
    start_containers "$DEPLOY_ROOT/staging_release" staging "staging-latest"
    echo "[INFO] Staging działa pod adresem: http://localhost:8080"
    RESULT="success"
    ;;

  production)
    require_version
    init_structure
    JOURNAL_ON_EXIT=1; JOURNAL_ENV="production"; JOURNAL_VERSION="$ARG2"
    new_release="$RELEASES_DIR/$ARG2"
    if [ -d "$new_release" ]; then
      JOURNAL_NOTE="release directory already exists"
      echo "[BŁĄD] Katalog wydania $ARG2 już istnieje! Użyj nowej wersji (np. v2)." >&2
      exit 1
    fi
    previous="$( [ -L "$CURRENT_LINK" ] && basename "$(readlink "$CURRENT_LINK")" || echo none )"
    JOURNAL_NOTE="previous=$previous"

    backup_database production
    echo "[DEPLOY] Tworzę katalog wydania: $new_release"
    copy_project "$new_release"
    start_containers "$new_release" production "$ARG2"
    switch_current_link "$new_release"
    echo "[INFO] Produkcja zaktualizowana do $ARG2 (poprzednia: $previous)."
    RESULT="success"
    ;;

  rollback)
    require_version
    init_structure
    JOURNAL_ON_EXIT=1; JOURNAL_ENV="production"; JOURNAL_VERSION="$ARG2"
    JOURNAL_NOTE="reason=${ARG3:-not given}; database was NOT rolled back"
    target_release="$RELEASES_DIR/$ARG2"
    if [ ! -d "$target_release" ]; then
      JOURNAL_NOTE="release $ARG2 not found"
      echo "[BŁĄD] Nie znaleziono wydania: $target_release. Nie mam do czego wrócić." >&2
      exit 1
    fi

    # Rollback kodu nie cofa bazy. Kopia stanu sprzed rollbacku pozwala świadomie wrócić do danych.
    backup_database production
    echo "[ROLLBACK] Wracam do wersji $ARG2 (baza danych NIE jest cofana)."
    start_containers "$target_release" production "$ARG2"
    switch_current_link "$target_release"
    echo "[ROLLBACK] Gotowe. Produkcja działa na wersji $ARG2."
    RESULT="success"
    ;;

  restore)
    environment="$ARG2"
    backup_file="$ARG3"
    case "$environment" in staging|production) ;; *) usage ;; esac
    [ -n "$backup_file" ] || usage
    echo "[RESTORE] Zatrzymuję kontener, przywracam bazę, uruchamiam ponownie."
    docker stop "lab_backend_$environment" >/dev/null 2>&1 || true
    status=0
    node "$PROJECT_DIR/scripts/restore.js" "$backup_file" "$STORAGE_ROOT/$environment" "$environment" || status=$?
    docker start "lab_backend_$environment" >/dev/null 2>&1 || true
    exit "$status"
    ;;

  journal)
    node "$PROJECT_DIR/scripts/lib/journal.js" "${ARG2:-20}"
    ;;

  *)
    usage
    ;;
esac

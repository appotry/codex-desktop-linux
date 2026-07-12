#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    cat <<'HELP'
Usage: scripts/rebuild-candidate.sh [--install] [path/to/Codex.dmg]

Runs the shared transactional install flow. The DMG is built and validated in
a sibling candidate directory before either codex-app-next/ or codex-app/ is
changed.

Environment:
  CODEX_NEXT_APP_DIR   Accepted candidate destination (default: ./codex-app-next)
  CODEX_FINAL_APP_DIR  Final app directory for --install (default: ./codex-app)
  REBUILD_REPORT_DIR   Report directory (default: ./dist-next/rebuild)
HELP
}

info() {
    echo "[rebuild] $*" >&2
}

INSTALL_AFTER_BUILD=0
DMG_PATH=""

while [ "$#" -gt 0 ]; do
    case "$1" in
        --install) INSTALL_AFTER_BUILD=1 ;;
        -h|--help) usage; exit 0 ;;
        -*) usage >&2; exit 2 ;;
        *)
            [ -z "$DMG_PATH" ] || { usage >&2; exit 2; }
            DMG_PATH="$(realpath "$1")"
            ;;
    esac
    shift
done

NEXT_APP_DIR="${CODEX_NEXT_APP_DIR:-$REPO_DIR/codex-app-next}"
FINAL_APP_DIR="${CODEX_FINAL_APP_DIR:-$REPO_DIR/codex-app}"
REPORT_DIR="${REBUILD_REPORT_DIR:-$REPO_DIR/dist-next/rebuild}"
TARGET_APP_DIR="$NEXT_APP_DIR"
if [ "$INSTALL_AFTER_BUILD" -eq 1 ]; then
    TARGET_APP_DIR="$FINAL_APP_DIR"
fi

args=()
if [ -n "$DMG_PATH" ]; then
    [ -f "$DMG_PATH" ] || { echo "[rebuild][ERROR] DMG not found: $DMG_PATH" >&2; exit 1; }
    args=("$DMG_PATH")
    info "Using DMG: $DMG_PATH"
else
    info "No explicit DMG given; installer will validate, reuse, or download Codex.dmg"
fi

info "Building and validating transactional candidate"
CODEX_INSTALL_DIR="$TARGET_APP_DIR" \
REBUILD_REPORT_DIR="$REPORT_DIR" \
CODEX_ACCEPTANCE_DECISION_JSON="$REPORT_DIR/upstream-dmg-decision.json" \
    "$REPO_DIR/install.sh" "${args[@]}"

cat <<EOF

[rebuild] Complete
  App:            $TARGET_APP_DIR
  Run:            $TARGET_APP_DIR/start.sh
  Patch report:   $REPORT_DIR/patch-report.json
  Rebuild report: $REPORT_DIR/rebuild-report.json
  Decision:       $REPORT_DIR/upstream-dmg-decision.json

EOF

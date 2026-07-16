#!/usr/bin/env bash
set -eu

runtime_root="${XDG_RUNTIME_DIR:-${CODEX_LINUX_APP_STATE_DIR:?}}"
runtime_dir="$runtime_root/${CODEX_LINUX_APP_ID:-codex-desktop}/app-server-bridge"
socket_path="${CODEX_LINUX_APP_SERVER_BRIDGE_SOCKET:-$runtime_dir/app-server.sock}"
printf 'env CODEX_LINUX_APP_SERVER_BRIDGE_SOCKET=%s\n' "$socket_path"

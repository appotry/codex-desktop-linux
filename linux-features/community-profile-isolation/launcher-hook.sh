#!/usr/bin/env bash
set -Eeuo pipefail

: "${HOME:?HOME is required}"
: "${CODEX_LINUX_APP_DIR:?CODEX_LINUX_APP_DIR is required}"

canonical="$HOME/.config/Codex-Community"
wrapper="$CODEX_LINUX_APP_DIR/.codex-linux/features/community-profile-isolation/codex-cli-wrapper.sh"

if [[ -n "${CODEX_ELECTRON_USER_DATA_PATH:-}" && "$CODEX_ELECTRON_USER_DATA_PATH" != "$canonical" ]]; then
  printf "ChatGPT Community refuses non-canonical CODEX_ELECTRON_USER_DATA_PATH: %s\n" \
    "$CODEX_ELECTRON_USER_DATA_PATH" >&2
  exit 64
fi

for arg in "$@"; do
  case "$arg" in
    --user-data-dir="$canonical") ;;
    --user-data-dir|--user-data-dir=*)
      printf "ChatGPT Community refuses non-canonical --user-data-dir: %s\n" "$arg" >&2
      exit 64
      ;;
  esac
done

if [[ ! -x "$wrapper" ]]; then
  printf "ChatGPT Community CLI isolation wrapper is missing or not executable: %s\n" \
    "$wrapper" >&2
  exit 69
fi

# The signed upstream bootstrap resets Electron userData from this variable
# immediately before the single-instance lock. Keep the env contract and the
# Electron argument pinned to the same Community-owned profile.
printf "env CODEX_ELECTRON_USER_DATA_PATH=%s\n" "$canonical"
printf "env CODEX_CLI_PATH=%s\n" "$wrapper"
printf "electron-arg %s\n" "--user-data-dir=$canonical"

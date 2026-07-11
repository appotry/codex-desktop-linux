#!/usr/bin/env bash
set -Eeuo pipefail

find_cargo() {
    if command -v cargo >/dev/null 2>&1; then
        command -v cargo
        return 0
    fi
    if [ -x "$HOME/.cargo/bin/cargo" ]; then
        printf '%s\n' "$HOME/.cargo/bin/cargo"
        return 0
    fi
    return 1
}

source_binary="${CODEX_GLOBAL_DICTATION_LINUX_SOURCE:-}"
if [ -n "$source_binary" ]; then
    [ -x "$source_binary" ] || {
        echo "Global dictation helper is not executable: $source_binary" >&2
        exit 1
    }
else
    cargo_cmd="$(find_cargo)" || {
        echo "cargo is required to build the global dictation helper" >&2
        exit 1
    }
    (
        cd "$SCRIPT_DIR"
        "$cargo_cmd" build --release \
            --manifest-path global-dictation-linux/Cargo.toml >&2
    )
    source_binary="$SCRIPT_DIR/global-dictation-linux/target/release/codex-global-dictation-linux"
fi

[ -x "$source_binary" ] || {
    echo "Global dictation helper is missing after build: $source_binary" >&2
    exit 1
}

target_dir="$INSTALL_DIR/resources/native"
mkdir -p "$target_dir"
install -m 0755 "$source_binary" "$target_dir/codex-global-dictation-linux"
echo "Global dictation helper staged" >&2

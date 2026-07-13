#!/bin/bash
# Build and stage the native bridge used for freedesktop notification actions.
# Sourced by install.sh. Do not run directly.
# shellcheck shell=bash

find_notification_actions_cargo() {
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

build_linux_notification_actions_bridge() {
    local source_binary="${CODEX_NOTIFICATION_ACTIONS_SOURCE:-}"
    local cargo_cmd=""

    if [ -n "$source_binary" ]; then
        if [ ! -x "$source_binary" ]; then
            warn "Prebuilt Linux notification actions bridge is not executable: $source_binary"
            return 1
        fi
        printf '%s\n' "$source_binary"
        return 0
    fi

    if ! cargo_cmd="$(find_notification_actions_cargo)"; then
        warn "cargo not found; Linux notification action buttons will fall back to View"
        return 1
    fi

    info "Building Linux notification actions bridge..."
    if ! (cd "$SCRIPT_DIR" && "$cargo_cmd" build --release -p codex-notification-actions-linux >&2); then
        warn "Failed to build Linux notification actions bridge; action buttons will fall back to View"
        return 1
    fi

    source_binary="${CARGO_TARGET_DIR:-$SCRIPT_DIR/target}/release/codex-notification-actions-linux"
    case "$source_binary" in
        /*) ;;
        *) source_binary="$SCRIPT_DIR/$source_binary" ;;
    esac
    if [ ! -x "$source_binary" ]; then
        warn "Linux notification actions bridge is missing after build: $source_binary"
        return 1
    fi
    printf '%s\n' "$source_binary"
}

stage_linux_notification_actions_bridge() {
    local source_binary=""
    local target_dir="$INSTALL_DIR/resources/native"
    local target_binary="$target_dir/codex-notification-actions-linux"

    if ! source_binary="$(build_linux_notification_actions_bridge)"; then
        rm -f "$target_binary"
        return 0
    fi

    mkdir -p "$target_dir"
    install -m 0755 "$source_binary" "$target_binary"
    info "Linux notification actions bridge staged"
}

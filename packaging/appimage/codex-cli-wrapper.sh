#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
NODE_BIN="$RESOURCES_DIR/node-runtime/bin/node"
CODEX_ENTRYPOINT="$RESOURCES_DIR/codex-cli/node_modules/@openai/codex/bin/codex.js"

[ -x "$NODE_BIN" ] || {
    echo "Bundled Codex CLI cannot find the managed Node.js runtime: $NODE_BIN" >&2
    exit 127
}
[ -f "$CODEX_ENTRYPOINT" ] || {
    echo "Bundled Codex CLI entrypoint is missing: $CODEX_ENTRYPOINT" >&2
    exit 127
}

exec "$NODE_BIN" "$CODEX_ENTRYPOINT" "$@"

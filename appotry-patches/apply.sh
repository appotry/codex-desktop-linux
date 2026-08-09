#!/bin/bash
# ============================================================================
# Apply appotry custom patches onto the upstream baseline.
#
# Design (方案 B: 上游为基线 + 补丁目录):
#   - The upstream repo is the baseline. We never modify upstream files.
#   - Our custom assets live ONLY in appotry-patches/ (git-tracked here).
#   - This script copies them into the locations the build expects.
#   - After an upstream merge, re-run: bash appotry-patches/apply.sh
#
# Usage:
#   bash appotry-patches/apply.sh          # apply all patches
#   bash appotry-patches/apply.sh --check  # verify applied state, no writes
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Map: patch source -> destination (relative to repo root)
PATCHES=(
  "appotry-patches/workflows/auto-build.yml:.github/workflows/auto-build.yml"
  "appotry-patches/workflows/sync-upstream.yml:.github/workflows/sync-upstream.yml"
  "appotry-patches/scripts/lib/linux-update-bridge-patch.js:scripts/lib/linux-update-bridge-patch.js"
  "appotry-patches/launcher/start.sh.template:launcher/start.sh.template"
  "appotry-patches/docs/LOCAL-BUILD.zh.md:docs/LOCAL-BUILD.zh.md"
)

check_only=0
if [ "${1:-}" = "--check" ]; then
  check_only=1
fi

applied=0
for entry in "${PATCHES[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  src_abs="$REPO_DIR/$src"
  dst_abs="$REPO_DIR/$dst"

  if [ "$check_only" -eq 1 ]; then
    if [ -f "$dst_abs" ] && cmp -s "$src_abs" "$dst_abs"; then
      echo "OK  $dst"
    else
      echo "MISSING  $dst  (run apply.sh)"
    fi
    continue
  fi

  mkdir -p "$(dirname "$dst_abs")"
  cp "$src_abs" "$dst_abs"
  echo "Applied  $src  ->  $dst"
  applied=$((applied + 1))
done

if [ "$check_only" -eq 0 ]; then
  echo "Applied $applied patch(es). Commit the result."
fi

#!/usr/bin/env python3
"""Resolve a Codex CLI path to a canonical executable without running it."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import sys


class LaunchPathError(RuntimeError):
    pass


def resolve_cli_launch_path(raw_path: str) -> Path:
    if os.sep not in raw_path:
        discovered = shutil.which(raw_path)
        if discovered is None:
            raise LaunchPathError(f"Codex CLI command {raw_path!r} was not found in PATH")
        selected_path = Path(discovered)
    else:
        selected_path = Path(raw_path)

    try:
        canonical_cli = selected_path.resolve(strict=True)
        metadata = canonical_cli.stat()
    except OSError as error:
        raise LaunchPathError(f"Failed to resolve Codex CLI path {selected_path}: {error}") from error

    if not stat.S_ISREG(metadata.st_mode) or not os.access(canonical_cli, os.X_OK):
        raise LaunchPathError(f"Selected Codex CLI target {canonical_cli} is not an executable file")
    return canonical_cli


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1]:
        print(f"usage: {Path(sys.argv[0]).name} CLI_PATH", file=sys.stderr)
        return 64
    try:
        print(resolve_cli_launch_path(sys.argv[1]))
    except (OSError, LaunchPathError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

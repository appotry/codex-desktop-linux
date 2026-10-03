# Community Profile Isolation

This optional Linux feature keeps ChatGPT Community runtime state separate from
the official ChatGPT installation while preserving the normal `codex-desktop`
package and installation identity.

## What it does

At Community launch time the feature pins:

- `CODEX_HOME=$HOME/.codex-community`;
- `CODEX_ELECTRON_USER_DATA_PATH=$HOME/.config/Codex-Community`;
- Electron `--user-data-dir=$HOME/.config/Codex-Community`;
- `CODEX_CLI_PATH` to the Community-owned wrapper staged inside
  `/opt/codex-desktop/.codex-linux/`.

The signed upstream bootstrap reasserts Electron `userData` from
`CODEX_ELECTRON_USER_DATA_PATH` immediately before the single-instance lock,
so the command-line argument alone is not sufficient.

The wrapper executes `/opt/codex-desktop/resources/codex`, repairs a runtime
`PATH` that may put another `codex` ahead of Community resources, and pins
that dynamic path through `shell_environment_policy.set.PATH`.

## Compatibility and failure boundaries

This feature conflicts with `shared-app-server-socket`. That feature records
the selected CLI executable as authority identity, while profile isolation uses
a wrapper that execs the bundled CLI. Enabling both is rejected during feature
selection rather than failing attached-CLI verification at runtime.

The feature fails closed when:

- `CODEX_ELECTRON_USER_DATA_PATH` points at another profile;
- a conflicting `--user-data-dir` is supplied;
- the Community CLI wrapper is missing or not executable;
- `CODEX_HOME` resolves outside the Community state directory;
- the bundled Community `codex` executable is missing or not executable.

Existing symlinks for `~/.codex-community` are supported. The wrapper compares
physical paths when the directories exist, matching launcher canonicalization.

The official app, normal shell `codex`, official `codex://` handler, and
package identity are not modified. The feature does not migrate, merge, clear,
or delete either profile.

## Test

Run:

```bash
node --test linux-features/community-profile-isolation/test.js
```

The suite covers feature conflict selection, Electron bootstrap environment
ownership, conflicting profile rejection, runtime PATH repair, symlinked
`CODEX_HOME`, and the real launcher-to-wrapper sequence. Official Linux CI
also runs the suite against the extracted signed bootstrap and performs a
feature-only build from the signed package.

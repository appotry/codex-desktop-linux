# Deferred update builds

This disabled-by-default Linux feature adds a **Build updates automatically**
toggle to Linux Settings.

When the toggle is on, the native updater keeps its standard behavior and
builds a detected upstream DMG in the background. When it is off, background
checks still download and verify the latest DMG, but leave it pending until the
user chooses **Check for updates**.

The updater revalidates the upstream DMG before using a pending download. If a
newer DMG replaces it or the cached file is removed, the same check downloads
the current DMG before continuing. Disabling this feature immediately restores
automatic builds, including for an already deferred candidate.

App-launch `--if-stale` checks treat a deferred candidate as stable. A fresh
check performs no upstream DMG request; after the check interval, an unchanged HEAD
reuses the valid cached DMG without GET. Offline background checks preserve the
pending candidate.

Enable it in the gitignored `linux-features/features.json` file:

```json
{
  "enabled": ["deferred-update-build"]
}
```

The setting patch is optional and fail-soft. Missing or drifted Linux Settings
assets are reported without writing a partial replacement. When the feature is
enabled during an updater rebuild, the normal enabled-feature acceptance gate
rejects drift and preserves the installed app.

Run its focused tests with:

```bash
node --test linux-features/deferred-update-build/test.js
```

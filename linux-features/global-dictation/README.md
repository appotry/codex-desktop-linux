# Global Dictation

This optional feature enables the global dictation controls already present in the desktop app.

X11 uses Electron for shortcut registration and a short-lived modifier-state
watcher while hold-to-talk is active. Wayland uses the XDG GlobalShortcuts
portal so both activation and release come from the compositor. The helper does
not read `/dev/input` or require elevated permissions.

X11 requires `xinput`, `xmodmap`, and `xdotool` at runtime. Wayland requires a
desktop portal backend that implements `org.freedesktop.portal.GlobalShortcuts`
and `org.freedesktop.portal.RemoteDesktop`.

Enable the feature in `linux-features/features.json` before rebuilding:

```json
{
  "enabled": ["global-dictation"]
}
```

The desktop portal may ask for shortcut approval on first use and keyboard
access when the first result is pasted into another application. The helper
reuses that keyboard session until the hotkey registration is stopped. If the
required portal interfaces are unavailable, the feature fails without changing
the macOS or Windows paths.

Wayland shortcuts must contain at least one modifier and one key. Modifier-only
shortcuts cannot be represented by the XDG shortcut format and are rejected
before registration.

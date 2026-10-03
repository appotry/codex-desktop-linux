# Linux Computer Use

Linux Computer Use is an opt-in UI surface backed by a native Rust MCP backend,
`codex-computer-use-linux`. The official Linux package is the baseline, and the
community integration is disabled until the `computer-use-linux` feature is
explicitly enabled. Enabling it stages the Linux backend/plugin and the
feature-owned UI descriptors; none of them are default core patches.

In Settings → Computer use, **Any App**
controls native access independently of browser access. Use that row to install
or enable native access on a fresh profile.

The backend's capabilities are listed below. The in-app API exposes a subset;
see [supported operations](../linux-features/computer-use-linux/README.md#supported-operations)
for its limitations.

It supports:

- app listing and accessibility trees through AT-SPI
- screenshots through GNOME Shell DBus, the Codex GNOME Shell extension, or XDG Desktop Portal
- window listing and focusing on GNOME, KWin/Plasma 5 and 6, Hyprland, Niri,
  COSMIC, i3, and generic X11/EWMH window managers; GNOME extension and X11
  windows can also be moved and resized
- keyboard, text, click, scroll, and drag input through `/dev/uinput`, XDG
  RemoteDesktop portal, `xdotool` on X11, or `ydotool`
- pointer-direction feedback for the built-in V2 pet after successful click,
  scroll, and drag actions

The in-app adapter returns a compact accessibility projection and suppresses an
unchanged compact projection on repeated reads. Use `disableDiffing: true` for a
fresh compact tree, or `compact: false` for complete backend metadata.
`maxNodes`/`maxDepth` bound accessibility traversal; screenshot calls accept
`maxWidth`, `maxHeight`, `maxBytes`, `scale`, `format`, and `quality`. Screenshot
methods already emit the image and should not be emitted a second time.

## Runtime Dependencies

The embedded backend includes the standalone v0.7.6 accessibility setup,
guard, native activation, coordinate-contract, completion-notification, and
accessibility-tree scoping changes. Setup verifies GNOME's saved toolkit-accessibility key even when
runtime AT-SPI is ready, and warns when the saved key cannot be verified.
Other accessibility tools can change the key later; setup does not hold it on.

`get_app_state` returns screenshots as a structured image content block followed
by the JSON report. The JSON `screenshot` value contains dimensions, scale,
format, and byte counts without an inline base64 `data_url`; callers should read
the image block for pixels.

`doctor` reports an XDG portal interface only when the portal exports its
methods: Screenshot needs `Screenshot`, ScreenCast needs `CreateSession`,
`SelectSources`, and `Start`, and InputCapture needs `GetZones`, `Enable`, and
`ConnectToEIS`. `busctl introspect` exits 0 with only a header line for a
missing interface, so exit status alone was a false positive. Readiness reports
`can_capture_screenshots` and a blocker when no screenshot route is detected;
that is detection, not a test capture.

On a native X11 session (never XWayland), screenshots can use one root-window
`GetImage` after GNOME Shell, the Codex GNOME Shell extension, and the portal,
and before `gnome-screenshot`. Pixels are device pixels, the space xdotool input
uses. `doctor` reports it as `platform.x11_display` and the `x11`
screenshot capability; `CODEX_COMPUTER_USE_SCREENSHOT_BACKEND=x11` pins it.
X11/EWMH window origins come from the X server instead of `wmctrl -lG`, which
counts the frame offset twice, so window crops and relative clicks line up
with the client area.

Native X11 connections and replies share a transport deadline; a stalled server
closes the query connection instead of leaving a blocked worker behind. Unix
sockets, literal IP addresses, and `localhost` need no resolver helper. A remote
hostname in `DISPLAY` requires `getent ahosts` for bounded name resolution;
missing or failed resolution reports the X11 route as unavailable.

Element-targeted `click` and `scroll` refuse an `element_index` from another
app's `get_app_state` snapshot and ask for a snapshot of the target. On GNOME
Wayland with a scaled monitor, portal pointer input multiplies the stream point
by the monitor scale, matching mutter's logical layout mode. After targeted
typing, focus feedback reports an incomplete search or an app without an AT-SPI
tree instead of a false "no focused element" warning.

On Wayland, portal `press_key` sends modifiers and named keys as keysyms
resolved by the compositor's active keymap, so Ctrl shortcuts still work when
Caps Lock and Control are swapped. Letters and digits retain physical US
keycodes so shortcuts also work under non-Latin layouts. KDE Plasma retains
physical keycodes for all portal chords.

On X11, `type_text` keeps xdotool's 12 ms per-character delay so XTEST events
stay ordered. `CODEX_COMPUTER_USE_XDOTOOL_TYPE_DELAY_MS` overrides it; the
standalone `COMPUTER_USE_LINUX_XDOTOOL_TYPE_DELAY_MS` name remains an alias.

For an explicit foreground hold-open, run `codex-computer-use-linux guard-accessibility`.
It holds a passive AT-SPI listener and watches/reasserts the saved toolkit setting
for the current user. It is never started by MCP, setup, or observation. Stop
with Ctrl-C or SIGTERM before disabling accessibility. Stop cancels pending
work and releases the listener without disabling other clients or restoring
an old setting. Applications launched during a reset/reassertion interval may
still need restarting.

Scope `get_app_state` with `app_name_or_bundle_identifier` or a window target
(`window_id`, `pid`, `app_id`, `wm_class`, `title`). Without one it returns the
whole desktop AT-SPI tree, reports `tree_scoped=false`, and appends a warning to
`message`, which can exhaust a small context window. `accessibility_tree_truncated=true`
means the node, depth, or read budget stopped traversal with unread elements
left; recover by scoping to a narrower target and raising `max_nodes` or
`max_depth` (hard caps 2000 and 64), not by lowering `max_nodes`.

Plain left element/selector clicks prefer a native AT-SPI `click`, `press`, or
`toggle` action, resolved by name against the live action list. Entry `activate`
and slider `jump` actions are not substituted for pointer clicks. This avoids guessing a
GTK toolkit-to-pointer scale. Explicit coordinates, right clicks, and multiple
clicks retain pointer semantics. Relative coordinates use the clipped screenshot
crop origin in coordinate pixels: divide preview pixels by the returned scale.
Raw GDK surface coordinates and widget-local coordinates are not that origin.
This does not qualify every GNOME X11 EWMH move/resize or mixed-monitor mapping.

Set `CODEX_COMPUTER_USE_NOTIFY_ON_COMPLETE=1` in the MCP server environment
to expose `complete_interaction`, a parameter-free completion notification.
The standalone `COMPUTER_USE_LINUX_NOTIFY_ON_COMPLETE` alias is accepted only
when the Codex variable is unset; an explicit Codex value of `0` disables it.
The tool uses `notify-send` with bounded execution and cleanup. Missing services,
failures, and timeouts skip the cue without failing the task. It does not grant
exclusive desktop ownership and is disabled by default.

The direct MCP server also exposes `run_shell` only when explicitly started
with `CODEX_COMPUTER_USE_ENABLE_SHELL=1`. The standalone
`COMPUTER_USE_LINUX_ENABLE_SHELL=1` alias is used only when the Codex variable
is unset; an explicit Codex value of `0` keeps it disabled. The in-app native
adapter does not expose this tool. It runs `/bin/sh -c` with the current user's
host permissions, without a sandbox or login profiles. The host must approve
the requested command. Ambient credentials and agent sockets are removed from
the environment; additional variables must be supplied explicitly. Execution
defaults to 30 seconds (maximum 120), and returned output is bounded. An audit
digest is written to backend stderr without logging command text.

Install `ydotool` 1.0.3 or newer when you need the fallback input path. The
backend probes the exact absolute move, wheel move, click, delayed key, and
stdin typing command shapes it emits. Earlier or incompatible CLIs are rejected
even if `ydotoold` and its socket are present.

```bash
# Debian / Ubuntu
sudo apt install ydotool
sudo apt install ydotoold   # on Ubuntu releases that split the daemon

# Fedora
sudo dnf install ydotool

# Arch / Manjaro
sudo pacman -S ydotool

# openSUSE
sudo zypper install ydotool
```

The preferred coordinate input path opens `/dev/uinput` directly, but that
device provides pointer input only. Keyboard readiness still requires an XDG
RemoteDesktop portal with keyboard support, `xdotool` on X11, or a compatible
`ydotool` daemon and socket. Portal pointer support also requires the
RemoteDesktop pointer methods, a monitor-capable ScreenCast source, and the
matching advertised device types. ScreenCast v2 and newer must also advertise
the hidden cursor mode that the runtime requests; v1 uses that mode by default.

For `ydotool`, run a daemon and make sure your user can access the socket:

```bash
sudo systemctl enable --now ydotoold
sudo usermod -a -G input "$USER"
```

Then log out and back in.

On X11, install `xdotool` for layout-correct XTEST keyboard/text input and
coordinate clicks, and `wmctrl` plus `xprop` for generic EWMH window listing,
focus, move, and resize. `xdotool` is preferred only with a nonempty `DISPLAY`;
ydotool is used when it cannot be launched. Once xdotool starts, a failure or
timeout is returned and input is never replayed through ydotool. Override
keyboard selection with `COMPUTER_USE_LINUX_FORCE_YDOTOOL_KEYBOARD=1` or
`CODEX_COMPUTER_USE_FORCE_YDOTOOL_KEYBOARD=1`; the corresponding
`*_FORCE_XDOTOOL_KEYBOARD=1` names force XTEST when available. Set
`COMPUTER_USE_LINUX_FORCE_YDOTOOL_POINTER=1` or
`CODEX_COMPUTER_USE_FORCE_YDOTOOL_POINTER=1` to skip native-X11 xdotool clicks
and scroll. Native X11 scroll sends XTEST wheel buttons (4 up, 5 down, 6 left,
7 right) through xdotool, because GTK 3 drops the single wheel event that
follows ydotool's absolute move.

The Wayland RemoteDesktop portal asks for consent on every new process by
default. Set `CODEX_COMPUTER_USE_PERSIST_REMOTE_DESKTOP=1` (standalone alias
`COMPUTER_USE_LINUX_PERSIST_REMOTE_DESKTOP=1`) to request `persist_mode=2` on
`SelectDevices` and reuse the single-use restore token that `Start` returns.
Tokens are stored per device kind, mode `0600`, under
`$XDG_STATE_HOME/codex-computer-use-linux/` or
`~/.local/state/codex-computer-use-linux/`. The first grant still shows the
dialog; later processes restore until the desktop revokes the grant. This needs
RemoteDesktop interface version 2.

Some distros name the unit `ydotool.service` instead of `ydotoold.service`, and
some install `/usr/bin/ydotoold` without a service unit. If the system unit path
is awkward, a user-session service that binds `%t/.ydotool_socket` is also
valid.

Portal packages are needed when your desktop relies on XDG Desktop Portal input
or screenshots:

- KDE Plasma: `xdg-desktop-portal-kde`
- sway/wlroots: `xdg-desktop-portal-wlr`
- Hyprland: `xdg-desktop-portal-hyprland`
- GNOME: usually available by default

`doctor` evaluates pointer and keyboard portal capability independently. A
keyboard-only or pointer-only RemoteDesktop implementation remains useful when
its supported modality is complete, but pointer-only support does not make
keyboard readiness green.

Niri window listing and exact focus use the `niri` command and the active
session's `NIRI_SOCKET`. The Computer Use backend hydrates `NIRI_SOCKET` for GUI
starts, but the socket must still belong to the active Niri session and be
reachable by the desktop user.

The former `x11-ewmh-computer-use` alternative has been retired. The retained
`computer-use-linux` backend owns generic X11/EWMH support on both official
architectures, so the x86-only duplicate no longer belongs in package builds.

## Verify Readiness

After enabling `computer-use-linux`, rebuilding, and reinstalling ChatGPT
Community, ask Codex:

> Check whether Linux Computer Use is ready

You can also run the backend directly:

```bash
./codex-app/resources/plugins/openai-bundled/plugins/unified-computer-use/bin/codex-computer-use-linux doctor
./codex-app/resources/plugins/openai-bundled/plugins/unified-computer-use/bin/codex-computer-use-linux setup
./codex-app/resources/plugins/openai-bundled/plugins/unified-computer-use/bin/codex-computer-use-linux apps
./codex-app/resources/plugins/openai-bundled/plugins/unified-computer-use/bin/codex-computer-use-linux windows
./codex-app/resources/plugins/openai-bundled/plugins/unified-computer-use/bin/codex-computer-use-linux screenshot
```

## Enable The In-App UI

Use the optional-feature wizard and enable `computer-use-linux`:

```bash
make setup-native
make install-native
```

Or edit the gitignored feature configuration directly:

```bash
cp -n linux-features/features.example.json linux-features/features.json
# Add "computer-use-linux" to the enabled array, then:
make install-native
```

`make install-native` builds the required `codex-computer-use-linux` and
`codex-computer-use-cosmic` release helpers once before staging the app.
Updater rebuilds consume those retained prebuilt helpers rather than compiling
Rust for every OpenAI package update. To opt out, remove the feature ID and
rebuild/reinstall.

Nix:

```bash
nix run github:ilysenko/codex-desktop-linux#codex-desktop-computer-use-ui
```

Combined with a Linux feature output:

```bash
nix run github:ilysenko/codex-desktop-linux#codex-desktop-computer-use-ui-remote-mobile-control
```

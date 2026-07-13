# Linux Notification Actions Bridge

`codex-notification-actions-linux` bridges the action-bearing notification
payload already produced by Codex Desktop to the freedesktop
`org.freedesktop.Notifications` interface. Electron exposes notification action
buttons on macOS and Windows but not Linux, even when the active Linux
notification server advertises the standard `actions` capability.

The Electron main-process patch starts one short-lived bridge process per
actionable notification. The bridge accepts one JSON request on stdin, sends JSON events
for show, click, action, and close on stdout, and accepts `close` on stdin. It
does not execute commands or make approval decisions; it returns only the
selected action index to the existing upstream notification callback.

If the session bus or notification server is unavailable, or the server does
not advertise action support, the bridge reports `unavailable` and the app
uses its existing Electron notification instead.

Run its tests from the repository root:

```bash
cargo test -p codex-notification-actions-linux
```

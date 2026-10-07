# Publishing to extensions.gnome.org

## The zip

A release is a pushed `v*` tag: the `Release` workflow runs `make check`, packs
`dist/ai-usage@jackicus.shell-extension.zip` with `./scripts/dev.sh pack` and attaches it to
the GitHub release. That zip is what is uploaded: `LICENSE`, `metadata.json`, `extension.js`,
`prefs.js`, `stylesheet.css`, the schema XML and `lib/` with `lib/providers/`. `make pack`
refuses anything else and drops a compiled schema (the shell compiles it on install).

## metadata.json

`uuid` is fixed once uploaded; `shell-version` is `["50"]`, the only version it has run on;
`settings-schema` is read with `getSettings()` and no argument. `version` is absent
(extensions.gnome.org assigns it), `version-name` is letters, digits, dots and spaces, at
most 16, and `session-modes` is absent: a screen lock disables the extension.

## The review guidelines, checked against this code

Checked on 2026-10-04 against the
[Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) and
[Best Practices](https://gjs.guide/extensions/review-guidelines/best-practices.html), on the
zip `make pack` builds. No blockers.

- **Lifecycle.** `extension.js` builds `AiUsageApp` in `enable()`; module scope holds constants
  and the class registration. `disable()` removes the poll timer and the debounce source,
  cancels a read in flight, disconnects the extension's, the desktop interface's and each
  provider's settings, destroys the button, cancels the login file monitors and aborts the HTTP
  session.
- **Imports.** No `ByteArray`, `Lang` or `Mainloop`; no `Gdk`, `Gtk` or `Adw` in the shell
  process; `make imports` fails when `prefs.js` reaches St, Clutter, Meta, Shell, Soup or a
  shell `resource:///` module.
- **Readable code.** Plain ES modules, unminified; `make check` ends with `./scripts/dev.sh
  size`. No `try` around `destroy()`, `disconnect()` or `GLib.Source.remove()`, no
  `_destroyed` flags, no line over 200 characters, `enable()` and `disable()` side by side.
- **Logging.** Failures only. `Log.debug` prints under the `make link` development entry point.
- **Subprocesses.** One, opt-in: with "Renew an expired login" on, `timeout 60 claude doctor`
  or `codex doctor` once when a login expires, so the tool refreshes its own login. Its output
  is discarded and it exits by itself. The description and README say so. No `run_dispose()`,
  privileged process or clipboard use.
- **Other extensions.** None touched.
- **Network.** For each provider switched on whose CLI is on `PATH`, the login that CLI stored
  is read (a file, or the system keyring for Antigravity and for Codex without its file) and sent to that provider's endpoint:
  `api.anthropic.com`, `cloudcode-pa.googleapis.com`, `chatgpt.com`. Nothing else is sent, no
  token is kept or logged, and no provider file is written. No telemetry.
- **Schemas.** `org.gnome.shell.extensions.ai-usage` at `/org/gnome/shell/extensions/ai-usage/`
  and a relocatable per-provider schema under it, in one XML file;
  `glib-compile-schemas --strict` passes.
- **Legal.** GPL-2.0-or-later, `LICENSE` in the zip, no code from other extensions. No logo or
  icon ships: the button reads "AI" and the tabs carry the names, with the disclaimer in the
  README's "Credits and trademarks".
- **Icons.** `St.Icon` in the shell, no emoji; the preferences use none. The pop-up's bars are
  the shell's `BarLevel`.
- **Private API.** None.

## Uploading

https://extensions.gnome.org/upload/, signed in as the extension's owner, with the zip from
the GitHub release. extensions.gnome.org assigns `version`; the review can take days and its
comments arrive on the extension's page.

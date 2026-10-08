---
name: drive-extension
description: See AI Usage in a throwaway nested GNOME Shell - its button in the top bar, the pop-up's tabs and limits, each provider's states and the preferences, over stand-in logins - and take screenshots of it. Use whenever a change to it must be seen or needs a fresh shell start (extension.js, metadata.json, the schema).
---

# Driving AI Usage in a nested shell

**Read `gnome-ext:nested-shell` first**: the loop (`start`, `do`, `reload`, `stop`), the
steps and its settings are there. This is what is particular to AI Usage.

```bash
./scripts/nested.sh start --stand-in --headless   # ACTIVE when it returns
./scripts/nested.sh click 1368 16                 # open the pop-up (1600x900, one monitor)
./scripts/nested.sh shot $S/pop-up.png 1000 0 600 600
./scripts/nested.sh stop
```

- **Always `--stand-in`, unless the user asks.** A plain `start` runs the real install,
  CLIs and logins, so its providers read the real stored logins and go to the network.
  No `PATH` hides the CLIs: Codex's is in `/usr/bin`, which every start needs.
- **The stand-in world** (`./scripts/nested.d/stand-in.sh`): stand-in `claude`, `codex`
  and `agy` overlaid on `/usr/bin` (`EXT_STAND_IN_BINS`), a scratch `HOME` with stand-in
  logins (and no `CODEX_HOME`: `EXT_STAND_IN_UNSET`), and the staged copy's `lib/http.js`
  replaced by `./scripts/stand-in-http.js`, which answers with invented figures. A
  provider added without an answer there shows as unavailable. `reload` re-stages `src/`
  with it (`nested_stand_in_stage`); the logins are made once per start.
- **Where it is**: the `AI` button at the right of the top bar, about (1368, 16) on the
  default monitor while the input session's recording indicator is in the bar (it shifts
  everything left of it). The pop-up opens below it, tabs at the top by default.
- **States**: `./scripts/nested.sh state PROVIDER STATE` (`claude`, `codex`,
  `antigravity`; `ok`, `signed-out`, `lapsed`, `expired`, `unavailable`,
  `unknown-shape`, `unsupported`). It rewrites or removes the stand-in login, which the
  file monitor reads; the service's failure is in `$HOME/stand-in-failures.json`, which
  `stand-in-http.js` reads.
- **Antigravity's keyring lookup times out on the nested bus after about 25 s** (and logs
  "Keyring lookup for gemini failed"). Under `--stand-in` it then falls back to the
  stand-in token file; under a plain start its tab has no figure, so it is hidden.
- **Its settings**: `./scripts/nested.sh run timeout 5 gsettings --schemadir src/schemas set
  org.gnome.shell.extensions.ai-usage tab-position bottom`. The preferences:
  `./scripts/nested.sh run gnome-extensions prefs ai-usage@jackicus`, then `do "window FILE"`.

## Screenshots

`./scripts/nested.sh shots [--light] [--out DIR]` (`make shots`) takes the published set
into `docs/screenshots/` over `start --stand-in --headless`, then stops (`--light`: top
bar and pop-up only, `*-light.png`; `--out`: the scratchpad, to compare before
committing). It refuses while a nested shell runs, waits `SHOTS_SETTLE` for Antigravity's
keyring timeout, and strips the PNGs with `oxipng` (it warns when that is missing: never
commit them unstripped). A click and its photo are separate `do` calls, so the indicator
is gone from the photo; the click points in `./scripts/nested.d/shots.sh` (`SHOTS_BUTTON`,
`SHOTS_TAB_*`) are measured with it present.

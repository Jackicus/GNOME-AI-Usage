# AI Usage

Shared rules for every extension come from the GNOME-EXTENSIONS kit: `../CLAUDE.md` and `../.claude/rules/` (loaded with this file), and the `gnome-ext:*` skills. `.claude/kit.sh` pulls the kit at session start, or, with no kit beside this repository, fetches it and prints its rules into the session.

A GNOME Shell extension (UUID `ai-usage@jackicus`, `version-name` 0.1, shell 50)
that puts one button in the top bar, with a tab per AI subscription in its pop-up,
showing how much of each rate limit is used and when it resets. Claude and Antigravity are verified
against live accounts; Codex against a live free-plan account (codex-cli
0.160.0, 2026-10-02), its paid-plan windows only from openai/codex's source.

## The rule the whole design hangs off

**This extension never signs anyone in.** It reads the login that a provider's
own command-line tool has already stored, and does nothing else with it:

* The CLI is a hard requirement: a provider whose command is not on `PATH` gets
  no tab at all, rather than a broken one.
* It never refreshes a token. Refreshing Claude's rotates the refresh token and
  could sign the user out of Claude Code. A rejected token (401/403) is
  `Status.EXPIRED`, and its tab asks the user to run the tool once.
* `renew-login` (off by default) is the one way past that: once per expiry it
  runs the tool's own `doctor` (`renewArgs`), which refreshes the login as the
  tool starts, and the credentials watch reads the result. The tool does the
  refreshing, never this extension (`.claude/rules/providers.md`).
* Tokens are read fresh on every poll and never held — the tool rewrites the
  file when it refreshes, so a cached token is a stale one.
* Nothing is ever written to a provider's files; no token is logged, ever.

Each provider's endpoint, its traps, the provider contract and how to add one
are in `.claude/rules/providers.md`.

## Layout

```
src/extension.js        entry point: imports lib/app.js
src/prefs.js            preferences (own process); every row binds to a key
src/stylesheet.css      sizes taken from the shell's own theme; why, beside
                        each rule
src/schemas/            global schema + relocatable per-provider schema
src/lib/app.js          when to read, which providers are live, the one button and
                        where it sits, notifications, the desktop clock-format setting
src/lib/indicator.js    the panel button and its pop-up with a tab per provider;
                        draws the Readings it is handed -- no polling, no settings,
                        no providers
src/lib/usage.js        Limit, Reading, Status, Severity and their wording;
                        no shell imports, so scripts/ can load it
src/lib/settings.js     per-provider settings, capabilities -> switches, and
                        applyOptions(). Imports only Gio and usage.js (prefs)
src/lib/http.js         one libsoup session; getJson/postJson; HttpError(status)
src/lib/log.js          debug (verbose only) / warn / error, "[AI Usage]" prefix
src/lib/providers/registry.js     which providers exist
src/lib/providers/common.js       reading, readJson, humanise, parseTimestamp,
                                  failureReading, unknownShapeReading
src/lib/providers/claude.js       Claude, via Claude Code's stored login
src/lib/providers/antigravity.js  Antigravity, via agy's keyring login
src/lib/providers/codex.js        Codex, via the Codex CLI's auth.json
tests/fixtures/         saved responses (invented values), for `make parsers`
```

What ships is `./scripts/ext.conf`'s `EXT_SHIP` (`lib/` with `lib/providers/`);
`make pack` refuses a zip holding anything else. The kit's
`./scripts/dev-extension.js`, the `make link` entry point, also turns the debug
log on (`lib/log.js`'s `setVerbose`) and names its stage after a checksum of
`lib/`'s files.

## How it behaves

* **One button, `AI` and a percentage**, while a provider is live (`enabled` and
  its CLI on `PATH`); the percentage is the selected tab's figure, picked by
  `primary-limit`, and tints the label by its severity. `show-percent` off leaves
  `AI`. No icon ships: the providers' marks need their owners' written permission
  (README, Credits and trademarks), so the tabs carry the names.
* **The pop-up has a tab per live provider**, at the top or, by `tab-position`,
  the bottom, with refresh at the end of the tab row. A click on a tab writes
  `selected-provider`, which the next redraw reads back: the pop-up opens on that
  tab and the button shows its figure; with none chosen, or its tab hidden, the
  first tab is selected. `hide-unavailable` (default on) drops the tab of a
  provider with no figure, or no reading yet, and the button with the last tab;
  it is still read, so it returns when the tool refreshes its login.
  `_syncProviders()` diffs against the live list, so toggling needs no restart.
* Role `${uuid}`, placed in `panel-box` at `panel-index`. Destroying the indicator
  releases the role, so `_place()` builds a new one to move it.
* **Reading is lazy.** A timer (`poll-seconds`) is the fallback, skipped when
  the session has been idle for 10 minutes. The real triggers are the stored
  login changing on disk (file monitor, 2 s debounce) and opening a pop-up —
  which re-reads only if the figures are over a minute old. The refresh button
  always reads, every provider.
* Notifications fire once per limit per window, keyed by reset time (rounded to
  the minute by `parseTimestamp()`). The app holds that record, so a disable
  (a screen lock too) forgets it and a limit still past the line notifies once
  more after the unlock.
* `reset-format` words resets in pop-ups and notifications alike, through
  `formatReset()` on the desktop's `clock-format`; `auto` matches Claude Code.
  Claude's labels (`5-hour limit`, `Weekly · all models`) and plan format
  (`Max (20x)`) live in `claude.js`. The breakdown line shows only when two or
  more surfaces are above zero (`breakdownFrom()` in `claude.js` drops the
  zeros, `formatBreakdown()` wants two rows).
* How the pop-up is drawn, and its St workarounds: `.claude/rules/popup.md`.

## Settings

Global keys: `primary-limit` (`session` default, `highest`, `weekly`),
`show-percent`, `hide-unavailable`, `renew-login`, `reset-format`,
`selected-provider` (the tab chosen last), `tab-position` (`top` default, `bottom`),
`panel-box`, `panel-index`, `poll-seconds`, `warn-percent`, `critical-percent`,
`notify-percent`.

**Per-provider keys are a relocatable schema** at
`/org/gnome/shell/extensions/ai-usage/providers/<id>/` (no schema change per
provider): `enabled`, `show-per-model`, `show-breakdown`, `show-credits`. The
provider's `capabilities` (`perModel`, `breakdown`, `credits`) decide which
switches the preferences offer (`keysFor()`).

**`applyOptions(reading, options, thresholds)` in `settings.js` is the one
place** switches and thresholds are applied; providers return everything, and
the renderer reads no settings. It returns a view without mutating the Reading,
so any display change is one redraw and no request. Only `enabled` re-reads.

## Private shell API

None.

## Verifying

* `make check` — all that needs no shell, and what CI runs: ESLint, the shared
  `schema` check (`--strict`), then `EXT_CHECKS`, each a `./scripts/dev.d/`
  command:
  * `parsers`: each provider's parser over `tests/fixtures/`, including that
    unknown shapes degrade rather than throw.
  * `imports`: walks everything `prefs.js` reaches, fails on St, Clutter, Meta,
    Shell, Soup or `resource:///org/gnome/shell/`, then loads the shared modules.

  CI adds `libsecret` (`.github/ci-packages`): `antigravity.js` imports
  `gi://Secret`, and the imports and parsers checks load it. It ends with `size`:
  src/ JavaScript against `EXT_BUDGET_LINES` (1800: the size after the simplify
  pass of 2026-10-04, 1756 lines, rounded up to the next hundred).
* `make providers` — the real provider modules under plain `gjs`, printing what
  each tab would show. Tells a data problem from a drawing problem. It reads
  the real stored logins and goes to the network: ask first.

### The nested shell

The kit's `./scripts/nested.sh` (`gnome-ext:nested-shell`). What is this
extension's own:

* **A plain `start` runs your install, your CLIs and your logins**, so its
  providers read the real stored logins and go to the network. To try something
  without that, `start --stand-in`. No `PATH` hides the CLIs: Codex's is in
  `/usr/bin`, which every start needs.
* **`start --stand-in`** is a stand-in world (`./scripts/nested.d/stand-in.sh`):
  stand-in `claude`, `codex` and `agy` overlaid on `/usr/bin` (`EXT_STAND_IN_BINS`), a
  scratch `HOME` with stand-in logins (and no `CODEX_HOME`: `EXT_STAND_IN_UNSET`),
  and the staged copy's `lib/http.js`
  replaced by `./scripts/stand-in-http.js`, which answers with invented figures.
  No real path, login, account or network reaches it; a provider added without
  an answer there shows as unavailable. `reload` re-stages `src/` with
  `stand-in-http.js` (`nested_stand_in_stage`); the logins are made once per start.
* **`./scripts/nested.sh shots [--light] [--out DIR]`** (`make shots`) takes the
  published set into `docs/screenshots/` over `start --stand-in --headless`,
  then stops (`--light`: top bar and pop-up only, `*-light.png`; `--out`: the
  scratchpad, to compare before committing). It refuses while a nested shell
  runs. `--stand-in` starts in GNOME's stock look, so a shot carries none of
  your fonts or icon theme. It ends by stripping the PNGs' text chunks with `oxipng` (it warns when `oxipng` is missing; never
  commit them unstripped).

Input is a RemoteDesktop session whose recording indicator stays in the top
bar until the driver exits, so a click and its photo are separate `do` calls,
and the click coordinates in `./scripts/nested.d/shots.sh`
(`SHOTS_BUTTON`, `SHOTS_TAB_*`) are measured with the indicator present.
Antigravity's keyring lookup times out on the nested bus after about 25 s
(`SHOTS_SETTLE`, and an expected "keyring lookup failed" log line); under
`--stand-in` it then falls back to the stand-in token file, and under a plain
start its tab has no figure, so it is hidden.

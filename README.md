# AI Usage

Shows how much of your AI subscriptions' rate limits you have used, as a button in the
top bar: the current session, the week, and the week for each model, with the time each
one resets.

![The pop-up under the top-bar button reading "AI 12%", with tabs for Claude, Codex and Antigravity and
Claude's limits, each with a bar and its reset time, listed below.](docs/screenshots/pop-up.png)

## What it does

- **One button**, reading "AI" and the current-session figure of the subscription whose tab
  is selected. It turns amber at 80% and red at 95%, and both figures can be changed.
- **A tab per subscription in its pop-up**, at the top or the bottom. Choosing one changes
  the button's figure and stays chosen. Each lists the session, the week and the week for each model,
  with a bar and the time it resets, plus paid extra usage and where the week's usage
  went, when the provider reports them.
- **The provider's own figures**, from the request its command-line tool makes for its
  own usage command, so the top bar and the terminal agree.
- **Fresh when you look**: a reading every five minutes, skipped while the session is
  idle, and again when you open a pop-up whose figures are over a minute old.
- **An optional notification** when a limit crosses a figure you choose, once per limit
  until it resets (or once more after the screen is unlocked).
- **Your choice of figure and place**: the session, the week or whichever is highest, at
  the left, centre or right of the top bar.

![The right of the top bar: the button reading "AI 12%", beside the system icons.](docs/screenshots/top-bar-cropped.png)

## You never sign in here

This extension never asks for a password and never signs you in or out. It reads the
login that your provider's command-line tool has already stored, so that tool has to be
installed and signed in, and a provider whose tool is not installed gets no tab. It
never refreshes a login either: if the stored login has expired, its tab is hidden
until you run the tool once, which refreshes it (or, with "Hide a provider with nothing to
show" off, the tab stays and the pop-up asks you to).
With "Renew an expired login" on, the extension runs `claude doctor` or `codex doctor` once
when a login expires, which makes the tool refresh it itself; it is off by default because
it starts the tool, and Antigravity has no such command.

## Providers

| Provider | Needs | Status |
| --- | --- | --- |
| Claude | Claude Code (`claude`), signed in | Working, verified against a live account |
| Antigravity | the Antigravity CLI (`agy`), signed in | Working, verified against a live account |
| Codex | the Codex CLI (`codex`), signed in with ChatGPT | Working, verified against a live free-plan account (codex-cli 0.160.0, 2026-10-02); the paid plans' windows are read as openai/codex's source describes them |

Each provider is switched on or off in the preferences, and offered only the switches it
can honour: per-model limits, where the usage went, extra usage.

## Requirements

- GNOME Shell 50.
- The command-line tool of each provider you want, signed in, and on the `PATH` that
  GNOME Shell was started with.
- libsecret's introspection data, which GNOME normally has already (Debian and Ubuntu:
  `gir1.2-secret-1`). The Antigravity CLI keeps its login in the system keyring, and the
  Codex CLI can.

## Privacy and network

On every reading, for each provider switched on, the extension reads the stored login and
sends it to that provider's own server, the same request the provider's tool makes:

| Provider | Reads | Sends it to |
| --- | --- | --- |
| Claude | `~/.claude/.credentials.json`, and the plan name from `~/.claude.json` | `api.anthropic.com` |
| Antigravity | the login in the system keyring, or `~/.gemini/antigravity-cli/antigravity-oauth-token` | `cloudcode-pa.googleapis.com` |
| Codex | `auth.json` in `$CODEX_HOME`, or `~/.codex/auth.json`, else its login in the system keyring | `chatgpt.com` |

Nothing else goes anywhere, and the only process it starts is the opt-in `doctor` run. The
extension never writes to these files, never keeps a token between readings and never logs
one. What it stores is its own settings, in dconf. These are the endpoints the tools
themselves use, not published APIs, so a provider may change them; the pop-up then says the
usage could not be read.

## Install

It is not on extensions.gnome.org yet. From source, with `make`, `glib-compile-schemas`
and `gnome-extensions`:

```sh
git clone https://github.com/Jackicus/GNOME-AI-Usage
cd GNOME-AI-Usage
make install
```

Then **log out and back in** (a Wayland session cannot load an extension it has never
seen), and:

```sh
gnome-extensions enable ai-usage@jackicus
```

To update, `git pull && make install`, then log out and back in. To remove it,
`make uninstall`.

## Preferences

`gnome-extensions prefs ai-usage@jackicus` opens them, as does the Extensions app.

| Button | Readings | Providers |
| --- | --- | --- |
| ![The Button page: the figure the button shows, two switches, where the tabs sit and how reset times are worded.](docs/screenshots/preferences-button.png) | ![The Readings page: 300 seconds between readings, and Notify at 0, which turns notifications off.](docs/screenshots/preferences-readings.png) | ![The Providers page: Claude Code found at /usr/bin/claude, the Codex CLI found at /usr/bin/codex, and the Antigravity CLI (agy) found at /usr/bin/agy, each with a switch.](docs/screenshots/preferences-providers.png) |

- **Button**: the figure the button shows, whether the percentage is shown beside
  "AI", whether the tabs sit at the top or the bottom of the pop-up, how reset times are
  worded, which end of the top bar the button sits in and where, and the figures at which
  it turns amber and red.
- **Readings**: seconds between readings (60 to 3600), and the figure at which a limit
  notifies you (0 for never).
- **Providers**: each provider's switch, where its tool was found, and what its tab
  lists.

## Troubleshooting

Follow the shell's log while you reproduce the problem:

```sh
journalctl -f -o cat /usr/bin/gnome-shell | grep -i 'ai usage'
```

and for the preferences window, which is its own process:

```sh
journalctl -f -o cat SYSLOG_IDENTIFIER=org.gnome.Shell.Extensions
```

From a clone, `make status` says whether it is installed and what state the running
shell has it in, `make logs` follows the log, and `make providers` runs the provider code
outside the shell and prints what each tab would show. That last one reads your
stored logins and goes online, just as the extension does.

- **A provider has no tab**: its tool is not on the `PATH` GNOME Shell started with,
  or its switch is off. A tool installed into a directory your terminal adds to `PATH`
  may not be on the session's.
- **A tab has gone, or the button**: with "Hide a provider with nothing to show" on (the
  default), a provider that is signed out, whose stored login has expired or that could not
  be read has no tab, and with none left the button goes too. The tools refresh their logins
  only while they run, so use the tool (`claude`, `agy` or `codex`) and it returns. With the
  option off the tab stays, and the button is amber when no provider has a figure.
- **The button is amber with no figure**: a stored login has expired or is missing.
  Run the tool once (`claude`, `agy` or `codex`), signing in if it asks; a new Claude or
  Codex login is picked up within seconds, and any provider's on the next reading or when you open the pop-up.
- **No button at all after installing**: log out and back in, then
  `gnome-extensions enable ai-usage@jackicus`.

## Development

`make link` installs a link to `src/`, `make reload` loads your edits, `make nested` runs
the extension in a nested GNOME Shell with settings of its own (`make nested-stop` stops
it), `make shots` retakes the screenshots, and `make check` is what CI runs. See
[CONTRIBUTING.md](CONTRIBUTING.md), and [CLAUDE.md](CLAUDE.md) for the design: where the
figures come from, what each file is for, and how to add a provider.

## Licence

GPL-2.0-or-later. See [LICENSE](LICENSE).

## Credits and trademarks

Claude is a trademark of Anthropic, Antigravity of Google, and Codex and OpenAI of
OpenAI. The names are used only to say which service a figure belongs to; this extension
is not affiliated with or endorsed by any of them. No logo or mark of theirs ships: the
button says "AI" and the tabs carry the names.

The plans, figures and paths in the screenshots are invented: they come from stand-in
logins and answers in a nested shell (`./scripts/nested.sh shots`), not from anyone's
account.

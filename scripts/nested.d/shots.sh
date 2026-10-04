#   ./scripts/nested.sh shots [--light] [--out DIR]
#                                     start a stand-in nested shell (headless), open the
#                                     button's pop-up and the preferences, write the
#                                     pictures to docs/screenshots/ (or DIR), and stop
#                                     it; --light does the top bar and the pop-up again
#                                     in a light shell, as *-light.png
#

# Antigravity's keyring lookup times out after about 25 s on the throwaway bus and then falls back to
# the stand-in token file; the top bar is photographed after that.
SHOTS_SETTLE=35

# Click points on a 1600x900 monitor, measured while the driver's recording indicator is in the bar
# (it shifts everything left of it; the pictures are taken by a later run, without it). A stale point
# clicks the bar and photographs the wallpaper. Re-measure with 'start --stand-in --headless' and
# 'do "click 1368 16" "shot FILE 0 0 1600 36"'.
SHOTS_BUTTON="1368 16"
# The preferences window opens centred, so its tabs are at fixed points too.
SHOTS_TAB_BUTTON="677 201"
SHOTS_TAB_READINGS="799 201"
SHOTS_TAB_PROVIDERS="922 201"

cmd_shots() {
    local light=0 out="$REPO_DIR/docs/screenshots" status=0
    while (( $# )); do
        case "$1" in
            --light) light=1 ;;
            --out)   out="${2:-}"; [[ -n "$out" ]] || die "--out takes a directory."; shift ;;
            *)       die "Unknown shots option '$1'. Usage: shots [--light] [--out DIR]" ;;
        esac
        shift
    done
    is_running && die "A nested shell is running: './scripts/nested.sh stop' it first. Shots start one of their own, over stand-in data."
    command -v python3 >/dev/null || die "'python3' not found in PATH; the driver needs it."
    python3 -c 'import gi' 2>/dev/null || die "python3 has no 'gi' (install python-gobject); the driver needs it."
    mkdir -p "$out"
    out="$(cd "$out" && pwd)"

    cmd_start --stand-in --headless || return 1
    shots_take "$light" "$out" || status=1
    shots_errors
    stop_session "" || status=1
    (( status == 0 )) || return 1
    shots_report "$out"
}

# One run of the driver per call: the recording indicator leaves the bar only when the process that
# asked for it exits, so a click and the photograph of what it opened are separate calls.
shots_do() {
    cmd_do "$@" >/dev/null || { warn "The driver could not run: $*"; return 1; }
}

shots_take() {
    local light="$1" out="$2" suffix=""
    (( light )) && suffix="-light"

    # The pictures are named apart so a run in one scheme does not overwrite the other's.
    if (( light )); then
        cmd_run timeout 5 gsettings set org.gnome.desktop.interface color-scheme prefer-light || return 1
    fi

    info "Letting the readings settle (${SHOTS_SETTLE}s)..."
    sleep "$SHOTS_SETTLE"

    info "Photographing the top bar..."
    # Nothing is clicked first, so there is no recording indicator in this picture.
    shots_do "shot $out/top-bar$suffix.png 1100 0 500 36" || return 1
    # The tighter crop the README opens with, taken from the shell so it can be regenerated. Dark only.
    if (( ! light )); then
        shots_do "shot $out/top-bar-cropped.png 1320 0 280 28" || return 1
    fi

    info "Opening the pop-up..."
    shots_do "click $SHOTS_BUTTON" "wait 1.5" || return 1
    # The recording indicator outlives its process by a few seconds: still there at 4, gone by 6.
    shots_do "wait 6" "shot $out/pop-up$suffix.png 1092 0 508 340" || return 1
    shots_do "key Escape" || return 1

    # The preferences are a GTK window with its own colour setting, so there is no second scheme to shoot.
    (( light )) && return 0

    info "Opening the preferences..."
    # The Extensions app is D-Bus activated on the nested bus; 'stop' closes it.
    cmd_run gnome-extensions prefs "$EXT_UUID" >>"$LOG_FILE" 2>&1 &
    sleep 5
    shots_do "click $SHOTS_TAB_BUTTON" "wait 1" || return 1
    shots_do "window $out/preferences-button.png" || return 1
    shots_do "click $SHOTS_TAB_READINGS" "wait 1" || return 1
    shots_do "window $out/preferences-readings.png" || return 1
    shots_do "click $SHOTS_TAB_PROVIDERS" "wait 1" || return 1
    shots_do "window $out/preferences-providers.png" || return 1
}

# What went wrong in the session; Antigravity's keyring timeout is expected and is not one.
shots_errors() {
    local errors
    errors="$(grep -E 'JS ERROR|Extension .* error|\[AI Usage\] (Failed to load|Error during disable)' "$LOG_FILE" 2>/dev/null | head -5 || true)"
    [[ -z "$errors" ]] && return 0
    echo
    printf '\033[1;31m%s\033[0m\n' "Errors"
    sed 's/^/  /' <<< "$errors"
}

# The shell writes a creation time and a timezone into each PNG; a public picture carries pixels only.
shots_report() {
    local out="$1" shot
    if command -v oxipng >/dev/null 2>&1; then
        oxipng --quiet --opt 4 --strip safe "$out"/*.png
    else
        warn "oxipng is not installed: the shots still carry their text chunks. Strip them before committing."
    fi
    echo
    printf '\033[1m%s\033[0m\n' "Screenshots"
    for shot in "$out"/*.png; do
        [[ -e "$shot" ]] && printf '  %s\n' "${shot#"$REPO_DIR"/}"
    done
    return 0
}

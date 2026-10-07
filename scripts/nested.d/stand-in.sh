#   ./scripts/nested.sh state PROVIDER STATE
#                                     under --stand-in, put a provider (claude, codex,
#                                     antigravity) in a state its tab can show: ok,
#                                     signed-out, lapsed (a login past its expiry; not
#                                     claude), expired (the service answers 401),
#                                     unavailable (503), unknown-shape, unsupported
#                                     (codex's API-key login). It re-reads at once
#

# The stand-in world for 'start --stand-in' (and so 'shots'), since the pictures go into a public
# repository. On top of the kit's scratch HOME and stand-in CLIs: stand-in logins, where every token
# is the word "stand-in" (Codex's wrapped as a JWT, whose claims codex.js reads), and
# scripts/stand-in-http.js staged over lib/http.js. A provider with no answer there shows as unavailable.

# nested_stand_in_stage STAGE: every time the extension is staged, reload included.
nested_stand_in_stage() {
    cp "$REPO_DIR/scripts/stand-in-http.js" "$1/lib/http.js"
}

# nested_stand_in HOME STAGE: once per start.
nested_stand_in() {
    local provider
    rm -f "$1/stand-in-failures.json"
    for provider in claude codex antigravity; do
        stand_in_login "$1" "$provider" '+1 day'
    done
}

# stand_in_login HOME PROVIDER EXPIRY: the login its CLI would store, good until EXPIRY ('date -d').
stand_in_login() {
    local home="$1" expiry="$3" claims
    case "$2" in
        claude)
            mkdir -p "$home/.claude"
            cat > "$home/.claude.json" <<'JSON'
{"oauthAccount": {"organizationRateLimitTier": "default_claude_max_5x"}}
JSON
            cat > "$home/.claude/.credentials.json" <<'JSON'
{"claudeAiOauth": {"accessToken": "stand-in", "subscriptionType": "max", "rateLimitTier": "default_claude_max_5x"}}
JSON
            ;;
        antigravity)
            mkdir -p "$home/.gemini/antigravity-cli"
            cat > "$home/.gemini/antigravity-cli/antigravity-oauth-token" <<JSON
{"token": {"access_token": "stand-in", "expiry": "$(date -u -d "$expiry" +%FT%TZ)"}}
JSON
            ;;
        codex)
            mkdir -p "$home/.codex"
            claims="$(printf '{"exp": %s, "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"}}' \
                "$(date -u -d "$expiry" +%s)" | base64 -w0 | tr '+/' '-_' | tr -d '=')"
            cat > "$home/.codex/auth.json" <<JSON
{"auth_mode": "chatgpt", "OPENAI_API_KEY": null, "tokens": {"id_token": "stand-in", "access_token": "stand-in.$claims.stand-in", "refresh_token": "stand-in", "account_id": "00000000-0000-4000-8000-000000000000"}, "last_refresh": "$(date -u +%FT%TZ)"}
JSON
            ;;
    esac
}

stand_in_login_file() {
    case "$2" in
        claude)      echo "$1/.claude/.credentials.json" ;;
        antigravity) echo "$1/.gemini/antigravity-cli/antigravity-oauth-token" ;;
        codex)       echo "$1/.codex/auth.json" ;;
    esac
}

# Every state is reached by writing or removing the login file, which the extension watches.
cmd_state() {
    local provider="${1:-}" state="${2:-}" home="$STAND_IN_HOME" failures file
    [[ "$provider" =~ ^(claude|codex|antigravity)$ ]] \
        || die "Usage: state claude|codex|antigravity ok|signed-out|lapsed|expired|unavailable|unknown-shape|unsupported"
    is_running && stand_in || die "This needs a nested shell started with --stand-in."
    failures="$home/stand-in-failures.json"
    file="$(stand_in_login_file "$home" "$provider")"

    # Every provider's failure but this one's is kept.
    python3 - "$failures" "$provider" "$state" <<'PY'
import json, sys
path, provider, state = sys.argv[1:]
try:
    failures = json.load(open(path))
except (OSError, ValueError):
    failures = {}
failures.pop(provider, None)
if state in ('expired', 'unavailable', 'unknown-shape'):
    failures[provider] = state
json.dump(failures, open(path, 'w'))
PY

    case "$state" in
        ok|expired|unavailable|unknown-shape)
            stand_in_login "$home" "$provider" '+1 day' ;;
        signed-out)
            rm -f "$file" ;;
        lapsed)
            [[ "$provider" != claude ]] || die "Claude's login carries no expiry the extension reads: use 'expired'."
            stand_in_login "$home" "$provider" '-35 min' ;;
        unsupported)
            [[ "$provider" == codex ]] || die "Only Codex has an unsupported login (an API key)."
            echo '{"auth_mode": "apikey", "OPENAI_API_KEY": "stand-in", "tokens": null}' > "$file" ;;
        *)
            die "Unknown state '$state'." ;;
    esac
    ok "$provider: $state. Read again in about 2 s (Antigravity: 30 s, after its keyring lookup times out)."
}

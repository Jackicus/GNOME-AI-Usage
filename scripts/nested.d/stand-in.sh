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
    local home="$1"
    mkdir -p "$home/.claude" "$home/.codex" "$home/.gemini/antigravity-cli"
    cat > "$home/.claude/.credentials.json" <<'EOF'
{"claudeAiOauth": {"accessToken": "stand-in", "subscriptionType": "max", "rateLimitTier": "default_claude_max_5x"}}
EOF
    cat > "$home/.claude.json" <<'EOF'
{"oauthAccount": {"organizationRateLimitTier": "default_claude_max_5x"}}
EOF
    cat > "$home/.gemini/antigravity-cli/antigravity-oauth-token" <<EOF
{"token": {"access_token": "stand-in", "expiry": "$(date -u -d '+1 day' +%FT%TZ)"}}
EOF
    local claims
    claims="$(printf '{"exp": %s, "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"}}' \
        "$(date -u -d '+1 day' +%s)" | base64 -w0 | tr '+/' '-_' | tr -d '=')"
    cat > "$home/.codex/auth.json" <<EOF
{"auth_mode": "chatgpt", "OPENAI_API_KEY": null, "tokens": {"id_token": "stand-in", "access_token": "stand-in.$claims.stand-in", "refresh_token": "stand-in", "account_id": "00000000-0000-4000-8000-000000000000"}, "last_refresh": "$(date -u +%FT%TZ)"}
EOF
}

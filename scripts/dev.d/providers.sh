#   ./scripts/dev.sh providers  print, for each provider, whether its tool is installed, whether a
#                               login is stored, and the figures that come back. Reads the real
#                               stored logins and goes to the network: the user's to run
#

cmd_providers() {
    require gjs
    gjs -m "$REPO_DIR/scripts/providers.js"
}

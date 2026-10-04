#   ./scripts/dev.sh imports    check that nothing in prefs.js's import graph reaches St,
#                               Clutter, Meta, Shell, Soup or resource:// paths
#   ./scripts/dev.sh parsers    run each provider's parser over saved responses, the only
#                               check for a provider whose tool is not installed here
#

cmd_imports() {
    require gjs
    gjs -m "$REPO_DIR/scripts/imports.js"
}

cmd_parsers() {
    require gjs
    gjs -m "$REPO_DIR/scripts/parsers.js"
}

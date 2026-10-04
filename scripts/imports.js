// prefs.js runs without the shell, so nothing in its import graph may reach St, Clutter, Meta, Shell,
// Soup or resource:///org/gnome/shell/ (which is why common.js duck-types e.status instead of
// importing HttpError). Walks the graph, then loads the two modules the preferences share with the
// shell. `./scripts/dev.sh imports`; nothing here ships.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const RED = '\x1b[1;31m';
const GREEN = '\x1b[1;32m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

// The shell's resource path is lowercase `shell`; the preferences' own entry point under
// `Shell/Extensions` is allowed.
const FORBIDDEN = [
    'gi://St', 'gi://Clutter', 'gi://Meta', 'gi://Shell', 'gi://Soup',
    'resource:///org/gnome/shell/',
];

const SRC = GLib.canonicalize_filename(GLib.build_filenamev([
    GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]), '..', 'src']), null);

let failures = 0;

function check(what, got, want) {
    const ok = String(got) === String(want);
    if (!ok)
        failures++;
    const mark = ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`;
    const detail = ok ? `${DIM}${got}${OFF}` : `${RED}got ${got}, wanted ${want}${OFF}`;
    print(`  ${mark} ${what.padEnd(42)} ${detail}`);
}

function read(path) {
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(bytes);
}

// A regex, not a parser: these are plain ES modules in one house style.
function importsOf(source) {
    const specifiers = [];
    const patterns = [
        /\bfrom\s+['"]([^'"]+)['"]/g,
        /\bimport\s+['"]([^'"]+)['"]/g,
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern))
            specifiers.push(match[1]);
    }
    return specifiers;
}

// Every module reachable from `entry` by relative import, as path -> [specifier].
function graphFrom(entry) {
    const seen = new Map();
    const queue = [entry];

    while (queue.length) {
        const path = queue.shift();
        if (seen.has(path))
            continue;

        const specifiers = importsOf(read(path));
        seen.set(path, specifiers);

        for (const specifier of specifiers) {
            if (!specifier.startsWith('.'))
                continue;   // gi:// and resource:// are leaves, not files to walk
            queue.push(GLib.canonicalize_filename(
                GLib.build_filenamev([GLib.path_get_dirname(path), specifier]), null));
        }
    }
    return seen;
}

print(`${'\x1b[1m'}The preferences' import graph${OFF} — src/prefs.js and everything it reaches`);
{
    const graph = graphFrom(GLib.build_filenamev([SRC, 'prefs.js']));

    // A graph that dropped out would make this pass trivially.
    check('modules reached', graph.size > 1, true);

    for (const [path, specifiers] of graph) {
        const bad = specifiers.filter(s => FORBIDDEN.some(f => s.startsWith(f)));
        check(`${path.slice(SRC.length + 1)} stays clear`, bad.join(', ') || 'yes', 'yes');
    }
}

print(`\n${'\x1b[1m'}Loading them${OFF} — outside the shell, as the preferences do`);
{
    const shared = ['lib/providers/registry.js', 'lib/settings.js'];
    const loaded = await Promise.all(shared.map(name =>
        import(`file://${GLib.build_filenamev([SRC, name])}`)
            .then(module => ({module}), e => ({error: e.message}))));

    for (const [i, name] of shared.entries())
        check(`${name} loads`, loaded[i].error ?? 'yes', 'yes');

    const registry = loaded[0].module;
    check('and the registry has providers in it', registry?.PROVIDERS.length > 0, true);
}

print('');
if (failures) {
    print(`${RED}${failures} import check(s) failed.${OFF}`);
    throw new Error(`${failures} import check(s) failed`);
}
print(`${GREEN}All import checks passed.${OFF}`);

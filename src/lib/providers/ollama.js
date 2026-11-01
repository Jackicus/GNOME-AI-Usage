// The local Ollama server: its installed models (/api/tags), what it holds in
// memory (/api/ps), and this session's use of each. The server counts nothing,
// so the session figures are the extension's own samples of /api/ps.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Status, numberOrNull, stringOrNull} from '../usage.js';
import {failureReading, readJson, reading} from './common.js';
import * as Log from '../log.js';

Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

export const OllamaProvider = {
    id: 'ollama',
    displayName: 'Ollama',
    cli: 'ollama',
    cliName: 'Ollama',
    // Sampled often whether the session is idle or not: a sample is a request to this machine.
    local: true,

    capabilities: {
        perModel: false,
        breakdown: false,
        credits: false,
    },

    // One per running shell, in the login's runtime directory: a screen lock
    // disables the extension and keeps the figures, a new login starts afresh.
    sessionFile() {
        const pid = Gio.Credentials.new().get_unix_pid();
        return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_runtime_dir(), 'ai-usage', `ollama-${pid}.json`]));
    },

    async read(http, cancellable = null) {
        const server = serverUrl(GLib.getenv('OLLAMA_HOST') ?? '');
        let tags, ps;
        try {
            [tags, ps] = await Promise.all([
                http.getJson(`${server}/api/tags`, {}, cancellable),
                http.getJson(`${server}/api/ps`, {}, cancellable),
            ]);
        } catch (e) {
            if (e.status === 0)
                return reading(this, {status: Status.UNAVAILABLE, message: `the Ollama server at ${server} is not running`});
            return failureReading(this, e, null);
        }

        this._session ??= await loadSession(this.sessionFile());
        if (sample(this._session, runningFrom(ps), Date.now()))
            saveSession(this.sessionFile(), this._session);
        return reading(this, {status: Status.OK, models: modelsFrom(tags, ps, this._session)});
    },
};

// As the CLI reads OLLAMA_HOST: http, and port 11434 unless a scheme or a port is given.
export function serverUrl(value) {
    const [, scheme, host] = value.trim().match(/^(?:(https?):\/\/)?([^/]*)/);
    const port = scheme === 'https' ? 443 : scheme ? 80 : 11434;
    const hostPort = /:\d+$/.test(host) ? host : `${host || '127.0.0.1'}:${port}`;
    return `${scheme ?? 'http'}://${hostPort}`;
}

async function loadSession(file) {
    const saved = await readJson(file, 'Ollama session file');
    return {models: saved?.models ?? {}, sampledAt: numberOrNull(saved?.sampledAt)};
}

async function saveSession(file, session) {
    try {
        GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
        await file.replace_contents_bytes_async(new GLib.Bytes(new TextEncoder().encode(JSON.stringify(session))),
            null, false, Gio.FileCreateFlags.PRIVATE, null);
    } catch (e) {
        Log.warn(`Could not keep Ollama's session figures: ${e.message}`);
    }
}

// name -> expires_at (Unix ms, or null) of each model in memory.
function runningFrom(ps) {
    const running = new Map();
    for (const model of Array.isArray(ps?.models) ? ps.models : []) {
        const name = stringOrNull(model?.name);
        if (name)
            running.set(name, expiresAt(model));
    }
    return running;
}

function expiresAt(model) {
    const at = GLib.DateTime.new_from_iso8601(stringOrNull(model?.expires_at) ?? '', null);
    return at ? at.to_unix() * 1000 : null;
}

// Adds what changed since the last sample. A load or a later expiry means a
// request came in: the server pushes the expiry back after each one.
export function sample(session, running, now) {
    let changed = false;
    for (const [name, expires] of running) {
        session.models[name] ??= {loads: 0, inMemoryMs: 0, lastUsed: null, loaded: false, expires: null};
        const model = session.models[name];
        if (!model.loaded) {
            model.loads++;
            model.lastUsed = now;
        } else {
            if (session.sampledAt !== null)
                model.inMemoryMs += now - session.sampledAt;
            if (expires !== null && model.expires !== null && expires > model.expires)
                model.lastUsed = now;
        }
        model.loaded = true;
        model.expires = expires;
        changed = true;
    }
    for (const [name, model] of Object.entries(session.models)) {
        if (model.loaded && !running.has(name)) {
            model.loaded = false;
            changed = true;
        }
    }
    session.sampledAt = now;
    return changed;
}

// Every installed model, with what it holds in memory and its session figures.
export function modelsFrom(tags, ps, session) {
    const loaded = new Map();
    for (const model of Array.isArray(ps?.models) ? ps.models : []) {
        const name = stringOrNull(model?.name);
        if (name)
            loaded.set(name, model);
    }

    const installed = Array.isArray(tags?.models) ? tags.models : [];
    const names = new Set([...installed.map(m => stringOrNull(m?.name)).filter(Boolean), ...loaded.keys()]);
    const models = [...names].map(name => {
        const tag = installed.find(m => m?.name === name) ?? loaded.get(name);
        const running = loaded.get(name);
        const used = session.models[name];
        return {
            name: name.replace(/:latest$/, ''),
            parameters: stringOrNull(tag?.details?.parameter_size),
            quantization: stringOrNull(tag?.details?.quantization_level),
            size: numberOrNull(tag?.size),
            memory: running ? {
                size: numberOrNull(running.size),
                vram: numberOrNull(running.size_vram),
                context: numberOrNull(running.context_length),
                unloadsAt: expiresAt(running) === null ? null : GLib.DateTime.new_from_unix_utc(expiresAt(running) / 1000),
            } : null,
            session: used ? {
                loads: used.loads,
                inMemoryMs: used.inMemoryMs,
                lastUsed: used.lastUsed === null ? null : GLib.DateTime.new_from_unix_utc(used.lastUsed / 1000),
            } : null,
        };
    });
    // In memory, then the rest used this session, latest first, then the server's order (newest pull first).
    const rank = m => m.memory ? 0 : m.session ? 1 : 2;
    const lastUsed = m => m.session?.lastUsed?.to_unix() ?? 0;
    return models.sort((a, b) => rank(a) - rank(b) || lastUsed(b) - lastUsed(a));
}

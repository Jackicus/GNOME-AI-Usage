import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Secret from 'gi://Secret?version=1';

import {Reading, Status} from '../usage.js';
import * as Log from '../log.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');

export function reading(provider, fields) {
    return new Reading({
        providerId: provider.id,
        displayName: provider.displayName,
        cli: provider.cliName,
        ...fields,
    });
}

// The file's JSON, or null when it is missing or half-written: both are
// ordinary for a login file, so only a debug line.
export async function readJson(file, what) {
    try {
        const [bytes] = await file.load_contents_async(null);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        Log.debug(`No ${what} to read: ${e.message}`);
        return null;
    }
}

// A CLI's own item in the secret service, as JSON, or null. Items written by
// go-keyring and Rust's keyring carry no schema of ours, so only the attributes are matched.
export function lookupSecret(attributes, cancellable) {
    const schema = new Secret.Schema('org.freedesktop.Secret.Generic', Secret.SchemaFlags.DONT_MATCH_NAME,
        Object.fromEntries(Object.keys(attributes).map(name => [name, Secret.SchemaAttributeType.STRING])));
    return new Promise(resolve => {
        Secret.password_lookup(schema, attributes, cancellable, (_o, result) => {
            try {
                resolve(JSON.parse(Secret.password_lookup_finish(result)));
            } catch (e) {
                // No item, a locked keyring or no secret service.
                Log.debug(`Keyring lookup for ${attributes.service} failed: ${e.message}`);
                resolve(null);
            }
        });
    });
}

// "free-tier" -> "Free tier".
export function humanise(id) {
    return id.replace(/[_-]+/g, ' ').trim().replace(/^\w/, c => c.toUpperCase());
}

// Rounded to the minute: the services jitter a reset across minute boundaries,
// and a notification is keyed by it.
export function parseTimestamp(value) {
    if (typeof value !== 'string')
        return null;
    const at = GLib.DateTime.new_from_iso8601(value, null);
    if (!at)
        return null;
    const seconds = at.to_unix() + at.get_microsecond() / 1e6;
    return GLib.DateTime.new_from_unix_utc(Math.round(seconds / 60) * 60);
}

// A cancelled request is thrown on: the app drops that round.
export function failureReading(provider, e, plan) {
    if (e instanceof Gio.IOErrorEnum)
        throw e;
    // Duck-typed, not HttpError: importing http.js would put Soup in prefs' graph.
    const expired = e.status === 401 || e.status === 403;
    return reading(provider, {
        status: expired ? Status.EXPIRED : Status.UNAVAILABLE,
        plan,
        message: expired ? null : e.message,
    });
}

// A failed request and a response in an unknown shape are different readings.
export async function fetchReading(provider, plan, request, parse) {
    let body;
    try {
        body = await request();
    } catch (e) {
        return failureReading(provider, e, plan);
    }

    try {
        return parse(body);
    } catch (e) {
        Log.warn(`Could not read ${provider.displayName}'s usage response: ${e.message}`);
        return reading(provider, {
            status: Status.UNAVAILABLE,
            plan,
            message: 'the service answered in a shape this version does not know',
        });
    }
}

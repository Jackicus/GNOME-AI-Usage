// The endpoint is the one Codex's own /status reads.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Limit, Status, numberOrNull, stringOrNull} from '../usage.js';
import * as Log from '../log.js';
import {fetchReading, humanise, readJson, reading} from './common.js';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

const USER_AGENT = 'codex_cli_rs';

// The response does not name its windows, so they are told apart by length. The
// shared ids let primary-limit find them.
const KNOWN_WINDOWS = [
    {seconds: 5 * 60 * 60, tolerance: 60 * 60, id: 'session', label: 'Current session'},
    {seconds: 7 * 24 * 60 * 60, tolerance: 12 * 60 * 60, id: 'weekly_all', label: 'This week'},
    {seconds: 30 * 24 * 60 * 60, tolerance: 24 * 60 * 60, id: 'monthly', label: 'This month'},
];

export const CodexProvider = {
    id: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    cliName: 'the Codex CLI',
    renewArgs: ['doctor'],

    capabilities: {
        perModel: true,
        breakdown: false,
        credits: true,
    },

    credentialsFile() {
        // As the CLI does: CODEX_HOME when set and non-empty.
        const home = GLib.getenv('CODEX_HOME') || GLib.build_filenamev([GLib.get_home_dir(), '.codex']);
        return Gio.File.new_for_path(GLib.build_filenamev([home, 'auth.json']));
    },

    async read(http, cancellable = null) {
        const auth = await readCredentials();
        if (!auth)
            return reading(this, {status: Status.SIGNED_OUT});

        if (!auth.accessToken) {
            return reading(this, {
                status: Status.UNSUPPORTED,
                message: 'Signed in with an API key, which is billed per request rather than against subscription limits.',
            });
        }

        if (auth.expiresAt && auth.expiresAt.to_unix() * 1000 <= Date.now())
            return reading(this, {status: Status.EXPIRED, expiredAt: auth.expiresAt});

        const headers = {
            'Authorization': `Bearer ${auth.accessToken}`,
            'User-Agent': USER_AGENT,
        };
        if (auth.accountId)
            headers['ChatGPT-Account-ID'] = auth.accountId;

        return fetchReading(this, auth.plan, () => http.getJson(USAGE_URL, headers, cancellable),
            body => this._parse(body, auth));
    },

    _parse(body, auth) {
        const limits = [];

        const rate = body?.rate_limit;
        pushWindow(limits, rate?.primary_window, {fallbackId: 'primary'});
        pushWindow(limits, rate?.secondary_window, {fallbackId: 'secondary'});

        // Keyed on the model, not the position: notifications remember the id.
        const extra = Array.isArray(body?.additional_rate_limits) ? body.additional_rate_limits : [];
        extra.forEach((entry, index) => {
            const name = entry?.normal_model_slug || entry?.limit_name || entry?.metered_feature || null;
            const key = name ?? `bucket${index}`;
            const detail = entry?.rate_limit;
            pushWindow(limits, detail?.primary_window,
                {fallbackId: `model:${key}`, scoped: true, modelName: name});
            pushWindow(limits, detail?.secondary_window,
                {fallbackId: `model:${key}:secondary`, scoped: true, modelName: name});
        });

        if (!limits.length)
            throw new Error('no windows in the response');

        return reading(this, {
            status: Status.OK,
            plan: planLabel(body?.plan_type) ?? auth.plan,
            limits,
            credits: creditsFrom(body),
        });
    },
};

function pushWindow(limits, window, {fallbackId, scoped = false, modelName = null}) {
    const percent = numberOrNull(window?.used_percent);
    if (percent === null)
        return;

    const seconds = numberOrNull(window.limit_window_seconds);
    const known = KNOWN_WINDOWS.find(w => Math.abs(seconds - w.seconds) < w.tolerance);
    const base = known?.label ?? windowLabel(seconds);
    limits.push(new Limit({
        id: !scoped && known ? known.id : fallbackId,
        label: modelName ? `${base} · ${modelName}` : base,
        percent,
        resetsAt: resetTime(window),
        scoped,
    }));
}

function windowLabel(seconds) {
    if (seconds === null || seconds <= 0)
        return 'Current limit';
    const hours = Math.round(seconds / 3600);
    return hours < 48 ? `Last ${hours} hours` : `Last ${Math.round(hours / 24)} days`;
}

// Absolute reset only: one derived from reset_after_seconds drifts per poll and
// would notify again every time.
function resetTime(window) {
    const at = numberOrNull(window.reset_at);
    if (at === null || at <= 0)
        return null;
    return GLib.DateTime.new_from_unix_utc(at);
}

// A balance is not a share of anything, so the row has no bar (percent null).
function creditsFrom(body) {
    const credits = body?.credits;
    if (!credits || credits.has_credits === false)
        return null;
    if (credits.unlimited === true)
        return {percent: null, label: 'Credits · unlimited'};

    // A string in the upstream types.
    const balance = credits.balance;
    if (typeof balance !== 'string' && typeof balance !== 'number')
        return null;
    const amount = Number(balance);
    if (!Number.isFinite(amount) || amount <= 0)
        return null;
    return {percent: null, label: `Credits · ${amount} left`};
}

function planLabel(planType) {
    return stringOrNull(planType) && planType !== 'unknown' ? humanise(planType) : null;
}

// Read fresh every poll and never kept. A login kept in the keyring reads as signed out.
async function readCredentials() {
    const parsed = await readJson(CodexProvider.credentialsFile(), 'Codex credentials');
    const tokens = parsed?.tokens;
    const accessToken = stringOrNull(tokens?.access_token);

    // An API-key login is signed in but has no subscription windows.
    if (!accessToken)
        return parsed?.OPENAI_API_KEY ? {accessToken: null} : null;

    const claims = jwtClaims(accessToken);
    const authClaims = claims?.['https://api.openai.com/auth'];

    return {
        accessToken,
        accountId: stringOrNull(tokens.account_id) ?? authClaims?.chatgpt_account_id ?? null,
        plan: planLabel(authClaims?.chatgpt_plan_type),
        // No readable expiry: the request decides.
        expiresAt: numberOrNull(claims?.exp) === null ? null : GLib.DateTime.new_from_unix_utc(claims.exp),
    };
}

// The token is a JWT; if it cannot be read, the request decides.
function jwtClaims(token) {
    try {
        const payload = token.split('.')[1];
        // base64url without padding, to the base64 GLib reads.
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
            .padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
        return JSON.parse(new TextDecoder().decode(GLib.base64_decode(padded)));
    } catch (e) {
        Log.debug(`Could not read the Codex token's claims: ${e.message}`);
        return null;
    }
}


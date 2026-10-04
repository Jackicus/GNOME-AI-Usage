// The request Claude Code's /usage makes, with its stored token. The token is
// never refreshed here: that rotates the refresh token and signs Claude Code out.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Limit, Status, numberOrNull, stringOrNull} from '../usage.js';
import {fetchReading, humanise, parseTimestamp, readJson, reading} from './common.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

// Not required today; sent to look exactly like Claude Code.
const OAUTH_BETA = 'oauth-2025-04-20';

// Listing order; an unknown kind is listed last under its own name.
const KIND_ORDER = ['session', 'weekly_all', 'weekly_scoped'];

// Claude Code's own words for these rows.
const KIND_LABELS = {
    session: '5-hour limit',
    weekly_all: 'Weekly · all models',
    weekly_scoped: 'Weekly',
};

export const ClaudeProvider = {
    id: 'claude',
    displayName: 'Claude',
    cli: 'claude',
    cliName: 'Claude Code',
    renewArgs: ['doctor'],

    capabilities: {
        perModel: true,
        breakdown: true,
        credits: true,
    },

    credentialsFile() {
        return Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']));
    },

    async read(http, cancellable = null) {
        const auth = await readCredentials();
        if (!auth)
            return reading(this, {status: Status.SIGNED_OUT});

        const headers = {'Authorization': `Bearer ${auth.accessToken}`, 'anthropic-beta': OAUTH_BETA};
        return fetchReading(this, planLabel(auth), () => http.getJson(USAGE_URL, headers, cancellable),
            body => this._parse(body, auth));
    },

    _parse(body, auth) {
        const rows = Array.isArray(body?.limits) ? body.limits : [];
        const limits = rows.map(limitFromRow).filter(Boolean);

        if (!limits.length)
            throw new Error('no limits in the response');

        limits.sort((a, b) => kindRank(a.id) - kindRank(b.id));

        return reading(this, {
            status: Status.OK,
            plan: planLabel(auth),
            limits,
            breakdown: breakdownFrom(body),
            credits: creditsFrom(body),
        });
    },
};

function limitFromRow(row) {
    const kind = stringOrNull(row?.kind);
    const percent = numberOrNull(row?.percent);
    if (!kind || percent === null)
        return null;

    return new Limit({
        id: kind,
        label: labelForRow(kind, row),
        percent,
        severity: row.severity,
        resetsAt: parseTimestamp(row.resets_at),
        // Scoped by model or by surface: either way the per-model switch hides it.
        scoped: !!row.scope,
    });
}

function labelForRow(kind, row) {
    const base = KIND_LABELS[kind] ?? humanise(kind);
    const scope = row.scope?.model?.display_name ?? row.scope?.surface?.display_name;
    return scope ? `${base} · ${scope}` : base;
}

function breakdownFrom(body) {
    const rows = body?.seven_day_breakdown?.rows;
    if (!Array.isArray(rows))
        return [];
    return rows
        .filter(row => Number(row?.percent) > 0 && typeof row?.display_name === 'string')
        .map(row => ({label: row.display_name, percent: Number(row.percent)}));
}

function creditsFrom(body) {
    const extra = body?.extra_usage;
    if (!extra || typeof extra !== 'object')
        return null;

    const spent = money(body?.spend?.used);

    // Switched off, the service sends no figure: a row with no bar (percent null).
    if (!extra.is_enabled) {
        return {
            percent: null,
            label: 'Extra usage · off',
            detail: spent ? `${spent} used` : null,
        };
    }

    // spend.percent goes with spend.severity, or a 0% bar is coloured as a warning.
    const percent = numberOrNull(body?.spend?.percent) ?? numberOrNull(extra.utilization);
    if (percent === null)
        return null;

    return {
        percent,
        severity: body?.spend?.severity,
        label: spent ? `Extra usage · ${spent} used` : 'Extra usage',
    };
}

function money(amount) {
    const minor = Number(amount?.amount_minor);
    if (!Number.isFinite(minor))
        return null;
    const exponent = numberOrNull(amount?.exponent) ?? 2;
    const value = minor / 10 ** exponent;
    const currency = stringOrNull(amount?.currency) ?? '';
    return `${value.toFixed(exponent)} ${currency}`.trim();
}

function kindRank(id) {
    const index = KIND_ORDER.indexOf(id);
    return index === -1 ? KIND_ORDER.length : index;
}

// Read fresh every poll and never kept or logged.
async function readCredentials() {
    const oauth = (await readJson(ClaudeProvider.credentialsFile(), 'Claude credentials'))?.claudeAiOauth;
    const accessToken = stringOrNull(oauth?.accessToken);
    if (!accessToken)
        return null;
    return {
        accessToken,
        subscriptionType: oauth.subscriptionType,
        rateLimitTier: oauth.rateLimitTier,
        accountTier: await readAccountTier(Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), '.claude.json']))),
    };
}

// The current plan, from ~/.claude.json: the credentials' tier is stamped at
// sign-in and never rewritten.
export async function readAccountTier(file) {
    const account = (await readJson(file, 'Claude account file'))?.oauthAccount;
    return stringOrNull(account?.organizationRateLimitTier) ?? stringOrNull(account?.userRateLimitTier);
}

// "default_claude_max_5x" -> "Max (5x)", as Claude Code writes it.
export function planLabel(auth) {
    const tier = auth.accountTier ?? stringOrNull(auth.rateLimitTier);
    const plan = tier && humanise(tier.replace(/^default_claude_/, '')).replace(/ (\d+x)$/, ' ($1)');
    if (plan)
        return plan;
    const type = stringOrNull(auth.subscriptionType);
    return type && humanise(type);
}

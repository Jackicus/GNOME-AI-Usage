// Staged over lib/http.js under `start --stand-in`: answers each provider's usage request with
// invented figures, with reset times relative to now, and sends nothing. The providers run
// unchanged around it, on the stand-in logins scripts/nested.d/stand-in.sh writes. Nothing here ships.

import GLib from 'gi://GLib';

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Now plus some hours and minutes, as the services write it.
function inHours(hours, minutes = 0) {
    return GLib.DateTime.new_now_utc().add_hours(hours).add_minutes(minutes).format_iso8601();
}

// 15:00 local, some days from today: the shape of a weekly reset.
function inDaysAt(days, hour) {
    const day = GLib.DateTime.new_now_local().add_days(days);
    return GLib.DateTime.new_local(day.get_year(), day.get_month(), day.get_day_of_month(), hour, 0, 0)
        .to_utc().format_iso8601();
}

function claudeUsage() {
    const weekly = inDaysAt(4, 15);
    return {
        limits: [
            {kind: 'session', percent: 12, severity: 'normal', resets_at: inHours(2, 22), scope: null},
            {kind: 'weekly_all', percent: 34, severity: 'normal', resets_at: weekly, scope: null},
            {
                kind: 'weekly_scoped', percent: 41, severity: 'normal', resets_at: weekly,
                scope: {model: {id: null, display_name: 'Opus'}, surface: null},
            },
        ],
        extra_usage: {is_enabled: false},
        spend: {used: {amount_minor: 0, currency: 'USD', exponent: 2}},
        seven_day_breakdown: {
            rows: [
                {key: 'claude_code', display_name: 'Claude Code', percent: 88},
                {key: 'chat', display_name: 'Chats', percent: 12},
                {key: 'other', display_name: 'Other', percent: 0},
            ],
        },
    };
}

function antigravityProject() {
    return {cloudaicompanionProject: 'stand-in-project', currentTier: {id: 'standard-tier'}};
}

function antigravityQuota() {
    return {
        groups: [
            {
                displayName: 'Gemini Models',
                buckets: [
                    {bucketId: 'gemini-5h', window: '5h', resetTime: inHours(3, 40), remainingFraction: 0.82},
                    {bucketId: 'gemini-weekly', window: 'weekly', resetTime: inDaysAt(5, 20), remainingFraction: 0.6},
                ],
            },
            {
                displayName: 'Claude and GPT models',
                buckets: [
                    {bucketId: '3p-weekly', window: 'weekly', resetTime: inDaysAt(6, 15), remainingFraction: 0.95},
                ],
            },
        ],
    };
}

// A Codex window, as the service writes it: seconds, and the reset as a Unix time.
function codexWindow(percent, hours, resetsAt) {
    const at = GLib.DateTime.new_from_iso8601(resetsAt, null).to_unix();
    return {
        used_percent: percent,
        limit_window_seconds: hours * 60 * 60,
        reset_after_seconds: at - GLib.DateTime.new_now_utc().to_unix(),
        reset_at: at,
    };
}

function codexUsage() {
    const session = codexWindow(23, 5, inHours(1, 50));
    const weekly = codexWindow(47, 7 * 24, inDaysAt(3, 9));
    return {
        user_id: 'user-StandInStandInStandIn00',
        account_id: '00000000-0000-4000-8000-000000000000',
        email: 'someone@example.com',
        plan_type: 'plus',
        rate_limit: {allowed: true, limit_reached: false, primary_window: session, secondary_window: weekly},
        code_review_rate_limit: null,
        additional_rate_limits: null,
        model_usage: {},
        chatpass: {windows: [session, weekly]},
        credits: {
            has_credits: false, unlimited: false, overage_limit_reached: false, balance: null,
            approx_local_messages: null, approx_cloud_messages: null,
        },
        spend_control: {reached: false, individual_limit: null},
        rate_limit_reached_type: null,
        promo: null,
        rate_limit_reset_credits: {available_count: 0, applicable_available_count: 0},
    };
}

const ANSWERS = {
    'https://api.anthropic.com/api/oauth/usage': ['claude', claudeUsage],
    'https://chatgpt.com/backend-api/wham/usage': ['codex', codexUsage],
    'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist': ['antigravity', antigravityProject],
    'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary': ['antigravity', antigravityQuota],
};

// How a provider's service fails, as './scripts/nested.sh state' writes it: {"codex": "expired"}.
function failureFor(provider) {
    try {
        const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([GLib.get_home_dir(), 'stand-in-failures.json']));
        return JSON.parse(new TextDecoder().decode(bytes))[provider] ?? null;
    } catch {
        return null;
    }
}

export class Http {
    getJson(url) {
        return this._answer(url);
    }

    postJson(url) {
        return this._answer(url);
    }

    // A URL with no stand-in answer is the service being unreachable, which is
    // what a provider added without one here would show in a retake.
    _answer(url) {
        if (!ANSWERS[url])
            return Promise.reject(new HttpError(0, `No stand-in answer for ${url}`));

        const [provider, answer] = ANSWERS[url];
        switch (failureFor(provider)) {
        case 'expired':
            return Promise.reject(new HttpError(401, 'Unauthorized'));
        case 'unavailable':
            return Promise.reject(new HttpError(503, 'the stand-in service is down'));
        case 'unknown-shape':
            return Promise.resolve({stand_in: 'a shape no parser knows'});
        default:
            return Promise.resolve(answer());
        }
    }

    destroy() {
    }
}

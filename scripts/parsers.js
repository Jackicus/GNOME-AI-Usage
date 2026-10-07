// Each provider's parser over saved responses (tests/fixtures/). The endpoints are undocumented and their shapes
// move, so this says so when one does. `./scripts/dev.sh parsers`; nothing here ships.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {applyOptions} from '../src/lib/settings.js';
import {AntigravityProvider, planFrom, tokenFrom} from '../src/lib/providers/antigravity.js';
import {parseTimestamp} from '../src/lib/providers/common.js';
import {ClaudeProvider, planLabel, readAccountTier} from '../src/lib/providers/claude.js';
import {CodexProvider, keyringAccount} from '../src/lib/providers/codex.js';
import {ResetFormat, Status, formatBreakdown, formatPercent, formatReset, formatTime} from '../src/lib/usage.js';

const THRESHOLDS = {warn: 80, critical: 95};
const EVERYTHING = {showPerModel: true, showBreakdown: true, showCredits: true};

const RED = '\x1b[1;31m';
const GREEN = '\x1b[1;32m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

let failures = 0;

function check(what, got, want) {
    const ok = String(got) === String(want);
    if (!ok)
        failures++;
    const mark = ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`;
    const detail = ok ? `${DIM}${got}${OFF}` : `${RED}got ${got}, wanted ${want}${OFF}`;
    print(`  ${mark} ${what.padEnd(42)} ${detail}`);
}

function fixture(name) {
    const dir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    const path = GLib.build_filenamev([dir, '..', 'tests', 'fixtures', name]);
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return JSON.parse(new TextDecoder().decode(bytes));
}

// Severity is decided at draw time, so it is checked on what applyOptions() returns.
function drawn(reading, thresholds = THRESHOLDS) {
    return applyOptions(reading, EVERYTHING, thresholds);
}

print('\x1b[1mClaude\x1b[0m — tests/fixtures/claude-usage.json');
{
    const reading = ClaudeProvider._parse(fixture('claude-usage.json'),
        {rateLimitTier: 'default_claude_max_5x'});

    check('status', reading.status, Status.OK);
    check('plan label from the rate limit tier', reading.plan, 'Max (5x)');
    check('limits found', reading.limits.length, 3);
    check('ordered session first', reading.limits[0].id, 'session');
    check('session percent', formatPercent(reading.limits[0].percent), '50%');
    check('severity from the response (warning)', drawn(reading).limits[1].severity, 'warning');
    check('severity from the response (critical)', drawn(reading).limits[2].severity, 'critical');
    // Claude Code's own words for these rows.
    check('session row takes Claude Code\'s words', reading.limits[0].label, '5-hour limit');
    check('the weekly row too', reading.limits[1].label, 'Weekly · all models');
    check('per-model row is labelled', reading.limits[2].label, 'Weekly · Fable');
    check('per-model row is marked scoped', reading.limits[2].scoped, true);
    check('whole-account row is not scoped', reading.limits[1].scoped, false);
    check('reset time parsed', reading.limits[0].resetsAt?.format_iso8601(), '2026-09-30T18:10:00Z');
    check('breakdown rows kept', reading.breakdown.length, 1);
    check('breakdown label', reading.breakdown[0].label, 'Claude Code');
    // Switched off is shown as off, with no figure: the service sends only what has been spent.
    check('credits shown as off when not enabled', reading.credits?.label, 'Extra usage · off');
    check('with no figure to draw a bar from', reading.credits?.percent, null);
    check('and what has been spent', reading.credits?.detail, '0.00 USD used');
    check('worst limit is the highest', formatPercent(reading.worst.percent), '97%');
}

// ~/.claude.json is the copy of the plan Claude Code refreshes; the credentials' tier is stale after a plan
// change. Any failure there falls through to the old source.
print('\n\x1b[1mClaude\x1b[0m — the plan name, and which file it comes from');
{
    const dir = GLib.dir_make_tmp('ai-usage-plan-XXXXXX');
    const written = [];
    // The account file as on disk, read the way the extension reads it; a null text is no file.
    const accountTier = async text => {
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([dir, `claude-${written.length}.json`]));
        if (text !== null) {
            file.replace_contents(new TextEncoder().encode(text), null, false,
                Gio.FileCreateFlags.NONE, null);
            written.push(file);
        }
        return readAccountTier(file);
    };

    // The real shape: the organisation's tier, the admin's own one null.
    const live = await accountTier(JSON.stringify({
        numStartups: 42,
        oauthAccount: {
            emailAddress: 'someone@example.com',
            organizationRateLimitTier: 'default_claude_max_20x',
            userRateLimitTier: null,
            organizationRole: 'admin',
        },
    }));
    const stale = {rateLimitTier: 'default_claude_max_5x', subscriptionType: 'max'};

    check('the account file is read', live, 'default_claude_max_20x');
    check('max_20x humanises', planLabel({accountTier: live}), 'Max (20x)');
    check('it beats the stale credentials tier', planLabel({...stale, accountTier: live}), 'Max (20x)');
    check('which on its own would have said', planLabel(stale), 'Max (5x)');
    // The multiplier goes in brackets, and only a tier that has one.
    check('a tier with no multiplier is left alone',
        planLabel({accountTier: 'default_claude_pro'}), 'Pro');

    // A personal account carries no organisation tier, so its own is taken.
    check('userRateLimitTier when there is no org tier',
        await accountTier(JSON.stringify({oauthAccount: {
            organizationRateLimitTier: null, userRateLimitTier: 'default_claude_pro',
        }})), 'default_claude_pro');

    // Ordinary states, not faults: no file yet, a half-written one, no oauthAccount.
    check('an absent file yields no tier', await accountTier(null), null);
    check('an unparseable file yields no tier', await accountTier('{"oauthAccount": {"organi'), null);
    check('a file with no oauthAccount yields none', await accountTier('{"numStartups": 42}'), null);
    check('an empty tier is not a tier', await accountTier('{"oauthAccount": {"organizationRateLimitTier": ""}}'), null);
    check('a non-string tier is not a tier', await accountTier('{"oauthAccount": {"userRateLimitTier": 7}}'), null);

    // ...and every one of them falls through to what there was before.
    for (const [what, text] of [['absent', null], ['unparseable', '{"oauthAcc'],
        ['without oauthAccount', '{}']]) {
        check(`${what} falls back to the credentials`,
            // eslint-disable-next-line no-await-in-loop
            planLabel({...stale, accountTier: await accountTier(text)}), 'Max (5x)');
    }
    check('with no tier anywhere, the subscription name',
        planLabel({subscriptionType: 'max', accountTier: await accountTier(null)}), 'Max');
    check('nothing known at all means no plan shown', planLabel({}), null);

    // And the whole way through, on a real response.
    const reading = ClaudeProvider._parse(fixture('claude-usage.json'),
        {...stale, accountTier: live});
    check('the reading carries the live plan', reading.plan, 'Max (20x)');

    for (const file of written)
        file.delete(null);
    Gio.File.new_for_path(dir).delete(null);
}

// Resets jitter; parseTimestamp() rounds to the minute so one reset is one moment.
print('\n\x1b[1mReset timestamps\x1b[0m — jitter in resets_at is rounded away');
{
    const unix = text => parseTimestamp(text)?.to_unix();
    const minute = unix('2026-09-30T14:00:00+00:00');

    check('either side of a minute boundary agree',
        unix('2026-09-30T13:59:59.748885+00:00'), unix('2026-09-30T14:00:00.116803+00:00'));
    check('and agree with the minute itself', unix('2026-09-30T13:59:59.748885+00:00'), minute);
    check('a second apart across a boundary', unix('2026-09-30T13:59:59.500+00:00'), unix('2026-09-30T14:00:00.500+00:00'));
    check('rounds down below the half', unix('2026-09-30T14:00:29.900+00:00'), minute);
    check('rounds up from the half', unix('2026-09-30T14:00:30+00:00'), minute + 60);
    check('an offset is the same moment', unix('2026-09-30T16:00:00.2+02:00'), minute);
    check('not a string is no time', parseTimestamp(1790000000), null);
    check('not a time is no time', parseTimestamp('soon'), null);
}

// Pinned to a fixed moment, timezone and clock, so the expected strings do not move with the machine.
print('\n\x1b[1mReset times\x1b[0m — the four reset-format values, against a fixed moment');
{
    const utc = GLib.TimeZone.new_utc();
    const at = text => GLib.DateTime.new_from_iso8601(text, null);

    // Wednesday 30 September 2026, 13:59 UTC: an hour before one reset, six days before the weekly one.
    const now = at('2026-09-30T13:59:00+00:00');
    const soon = at('2026-09-30T15:00:00+00:00');
    const far = at('2026-10-06T14:00:00+00:00');
    const say = (resetsAt, format, clock = '12h') =>
        formatReset(resetsAt, {format, now, clock, timezone: utc});

    // Claude Code's own wording, down to "hr" and "min".
    check('auto: a countdown while it is near', say(soon, ResetFormat.AUTO), 'Resets in 1 hr 1 min');
    check('auto: a wall clock once it is not', say(far, ResetFormat.AUTO), 'Resets Tue 2:00 PM');
    check('relative keeps the countdown far out', say(far, ResetFormat.RELATIVE), 'Resets in 6 days');
    check('absolute gives the time close in', say(soon, ResetFormat.ABSOLUTE), 'Resets 3:00 PM');
    check('both, with the time in brackets', say(far, ResetFormat.BOTH), 'Resets in 6 days (Tue 2:00 PM)');
    check('auto is what a caller gets by default',
        formatReset(far, {now, clock: '12h', timezone: utc}), 'Resets Tue 2:00 PM');

    check('and the date past the next six days',
        say(at('2026-10-07T13:00:00+00:00'), ResetFormat.ABSOLUTE), 'Resets Wed 7 Oct 1:00 PM');
    check('a month away', say(at('2026-11-01T15:24:00+00:00'), ResetFormat.AUTO, '24h'), 'Resets Sun 1 Nov 15:24');

    // The desktop's own 12/24-hour setting, never a hardcoded one.
    check('a 24-hour desktop', say(far, ResetFormat.ABSOLUTE, '24h'), 'Resets Tue 14:00');
    check('a 12-hour one', say(far, ResetFormat.ABSOLUTE, '12h'), 'Resets Tue 2:00 PM');

    check('under a minute still says something',
        say(at('2026-09-30T13:59:30+00:00'), ResetFormat.RELATIVE), 'Resets in 1 min');
    check('minutes on their own', say(at('2026-09-30T14:44:00+00:00'), ResetFormat.RELATIVE), 'Resets in 45 min');
    check('a whole number of hours drops the minutes',
        say(at('2026-09-30T15:59:00+00:00'), ResetFormat.RELATIVE), 'Resets in 2 hr');
    check('a reset already past', say(at('2026-09-30T13:00:00+00:00'), ResetFormat.AUTO), 'Resets now');
    check('an open-ended limit has no sentence', formatReset(null), null);

    // When a login lapsed: a moment already past.
    const time = text => formatTime(at(text), {now, clock: '24h', timezone: utc});
    check('a lapse earlier today is a time', time('2026-09-30T12:09:00+00:00'), '12:09');
    check('a lapse this week names the day', time('2026-09-28T19:09:00+00:00'), 'Mon 19:09');
    check('a lapse longer ago has its date', time('2026-09-20T19:09:00+00:00'), 'Sun 20 Sep 19:09');
}

// The breakdown line sits under a limit row, so it must not read as another one: a single
// surviving row is 100% and reports nothing.
print('\n\x1b[1mThe breakdown line\x1b[0m — quiet until it has something to report');
{
    const reading = ClaudeProvider._parse(fixture('claude-usage.json'), {});
    check('the provider still reports its one row', reading.breakdown.length, 1);
    check('but one surface earns no line', formatBreakdown(reading.breakdown), null);

    const mixed = [{label: 'Claude Code', percent: 60}, {label: 'Chats', percent: 40}];
    check('two surfaces do', formatBreakdown(mixed),
        'Where this week went: Claude Code 60% · Chats 40%');
    check('and it does not open with a figure', /^[A-Za-z]/.test(formatBreakdown(mixed)), true);
    check('an empty breakdown is silent', formatBreakdown([]), null);
}

print('\n\x1b[1mCodex\x1b[0m — tests/fixtures/codex-usage.json  \x1b[2m(paid plan, shape from openai/codex)\x1b[0m');
{
    const reading = CodexProvider._parse(fixture('codex-usage.json'), {plan: null});

    check('status', reading.status, Status.OK);
    check('plan label from plan_type', reading.plan, 'Plus');
    check('limits found', reading.limits.length, 3);
    check('5h window named from its length', reading.limits[0].label, 'Current session');
    check('7d window named from its length', reading.limits[1].label, 'This week');
    check('primary percent', formatPercent(reading.limits[0].percent), '50%');
    check('severity derived from percent', drawn(reading).limits[1].severity, 'warning');
    check('per-model row labelled by model', reading.limits[2].label, 'Current session · gpt-5-codex');
    check('per-model row is marked scoped', reading.limits[2].scoped, true);
    check('whole-account row is not scoped', reading.limits[0].scoped, false);
    check('epoch reset converted', reading.limits[0].resetsAt?.format_iso8601(), '2033-05-18T03:33:20Z');
    check('null secondary window skipped', reading.limits.filter(l => l.scoped).length, 1);
    check('credits balance read', reading.credits?.label, 'Credits · 12 left');
    check('with no figure to draw a bar from', reading.credits?.percent, null);
    check('and a null percent grades as normal', drawn(reading).credits.severity, 'normal');
    check('no breakdown for this provider', reading.breakdown.length, 0);
}

// The account Codex's keyring entry is filed under, worked out in Python from openai/codex's compute_store_key().
print('\n\x1b[1mCodex\x1b[0m — the keyring entry a login kept there is filed under');
{
    check('cli| and 16 hex digits of the path\'s SHA-256', keyringAccount('/home/someone/.codex'), 'cli|cd5e9c565ce61932');
    check('the same path written untidily', keyringAccount('/home/someone/./.codex/'), 'cli|cd5e9c565ce61932');
}

print('\n\x1b[1mCodex\x1b[0m — tests/fixtures/codex-usage-free.json  \x1b[2m(free plan, the live shape)\x1b[0m');
{
    const reading = CodexProvider._parse(fixture('codex-usage-free.json'), {plan: null});

    check('status', reading.status, Status.OK);
    check('plan label from plan_type', reading.plan, 'Free');
    check('the one 30-day window', reading.limits.length, 1);
    check('named from its length', reading.limits[0].label, 'This month');
    check('with an id of its own', reading.limits[0].id, 'monthly');
    check('percent', formatPercent(reading.limits[0].percent), '37%');
    check('epoch reset converted', reading.limits[0].resetsAt?.format_iso8601(), '2033-06-04T12:13:20Z');
    check('null additional_rate_limits is no models', reading.limits.filter(l => l.scoped).length, 0);
    check('no credits means no credits row', reading.credits, null);
}

print('\n\x1b[1mAntigravity\x1b[0m — the plan, from tests/fixtures/antigravity-load.json');
{
    const load = fixture('antigravity-load.json');
    check('a subscription is named by paidTier, not currentTier', planFrom(load), 'Google AI Pro');
    check('without one, currentTier is humanised', planFrom({currentTier: load.currentTier}), 'Free tier');
    check('with neither, there is no plan', planFrom({}), null);
}

// agy's stored token, as its keyring item holds it: Go writes the expiry with nanoseconds.
print('\n\x1b[1mAntigravity\x1b[0m — the stored token and its expiry');
{
    const token = tokenFrom({token: {access_token: 'stand-in', expiry: '2026-10-06T19:09:02.310434144+01:00'}});
    check('the access token is read', token.accessToken, 'stand-in');
    check('its expiry, nanoseconds and offset', token.expiresAt?.to_unix(),
        GLib.DateTime.new_from_iso8601('2026-10-06T18:09:02Z', null).to_unix());
    check('no expiry leaves it to the request', tokenFrom({token: {access_token: 'stand-in'}}).expiresAt, null);
    check('an unreadable expiry too', tokenFrom({token: {access_token: 'stand-in', expiry: 'soon'}}).expiresAt, null);
    check('no access token is no login', tokenFrom({token: {refresh_token: 'stand-in'}}), null);
}

print('\n\x1b[1mAntigravity\x1b[0m — tests/fixtures/antigravity-quota.json  \x1b[2m(real, plus a synthetic 5h bucket)\x1b[0m');
{
    AntigravityProvider._plan = 'Free tier';
    const reading = AntigravityProvider._parse(fixture('antigravity-quota.json'));

    check('status', reading.status, Status.OK);
    check('buckets found', reading.limits.length, 3);

    // The response says what is LEFT and the extension shows what is USED: backwards would read 100% on an
    // untouched limit. Sorted: the 5-hour bucket first, then the weekly ones in response order.
    check('remainingFraction 0.35 means 65% used', formatPercent(reading.limits[0].percent), '65%');
    check('remainingFraction 0 means fully used', formatPercent(reading.limits[1].percent), '100%');
    check('remainingFraction 1 means untouched', formatPercent(reading.limits[2].percent), '0%');

    check('shortest window sorts first', reading.limits[0].id, 'gemini-5h');
    check('5h window labelled', reading.limits[0].label, 'Current session · Gemini Models');
    check('weekly window labelled', reading.limits[1].label, 'This week · Gemini Models');
    check('the other family keeps its own row', reading.limits[2].label, 'This week · Claude and GPT models');
    // The bucket's displayName is "Weekly Limit Remaining", which over a used figure would lie.
    check('the response label is NOT reused', reading.limits[1].label.includes('Remaining'), false);
    check('an exhausted bucket is critical', drawn(reading).limits[1].severity, 'critical');
    check('an untouched bucket is normal', drawn(reading).limits[2].severity, 'normal');
    check('reset time parsed, to the minute', reading.limits[1].resetsAt?.format_iso8601(), '2026-10-05T20:12:00Z');
    check('nothing is marked per-model', reading.limits.filter(l => l.scoped).length, 0);
}

// Turning a hidden row's switch back on restores it without a new poll.
print('\n\x1b[1mDisplay switches\x1b[0m — hiding a row must not throw it away');
{
    const full = ClaudeProvider._parse(fixture('claude-usage.json'),
        {rateLimitTier: 'default_claude_max_5x'});
    const hidden = applyOptions(full, {...EVERYTHING, showPerModel: false, showBreakdown: false}, THRESHOLDS);

    check('per-model rows hidden in the view', hidden.limits.length, 2);
    check('breakdown hidden in the view', hidden.breakdown.length, 0);
    check('the reading itself is untouched', full.limits.length, 3);
    check('its breakdown is untouched', full.breakdown.length, 1);

    const restored = drawn(full);
    check('turning it back on restores the rows', restored.limits.length, 3);
    check('and the breakdown', restored.breakdown.length, 1);
    check('the view keeps its getters', restored.ok, true);
    check('and its computed properties', formatPercent(restored.worst.percent), '97%');

    // A threshold moves the colour of the figures in hand without another read.
    check('a lower threshold recolours at once', drawn(full, {warn: 40, critical: 60}).limits[0].severity, 'warning');
    check('without touching the reading', drawn(full).limits[0].severity, 'normal');
}

// Shapes that caused real bugs: Number(null) is 0, so a null percent became a 0% row, and for
// Antigravity, which reports what is LEFT, a null read as fully spent.
print('\n\x1b[1mHostile shapes\x1b[0m — a wrong number is worse than no number');
{
    const claude = ClaudeProvider._parse({
        limits: [
            {kind: 'session', percent: null, resets_at: null},
            {kind: 'weekly_all', percent: 42, resets_at: null},
            {kind: 'weekly_scoped', percent: 10, scope: {surface: {display_name: 'Cowork'}}},
        ],
    }, {});
    check('claude drops a null percent', claude.limits.length, 2);
    check('claude keeps the real one', formatPercent(claude.limits[0].percent), '42%');
    check('a surface-scoped row is named', claude.limits[1].label, 'Weekly · Cowork');
    check('and counts as scoped, so it can be hidden', claude.limits[1].scoped, true);

    const credits = ClaudeProvider._parse({
        limits: [{kind: 'session', percent: 5}],
        extra_usage: {is_enabled: true, utilization: null},
        spend: {percent: 30, severity: 'warning', used: {amount_minor: 1234, currency: 'USD', exponent: 2}},
    }, {});
    // The figure and the severity come from the same object, or an empty bar is painted as a warning.
    check('credits take the figure beside their severity', formatPercent(credits.credits.percent), '30%');
    check('and the service severity is still honoured', drawn(credits).credits.severity, 'warning');

    const noFigure = ClaudeProvider._parse({
        limits: [{kind: 'session', percent: 5}],
        extra_usage: {is_enabled: true, utilization: null},
        spend: {used: {amount_minor: 0, currency: 'USD', exponent: 2}},
    }, {});
    check('no credits figure means no credits row', noFigure.credits, null);

    const noExtra = ClaudeProvider._parse({limits: [{kind: 'session', percent: 5}]}, {});
    check('no extra_usage at all means no credits row', noExtra.credits, null);

    const anti = AntigravityProvider._parse({
        groups: [{displayName: 'Gemini Models', buckets: [
            {bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: null},
            {bucketId: 'gemini-5h', window: '5h', remainingFraction: 0},
        ]}],
    });
    check('antigravity drops a null fraction', anti.limits.length, 1);
    check('rather than reading it as fully spent', anti.limits.every(l => l.percent !== 100 || l.id === 'gemini-5h'), true);

    const codex = CodexProvider._parse({
        plan_type: 'plus',
        rate_limit: {
            primary_window: {used_percent: null, limit_window_seconds: 18000, reset_at: 2000000000},
            secondary_window: {used_percent: 20, limit_window_seconds: 604800, reset_after_seconds: 600},
        },
        credits: {has_credits: false, balance: '0'},
        additional_rate_limits: [],
    }, {});
    check('codex drops a null percent', codex.limits.length, 1);
    // A reset derived from reset_after_seconds moves every poll and would notify every poll.
    check('no absolute reset means no reset shown', codex.limits[0].resetsAt, null);
    check('a recognised window takes the shared id', codex.limits[0].id, 'weekly_all');
    check('no credits means no credits row', codex.credits, null);

    const unlimited = CodexProvider._parse({
        rate_limit: {primary_window: {used_percent: 1, limit_window_seconds: 18000, reset_at: 2000000000}},
        credits: {has_credits: true, unlimited: true},
    }, {});
    check('unlimited credits read', unlimited.credits?.label, 'Credits · unlimited');
    check('and drawn without a bar', unlimited.credits?.percent, null);

    const ids = CodexProvider._parse({
        rate_limit: {primary_window: {used_percent: 1, limit_window_seconds: 18000, reset_at: 2000000000}},
        additional_rate_limits: [{rate_limit: {primary_window: {used_percent: 2, limit_window_seconds: 18000, reset_at: 2000000000}}}],
    }, {});
    check('session window takes the shared id', ids.limits[0].id, 'session');
    check('an unnamed model bucket keeps a stable id', ids.limits[1].id, 'model:bucket0');
}

// The parts of Claude's response read only on some accounts.
print('\n\x1b[1mClaude\x1b[0m — money, unknown kinds and bad times');
{
    const spent = ClaudeProvider._parse({
        limits: [
            {kind: 'session', percent: 5, resets_at: 'tomorrow-ish'},
            {kind: 'weekly_opus_extra', percent: 7},
        ],
        extra_usage: {is_enabled: true},
        spend: {percent: 10, used: {amount_minor: 1234, currency: 'EUR', exponent: 2}},
    }, {});
    check('minor units in the currency\'s exponent', spent.credits.label, 'Extra usage · 12.34 EUR used');
    check('an unknown kind is named from itself', spent.limits[1].label, 'Weekly opus extra');
    check('and listed after the known ones', spent.limits[1].id, 'weekly_opus_extra');
    check('a reset that is not a time is none', spent.limits[0].resetsAt, null);
    const yen = ClaudeProvider._parse({
        limits: [{kind: 'session', percent: 5}],
        extra_usage: {is_enabled: false},
        spend: {used: {amount_minor: 500, currency: 'JPY', exponent: 0}},
    }, {});
    check('a currency with no minor unit', yen.credits.detail, '500 JPY used');
}

print('\n\x1b[1mCodex\x1b[0m — the shapes a free or odd account sends');
{
    const window = {used_percent: 3, limit_window_seconds: 18000, reset_at: 2000000000};
    const none = CodexProvider._parse({plan_type: 'free', rate_limit: null, additional_rate_limits: null}, {plan: null});
    check('a null rate_limit is no limits, not a new shape', none.status, Status.UNSUPPORTED);
    check('and still names the plan', none.plan, 'Free');
    check('null and empty additional limits agree',
        CodexProvider._parse({rate_limit: {primary_window: window}, additional_rate_limits: []}, {}).limits.length,
        CodexProvider._parse({rate_limit: {primary_window: window}, additional_rate_limits: null}, {}).limits.length);
    const odd = CodexProvider._parse({
        plan_type: 'unknown',
        rate_limit: {primary_window: {...window, limit_window_seconds: null}},
        additional_rate_limits: [{limit_name: 'no windows'}, {limit_name: 'gpt-x', rate_limit: null}],
    }, {plan: 'Pro'});
    check('a model entry with no rate_limit adds no row', odd.limits.length, 1);
    check('a window of no stated length', odd.limits[0].label, 'Current limit');
    check('plan_type "unknown" leaves the login\'s plan', odd.plan, 'Pro');
}

// Codex's login, read the way the extension reads it: auth.json in a scratch CODEX_HOME, a stub for the
// network, and a session bus that is not there, so the keyring fallback finds nothing.
print('\n\x1b[1mCodex\x1b[0m — reading its login, with a stub for the network');
{
    const home = GLib.dir_make_tmp('ai-usage-codex-XXXXXX');
    GLib.setenv('CODEX_HOME', home, true);
    GLib.setenv('DBUS_SESSION_BUS_ADDRESS', `unix:path=${home}/no-bus`, true);
    const file = Gio.File.new_for_path(GLib.build_filenamev([home, 'auth.json']));
    const write = auth => file.replace_contents(new TextEncoder().encode(JSON.stringify(auth)), null, false,
        Gio.FileCreateFlags.NONE, null);
    const base64url = text => GLib.base64_encode(new TextEncoder().encode(text))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = claims => `stand-in.${base64url(JSON.stringify(claims))}.stand-in`;
    const auth = (token, accountId) => ({tokens: {access_token: token, account_id: accountId}});
    const later = Math.floor(Date.now() / 1000) + 3600;

    let sent = null;
    const answering = answer => ({
        getJson: (_url, headers) => {
            sent = headers;
            return answer();
        },
    });
    const usage = answering(() => Promise.resolve(fixture('codex-usage-free.json')));
    const read = async http => {
        sent = null;
        return CodexProvider.read(http);
    };

    check('no auth.json and no keyring is signed out', (await read(usage)).status, Status.SIGNED_OUT);
    check('without asking the service', sent, null);

    write({OPENAI_API_KEY: 'stand-in', tokens: null});
    check('an API-key login has no subscription limits', (await read(usage)).status, Status.UNSUPPORTED);

    // Payloads whose base64url length is 0, 2 and 3 mod 4: each needs different padding.
    for (const pad of ['', 'x', 'xx']) {
        const claims = {exp: 1700000000, pad, 'https://api.openai.com/auth': {chatgpt_plan_type: 'plus'}};
        const length = base64url(JSON.stringify(claims)).length % 4;
        write(auth(jwt(claims), 'stand-in-account'));
        // eslint-disable-next-line no-await-in-loop
        const lapsed = await read(usage);
        check(`a lapsed token (payload length ${length} mod 4)`, lapsed.status, Status.EXPIRED);
        check('  says when, from its exp claim', lapsed.expiredAt?.to_unix(), 1700000000);
    }
    check('and the service is not asked', sent, null);

    write(auth(jwt({exp: later, 'https://api.openai.com/auth': {chatgpt_account_id: 'from-claim'}}), 'from-field'));
    const ok = await read(usage);
    check('a live token reads', ok.status, Status.OK);
    check('the token is sent as a bearer', sent.Authorization.startsWith('Bearer stand-in.'), true);
    check('account_id is taken over the claim', sent['ChatGPT-Account-ID'], 'from-field');
    write(auth(jwt({exp: later, 'https://api.openai.com/auth': {chatgpt_account_id: 'from-claim'}})));
    await read(usage);
    check('the claim when there is no field', sent['ChatGPT-Account-ID'], 'from-claim');

    write(auth('not-a-jwt'));
    check('an unreadable token is left to the request', (await read(usage)).status, Status.OK);

    const failing = status => answering(() => Promise.reject(Object.assign(new Error('stand-in failure'), {status})));
    check('a 401 is an expired login', (await read(failing(401))).status, Status.EXPIRED);
    check('a 403 too', (await read(failing(403))).status, Status.EXPIRED);
    const down = await read(failing(503));
    check('a 503 is unavailable', down.status, Status.UNAVAILABLE);
    check('with the reason', down.message, 'stand-in failure');
    const strange = await read(answering(() => Promise.resolve({nonsense: true})));
    check('an unknown shape is unavailable, not a throw', strange.status, Status.UNAVAILABLE);

    file.delete(null);
    Gio.File.new_for_path(home).delete(null);
}

// An unreadable response must degrade, never throw: a provider that throws
// takes the whole pop-up down with it.
print('\n\x1b[1mBoth\x1b[0m — a response in a shape they do not know');
for (const provider of [ClaudeProvider, CodexProvider, AntigravityProvider]) {
    let threw = null;
    try {
        // Antigravity's parser takes no credentials, and ignores the stub.
        provider._parse({nonsense: true}, {});
    } catch (e) {
        threw = e;
    }
    check(`${provider.id} rejects it rather than inventing figures`, threw !== null, true);
}

print('');
if (failures) {
    print(`${RED}${failures} check(s) failed.${OFF}`);
    throw new Error(`${failures} parser check(s) failed`);
}
print(`${GREEN}All parser checks passed.${OFF}`);

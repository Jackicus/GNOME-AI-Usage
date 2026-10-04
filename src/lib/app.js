import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Http} from './http.js';
import {UsageIndicator} from './indicator.js';
import {PROVIDERS} from './providers/registry.js';
import {applyOptions, providerSettings} from './settings.js';
import {Status, formatReset} from './usage.js';
import * as Log from './log.js';

// A scheduled poll is skipped after this long without input.
const IDLE_SKIP_MS = 10 * 60 * 1000;

// Seconds a tool gets to renew its login before it is stopped.
const RENEW_TIMEOUT_S = '60';

// Opening a pop-up re-reads only figures older than this (microseconds).
const FRESH_FOR_US = 60 * GLib.TIME_SPAN_SECOND;

export class AiUsageApp {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();

        this._http = null;
        // provider id -> {provider, settings, handlerId, live, reading, renewed}, in registry order
        this._providers = new Map();
        this._indicator = null;
        this._notified = new Map();   // limit key -> the resets_at (unix seconds) it was notified for

        this._settingsId = 0;
        this._interface = null;
        this._interfaceId = 0;
        this._timerId = 0;
        this._debounceId = 0;
        this._cancellable = null;
        this._monitors = [];
    }

    enable() {
        this._http = new Http(`gnome-shell-extension-ai-usage/${this._extension.metadata['version-name']}`);

        for (const provider of PROVIDERS) {
            const settings = providerSettings(this._extension.dir, provider.id);
            const handlerId = settings.connect('changed', (_s, key) => {
                if (key !== 'enabled') {
                    this._redraw();
                    return;
                }
                this._syncProviders();
                this.refresh();
            });
            // A copy per enable, so whatever a provider caches goes with disable().
            this._providers.set(provider.id,
                {provider: Object.create(provider), settings, handlerId, live: false, reading: null, renewed: false});
        }

        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if ((key === 'panel-box' || key === 'panel-index') && this._indicator)
                this._place();
            else if (key === 'poll-seconds')
                this._schedule();
            else if (key === 'renew-login')
                this.refresh();
            else
                this._redraw();
        });
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._interfaceId = this._interface.connect('changed::clock-format', () => this._redraw());

        this._syncProviders();
        this.refresh();
        this._schedule();
    }

    disable() {
        this._unschedule();
        this._cancelInFlight();

        this._settings.disconnect(this._settingsId);
        this._interface.disconnect(this._interfaceId);
        this._interface = null;

        for (const {settings, handlerId} of this._providers.values())
            settings.disconnect(handlerId);
        this._providers.clear();
        this._indicator?.destroy();
        this._indicator = null;

        this._stopWatchingCredentials();
        if (this._debounceId)
            GLib.Source.remove(this._debounceId);
        this._debounceId = 0;

        this._http.destroy();
        this._http = null;
    }

    _live() {
        return [...this._providers.values()].filter(entry => entry.live);
    }

    // A provider is live when it is switched on and its command-line tool is
    // installed. The button exists while one is.
    _syncProviders() {
        for (const entry of this._providers.values()) {
            const {provider, settings} = entry;
            entry.live = settings.get_boolean('enabled');
            if (entry.live && !GLib.find_program_in_path(provider.cli)) {
                Log.debug(`'${provider.cli}' is not installed; leaving ${provider.id} out.`);
                entry.live = false;
            }
            if (!entry.live)
                entry.reading = null;
        }

        const live = this._live();
        Log.debug(`Providers: ${live.map(e => e.provider.id).join(', ') || 'none'}`);
        if (!live.length) {
            this._indicator?.destroy();
            this._indicator = null;
        } else if (this._indicator) {
            this._redraw();
        } else {
            this._place();
        }
        this._watchCredentials();
    }

    // addToStatusArea claims the role until the indicator is destroyed, so a
    // button already placed is built afresh to be placed again. -1, or an
    // index past the end of the box, appends.
    _place() {
        this._indicator?.destroy();
        // Refresh reads every provider and leaves the pop-up open to watch the
        // figures change; the preferences close it.
        const indicator = new UsageIndicator([
            {label: 'Refresh now', icon: 'view-refresh-symbolic', action: () => this.refresh()},
            {label: 'Preferences', icon: 'go-next-symbolic', action: () => {
                indicator.menu.close(true);
                this._extension.openPreferences();
            }},
        ]);
        indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refreshIfStale();
        });
        this._indicator = indicator;
        Main.panel.addToStatusArea(this._extension.uuid, indicator,
            this._settings.get_int('panel-index'), this._settings.get_string('panel-box'));
        this._redraw();
    }

    // A read already out is cancelled, so the newest answer is the one shown.
    refresh() {
        this._cancelInFlight();
        if (!this._live().length)
            return;

        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        this._readAll(cancellable).catch(e => {
            if (!cancellable.is_cancelled())
                Log.error('Reading usage failed', e);
        }).finally(() => {
            if (this._cancellable === cancellable)
                this._cancellable = null;
        });
    }

    // Opening the pop-up again and again would otherwise start a read each time.
    _refreshIfStale() {
        const now = GLib.DateTime.new_now_utc();
        if (this._cancellable || this._live().some(e => e.reading && now.difference(e.reading.at) < FRESH_FOR_US))
            return;
        this.refresh();
    }

    // The button draws as each provider answers, so a slow one holds up no other.
    async _readAll(cancellable) {
        await Promise.all(this._live().map(async entry => {
            const reading = await entry.provider.read(this._http, cancellable);
            if (cancellable.is_cancelled())
                return;

            entry.reading = reading;
            reading.cli = entry.provider.cliName;
            if (reading.ok)
                entry.renewed = false;
            else if (reading.status === Status.EXPIRED)
                this._renewLogin(entry);
            this._redraw();
            // From the untouched readings: a hidden limit still notifies.
            this._maybeNotify();
        }));
    }

    // The tool renews its login as it starts and the credentials watch reads the
    // result. Once per expiry, so a login the tool cannot renew costs one run.
    _renewLogin(entry) {
        const {provider} = entry;
        if (entry.renewed || !provider.renewArgs || !this._settings.get_boolean('renew-login'))
            return;

        entry.renewed = true;
        Log.debug(`Running '${provider.cli} ${provider.renewArgs.join(' ')}' to renew the login.`);
        try {
            Gio.Subprocess.new(['timeout', RENEW_TIMEOUT_S, provider.cli, ...provider.renewArgs],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            Log.warn(`Could not run ${provider.cli}: ${e.message}`);
        }
    }

    // A provider that has not answered yet has a null reading ("Reading usage…").
    _redraw() {
        if (!this._indicator)
            return;

        const s = this._settings;
        const thresholds = {warn: s.get_int('warn-percent'), critical: s.get_int('critical-percent')};
        const options = {
            showPercent: s.get_boolean('show-percent'),
            hideUnavailable: s.get_boolean('hide-unavailable'),
            limit: s.get_string('primary-limit'),
            tabs: s.get_string('tab-position'),
            resetFormat: s.get_string('reset-format'),
            clock: this._interface.get_string('clock-format'),
        };
        this._indicator.setReadings(this._live().map(({provider, settings, reading}) => ({
            id: provider.id,
            name: provider.displayName,
            reading: reading && applyOptions(reading, {
                showPerModel: settings.get_boolean('show-per-model'),
                showBreakdown: settings.get_boolean('show-breakdown'),
                showCredits: settings.get_boolean('show-credits'),
            }, thresholds),
        })), options);
    }

    _cancelInFlight() {
        this._cancellable?.cancel();
        this._cancellable = null;
    }

    _schedule() {
        this._unschedule();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._settings.get_int('poll-seconds'), () => {
            if (global.backend.get_core_idle_monitor().get_idletime() <= IDLE_SKIP_MS)
                this.refresh();
            else
                Log.debug('Skipping a poll: the session is idle.');
            return GLib.SOURCE_CONTINUE;
        });
    }

    _unschedule() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }

    // The tool rewriting its login means the figures moved, or an expired token is good again.
    _watchCredentials() {
        this._stopWatchingCredentials();
        for (const {provider} of this._live()) {
            const monitor = provider.credentialsFile().monitor_file(Gio.FileMonitorFlags.NONE, null);
            monitor.connect('changed', () => this._refreshSoon());
            this._monitors.push(monitor);
        }
    }

    _stopWatchingCredentials() {
        for (const monitor of this._monitors)
            monitor.cancel();
        this._monitors = [];
    }

    // A credential write arrives as several events, and a read mid-write gets half a file.
    _refreshSoon() {
        if (this._debounceId)
            GLib.Source.remove(this._debounceId);
        this._debounceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._debounceId = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Once per limit per window, the window being its reset time.
    _maybeNotify() {
        const notifyAt = this._settings.get_int('notify-percent');
        if (!notifyAt)
            return;

        const now = GLib.DateTime.new_now_utc().to_unix();
        for (const [key, resetsAt] of this._notified) {
            if (resetsAt !== null && resetsAt < now)
                this._notified.delete(key);
        }

        const wording = {format: this._settings.get_string('reset-format'), clock: this._interface.get_string('clock-format')};
        for (const {reading} of this._live()) {
            if (reading?.status !== Status.OK)
                continue;
            for (const limit of reading.limits) {
                const key = `${reading.providerId}:${limit.id}`;
                const window = limit.resetsAt?.to_unix() ?? null;

                if (limit.percent < notifyAt) {
                    this._notified.delete(key);
                    continue;
                }
                if (this._notified.has(key) && this._notified.get(key) === window)
                    continue;
                this._notified.set(key, window);

                const when = limit.resetsAt ? ` ${formatReset(limit.resetsAt, wording)}.` : '';
                Main.notify(`${reading.displayName} usage at ${Math.round(limit.percent)}%`,
                    `${limit.label}.${when}`);
            }
        }
    }
}

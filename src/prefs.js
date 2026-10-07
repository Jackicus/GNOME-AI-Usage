import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PROVIDERS} from './lib/providers/registry.js';
import {keysFor, providerSettings} from './lib/settings.js';

export default class AiUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.add(this._buttonPage(settings));
        window.add(this._readingPage(settings));
        window.add(this._providersPage(settings));
    }

    _buttonPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Button',
            icon_name: 'preferences-desktop-appearance-symbolic',
        });

        const place = new Adw.PreferencesGroup({
            title: 'Where it sits',
            description: 'The button goes in the chosen part of the top bar. Which neighbours it lands '
                + 'between also depends on what other extensions have put there.',
        });
        place.add(comboRow(settings, 'panel-box', 'Part of the top bar', [
            ['left', 'Left'],
            ['center', 'Centre'],
            ['right', 'Right'],
        ]));
        place.add(spinRow(settings, 'panel-index', 'Position',
            'Its place in that part, counted from the left; -1 puts it at the right end.', -1, 20));
        page.add(place);

        const shown = new Adw.PreferencesGroup({
            title: 'What it shows',
            description: 'The pop-up always lists every limit. This is the single figure on the button itself, '
                + 'for the provider whose tab is selected.',
        });
        shown.add(comboRow(settings, 'primary-limit', 'Figure on the button', [
            ['highest', 'Whichever is highest'],
            ['session', 'Current session'],
            ['weekly', 'This week'],
        ]));
        shown.add(switchRow(settings, 'show-percent', 'Show the percentage',
            'With this off the button is just "AI", tinted by how much has been used.'));
        shown.add(switchRow(settings, 'hide-unavailable', 'Hide a provider with nothing to show',
            'Signed out, login expired or unreadable. The tool refreshes its login only while it runs, '
            + 'so its tab returns by itself once you have used it. With none left the button goes too.'));
        page.add(shown);

        const popup = new Adw.PreferencesGroup({
            title: 'The pop-up',
            description: 'Every limit carries the time it resets, worded the same in the pop-up and in '
                + 'notifications. An exact time is in your own timezone, on the clock your desktop is set to.',
        });
        popup.add(comboRow(settings, 'tab-position', 'Provider tabs', [
            ['top', 'At the top'],
            ['bottom', 'At the bottom'],
        ]));
        const reset = comboRow(settings, 'reset-format', 'Reset times', [
            ['auto', 'Automatic'],
            ['relative', 'Countdown'],
            ['absolute', 'Time of day'],
            ['both', 'Both'],
        ]);
        reset.subtitle = 'Automatic is a countdown when the reset is less than a day away, the time when it is not.';
        popup.add(reset);
        page.add(popup);

        return page;
    }

    _readingPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Readings',
            icon_name: 'preferences-system-time-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'How often',
            description: 'Opening the pop-up reads the figures again once they are a minute old, and so does signing in or refreshing your login, '
                + 'so a long interval here still gives you fresh numbers whenever you look.',
        });
        group.add(spinRow(settings, 'poll-seconds', 'Seconds between readings', null, 60, 3600, 30));
        page.add(group);

        const warnings = new Adw.PreferencesGroup({
            title: 'Warnings',
            description: 'How much of a limit is used, in percent, before it is shown in amber, then red, and '
                + 'before you are notified. A notification comes once for each limit, and not again until it resets.',
        });
        warnings.add(spinRow(settings, 'warn-percent', 'Amber from', null, 1, 100));
        warnings.add(spinRow(settings, 'critical-percent', 'Red from', null, 1, 100));
        warnings.add(spinRow(settings, 'notify-percent', 'Notify from', 'Zero turns notifications off.', 0, 100));
        page.add(warnings);

        return page;
    }

    _providersPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Providers',
            icon_name: 'system-users-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Providers',
            description: 'This extension never signs you in and never stores a password. It reads the login that each '
                + "provider's own command-line tool has already saved, so signing in and out stays in one place. "
                + 'A provider needs that tool installed and already signed in, and is offered once it is installed.',
        });

        for (const provider of PROVIDERS)
            group.add(this._providerRow(provider));

        page.add(group);

        const renew = new Adw.PreferencesGroup({
            title: 'Expired logins',
            description: 'Claude Code and Codex renew their login only when they run, so after a few hours it '
                + 'lapses until you have used the tool.',
        });
        renew.add(switchRow(settings, 'renew-login', 'Renew an expired login',
            'Runs "claude doctor" or "codex doctor" once each time the login expires, which makes the tool '
            + 'refresh it. Not available for Antigravity.'));
        page.add(renew);
        return page;
    }

    // A provider whose tool is missing cannot be read, so it is offered no switch.
    _providerRow(provider) {
        const path = GLib.find_program_in_path(provider.cli);
        if (!path) {
            return new Adw.ActionRow({
                title: provider.displayName,
                subtitle: `Not installed: no ${provider.cli} command was found`,
                use_markup: false,
            });
        }

        const row = new Adw.ExpanderRow({
            title: provider.displayName,
            subtitle: `Found at ${path}`,
            use_markup: false,
        });
        const settings = providerSettings(this.dir, provider.id);

        const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
        settings.bind('enabled', toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(toggle);

        for (const key of keysFor(provider)) {
            const child = switchRow(settings, key.key, key.title);
            settings.bind('enabled', child, 'sensitive', Gio.SettingsBindFlags.GET);
            row.add_row(child);
        }

        return row;
    }
}

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle: subtitle ?? ''});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, lower, upper, step = 1) {
    const row = new Adw.SpinRow({
        title,
        subtitle: subtitle ?? '',
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 10}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// Adw.ComboRow selects by position and the key holds a nick, so they are mapped by hand.
function comboRow(settings, key, title, choices) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(choices.map(([, label]) => label)),
    });

    const nicks = choices.map(([nick]) => nick);
    const sync = () => {
        const index = nicks.indexOf(settings.get_string(key));
        if (row.selected !== index)
            row.selected = index;
    };
    sync();

    row.connect('notify::selected', () => {
        const nick = nicks[row.selected];
        if (nick !== settings.get_string(key))
            settings.set_string(key, nick);
    });
    const changedId = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(changedId));

    return row;
}

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Severity, Status, formatBreakdown, formatPercent, formatReset} from './usage.js';

// Secondary text is dimmed with actor opacity, so it suits light and dark menus.
const DIM_OPACITY = 160;

// primary-limit -> the limit id it asks for; anything else shows the worst.
const PRIMARY_LIMIT = {session: 'session', weekly: 'weekly_all'};

const SEVERITY_CLASS = {
    [Severity.NORMAL]: 'ai-usage-normal',
    [Severity.WARNING]: 'ai-usage-warning',
    [Severity.CRITICAL]: 'ai-usage-critical',
};

function explain(reading) {
    switch (reading.status) {
    case Status.SIGNED_OUT:
        return `Not signed in. Run ${reading.cli} and sign in there.`;
    case Status.EXPIRED:
        return `The stored login has expired. Run ${reading.cli} once and it will refresh itself.`;
    case Status.UNSUPPORTED:
        return reading.message ?? 'This login has no subscription limits to show.';
    case Status.UNAVAILABLE:
        return reading.message
            ? `Usage could not be read: ${reading.message}`
            : 'Usage could not be read just now.';
    default:
        return 'Usage could not be read.';
    }
}

// The figure the button shows for a provider: its primary limit, else its worst.
function figureOf(reading, limit) {
    return reading?.ok ? reading.limits.find(l => l.id === PRIMARY_LIMIT[limit]) ?? reading.worst : null;
}

export const UsageIndicator = GObject.registerClass(
class UsageIndicator extends PanelMenu.Button {
    // select(id) is called with the provider whose tab is chosen.
    _init(actions, select) {
        super._init(0.5, 'AI usage', false);

        // menu.box is the actor that gets `.popup-menu-content`, so the width goes there.
        this.menu.box.add_style_class_name('ai-usage-menu');

        this._label = new St.Label({
            text: 'AI',
            style_class: 'ai-usage-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);

        this._select = select;
        this._rows = [];
        this._selected = null;
        this._options = null;
        this._tabIds = '';

        this._tabs = new St.BoxLayout({style_class: 'ai-usage-tabs', x_expand: true});
        this._tabsItem = tabsItem(this._tabs, actions);
        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._tabsItem);
        this.menu.addMenuItem(this._section);
    }

    // entries: [{id, name, reading}], one per live provider; a reading is null
    // until its provider has answered. options: showPercent, hideUnavailable,
    // limit (primary-limit), selected (the provider chosen last; the first tab
    // when it has none), tabs ('top' or 'bottom'), resetFormat, clock ('12h' or
    // '24h').
    setReadings(entries, options) {
        const rows = entries.map(entry => ({...entry, figure: figureOf(entry.reading, options.limit)}));
        this._rows = options.hideUnavailable ? rows.filter(row => row.figure) : rows;
        this._selected = this._rows.find(row => row.id === options.selected) ?? this._rows[0];
        this._options = options;

        this._renderPanel();
        this.menu.moveMenuItem(this._tabsItem, options.tabs === 'top' ? 0 : 1);
        if (this._selected)
            this._renderMenu();
    }

    _renderPanel() {
        const row = this._selected;

        this.container.visible = !!row;
        if (!row)
            this.menu.close(true);

        // No figure: amber when the fix is the user's (signing in again).
        const broken = row?.reading?.status === Status.EXPIRED || row?.reading?.status === Status.SIGNED_OUT;
        const severity = row?.figure ? row.figure.severity : broken ? Severity.WARNING : Severity.NORMAL;
        for (const cls of Object.values(SEVERITY_CLASS))
            this._label.remove_style_class_name(cls);
        this._label.add_style_class_name(SEVERITY_CLASS[severity]);

        this._label.set_text(row?.figure && this._options.showPercent ? `AI ${formatPercent(row.figure.percent)}` : 'AI');
    }

    // The tabs are rebuilt only when the providers shown change, so a redraw
    // does not take the keyboard focus off one.
    _renderTabs() {
        const ids = this._rows.map(row => row.id).join();
        if (ids !== this._tabIds) {
            this._tabIds = ids;
            this._tabs.destroy_all_children();
            for (const row of this._rows) {
                const tab = new St.Button({label: row.name, style_class: 'button flat ai-usage-tab', can_focus: true});
                tab.connect('clicked', () => this._select(row.id));
                this._tabs.add_child(tab);
            }
        }

        this._tabs.get_children().forEach((tab, i) => {
            tab.checked = this._rows[i] === this._selected;
        });
    }

    _renderMenu() {
        this._renderTabs();
        this._section.removeAll();

        const {reading} = this._selected;
        if (reading)
            this._addReading(reading, this._options);
        else
            this._section.addMenuItem(captionItem('Reading usage…'));
        // St has no :last-child; the stylesheet pads the marked row.
        this._section.box.get_children().at(-1).add_style_class_name('ai-usage-last');
    }

    _addReading(reading, {resetFormat, clock}) {
        if (reading.plan) {
            const plan = captionItem(reading.plan);
            plan.add_style_class_name('ai-usage-plan');
            this._section.addMenuItem(plan);
        }

        if (!reading.ok) {
            this._section.addMenuItem(captionItem(explain(reading)));
            return;
        }

        for (const limit of reading.limits)
            this._section.addMenuItem(limitItem(limit, resetFormat, clock));

        if (reading.credits)
            this._section.addMenuItem(limitItem(reading.credits, resetFormat, clock));

        const breakdown = formatBreakdown(reading.breakdown);
        if (breakdown)
            this._section.addMenuItem(captionItem(breakdown));
    }
});

// The shell's `icon-button flat`, as at the end of a Quick Settings slider row.
// Dimmed on the icon rather than the button, so the hover background stays full,
// and lit again on hover and focus, which the theme does not do for opacity.
function actionButton(label, iconName, action) {
    const icon = new St.Icon({icon_name: iconName, opacity: DIM_OPACITY});
    const button = new St.Button({
        style_class: 'icon-button flat',
        can_focus: true,
        accessible_name: label,
        y_align: Clutter.ActorAlign.CENTER,
        child: icon,
    });
    const light = () => {
        icon.opacity = button.hover || button.has_key_focus() ? 255 : DIM_OPACITY;
    };
    button.connect('notify::hover', light);
    button.connect('key-focus-in', light);
    button.connect('key-focus-out', light);
    button.connect('clicked', () => action());
    return button;
}

function inertItem(styleClass) {
    return new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: styleClass});
}

// The tabs, and the actions hard right.
function tabsItem(tabs, actions) {
    const item = inertItem('ai-usage-tabs-row');
    const row = new St.BoxLayout({style_class: 'ai-usage-tabs-box', x_expand: true});
    row.add_child(tabs);

    const buttons = new St.BoxLayout({
        style_class: 'ai-usage-action-row',
        y_align: Clutter.ActorAlign.CENTER,
    });
    for (const {label, icon, action} of actions)
        buttons.add_child(actionButton(label, icon, action));
    row.add_child(buttons);

    item.add_child(row);
    return item;
}

// Name, dimmed reset (or detail), percentage, bar underneath, as Claude Code's
// /usage. The name is the one expanding column and the figure has a fixed-width
// cell, so the columns line up from row to row. A row with no percentage has no
// figure and no bar: an empty bar would claim a 0% the service never said.
function limitItem(limit, resetFormat, clock) {
    const item = inertItem('ai-usage-limit');
    const column = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });

    const top = new St.BoxLayout({style_class: 'ai-usage-limit-row', x_expand: true});
    const name = new St.Label({
        text: limit.label,
        style_class: 'ai-usage-limit-label',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    // The name is what gets cut when the row is too narrow.
    name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    top.add_child(name);

    const reset = limit.detail ?? formatReset(limit.resetsAt, {format: resetFormat, clock});
    if (reset) {
        top.add_child(new St.Label({
            text: reset,
            style_class: 'ai-usage-limit-reset',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: DIM_OPACITY,
        }));
    }
    column.add_child(top);
    item.add_child(column);
    if (limit.percent === null)
        return item;

    // A box, not an St.Bin, so the figure ends where the bar does.
    const figure = new St.Label({
        text: formatPercent(limit.percent),
        style_class: `ai-usage-limit-figure ${SEVERITY_CLASS[limit.severity]}`,
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const percent = new St.BoxLayout({style_class: 'ai-usage-limit-percent'});
    percent.add_child(figure);
    top.add_child(percent);

    column.add_child(new BarLevel.BarLevel({
        value: limit.percent / 100,
        style_class: `ai-usage-bar ${SEVERITY_CLASS[limit.severity]}`,
        x_expand: true,
    }));
    return item;
}

function captionItem(text) {
    const item = inertItem('ai-usage-caption-row');
    const label = new St.Label({text, style_class: 'ai-usage-caption', x_expand: true, opacity: DIM_OPACITY});
    label.clutter_text.line_wrap = true;
    item.add_child(label);
    return item;
}

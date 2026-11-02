import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Severity, Status, describeModel, formatBreakdown, formatPercent, formatReset, formatTime} from './usage.js';

// Secondary text is dimmed with actor opacity, so it suits light and dark menus.
const DIM_OPACITY = 160;

function explain(reading, clock) {
    switch (reading.status) {
    case Status.SIGNED_OUT:
        return `Not signed in. Run ${reading.cli} and sign in there.`;
    case Status.EXPIRED: {
        const when = reading.expiredAt ? `expired at ${formatTime(reading.expiredAt, {clock})}` : 'has expired';
        return reading.renewable
            ? `The stored login ${when}. Refresh to have ${reading.cli} renew it.`
            : `The stored login ${when}. Run ${reading.cli} once and it will refresh itself.`;
    }
    case Status.UNSUPPORTED:
        return reading.message ?? 'This login has no subscription limits to show.';
    default:
        return reading.message
            ? `Usage could not be read: ${reading.message.replace(/\.$/, '')}.`
            : 'Usage could not be read just now.';
    }
}

function figureOf(reading, limit) {
    return reading?.ok ? reading.primary(limit) : null;
}

export const UsageIndicator = GObject.registerClass(
class UsageIndicator extends PanelMenu.Button {
    _init(refresh, select) {
        super._init(0.5, 'AI usage', false);

        // menu.box is the actor that gets `.popup-menu-content`, so the width goes there.
        this.menu.box.add_style_class_name('ai-usage-menu');

        // The shell's own box for an icon with a label in the top bar.
        this._box = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        this._icon = new St.Icon({style_class: 'system-status-icon', visible: false});
        this._iconPath = '';
        this._label = new St.Label({
            text: 'AI',
            style_class: 'ai-usage-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this.add_child(this._box);

        this._select = select;
        this._rows = [];
        this._selected = null;
        this._options = null;
        this._tabIds = '';

        this._tabs = new St.BoxLayout({style_class: 'ai-usage-tabs', x_expand: true});
        this._tabsItem = tabsItem(this._tabs, refresh);
        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._tabsItem);
        this.menu.addMenuItem(this._section);
    }

    // entries: [{id, name, reading}] per live provider; reading is null until it answers.
    // options: the object built in app.js's _redraw().
    setReadings(entries, options) {
        const rows = entries.map(entry => ({...entry, figure: figureOf(entry.reading, options.limit)}));
        this._rows = options.hideUnavailable ? rows.filter(row => row.reading?.ok) : rows;
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
        if (!row) {
            this.menu.close();
            return;
        }

        // No figure: amber when the fix is the user's (signing in again).
        const broken = row.reading?.status === Status.EXPIRED || row.reading?.status === Status.SIGNED_OUT;
        const severity = row.figure ? row.figure.severity : broken ? Severity.WARNING : Severity.NORMAL;
        // On the box, so a symbolic icon is tinted with the label.
        this._box.style_class = `panel-status-indicators-box ai-usage-${severity}`;

        const {buttonLabel, buttonIcon, showPercent} = this._options;
        const iconPath = buttonLabel === 'icon' ? buttonIcon : '';
        if (iconPath !== this._iconPath) {
            this._iconPath = iconPath;
            this._icon.gicon = iconPath ? new Gio.FileIcon({file: Gio.File.new_for_path(iconPath)}) : null;
        }
        this._icon.visible = !!iconPath;

        // "AI" stands in for a plan not known yet, an icon not chosen, or an empty button.
        const name = {plan: row.reading?.plan ?? 'AI', icon: iconPath ? null : 'AI'}[buttonLabel];
        const percent = row.figure && showPercent ? formatPercent(row.figure.percent) : null;
        const text = [name, percent].filter(Boolean).join(' ') || (iconPath ? '' : 'AI');
        this._label.text = text;
        this._label.visible = !!text;
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
            this._section.addMenuItem(captionItem(explain(reading, clock)));
            return;
        }
        if (reading.failed) {
            this._section.addMenuItem(captionItem(
                `Could not update: ${reading.failed}. These figures are from ${formatTime(reading.at, {clock})}.`));
        }

        // A local server has models rather than limits.
        if (!reading.limits.length) {
            this._addModels(reading.models, clock);
            return;
        }

        let group = null;
        for (const limit of reading.limits) {
            if (limit.group && limit.group !== group)
                this._section.addMenuItem(headingItem(limit.group));
            group = limit.group;
            this._section.addMenuItem(limitItem(limit, resetFormat, clock));
        }

        if (reading.credits)
            this._section.addMenuItem(limitItem(reading.credits, resetFormat, clock));

        const breakdown = formatBreakdown(reading.breakdown);
        if (breakdown)
            this._section.addMenuItem(captionItem(breakdown));
    }

    // What ran this session first, then the rest of what is installed, a line each.
    _addModels(models, clock) {
        if (!models.length) {
            this._section.addMenuItem(captionItem('No models are installed. Pull one with ollama pull.'));
            return;
        }

        const used = models.filter(model => model.memory || model.session);
        this._section.addMenuItem(headingItem('This session'));
        if (!used.length)
            this._section.addMenuItem(captionItem('No model has run yet this session.'));
        for (const model of used)
            this._section.addMenuItem(modelItem(describeModel(model, {clock}), model.name));

        const rest = models.filter(model => !used.includes(model));
        if (rest.length)
            this._section.addMenuItem(headingItem('Installed'));
        for (const model of rest)
            this._section.addMenuItem(installedItem(describeModel(model, {clock}), model.name));
    }
});

// The shell's icon-button, dimmed on the icon so the hover background stays full; lit on hover and focus.
function refreshButton(refresh) {
    const icon = new St.Icon({icon_name: 'view-refresh-symbolic', opacity: DIM_OPACITY});
    const button = new St.Button({
        style_class: 'icon-button flat',
        can_focus: true,
        accessible_name: 'Refresh now',
        y_align: Clutter.ActorAlign.CENTER,
        child: icon,
    });
    const light = () => {
        icon.opacity = button.hover || button.has_key_focus() ? 255 : DIM_OPACITY;
    };
    button.connect('notify::hover', light);
    button.connect('key-focus-in', light);
    button.connect('key-focus-out', light);
    button.connect('clicked', refresh);
    return button;
}

function inertItem(styleClass) {
    return new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: styleClass});
}

function tabsItem(tabs, refresh) {
    const item = inertItem('ai-usage-tabs-row');
    const row = new St.BoxLayout({style_class: 'ai-usage-tabs-box', x_expand: true});
    row.add_child(tabs);
    row.add_child(refreshButton(refresh));

    item.add_child(row);
    return item;
}

// Name, dimmed reset, percentage, bar underneath, as Claude Code's /usage. A row with no
// percentage has no figure and no bar: an empty bar would claim a 0% the service never said.
function limitItem(limit, resetFormat, clock) {
    const item = inertItem('ai-usage-limit');
    const column = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });

    const top = new St.BoxLayout({style_class: 'ai-usage-limit-row'});
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
            y_align: Clutter.ActorAlign.CENTER,
            opacity: DIM_OPACITY,
        }));
    }
    column.add_child(top);
    item.add_child(column);
    if (limit.percent === null)
        return item;

    // A box, not an St.Bin, which would centre the figure.
    const figure = new St.Label({
        text: formatPercent(limit.percent),
        style_class: `ai-usage-limit-figure ai-usage-${limit.severity}`,
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const percent = new St.BoxLayout({style_class: 'ai-usage-limit-percent'});
    percent.add_child(figure);
    top.add_child(percent);

    column.add_child(new BarLevel.BarLevel({
        value: limit.percent / 100,
        style_class: `ai-usage-bar ai-usage-${limit.severity}`,
    }));
    return item;
}

function rowLabel(text, styleClass, props = {}) {
    const label = new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...props});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

// Name and state, then what it holds in memory or what it is, then its session figures.
function modelItem({state, detail, usage}, name) {
    const item = inertItem('ai-usage-limit');
    const column = new St.BoxLayout({style_class: 'ai-usage-model', orientation: Clutter.Orientation.VERTICAL, x_expand: true});

    const top = new St.BoxLayout({style_class: 'ai-usage-limit-row'});
    top.add_child(rowLabel(name, 'ai-usage-limit-label', {x_expand: true}));
    if (state === 'In memory')
        top.add_child(rowLabel(state, 'ai-usage-limit-reset ai-usage-in-memory'));
    else if (state)
        top.add_child(rowLabel(state, 'ai-usage-limit-reset', {opacity: DIM_OPACITY}));
    column.add_child(top);

    for (const line of [detail, usage].filter(Boolean))
        column.add_child(rowLabel(line, 'ai-usage-caption', {opacity: DIM_OPACITY}));
    item.add_child(column);
    return item;
}

// One line: the name, and what the model is.
function installedItem({detail}, name) {
    const item = inertItem('ai-usage-installed');
    const row = new St.BoxLayout({style_class: 'ai-usage-limit-row', x_expand: true});
    row.add_child(rowLabel(name, 'ai-usage-installed-label', {x_expand: true}));
    if (detail)
        row.add_child(rowLabel(detail, 'ai-usage-caption', {opacity: DIM_OPACITY}));
    item.add_child(row);
    return item;
}

function headingItem(text) {
    const item = inertItem('ai-usage-heading-row');
    item.add_child(new St.Label({text, style_class: 'ai-usage-heading', x_expand: true, opacity: DIM_OPACITY}));
    return item;
}

function captionItem(text) {
    const item = inertItem('ai-usage-caption-row');
    const label = new St.Label({text, style_class: 'ai-usage-caption', x_expand: true, opacity: DIM_OPACITY});
    label.clutter_text.line_wrap = true;
    item.add_child(label);
    return item;
}

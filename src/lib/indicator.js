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
        this._refresh = refresh;
        this._rows = [];
        this._selected = null;
        this._options = null;
        this._tabIds = '';

        // The notification list's controls row, so the tabs are its round buttons.
        this._tabs = new St.BoxLayout({style_class: 'message-list-controls ai-usage-tabs', x_expand: true});
        this._tabs.layout_manager.homogeneous = true;
        this._tabsItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'ai-usage-tabs-row'});
        this._tabsItem.add_child(this._tabs);
        this._section = new PopupMenu.PopupMenuSection();
        this._section.box.add_style_class_name('ai-usage-cards');
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
        this._tabsItem.visible = !!options.tabs;
        this.menu.moveMenuItem(this._tabsItem, options.tabs === 'bottom' ? 1 : 0);
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
                const tab = new St.Button({
                    label: row.name,
                    style_class: 'button flat message-list-clear-button ai-usage-tab',
                    can_focus: true,
                    x_expand: true,
                });
                tab.connect('clicked', () => this._select(row.id));
                this._tabs.add_child(tab);
            }
        }

        this._tabs.get_children().forEach((tab, i) => {
            tab.checked = this._rows[i] === this._selected;
        });
    }

    // Refresh takes the first card's close button.
    _renderMenu() {
        this._renderTabs();
        this._section.removeAll();

        const {reading, name} = this._selected;
        // The button already names the plan when it shows one.
        const plan = this._options.buttonLabel === 'plan' ? null : reading?.plan;
        this._cards(reading, name).forEach(({title, window, children}, i) => {
            this._section.addMenuItem(cardItem(title, window ? plan : null, i ? null : this._refresh, children));
        });
    }

    // [{title, window, children}]: window marks a card of limits, which carries the plan.
    _cards(reading, name) {
        const {resetFormat, clock} = this._options;
        if (!reading)
            return [{title: name, children: [captionLabel('Reading usage…')]}];
        if (!reading.ok)
            return [{title: name, children: [captionLabel(explain(reading, clock), false)]}];

        const cards = [];
        if (reading.failed) {
            cards.push({title: 'Not updated', children: [captionLabel(
                `Could not update: ${reading.failed}. These figures are from ${formatTime(reading.at, {clock})}.`, false)]});
        }

        // A local server has models rather than limits.
        if (!reading.limits.length)
            return cards.concat(modelCards(reading.models, clock));

        // A card per window, in the order each first appears.
        const windows = Map.groupBy(reading.limits, limit => limit.group ?? limit.id);
        for (const limits of windows.values()) {
            cards.push({
                title: limits[0].group,
                window: true,
                children: limits.map(limit => limitRow(limit, resetFormat, clock)),
            });
        }
        if (reading.credits)
            cards.push({title: null, children: [limitRow(reading.credits, resetFormat, clock)]});

        // The breakdown is of the week, so it goes under the weekly limits.
        const breakdown = formatBreakdown(reading.breakdown);
        if (breakdown)
            (cards.find(card => card.title === 'Weekly') ?? cards.at(-1)).children.push(captionLabel(breakdown));
        return cards;
    }
});

// What ran this session first, then the rest of what is installed, a line each.
function modelCards(models, clock) {
    if (!models.length)
        return [{title: 'Installed', children: [captionLabel('No models are installed. Pull one with ollama pull.')]}];

    const used = models.filter(model => model.memory || model.session);
    const rest = models.filter(model => !used.includes(model));
    const cards = [{
        title: 'This session',
        children: used.length
            ? used.map(model => modelRow(describeModel(model, {clock}), model.name))
            : [captionLabel('No model has run yet this session.')],
    }];
    if (rest.length)
        cards.push({title: 'Installed', children: rest.map(model => installedRow(describeModel(model, {clock}), model.name))});
    return cards;
}

// The shell's notification (ui/messageList.js's Message), rebuilt from the theme's own
// classes: the title, and the plan where its time goes, then the rows. Refresh, when
// given, is where its close button is. Sensitive, though nothing activates it: St makes
// an insensitive item :insensitive, which outranks the plain .message look.
function cardItem(title, plan, refresh, children) {
    const item = new PopupMenu.PopupBaseMenuItem({
        activate: false,
        hover: false,
        can_focus: false,
        style_class: 'message ai-usage-card',
    });
    const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});

    if (title || refresh) {
        const header = new St.BoxLayout({style_class: 'message-header', x_expand: true});
        const headerContent = new St.BoxLayout({
            style_class: 'message-header-content',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        if (title)
            headerContent.add_child(new St.Label({text: title, style_class: 'message-source-title', y_align: Clutter.ActorAlign.END}));
        if (plan) {
            headerContent.add_child(new St.Label({
                text: plan,
                style_class: 'event-time',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.END,
            }));
        }
        header.add_child(headerContent);

        if (refresh) {
            const button = new St.Button({
                style_class: 'message-close-button',
                icon_name: 'view-refresh-symbolic',
                accessible_name: 'Refresh now',
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            button.connect('clicked', refresh);
            header.add_child(button);
        }
        column.add_child(header);
    }

    const box = new St.BoxLayout({style_class: 'message-box', x_expand: true});
    const content = new St.BoxLayout({
        style_class: 'message-content ai-usage-card-content',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    children.forEach(child => content.add_child(child));
    box.add_child(content);
    column.add_child(box);

    item.add_child(column);
    return item;
}

// Name, dimmed reset, percentage, bar underneath, as Claude Code's /usage. A row with no
// percentage has no figure and no bar: an empty bar would claim a 0% the service never said.
function limitRow(limit, resetFormat, clock) {
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
    if (limit.percent === null)
        return column;

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
    return column;
}

function rowLabel(text, styleClass, props = {}) {
    const label = new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...props});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

// Name and state, then what it holds in memory or what it is, then its session figures.
function modelRow({state, detail, usage}, name) {
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
    return column;
}

// One line: the name, and what the model is.
function installedRow({detail}, name) {
    const row = new St.BoxLayout({style_class: 'ai-usage-limit-row', x_expand: true});
    row.add_child(rowLabel(name, 'ai-usage-installed-label', {x_expand: true}));
    if (detail)
        row.add_child(rowLabel(detail, 'ai-usage-caption', {opacity: DIM_OPACITY}));
    return row;
}

// dim: false for a card's whole message, which reads as a notification's body.
function captionLabel(text, dim = true) {
    const label = new St.Label({text, style_class: 'ai-usage-caption', x_expand: true, opacity: dim ? DIM_OPACITY : 255});
    label.clutter_text.line_wrap = true;
    return label;
}

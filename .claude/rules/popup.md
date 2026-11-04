---
paths:
  - "src/lib/indicator.js"
  - "src/stylesheet.css"
---

# The button and its pop-up

* The pop-up's rows copy Claude Code's `/usage`: name (the one expanding column),
  dimmed reset, percentage in a fixed `min-width` cell, bar underneath. A tab row
  (top or bottom, `moveMenuItem()` in `setReadings()`) holds the providers as the
  shell's `button flat`, whose `:checked` look marks the open one, at equal widths
  (the box's `homogeneous`) inside an outlined box with no fill, at the shell's own button corners. The line below it
  holds the selected plan, dimmed, and `Refresh` as a plain word at its right end,
  an `St.Button` with no button style class, so no background, dimmed and lit on
  hover/focus by `refreshButton()`. A click on a tab only writes
  `selected-provider`; everything redraws from the setting. The tabs are rebuilt
  only when the providers shown change, so a redraw does not take the keyboard
  focus off one.
* **The simple view is one notification** (`messageItem()`): the shell's `Message` from
  `ui/messageList.js` rebuilt from the theme's own classes (`message` > `message-header`
  with `message-header-content`, `message-source-title` and `event-time` > `message-box`
  > `message-content` with a `message-title` per window), so it is a notification in
  every theme. Refresh sits where the close button is, the same `message-close-button`
  with Adwaita's `view-refresh-symbolic`. The time is the shell's `formatTimeSpan()` of the
  reading, worded as the pop-up maps. The item is sensitive but inert (`activate: false`,
  `hover: false`): St makes an insensitive one `:insensitive`, and `.message:insensitive`
  outranks `.message`, darkening it. The pop-up (`ai-usage-simple`) loses its padding and
  border and takes the notification's 16px corners, so the message fills it. The tab row
  is hidden, and `_addReading()` puts each window in a titled box (`windowBox()`) instead
  of a card, without the kept-figures caption or the breakdown.
* The menu has a fixed `width`, wide enough for the longest label, so
  it does not move when another tab is chosen.
* **A card per window** (`cardItem()`): the limits sharing a `group` (`Session`,
  `Weekly`, `Monthly`, `Daily`, or an unknown window's own name), in the order
  each first appears, under the group as its title; a limit with no group, and
  the credits, get a card with no title. The card is the calendar's events card,
  the theme's own `events-button` > `events-box` > `events-title`, and is
  reactive, since St makes a non-reactive widget `:insensitive`, which the theme
  greys out. Its padding is the theme's at the top and 4px more on the other sides, the
  line height the title adds above its letters, so the content sits 17px in all round
  (measured in the nested shell). A row's label names only what it covers (`All models`, a model).
* The bars are the shell's `BarLevel`, drawn from `-barlevel-*` properties on
  `.ai-usage-bar` and its severity class. It reads `-barlevel-overdrive-color`
  too, so that is set though never drawn. A row whose `percent` is null (credits
  switched off, a balance) has no figure and no bar.
* **A reading with no limits draws its `models`** (`_addModels()`): a `This
  session` heading over the models in memory or used, each a limit row's padding
  with its state beside the name (`In memory` in `-st-accent-color`, or a dimmed
  `Used 12 min ago`) and up to two dimmed caption lines (`describeModel()` in
  `usage.js`), then an `Installed` heading over the rest at one line each with half
  the padding. No bar: nothing there is a share of a limit.
* Kept figures (`reading.failed`) get a caption above the limits saying why they
  were not updated and when they are from.
* The last pop-up row is marked `ai-usage-last` by `_renderMenu()`, for want of
  `:last-child`.
* Dimming is actor opacity (`DIM_OPACITY`).
* **Its exception to the kit's colour rule**: the bar track's mid grey (also the
  tab box's outline) and GNOME's own warning/critical palette (Yellow 5 `#e5a50a`, Red 4 `#e01b24`) are
  the only flat colours, since St names no warning colour. A normal bar is
  `-st-accent-color`. No foreground colour is hardcoded.
* Paddings are px measured from the shell's own theme (`.popup-menu-item`,
  `.quick-settings`), each with its reason beside it.

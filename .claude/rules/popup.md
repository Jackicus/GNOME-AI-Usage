---
paths:
  - "src/lib/indicator.js"
  - "src/stylesheet.css"
---

# The button and its pop-up

* The pop-up holds only the tab row and the cards. The rows copy Claude Code's `/usage`:
  name (the one expanding column), dimmed reset, percentage in a fixed `min-width`
  cell, bar underneath.
* **The tabs are the notification list's controls** (`message-list-controls` round a
  `button flat message-list-clear-button` per provider), so they are its round buttons
  with no box of their own, `:checked` marking the open one, at equal widths (the box's
  `homogeneous`). At the top or bottom (`moveMenuItem()` in `setReadings()`), and
  hidden while the provider is chosen in the preferences. A click on a tab only writes
  `selected-provider`; everything redraws from the setting. The tabs are rebuilt only
  when the providers shown change, so a redraw does not take the keyboard focus off one.
* **A card per window is a notification** (`cardItem()`): the shell's `Message` from
  `ui/messageList.js` rebuilt from the theme's own classes (`message` > `message-header`
  with `message-header-content`, `message-source-title` and `event-time` > `message-box`
  > `message-content`), so it is a notification in every theme. The window (`Session`,
  `Weekly`, `Monthly`, `Daily`, or an unknown window's own name) is the source title and
  the plan sits where the time goes, left out while `button-label` is `plan`. The limits
  sharing a `group` share a card, in the order each first appears; a limit with no
  group, and the credits, get a card with no header. Refresh is the first card's close
  button, the same `message-close-button` with Adwaita's `view-refresh-symbolic`. A
  state with no limits (reading, signed out, expired) is one card under the provider's
  name, kept figures a `Not updated` card first, the breakdown a caption in the
  `Weekly` card, and Ollama's lists a `This session` and an `Installed` card. The item
  is sensitive but inert (`activate: false`, `hover: false`): St makes an insensitive
  one `:insensitive`, and `.message:insensitive` outranks `.message`, darkening it.
* **The cards sit 12px apart and 12px from the pop-up's edge**, the notification list's
  spacing, and the pop-up's corners are the message's 16px plus that gap, 28px, so they
  run concentric. The header-less card drops the theme's 12px above a message body that
  comes first, so it is as far in at the top as at the sides.
* The menu has a fixed `width`, wide enough for the longest label, so
  it does not move when another tab is chosen.
* The bars are the shell's `BarLevel`, drawn from `-barlevel-*` properties on
  `.ai-usage-bar` and its severity class. It reads `-barlevel-overdrive-color`
  too, so that is set though never drawn. A row whose `percent` is null (credits
  switched off, a balance) has no figure and no bar.
* **A reading with no limits draws its `models`** (`modelCards()`): the models in memory
  or used, each with its state beside the name (`In memory` in `-st-accent-color`, or a
  dimmed `Used 12 min ago`) and up to two dimmed caption lines (`describeModel()` in
  `usage.js`), then the rest at one line each. No bar: nothing there is a share of a
  limit.
* Dimming is actor opacity (`DIM_OPACITY`).
* **Its exception to the kit's colour rule**: the bar track's mid grey and
  GNOME's own warning/critical palette (Yellow 5 `#e5a50a`, Red 4 `#e01b24`) are
  the only flat colours, since St names no warning colour. A normal bar is
  `-st-accent-color`. No foreground colour is hardcoded.
* Paddings are px measured from the shell's own theme (`.popup-menu-item`,
  `.quick-settings`), each with its reason beside it.

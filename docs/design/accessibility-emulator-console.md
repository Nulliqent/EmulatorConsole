## Accessibility Audit — Per WCAG Principle

Severity: Critical blocks a task for someone using assistive technology; High makes the task very difficult but possible; Medium fails a WCAG criterion without blocking access; Low meets WCAG and falls short of inclusive design.

### Perceivable

**Critical. Pages stop at 640 px, so at 400% zoom content scrolls sideways and people using magnification lose their place.** Fails 1.4.10 Reflow. Below 640 CSS px the layout is one column down to 320 px: the sidebar becomes a menu button, panes stack in reading order, and only tables and code blocks scroll sideways inside their own box (state A10). Test: at 1280 px window width and 400% zoom, every task in the journeys completes with no page-level horizontal scroll.

**High. Verdict, Added and Removed read as words in a badge whose shape could be taken as decoration.** Fails nothing yet; the high-fidelity pass could make color carry them. Each keeps its word, and any color added also has a distinct glyph: Emulator Gap a filled square, Request Rejected an open circle, Unclear a question mark. Test: in grayscale, a reviewer sorts ten failed Calls by Verdict without reading the text, using glyphs alone.

**Medium. Code blocks for requests and responses scroll sideways at narrow widths and cannot be reached to scroll by keyboard.** Fails 2.1.1 with 1.4.10's exception. Each code block is focusable (`tabindex="0"`), named "Request body" or "Response body", and wraps lines by default with a "Don't wrap" switch. Test: tab to a response body and scroll it with arrow keys.

Keep: every Verdict, change and status is written as text beside any mark; contrast at least 4.5:1 for text and 3:1 for control borders and focus rings, in light, dark and increased contrast.

### Operable

**Critical. Table rows open a detail on click but are not keyboard targets.** Fails 2.1.1. The first cell of each row is a link or button named by the row (the Call's operation and time, the resource's name); rows are not focus stops themselves. Arrow keys move between rows in a list pane with roving tabindex, and Enter opens. Test: with keyboard only, open the third failed Call and return to the list at the same row.

**High. Pane dividers resize only by dragging.** Fails 2.5.7 Dragging Movements and 2.1.1. Each divider is a `separator` with `aria-valuenow`, moved 16 px by Left and Right arrows, 64 px with Shift, and reset by Enter. A "Reset panes" item sits in the View menu. Test: resize the list pane to its minimum and back by keyboard.

**High. Find has no keyboard shortcut and no visible hint.** Fails nothing; it slows every task. Command-K on macOS and Control-K elsewhere open Find, shown in the field as a hint. No single-key shortcut exists. Test: from any page, the shortcut puts focus in Find.

**Medium. The sticky top bar can cover a focused row when tabbing backwards.** Fails 2.4.11 Focus Not Obscured. Every scroll container sets `scroll-padding-top` to the top bar's height. Test: Shift-Tab through a long Calls list; each focused row is fully visible.

**Medium. No way to skip the sidebar.** Fails 2.4.1. A "Skip to content" link is the first focus stop on every page, shown on focus. Test: first Tab shows it; Enter moves focus to the page heading.

Keep: controls are at least 28 px tall and 24 px wide; Escape closes Find and every dialog; no content moves, flashes or times out.

### Understandable

**Medium. "Send" on a form with input that breaks the model gives no warning that the request will be refused.** Fails 3.3.1 only in spirit, since sending is allowed. The field error says "You can still send it." and Send's accessible description lists the fields with errors. Test: a screen reader announces "Send, 1 field doesn't match the model" on focus.

**Low. Pages for 436 services may use different labels for the same idea.** Generated labels come from operation names. The rules in the copy document apply to every generated string, so "Read more", "Refresh" and "Send" never vary. Test: a script compares button labels across ten generated services.

Keep: navigation, Find and Set a Marker sit in the same place on every page; the field that failed is named in every error message; Open in operation form carries the Call's input over.

### Robust

**High. Landmarks are not stated.** Fails 1.3.1 and 4.1.2 if built from divs. Top bar `header`; sidebar `nav` named "Main"; page `main`; the right-hand pane `aside` named by its content ("Call detail"). Each page has one `h1`, the page title; panes start at `h2`. Test: a screen reader's landmark list shows four entries on the Calls page.

**High. Icon-only controls at 640 px have no stated names.** Fails 4.1.2. The collapsed sidebar's buttons are named by their place ("Calls"), the clear button "Clear filter", and Hide sidebar by its action. Names match the visible tooltip. Test: every control on the 640 px wireframes is announced with a name.

Keep: native `button`, `a`, `input`, `select`, `table` and `dialog` throughout; state shown with `aria-current`, `aria-pressed`, `aria-expanded` and `aria-selected`.

## Screen Reader Flow Documentation

The reading order matches the visual order on every screen. In three-pane Calls, the order is list, detail, then request and response.

| Change | Announced | Politeness |
|---|---|---|
| New Calls arrive | "3 new Calls" at most every 5 s, only while Calls is open | polite |
| A new failed Call arrives | "Failed Call: Invoke, 404" | polite |
| The Emulator stops answering | "The Emulator isn't answering." | assertive |
| The Emulator answers again | "The Emulator is answering again." | polite |
| The Emulator restarted | "The Emulator restarted. Its resources were lost." | assertive |
| A list finishes reading | "State machines read: 3." | polite |
| A read fails | The error title | assertive |
| A response arrives in the operation form | "400 InvalidArn. Request Rejected." | polite |
| A Marker finishes comparing | "Since 14:02: 3 added, 1 removed." | polite |
| Copy succeeds | "Copied" | polite |
| Filter changes results | "12 Calls" after typing stops for 500 ms | polite |

## Keyboard Navigation Map

| Moment | Focus goes to | Focus returns to |
|---|---|---|
| Page load | The page's `h1`, after the skip link | |
| Find opens | Find's input | The control that opened it |
| A result in Find is chosen | The opened page's `h1` | |
| A Call or resource opens in the detail pane | The detail's heading | The row's link, on Escape |
| A Call opens at 640 px (detail replaces list) | The detail's heading | The same row's link, on Back |
| Confirm dialog opens | Cancel | The control that opened it |
| Delete succeeds | The list, on the row after the deleted one, or the list heading if none remain | |
| Send | Stays on Send; the response is announced | |
| Send returns a field error | The first field with an error | |
| Restart notice appears | Unchanged | |
| Restart notice is dismissed | The page's `h1` | |
| Menu is open (below 640 px) and Escape is pressed | The Menu button | |
| Set a Marker completes | Unchanged; the result is announced | |
| Sidebar hidden | The Show sidebar button | |

## Open Questions

- Should the Console offer a denser table mode, which would cut row height below 28 px for sighted mouse users?

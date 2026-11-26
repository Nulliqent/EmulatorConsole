# Applying the Human Interface Guidelines

Apple's Human Interface Guidelines are the standard for interaction, layout, writing and accessibility: https://developer.apple.com/design/human-interface-guidelines. The Console is a web app on macOS, Linux and Windows, so macOS guidance applies where a browser can honor it.

## Rules

| Area | Rule | Guideline page |
|---|---|---|
| Destructive actions | The destructive button is never the primary or default one. Cancel is present, titled Cancel, and not the default. Escape cancels. | Buttons, Alerts |
| Alerts | Only for destructive actions that cannot be undone. Never at startup, and never for information alone: connection and restart notices sit in the page. | Alerts, Feedback |
| Alert titles | Say what will happen to what. No "Error", no "OK" to confirm. | Alerts |
| Navigation | Sidebar of at most two levels; people can hide and show it; it collapses in a narrow window. Nothing essential sits at its bottom. | Sidebars |
| Panes | The selection stays highlighted in every pane that leads to the detail. Dividers are thin, resizable, and have minimum and maximum sizes. A hidden pane has more than one way back. | Split views |
| Choices in a row | Five to seven at most, named with nouns. More become a filterable list. Tabs: six at most. | Segmented controls, Tab views |
| Tables | Text first. Columns sort by their heading and can be resized. Long names lose their middle, not their end. | Lists and tables |
| Search | One place, Find, searches everything. It starts on typing and has a Clear button. Filters inside a page act on that page only. | Searching, Search fields |
| Entering data | Prefill what is known, offer choices where the model lists them, accept paste, validate on leaving a field. Say the fix beside the field. | Entering data, Writing |
| Optional fields | Hidden behind a labelled disclosure; required ones always visible. | Disclosure controls |
| Loading | Show the page at once with placeholders and let people go elsewhere. Use an indicator after a moment or two. | Loading |
| Settings | Few, with good defaults. Appearance, contrast and motion come from the system and are not repeated. | Settings |
| Keyboard | Standard shortcuts are never reused. | Keyboards |
| Color | One meaning per color. Never the only signal. Checked in light, dark and increased contrast. | Color, Accessibility |
| Control size | 28 px by default, 24 px at least: 20 pt is the macOS minimum and WCAG 2.2 asks for 24. | Accessibility |
| Type | 13 px by default, 11 px at least. No light weights. Text can grow without being cut. | Typography, Accessibility |
| Words | Direct, neutral, no blame. Empty pages give a next step. "Your" only where it is needed. | Writing |

## Where the Console differs

- **Typeface and icons.** The system font stack, so a Mac shows its own typeface and no Apple font is shipped. Icons are the Console's own or openly licensed; SF Symbols are not shipped.
- **Liquid Glass.** Used only for the floating controls and navigation: sidebar, toolbar and filter bar, in the frosted regular variant, never the clear one. Content stays solid. At rest no glass element overlaps another control or content; content passes under it only when scrolled, and a focused or selected item is never left under it. With Reduce Transparency, or where the browser lacks backdrop blur, it is solid. The Console keeps its own name, colors and Verdict marks.
- **Invalid input.** An operation form marks input that breaks the model and still sends it, since the Emulator's refusal is sometimes what is being tested.
- **Capitalization.** Sentence case throughout. API names keep their exact spelling.
- **Accessibility.** Where the two disagree, WCAG 2.2 AA is the floor.

---
name: Emulator Console
description: A local console for the AWS Emulator, where every call is a flight strip in a bay.
colors:
  bay-steel: "#d9dee2"
  strip-white: "#ffffff"
  surface: "#ffffff"
  sunk: "#eef1f3"
  rule: "#9aa5ad"
  hairline: "#d6dbdf"
  ink: "#15191c"
  ink-secondary: "#4d565d"
  glass-fill: "rgba(244, 246, 248, 0.66)"
  glass-edge: "rgba(255, 255, 255, 0.75)"
  holder-amber: "#e39b17"
  on-amber: "#15191c"
  holder-violet: "#6a4fb3"
  on-violet: "#ffffff"
  holder-slate: "#5c646b"
  on-slate: "#ffffff"
  holder-ok: "#ffffff"
  on-ok: "#15191c"
  alert-red: "#b8321e"
  link-blue: "#1f56c9"
  focus-blue: "#1f56c9"
  ink-capsule: "#15191c"
  on-capsule: "#ffffff"
  selection-wash: "rgba(31, 86, 201, 0.10)"
typography:
  error-display:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: "34px"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "28px"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: "20px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
    fontFeature: "\"tnum\""
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "18px"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "16px"
  holder-mark:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 800
    letterSpacing: "0.02em"
  mono-body:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  mono-small:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
rounded:
  tag: "4px"
  strip: "6px"
  control: "8px"
  item: "10px"
  notice: "12px"
  pane: "14px"
  dialog: "16px"
  sidebar: "18px"
  capsule: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  pull: "12px"
  sidebar: "220px"
  rail: "64px"
components:
  button-primary:
    backgroundColor: "{colors.ink-capsule}"
    textColor: "{colors.on-capsule}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.alert-red}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 12px"
  capsule-glass:
    backgroundColor: "{colors.glass-fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.capsule}"
    height: "40px"
    padding: "8px 14px"
  capsule-primary:
    backgroundColor: "{colors.ink-capsule}"
    textColor: "{colors.on-capsule}"
    rounded: "{rounded.capsule}"
    height: "40px"
    padding: "8px 14px"
  chip:
    textColor: "{colors.ink}"
    rounded: "{rounded.capsule}"
    height: "32px"
    padding: "0 12px"
  chip-selected:
    backgroundColor: "{colors.ink-capsule}"
    textColor: "{colors.on-capsule}"
    rounded: "{rounded.capsule}"
    height: "32px"
    padding: "0 12px"
  segmented:
    backgroundColor: "{colors.sunk}"
    rounded: "{rounded.capsule}"
    padding: "3px"
  segmented-selected:
    backgroundColor: "{colors.ink-capsule}"
    textColor: "{colors.on-capsule}"
    rounded: "{rounded.capsule}"
    height: "30px"
    padding: "0 14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  strip:
    backgroundColor: "{colors.strip-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.strip}"
    height: "54px"
  holder-rejected:
    backgroundColor: "{colors.holder-amber}"
    textColor: "{colors.on-amber}"
    typography: "{typography.holder-mark}"
    width: "44px"
  holder-gap:
    backgroundColor: "{colors.holder-violet}"
    textColor: "{colors.on-violet}"
    typography: "{typography.holder-mark}"
    width: "44px"
  holder-unclear:
    backgroundColor: "{colors.holder-slate}"
    textColor: "{colors.on-slate}"
    typography: "{typography.holder-mark}"
    width: "44px"
  holder-ok:
    backgroundColor: "{colors.holder-ok}"
    textColor: "{colors.on-ok}"
    width: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pane}"
    padding: "18px 20px"
  nav-item-current:
    backgroundColor: "{colors.ink-capsule}"
    textColor: "{colors.on-capsule}"
    rounded: "{rounded.item}"
    height: "36px"
    padding: "0 10px"
---

# Design System: Emulator Console

## Overview

**Creative North Star: "Flight Strips"**

Every Call the Emulator receives is a printed flight progress strip racked in a bay. The bay is steel grey; the strips are white, hairline-ruled into fields (time, operation, outcome, duration). At the head of each strip sits a solid square holder block that names the call's Verdict before a word is read: amber R for Request Rejected, violet G for Emulator Gap, slate ? for Unclear, neutral OK for a success. The strip being worked is pulled out of the rack, 12 px to the right, with a heavier ink edge and a lifted shadow. A dashed Marker strip sits in the rack where the Developer set a Marker, so later Calls stack above it.

The interface is dense, quiet and operational: 13 px system sans with tabular figures, monospace reserved for the things a Developer would copy (API names, times, IDs, bodies). Colour is spent almost entirely on holders; everything else is ink on white or steel. Floating controls and navigation are frosted Liquid Glass over the bay, following Apple's Human Interface Guidelines for behaviour (see docs/design/hig-application.md) while the product keeps its own name, palette and type. Content panes are always solid. The primary action and any selection are a solid ink capsule, inverted to pale ink in dark mode.

Light and dark follow the system setting, with a `data-theme="light"` or `data-theme="dark"` override on the root.

**Key Characteristics:**
- Calls are strips in a bay, not rows in a table with status pills.
- The Verdict lives in a solid square holder block at the strip's head; colour is always paired with a letter.
- Glass for floating controls and navigation only; content is solid.
- Ink capsule for primary action and selection, in every control family.
- Sans for interface, mono only for API names, times, IDs and bodies.

## Colors

A steel-and-ink neutral world where the only saturated colour is the Verdict holder.

### Primary
- **Ink Capsule** (`ink-capsule`): the solid fill of the primary action, the current nav item, the current tab, pressed chips and the selected segment. Pale ink in dark mode, with dark text.

### Secondary
- **Holder Amber** (`holder-amber`): Request Rejected. The emulator refused the request with an error the service defines.
- **Holder Violet** (`holder-violet`): Emulator Gap. The emulator lacks the operation or behaviour.
- **Holder Slate** (`holder-slate`): Unclear. The Console cannot classify the failure.
- **Holder OK** (`holder-ok`): success; a plain strip-coloured block carrying "OK".

### Tertiary
- **Alert Red** (`alert-red`): destructive button text, invalid-field borders, alert notices, a down connection dot. Never a fill.
- **Link Blue** (`link-blue`) and **Focus Blue** (`focus-blue`): inline links, caret, and the 2 px focus outline.
- **Selection Wash** (`selection-wash`): hover on nav and list items, the selected table row.

### Neutral
- **Bay Steel** (`bay-steel`): the page ground; the rack the strips sit in.
- **Strip White** (`strip-white`) and **Surface** (`surface`): strips, panels, detail and evidence panes, dialogs, inputs.
- **Sunk** (`sunk`): code blocks, the segmented-control track, the waiting holder, and the solid fallback for glass.
- **Rule** (`rule`): strip and panel borders, control borders, dividers. **Hairline** (`hairline`): field rules inside a strip, table row rules.
- **Ink** (`ink`) and **Ink Secondary** (`ink-secondary`): primary and supporting text.
- **Glass Fill** (`glass-fill`) and **Glass Edge** (`glass-edge`): the frosted control material and its rim highlight.

### Named Rules
**The Holder Carries the Colour Rule.** Saturated hue is reserved for Verdict holders. Panels, buttons and backgrounds stay neutral, so a glance down the bay reads only the Verdicts.

**The Letter With the Colour Rule.** Every holder prints its letter (R, G, ?, OK). Colour never carries the Verdict alone.

## Typography

**Interface Font:** system sans (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial)
**Mono Font:** system mono (ui-monospace, SF Mono, Menlo, Consolas)

**Character:** The platform's own faces, set small and tight with tabular figures, so the console reads like a native developer tool rather than a branded site.

### Hierarchy
- **Error Display** (800, 28/34 px; 22/28 px for a success and below 640 px): the error code at the top of the call detail. The largest text in the product.
- **Headline** (700, 22/28 px): page titles.
- **Title** (700, 15/20 px; 17/24 px in dialogs): panel and dialog headings.
- **Body** (400, 13/20 px, tabular figures): all interface text.
- **Label** (600, 12/18 px): table headers, evidence headings, meta lines, hints.
- **Caption** (400, 11/16 px): the secondary line inside a strip field.
- **Holder Mark** (800, 15 px, 0.02em): the Verdict letter; OK and the waiting mark drop to 12 px.
- **Mono Body / Mono Small** (13/20 px, 12/18 px): error messages, operation names (600 in strips), times, durations, IDs, field names in forms, key-value values, request and response bodies.

### Named Rules
**The Copyable Is Mono Rule.** Monospace marks what a Developer would copy into code: API and operation names, times, IDs, ARNs, bodies, member names. Prose, labels and buttons are never mono.

## Layout

An inset app shell on the bay: a 220 px glass sidebar and a content column, separated and padded by a 12 px gap. The column stacks the glass toolbar row, an optional notice, and the scrolling main area. Spacing steps are 4, 8, 12, 16 and 24 px; stacked page sections are 16 px apart and detail-pane blocks 14 px apart.

The Calls page is a resizable split: the bay of strips, a 10 px draggable divider, the detail pane, and at the widest size the request/response pane. The strips column keeps 12 px of right padding so the selected strip has room to be pulled.

- **1700 px and up:** three panes (strip list about 34%, detail, request/response).
- **1100–1699 px:** list (about 48%) and detail; the request and response move inline into the detail pane.
- **640–1099 px:** one pane at a time with a Back control; the sidebar collapses to a 64 px icon rail.
- **Below 640 px:** one column down to 320 px. The sidebar becomes a top bar with a Menu button; strips drop the time and duration fields; key-value lists stack.

## Elevation & Depth

Depth is mostly tonal: solid white panes on a steel ground, separated by 1 px rules. Three things lift. Glass controls float on a soft shade with an inset rim highlight. The pulled strip lifts on a short shadow. Dialogs sit on the deepest shadow over a dimmed backdrop.

### Shadow Vocabulary
- **Glass Shade** (`box-shadow: inset 0 1px 0 var(--glass-edge), 0 10px 30px rgba(20, 30, 40, 0.14)`; 0.45 black in dark): every glass element.
- **Pulled Strip** (`box-shadow: 0 6px 16px rgba(0, 0, 0, .18)`): only the selected strip.
- **Dialog** (`box-shadow: 0 24px 60px rgba(0, 0, 0, .3)`, backdrop `rgba(10, 14, 18, .45)`): modal dialogs.

### Named Rules
**The Glass Is for Controls Rule.** Liquid Glass (blur 22 px, saturate 180%) is used only on floating controls and navigation: the sidebar, the toolbar capsules, the sticky Calls filter bar and page-level navigation tabs. It is never used on content. At rest no glass element overlaps another control or content; content passes under glass only when scrolled, and the selection is never left under it (the bay keeps a 64 px scroll padding under the filter bar).

**The Solid Fallback Rule.** Glass falls back to solid `sunk` with no blur under `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, or when the browser lacks backdrop-filter.

## Shapes

Small radii for things that hold data, full capsules for things you press to choose. Strips and tags are near-square (6 px, 4 px) because they are printed slips; buttons and inputs are 8 px; panes are 14 px; the sidebar is 18 px; toolbar capsules, chips, tabs and segmented controls are fully round. The holder block is unrounded: a square end clipped by the strip's own corner. The Marker strip uses a dashed 1 px ink-secondary border, the only dashed line in the system.

## Components

### Buttons
Flat, bordered and firm.
- **Shape:** gently rounded (8 px), 32 px tall, 600 weight.
- **Primary:** solid ink capsule fill with inverted text. One per action group.
- **Default:** surface fill, 1 px rule border; the border darkens to ink-secondary on hover; pressed fills sunk.
- **Danger:** default button with alert-red text. Destructive actions are never primary and always confirm in a dialog whose Cancel takes focus.
- **Ghost:** no border or fill; used for the Menu button and row-level deletes.
- **Disabled:** 45% opacity, not-allowed cursor.

### Toolbar Capsules
40 px glass pills in the toolbar: Find (with its ⌘K hint), Region select, connection status (a dot that turns alert-red when down), and the primary ink "Set a Marker" capsule.

### Chips and Segmented Control
- **Chips:** 32 px capsules inside a filter bar, transparent at rest; pressed fills the ink capsule. A count follows at 70% opacity.
- **Segmented control:** the solid in-content toggle (sunk track, hairline border, 3 px inset, 30 px segments); the selected segment is the ink capsule. Use it, not glass, for toggles inside content.

### Inputs / Fields
- **Style:** surface fill, 1 px rule border, 8 px radius, 8×10 px padding; filter inputs are capsules. Field labels are mono 12 px 600 because they name API members.
- **Focus:** the global 2 px focus-blue outline at 2 px offset.
- **Error:** alert-red border with a 12 px 600 alert-red message below; hints are 12 px ink-secondary.

### Panels and Panes
Surface fill, 1 px rule border, 14 px radius. Panels pad 18×20 px; detail and evidence panes pad 20×24 px. Code blocks are mono 12/18 on sunk with a hairline border and 8 px radius.

### Navigation
- **Sidebar:** glass, 18 px radius. Items are 36 px rows with an 18 px line icon, 10 px radius, selection-wash hover, and the ink capsule for the current page.
- **Tabs:** a glass capsule track holding 32 px capsule links; the current tab is the ink capsule.
- **Mobile:** icon rail at 640–1099 px; a top bar with Menu below 640 px.

### Flight Strip (signature)
A grid of holder (44 px), time (74 px), operation, outcome and duration (60 px), at least 54 px tall, white with a 1 px rule border and 6 px radius. Fields are divided by hairlines; the holder is divided by a full rule. Operation names are mono 600; times and durations mono 12 px; secondary lines are 11 px ink-secondary with ellipsis. Hover darkens the border. The selected strip translates 12 px right, takes a 2 px ink border and the pulled-strip shadow over 160 ms `cubic-bezier(.2, .8, .2, 1)`; the motion is removed under reduced motion. Strips stack 4 px apart.

### Holder
A solid square block filling the strip's head, centred letter in Holder Mark type: amber R, violet G, slate ?, neutral OK, and a sunk block with "…" for a Call still waiting. The same holder heads the Verdict strip in the call detail, beside the Verdict name and its reason.

### Marker Strip
A transparent strip with a dashed ink-secondary border and 6 px radius, carrying a small ink-capsule "Marker" tag, the time, and a 12 px 600 note. It marks the Developer's Marker's place in the bay.

## Do's and Don'ts

### Do:
- **Do** show every Call as a strip with its holder block at the head, letter always printed.
- **Do** pull the selected strip 12 px right with a 2 px ink border and the pulled-strip shadow, and keep it in view, never under the filter bar.
- **Do** use the solid ink capsule for the primary action and every selection (nav item, tab, chip, segment, list pick), inverted in dark mode.
- **Do** keep glass on floating controls and navigation only, and fall back to solid sunk for reduced transparency, increased contrast or no backdrop-filter.
- **Do** use the solid segmented control for toggles inside content.
- **Do** set API names, times, IDs and bodies in system mono, and everything else in system sans with tabular figures.
- **Do** follow the system light/dark setting and honour a `data-theme` override.

### Don't:
- **Don't** render Calls as a grey table with coloured status pills.
- **Don't** put glass on content panes, strips, cards or dialogs, or let a glass element overlap another control at rest.
- **Don't** make a destructive action the primary button; it stays a red-text default button behind a confirming dialog.
- **Don't** spend saturated colour outside the Verdict holders; alert red is text and borders only.
- **Don't** let colour carry a Verdict without its letter.

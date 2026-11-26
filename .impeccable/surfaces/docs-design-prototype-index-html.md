---
version: 1
slug: "docs-design-prototype-index-html"
primary_target: "docs/design/prototype/index.html"
related_targets: []
---

# Emulator Console prototype

Scope: the high-fidelity, clickable design of the whole app shell and its core screens, for the third approval. Mode: Operate.
Audience and task: a Developer explaining a failed SDK call, reaching any of 436 services, sending an operation, and seeing what a run created. Content, states and strings come from docs/design/ (journeys, wireframes, states, copy).
Constraints: standard web controls; WCAG 2.2 AA; 640 px to 2,560 px designed, reflow to 320 px; light and dark from the system; glass only on floating controls, never overlapping a control.

## Direction contract

THESIS: Calls are flight progress strips in a bay: each request is one printed strip in a holder whose block names its Verdict, and the one being worked is pulled out of the rack. It refuses the category default of a grey table with coloured status pills.

OWN-WORLD: Steel-grey bay ground, white strips with hairline-ruled fields, and a solid square holder block at the head of each strip: amber with R for Request Rejected, violet with G for Emulator Gap, slate with ? for Unclear, white with OK. Type is the system sans for interface and the system monospace for API names, times and bodies. Floating controls (sidebar, toolbar pills, filter bar) are frosted glass over the bay; the primary action and selection are solid ink capsules.

STORY: The Developer sees the failed strips first, pulls one out, reads the error and Verdict at large size, then the request and response, and leaves with either a fix or the knowledge that the Emulator lacks the operation.

FIRST VIEWPORT: Glass sidebar inset at left (five places). Glass toolbar row at top: Find capsule, Region, connection, ink Set a Marker. Below it, a glass filter bar over the bay. The bay of strips fills the left pane; the selected strip sits pulled 12 px right with a shadow. The detail pane at right on a solid surface: meta line, 28 px error, message, Verdict strip with its holder, actions, then request and response. At rest nothing glass overlaps a control or content.

FORM: Flight Strips, assigned position 6 of the second hand. seed:98a71a563efb4b0e

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

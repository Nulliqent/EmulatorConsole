# Emulator Console high-fidelity prototype

## Anti-Pattern Verdict
Clean. Nothing pushes the Developer toward an action, hides a choice, or claims more than the evidence supports. The one silent behaviour, recording when no tab is open, is a finding below.

## Priority Issues

### Major

**Empty bucket deletes every object without asking**
- **What happens:** On the S3 page, Empty bucket is styled as an ordinary secondary button and runs at once. Delete bucket, Delete object, Delete table, Purge queue and Delete function each open the confirm dialog first (`app.js`, `s3Res`).
- **Why it matters:** One click deletes every object in the bucket, which can't be undone. It is the largest deletion on the page and the only one without a check.
- **Breaks:** error prevention, and consistency and standards.
- **Change:** Treat Empty bucket as a Destructive Operation: give it the destructive style and the same confirm dialog, which names the bucket and the approximate object count.

**Find's highlighted result isn't announced**
- **What happens:** In Find, the arrow keys move a visual highlight across the results. The input doesn't point to the highlighted option, so a screen reader stays silent while it moves (`#findres`, the `.on` class).
- **Why it matters:** Find is the fastest way to reach any of the 436 services and their operations. A screen reader user can't hear which result Enter will open.
- **Breaks:** visibility of system status; WCAG 4.1.2 Name, Role, Value.
- **Change:** Build Find as a combobox whose input names the active option. Each option carries its service and its implementation label, and the result count is announced as the query changes.

**Nothing says the Gateway keeps recording when no Console tab is open**
- **What happens:** The Gateway page says what is recorded and where, but not when. The Gateway records whenever the Console process runs, with or without a tab open. This is still an open question in the state inventory.
- **Why it matters:** Request bodies, including DynamoDB items and SQS messages as sent, build up in memory without the Developer knowing. It also leaves unanswered whether a closed tab means recording has stopped.
- **Breaks:** visibility of system status.
- **Change:** Decide the behaviour. Then state it on the Gateway page beside "What is recorded", and show the recording state wherever the Gateway endpoint is shown.

### Minor

**A Call filter that matches nothing leaves a blank list**
- **What happens:** Typing in Filter Calls hides strips that don't match. When none match, the bay goes empty, without the "No Calls match" line the copy deck defines for state C1.
- **Why it matters:** An empty bay looks the same as an empty run, which works against the principle "Say what is missing".
- **Breaks:** help users recognize, diagnose and recover from errors.
- **Change:** Show the no-match line in the bay, with a Clear filter action beside it.

**Escape doesn't take you back from a Call to its strip**
- **What happens:** The keyboard map says Escape in the detail pane returns focus to the strip that opened it. The prototype has no Escape handling there.
- **Why it matters:** A keyboard user reading Calls one after another has to Tab back through the toolbar and filter bar after each one.
- **Breaks:** flexibility and efficiency of use; the keyboard navigation map.
- **Change:** Add Escape from the detail pane to the selected strip, as the map states.

**A strip announces its Verdict last**
- **What happens:** Each strip is read in DOM order: time, operation, service, status, error, duration, then the Verdict, which only screen readers get.
- **Why it matters:** A sighted Developer reads the Verdict letter first. A screen reader user hears six fields before learning whether the Call is theirs to fix.
- **Breaks:** consistency and standards, between visual order and reading order.
- **Change:** Give each strip an accessible name that begins with the Verdict, then the operation, status and time.

**A sent operation is announced twice**
- **What happens:** After Send, the response pane, a polite live region, is replaced with all its content, including the Sent operations table. A separate announcement also says "400 InvalidArn. Request Rejected."
- **Why it matters:** A screen reader user hears the result twice, with the table read out as well.
- **Breaks:** aesthetic and minimalist design, applied to speech.
- **Change:** Announce only the status, error and Verdict once. Leave the pane itself out of the live region.

**"Add an optional field" stays in the JSON view**
- **What happens:** On an operation form, the optional-field disclosure sits outside the Fields view, so it still shows after switching to JSON.
- **Why it matters:** In JSON the Developer adds fields by typing them. The disclosure suggests the form still controls the input.
- **Breaks:** consistency and standards.
- **Change:** Show the disclosure only in the Fields view.

**Below 1,700 px the request and response sit under the Verdict**
- **What happens:** On a Call, the solid evidence pane appears only at 1,700 px and wider. At narrower widths, including a common 1,440 px window, the request and response follow the message, Verdict and actions, often below the fold.
- **Why it matters:** The first principle is evidence before explanation. At the widths most Developers use, the explanation comes first and the evidence has to be scrolled to.
- **Breaks:** match with the brief's first principle; recognition rather than recall.
- **Change:** Keep the start of the response, its status line and error body, visible beside the Verdict without scrolling at 1,440 px. The full request and response can stay below.

**Set a Marker gives its reason only in a hover title**
- **What happens:** While the Emulator isn't answering, Set a Marker is disabled. Its reason is in a `title` attribute, which keyboard and touch users never see, and a disabled button can't take focus.
- **Why it matters:** The notice explains the outage, but not that Markers wait for it, so the dimmed button looks broken.
- **Breaks:** visibility of system status.
- **Change:** Put the reason in the outage notice, or keep the button focusable with a visible description.

### Cosmetic

**The Service column header uses a text arrow and does nothing**
- **What happens:** On Services, the "Service ▾" header is a button that uses a text character as its glyph and has no sort behaviour.
- **Why it matters:** It suggests sorting that isn't there. Text glyphs also render differently on each system.
- **Breaks:** consistency and standards.
- **Change:** Remove the control, or make it a real sort with a drawn icon and `aria-sort`.

## Positive Findings
- A failed Call is one click from the first screen: Current run lists the Failed Calls as strips.
- The Verdict copy states its limits: "The Console can't tell whether AWS would refuse it too."
- An Emulator Gap says plainly that changing the request won't help, which saves the Developer's time.
- Implementation labels name the version they describe, and say that the Emulator doesn't report its own.
- Lists are read on request, with "Read at" and Refresh, so the Console doesn't keep an idle Emulator awake.
- The confirm dialog follows the guidelines: Cancel takes focus, Delete isn't the default, and the dialog names exactly what will go.
- Receiving SQS messages warns that it changes the queue, before anyone clicks.
- Generated lists use the SDK's own field names, so the 400th service reads like the first.
- Light and dark text exceed 4.5:1, including the dark secondary grey.
- Liquid Glass stays on the sidebar, toolbar capsules, filter bar and tabs, and never covers content or another control.

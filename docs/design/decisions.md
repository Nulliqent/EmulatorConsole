# Decisions

## 2026-11-25 · The Console covers every service the Emulator offers
- Decided by: the designer
- Why: they want their own console with full coverage.
- Rejected: eight services plus a form (too narrow); debugging only; contributing to StackPort; using StackPort.
- Rests on: ADR 0005; research-existing-tools.md

## 2026-11-25 · The Console connects to the Emulator; the models describe it
- Decided by: the designer
- Why: the models cover what the Emulator has or mostly has, and only the Emulator can say what it has.
- Rejected: treating the models as the list of services.
- Rests on: ADR 0005

## 2026-11-25 · The Console starts from scratch
- Decided by: the designer, in answer to the question about "not implemented" labels
- Why: no existing design or code is carried over.
- Rejected: reusing an earlier design.
- Rests on: the designer's answer

## 2026-11-25 · "Not implemented" labels come from the Emulator's source, by version
- Decided by: the designer
- Why: a Developer sees a missing operation before sending it. A live response overrides the label.
- Rejected: starting empty and learning from responses, which shows a gap only after someone hits it.
- Rests on: 7,291 stub markers among 19,405 operation files at v1.0.509

## 2026-11-25 · Every operation can be sent; generated lists stay read-only
- Decided by: the designer
- Why: guessing which operation deletes a listed row is unsafe.
- Rejected: row actions on generated lists; inspection only.
- Rests on: ADR 0005

## 2026-11-25 · Services are found by name, not by subject
- Decided by: Claude, default
- Why: Developers know their services, and the models hold no subject groups. Search, recent use and A–Z need no hand-kept classification.
- Rejected: subject categories, which would be a guess for 436 services and need upkeep at each release.
- Rests on: sitemap-emulator-console.html

## 2026-11-25 · Services are identified by SDK ID
- Decided by: Claude, default
- Why: every model has one and none repeat.
- Rejected: titles (three are shared by two services each) and signing names (shared by up to ten).
- Rests on: 439 models in api-models-aws

## 2026-11-25 · The first page is Current run
- Decided by: Claude, default
- Why: it answers both reasons for opening the Console, a failure and what a run left behind, without reading 436 services.
- Rejected: opening on Calls (empty without the Gateway); opening on Services (a long list before any evidence).
- Rests on: context-emulator-console.md

## 2026-11-25 · Operations are "sent", never "run"
- Decided by: Claude, default
- Why: "run" already means the period between the Emulator's start and stop.
- Rejected: a Run button, as the glossary's Operation Runner suggests.
- Rests on: GLOSSARY.md

## 2026-11-25 · Artifacts for this project
- Decided by: the designer
- Why: design comes before code, with three approvals.
- Rejected: building from the brief alone.
- Rests on: context, brief and site map; then journeys, wireframes, states, accessibility and copy; then PRODUCT.md, DESIGN.md and the high-fidelity design; then evaluation and handoff

## 2026-11-25 · The brief and structure are approved
- Decided by: the designer
- Why: first of three approvals.
- Rejected: none.
- Rests on: brief-emulator-console.md; sitemap-emulator-console.html

## 2026-11-25 · A new Emulator Run is recognised by new keys
- Decided by: Claude, default
- Why: the health route answers only "ok", and keys are written for each run. Labels name the version they describe, since the running one cannot be read.
- Rejected: showing a version or start time, which the Emulator does not report.
- Rests on: aws-emulator vendor/server/src/lib.rs, HEALTH_PATH; spikes-2026-11-25.md

## 2026-11-25 · Find from any page, with services seen this run before A–Z
- Decided by: Claude, default
- Why: one serves a known name and the other serves browsing, and neither needs setting up.
- Rejected: services pinned in the sidebar (setup, and width from every page); subject groups (no published groups).
- Rests on: wireframes-emulator-console-thumbnails.html

## 2026-11-25 · A Call shows the error, then the Verdict, then the request and response
- Decided by: Claude, default
- Why: what was received comes before what is concluded. Rows also carry the Verdict, to sort many failures.
- Rejected: notes inside the response (easy to miss in a long body); the Verdict in rows alone (one word is taken as the whole answer).
- Rests on: wireframes-emulator-console-thumbnails.html; brief, principle 1

## 2026-11-25 · An operation's input is one thing in two views, fields and JSON
- Decided by: Claude, default
- Why: fields help with a new call, and JSON takes a paste from code.
- Rejected: fields alone (deep input becomes a long form); JSON alone (slow for a simple call).
- Rests on: wireframes-emulator-console-thumbnails.html

## 2026-11-25 · A Marker shows one list of added and removed resources by service
- Decided by: Claude, default
- Why: it answers what changed and has a place for removed resources.
- Rejected: marks on every list (nowhere for removed ones); along the Calls (only changes made through the Gateway).
- Rests on: wireframes-emulator-console-thumbnails.html

## 2026-11-25 · Input that breaks the model can still be sent
- Decided by: Claude, default
- Why: the Emulator's refusal is sometimes what is being tested.
- Rejected: blocking Send until the input is valid.
- Rests on: journey-emulator-console.html

## 2026-11-25 · The four wireframe mechanisms and the screen structure stand
- Decided by: the designer
- Why: agreed after review; the second approval waits for the serialization test.
- Rejected: the other vignettes on the idea board.
- Rests on: wireframes-emulator-console-thumbnails.html; wireframes-emulator-console.html

## 2026-11-25 · The Console follows Apple's Human Interface Guidelines
- Decided by: the designer
- Why: the designer's direction.
- Rejected: none.
- Rests on: hig-application.md

## 2026-11-25 · The guidelines govern behavior, not Apple's look
- Decided by: Claude, default
- Why: the Console runs in browsers on three systems and has its own name and look.
- Rejected: imitating macOS, with SF Symbols and Liquid Glass.
- Rests on: hig-application.md; context-emulator-console.md

## 2026-11-25 · Services with more than seven lists show them as a filterable list
- Decided by: Claude, default
- Why: EC2 offers over 150 lists, and the guidelines put five to seven choices in a row at most.
- Rejected: chips for every list.
- Rests on: hig-application.md; EC2 Service Model

## 2026-11-26 · The Emulator Gap Verdict covers 501, UnknownService, and InvalidAction for a modelled operation
- Decided by: the designer
- Why: missing features also answer UnknownService (404) and InvalidAction naming an operation the Service Model defines. Other refusals keep their rule, and undeclared ones such as ValidationError stay Unclear.
- Rejected: 501 alone, which would call some missing features Unclear.
- Rests on: spikes-2026-11-25.md

## 2026-11-26 · The wireframes are approved
- Decided by: the designer
- Why: second of three approvals, after the serialization test passed.
- Rejected: none.
- Rests on: wireframes-emulator-console.html; spikes-2026-11-25.md

## 2026-11-26 · Pages reflow to one column below 640 px, down to 320 px
- Decided by: Claude, default
- Why: WCAG 2.2 AA, the agreed floor, needs reflow at 400% zoom, which is 320 CSS px.
- Rejected: a 640 px minimum, which fails 1.4.10 Reflow.
- Rests on: accessibility-emulator-console.md

## 2026-11-26 · The Console checks the Emulator's health on a timer
- Decided by: Claude, default
- Why: every 30 s, and every 5 s while it isn't answering, so a stopped Emulator is noticed. Health checks are not AWS API calls and do not keep the Emulator running.
- Rejected: noticing only on the next read, which leaves stale pages looking current.
- Rests on: states-emulator-console.md; spikes-2026-11-25.md

## 2026-11-26 · The visual world is Flight Strips, with Liquid Glass on the floating controls
- Decided by: the designer
- Why: preferred after two hands of directions; glass kept to controls and navigation, with no glass control overlapping another control.
- Rejected: Field Book, Lab Report, Customs Docket, High-Density Modules, Terminal Wayfinding, Airline Timetable, Ticket Wallet, and the category standard; Flight Strips without glass.
- Rests on: .impeccable/mocks/decision/ sketches; hig-application.md

## 2026-11-26 · The high-fidelity design is approved
- Decided by: the designer
- Why: third of three approvals, after the finish review returned ship. No Developers have tried the clickable design yet.
- Rejected: none. The finish reviewer's optional ideas (strip-style secondary pages, a visible rack, askew failed strips, strip field labels, more motion) were left out.
- Rests on: prototype/index.html; DESIGN.md; .impeccable/design.json

## 2026-11-26 · The Gateway records whenever the Console runs, and says so
- Decided by: the designer
- Why: a test run started before the Console is opened still leaves its Calls; the Gateway page and the endpoint state that recording is on.
- Rejected: recording only while a tab is open, which loses those Calls; a pause switch, which adds a third state to explain.
- Rests on: evaluation-emulator-console.md; states-emulator-console.md

## 2026-11-26 · Empty bucket is a Destructive Operation
- Decided by: Claude, default
- Why: it deletes every object and can't be undone, so it confirms like the other deletions. Fixed in the prototype with the optional-field disclosure that showed in the JSON view.
- Rejected: none.
- Rests on: evaluation-emulator-console.md

## 2026-11-26 · How the design avoids manipulative patterns
- Decided by: Claude, default
- Why: Destructive Operations confirm with Cancel focused and no default button, and name what goes; Verdicts say what they can't tell instead of assigning fault; there is no telemetry, sign-up, nagging or engagement mechanic; the Gateway is optional and says what it records and that it records whenever the Console runs; the "Record headers and status only" choice starts unchecked, so the default records more, which serves the Developer's own debugging on their own machine and is stated beside the choice; sensitive fields stay hidden until shown.
- Rejected: a destructive primary button in confirm dialogs.
- Rests on: evaluation-emulator-console.md; hig-application.md; copy-emulator-console.md

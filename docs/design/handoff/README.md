# Emulator Console, first version

Emulator Console is a local web console that connects to one running AWS Emulator. It is for a Developer whose code calls the Emulator through an AWS SDK. The first version explains a failed SDK call through an optional recording Gateway, with a Verdict that says what it can't tell. It reaches every one of the 436 services the Emulator offers through pages generated from AWS's Service Models, gives eight Curated Services hand-designed pages, and shows what a run created with Markers ([brief](../brief-emulator-console.md)).

## Contents

| Artifact | Path | What it holds |
|---|---|---|
| Brief | [../brief-emulator-console.md](../brief-emulator-console.md) | Gap, goals, principles, assumptions, Phase 1 scope and what waits |
| Product | [../../../PRODUCT.md](../../../PRODUCT.md) | Users, purpose, operating limits, brand commitments |
| Context | [../context-emulator-console.md](../context-emulator-console.md) | The Emulator's behaviour and the standing constraints |
| Glossary | [../../../GLOSSARY.md](../../../GLOSSARY.md) | Every domain term: Call, Verdict, Emulator Gap, Marker, Curated Service, Generated Page and the rest |
| Architecture decisions | [../../adr/](../../adr/) | The Gateway (0001), TypeScript in one Node process (0004), generated pages for every service (0005) |
| Spike results | [../spikes-2026-11-25.md](../spikes-2026-11-25.md) | Serialization across seven protocols, Gateway forwarding, Emulator behaviour, measured against 1.0.611 |
| Site map | [../sitemap-emulator-console.html](../sitemap-emulator-console.html) | Places, cross-links, navigation, labels, search and browse |
| Journeys | [../journey-emulator-console.html](../journey-emulator-console.html) | The five tasks screen by screen, with the interaction specification |
| Wireframes | [../wireframes-emulator-console.html](../wireframes-emulator-console.html) | Every screen at full-page fidelity |
| Prototype | [../prototype/index.html](../prototype/index.html) | The approved high-fidelity design, clickable; `?state=down`, `?state=restart`, `?state=empty`, `?view=json` |
| Design system | [../../../DESIGN.md](../../../DESIGN.md), [../../../.impeccable/design.json](../../../.impeccable/design.json) | Tokens, type, components and named rules for the built UI |
| Apple guidelines | [../hig-application.md](../hig-application.md) | How the Human Interface Guidelines apply, including where Liquid Glass may go |
| States and edge cases | [../states-emulator-console.md](../states-emulator-console.md) | State IDs A1–F3, timings, recoveries, edge case catalog |
| Accessibility | [../accessibility-emulator-console.md](../accessibility-emulator-console.md) | WCAG 2.2 AA findings, live regions, screen reader flows, keyboard map |
| Copy | [../copy-emulator-console.md](../copy-emulator-console.md) | Voice, terminology, every string by screen and state, content limits |
| Evaluation | [../evaluation-emulator-console.md](../evaluation-emulator-console.md) | Findings against the prototype; each one is a build requirement |
| Decision log | [../decisions.md](../decisions.md) | Every decision someone might reopen, including the review for manipulative patterns |

## How the pieces fit

| Screen | Wireframe | Journey step | Site map place | States | Copy |
|---|---|---|---|---|---|
| Connection: shows whether the Console reached the Emulator, trusts it and has its keys | `scr-connect` | Connect | Setup › Connection | A1, A3 | Copy deck, Notices |
| Gateway: the one endpoint line, and what is recorded and when | `scr-gateway` | Setup: Gateway | Setup › Gateway | B1–B4 | Copy deck, Gateway setup |
| Current run: the place a Developer lands, with failed Calls one click away | `scr-run`, `scr-run-empty` | Current run | Current run | A2, A4 | Copy deck, Lists |
| Restart notice: the resources are gone and the Calls are kept | `scr-restart` | Restart notice | Every page | A2 | Copy deck, Notices |
| Calls: strips in time order, filtered to find the failure | `scr-calls`, `scr-calls-wide`, `scr-calls-nar` | Calls | Calls | C1–C3, C8, C9 | Copy deck, Calls and Verdicts |
| Call: the request and response first, then a Verdict that states its limits | `scr-call-nar`, `scr-gap`, `scr-unclear` | Call; From a Call to a retry | Calls › Call | C4–C7 | Copy deck, Calls and Verdicts |
| Find: reach any service or operation by name | `scr-find` | Find | Every page | D1 | Copy deck, Top bar and sidebar |
| Services: all 436, filterable, with implementation labels | `scr-services` | Reach any service | Services | A5, A6 | Copy deck, Lists |
| Service resources: generated lists and details from List and Describe operations | `scr-svc`, `scr-svc-nar`, `scr-svc-empty`, `scr-svc-many` | Service: Resources; Resource | Services › Service › Resources | A4–A7, D2–D4 | Copy deck, Lists |
| Service without a list: an honest path to the operation that needs input | `scr-svc-nolist` | Service without a list | Services › Service › Resources | D2 | Copy deck, Lists |
| Operations: every operation, with "Not implemented" labels before anyone sends | `scr-ops` | Operations | Services › Service › Operations | | Copy deck, Lists |
| Operation form: send any operation, through fields or JSON | `scr-form`, `scr-form-nar` | Operation form; Response | Services › Service › Operations › Operation | E1–E7 | Copy deck, Operation form |
| Confirm: a Destructive Operation, with what goes named | `scr-confirm` | Confirm | Dialog | | Copy deck, Operation form |
| Markers: what a run created and removed in the Curated Services | `scr-markers`, `scr-marker` | Set a Marker; Marker | Markers › Marker | F1–F3 | Copy deck, Markers |
| S3, DynamoDB, SQS, SNS, Lambda, CloudWatch Logs, EventBridge, IAM: hand-designed pages that add test actions to the generated shape | `scr-s3`, `scr-ddb`, `scr-sqs`, `scr-sns`, `scr-lambda`, `scr-logs`, `scr-eb`, `scr-iam` | See what a run created; From a Call to a retry | Services › Curated Service | A4–A7 | Copy deck, Lists |

The prototype is the visual reference for every row. Where the prototype and a wireframe differ in layout, the prototype wins. Where they differ in behaviour, the states, accessibility and copy documents win.

## Left to the builder

- Implementing the visual design from `DESIGN.md` and the prototype. The prototype's code is a reference, not production code.
- The internal module structure, test framework and component library within the stack fixed by ADR 0004: TypeScript, React and Vite, and one Node process serving the UI, the Console's API and the Gateway.
- How the Service Models are indexed and shipped inside the container, provided the spike's serialization approach is kept.
- The Gateway's port, 9300 in the design. It can be configured.

## Open questions

- What is the product's name? "Emulator Console" is the working name, and it must not contain "AWS" ([PRODUCT.md](../../../PRODUCT.md)).
- Should tables offer a denser mode with rows under 28 px ([accessibility](../accessibility-emulator-console.md))?

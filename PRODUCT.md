# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript, React and Vite, served with the Console's API and the Gateway from one Node process in one container ([ADR 0004](docs/adr/0004-typescript-in-one-node-process.md)). Request serialization uses the AWS SDK's protocol classes with schemas converted from AWS's Service Models.

## Users

A Developer running one AWS Emulator on their own laptop, through code that uses an AWS SDK. They know the AWS services their code calls and those services' vocabulary. They arrive mid-task, usually from a failed SDK call or a test run, with an editor and a terminal open beside the Console; the window is often narrow, and some work full screen on a large monitor. Teams sharing an Emulator and people learning AWS are outside the first version.

## Product Purpose

A local web console that connects to a running AWS Emulator. It lets the Developer explain a failed SDK call, find what a run created, and reach any of the 436 services the Emulator offers. Success: a call that failed through the Gateway is found, its request and response read, and the Developer's own mistake told apart from an Emulator Gap in under a minute without the CLI.

## Positioning

The Console records the Developer's own calls to AWS Emulator, through an optional Gateway, with full requests and responses, and gives each failure a Verdict that states what it cannot tell. It covers every service the Emulator offers from AWS's own models and labels what the Emulator has not implemented before anyone sends it.

## Operating Context

- Started with `docker compose up` beside the Emulator; reached on loopback only.
- The Developer points their SDK at the Gateway with one endpoint line.
- The Emulator keeps state in memory; a restart loses every resource and changes its keys.
- The Emulator package changes quickly (1.0.509 to 1.0.611 in a week), so "not implemented" labels often describe another version.

## Capabilities and Constraints

- Connects to one Emulator and never starts, stops or resets it. No Docker socket.
- No login; loopback only; Host and Origin checks; Emulator credentials never reach the browser.
- No Console telemetry. Calls stay in memory, latest 5,000, bodies cut at 256 KB; signatures and session tokens are never stored; sensitive fields are hidden until shown.
- Designed for 640 px to full screen; reflows to one column down to 320 px. No phone layout.
- English only. Light and dark follow the system.
- Terms are defined in [GLOSSARY.md](GLOSSARY.md); interface words and every string in [the copy document](docs/design/copy-emulator-console.md).
- Approved structure: [site map](docs/design/sitemap-emulator-console.html), [journeys](docs/design/journey-emulator-console.html), [wireframes](docs/design/wireframes-emulator-console.html), [states](docs/design/states-emulator-console.md).

## Brand Commitments

- Its own name and look. The name must not contain "AWS"; a factual "for AWS Emulator" line is allowed. It states that it is not affiliated with AWS.
- The product name is undecided.
- Apple's Human Interface Guidelines govern behavior, layout, writing and accessibility ([applying the guidelines](docs/design/hig-application.md)). Liquid Glass is used for the floating controls and navigation only, never for content, and never covering another control. No SF Symbols, no imitation of the AWS Management Console.
- Voice: exact, evidence first, neutral about fault, short.

## Evidence on Hand

- Spike results against Emulator 1.0.611 ([spikes](docs/design/spikes-2026-11-25.md)).
- No users have been studied. There are no quotes, testimonials, customer logos or usage figures, and none may be invented.

## Product Principles

1. Evidence before explanation: show the request and response first; a Verdict never claims more than they support.
2. One shape for every service: the 400th service works like the first, and hand-designed pages add to that shape.
3. Say what is missing: an empty list, an unimplemented operation and an unreadable service look different from each other.
4. Stay close to the code: the SDK's names, and every view useful beside an editor.

## Accessibility & Inclusion

WCAG 2.2 AA is the floor, with full keyboard use, reflow to 320 px, and no information carried by color alone. Requirements are in [the accessibility document](docs/design/accessibility-emulator-console.md).

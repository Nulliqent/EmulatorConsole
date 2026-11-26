# Emulator Console, first version

## Context
Emulator Console is a local web console for Developers running AWS Emulator on their own machine ([context](context-emulator-console.md)). AWS Emulator offers 436 services, and at v1.0.509 about 38% of their operations (7,291 of 19,405) are unimplemented ([ADR 0005](../adr/0005-generated-pages-for-every-service.md)).

StackPort, MyDevStack, and LocalStack's App Inspector and Resource Browser are the nearest tools; the AWS CLI and SDK logs are the usual workaround ([existing tools](research-existing-tools.md)).

## Gap
When an SDK call fails, the Developer has an error and no evidence of whose fault it is. The Emulator's own history leaves out data events and bodies, and only some services write it ([ADR 0001](../adr/0001-record-calls-through-an-optional-gateway.md)). No tool in the research is documented to record an application's calls to AWS Emulator with their payloads, or to cover all 436 services.

## Opportunity
For Developers whose code reaches past the most common services. AWS publishes a model of every service the Emulator offers, so one set of generated pages can cover them all. With over a third of operations missing, a failed call may be an Emulator Gap rather than a mistake, and the error alone does not say which.

## Goals
- A failed SDK call is explained, or honestly left Unclear, in under a minute without the CLI.
- Any service the Emulator offers can be found, inspected and called from one place.
- A Developer can see what a run created in the Curated Services.
- An operation the Emulator lacks is visible before anyone spends time on it.

## Constraints
The standing limits are in the [context](context-emulator-console.md). Three shape this version most: nothing in the models groups services by subject, Calls exist only through the Gateway, and the Console cannot see resources it has not asked for.

## Guiding Principles
1. **Evidence before explanation.** Show the request and response first; a Verdict never claims more than they support.
2. **One shape for every service.** The 400th service works like the first. Hand-designed pages add to that shape and never replace it.
3. **Say what is missing.** An empty list, an unimplemented operation and an unreadable service look different from each other.
4. **Stay close to the code.** Use the names in the Developer's SDK, and keep every view useful beside an editor.

## Key Assumptions & Open Questions
- **Developers will point their SDK at a Gateway.** Without it there are no Calls. Wrong if people testing the design skip that setup.
- **Generated pages are useful, not just present.** Wrong if people testing a service outside the Curated eight leave for the CLI to understand a list or detail.
- **Developers find services by name.** Wrong if people scan the A–Z list for services they know by another name.
- **Other SDKs work through the Gateway as JavaScript's does.** Wrong if a signed request from another SDK that the Emulator accepts directly is refused through it ([spikes](spikes-2026-11-25.md)).

## Proposed Scope (Phase 1)
Included:
- Generated Pages for all 436 services: resource lists, details, and a form for every operation.
- Hand-designed pages for S3, DynamoDB, SQS, SNS, Lambda, CloudWatch Logs, EventBridge and read-only IAM, with test actions (put an object or item, send a message, invoke), delete and purge.
- The Gateway, Calls and Verdicts, for every service.
- Markers, for the Curated Services.
- Connection, setup, and an accessible layout from 640 px to full screen that reflows down to 320 px.

Waits:
- Links from Verdicts to known Emulator issues.
- Markers for other services, since their resource lists are not reliable enough to compare.
- Editing or deleting from generated lists, since the matching operation would be a guess. The operation's form does it instead.
- Several Emulators at once, shared use, saved history, phone layouts, other languages.

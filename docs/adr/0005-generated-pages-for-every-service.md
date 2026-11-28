---
status: accepted
---

# Generated pages for every service the Emulator offers

Supersedes ADR-0002. The Console covers all 436 services in the Emulator (v1.0.509). Each gets Generated Pages (resource lists, details and every operation) built from its Service Model. The eight Curated Services (S3, DynamoDB, SQS, SNS, Lambda, CloudWatch Logs, EventBridge, read-only IAM) also get pages designed by hand, at the same addresses.

ADR-0002 ruled out generated pages because 311 models declare no resource shapes. Operations are a better basis: 357 of the 436 services have a List or Describe operation that returns a collection and needs no input, and 8 more have only a Get or Search operation that does.

## Considered options

- Curated pages plus an Operation Runner (ADR-0002): leaves most services without a resource list.
- Curated pages for every service: more pages than can be designed or kept correct by hand.

## Consequences

- The Console connects to a running Emulator. `api-models-aws`, pinned to one commit and reduced to an index at build time, describes what the Emulator has or mostly has; the Emulator decides what appears. Their operation lists differ in 62 services (388 operations), so those differences are labelled. The three modelled services the Emulator lacks are hidden.
- Neither reference clone is built into or changed; the build uses its own download.
- Generated lists are read-only. Changes go through the Operation Runner, and Destructive Operations ask for confirmation.
- 71 services have no list that needs no input. They open on their operations and say which input their lists need. A Get or Search that returns a collection may be settings and not resources, so those are checked per service.
- About 37% of operations (7,192 of 19,405 operation files) are unimplemented stubs at v1.0.509, so missing operations need to be visible before they are sent. The count is of files carrying the Emulator's `//! SCAFFOLDED, NOT IMPLEMENTED:` marker. The Console's per-operation "not implemented" total (7,216, over the Service Model's operations) is a different number: it also counts 44 operations the Emulator models but leaves unwired (they answer 501 too) and leaves out stubs the Service Model lacks.
- Request serialization now carries the whole product, not one feature (ADR-0004).

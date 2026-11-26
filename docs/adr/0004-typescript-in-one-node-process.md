---
status: accepted
---

# TypeScript throughout, in one Node process

A React and Vite front end, the Console's API and the Gateway (on a second port) run from one Node process in one container, so there is one language to maintain and one thing to start. Every generated page and the Operation Runner must serialize requests for seven AWS protocols from Smithy models (ADR-0005).

## Considered options

- React with a Python backend: botocore already handles every service generically, at the cost of a second language.
- Rust: matches the Emulator, but slower to build a UI-heavy product in.

## Consequences

A spike on 2026-11-25 passed for all seven protocols (docs/design/spikes-2026-11-25.md), so the Python fallback is dropped. Serialization uses the AWS SDK's protocol classes with schemas converted from Service Models, not serializers of our own. The seven are restJson1, awsJson1_0, awsJson1_1, awsQuery, ec2Query, restXml and rpcv2Cbor.

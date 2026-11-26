---
status: accepted
---

# Record Calls through an optional Gateway

Explaining why an API request failed needs its full request and response, and the Emulator's only history (CloudTrail `LookupEvents`) omits data events and bodies and is written by only some services. Developers may point their SDK at a Gateway that forwards to the Emulator and records each Call. Inspecting resources works without it.

## Considered options

- `LookupEvents` only: no setup, but partial coverage and no bodies.
- No call history: leaves the debugging job unserved.

## Consequences

A spike on 2026-11-25 showed that signatures verify through the Gateway and that SQS queue URLs and presigned S3 URLs lead back to it (docs/design/spikes-2026-11-25.md). Returned URLs say `https`, so the Gateway accepts plain and TLS connections on one port.

The Gateway forwards each request unchanged with its original `Host`, and leaves responses untouched. Re-signing would hide the Developer's own credential mistakes, and rewriting returned URLs could break presigned signatures. Other kinds of returned URL are untested and may bypass the Gateway, and the Console says so.

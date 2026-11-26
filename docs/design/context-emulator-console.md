# Emulator Console

## Users
A Developer running one Emulator on their own laptop, through code that uses an AWS SDK. They know the AWS services their code calls and those services' vocabulary. They come to the Console mid-task: an SDK call has failed, or they want to see what a test run left behind. They have an editor and a terminal open beside it, so the window is often narrow; some work full screen on a large monitor. Teams sharing an Emulator and people learning AWS are outside the first version.

## Product
A local web console that connects to a running AWS Emulator and covers every service it offers, 436 at v1.0.509. AWS's Service Models describe those services; the Emulator decides which appear ([ADR 0005](../adr/0005-generated-pages-for-every-service.md)). The Console starts from scratch: no existing design or code is carried over. It is open source under Apache-2.0, starts with one `docker compose up`, and has its own name and look. It states that it is not affiliated with AWS.

## Constraints
- The Console connects only. It never starts, stops or resets the Emulator ([ADR 0003](../adr/0003-do-not-mount-the-docker-socket.md)).
- The Emulator keeps state in memory and loses it on stop. Its account is always `000000000000`. Its health route answers only `ok`, so the Console cannot read its version or start time; new keys are the sign of a new run. The package moves quickly: it was 1.0.611 a week after 1.0.509, so labels often describe another version ([spikes](spikes-2026-11-25.md)).
- Calls exist only for requests sent through the optional Gateway ([ADR 0001](../adr/0001-record-calls-through-an-optional-gateway.md)).
- Loopback only, no login. Emulator credentials never reach the browser.
- TypeScript in one Node process, on arm64 and x86_64 ([ADR 0004](../adr/0004-typescript-in-one-node-process.md)).
- Designed for 640 px to full screen on large monitors, with every task possible at every width. Below 640 CSS px, including 400% zoom, pages fall to one column down to 320 px. No layout is designed for phones.
- Apple's Human Interface Guidelines, as set out in [applying the guidelines](hig-application.md).
- WCAG 2.2 AA, full keyboard use, light and dark from the system setting, English.
- No timed AWS requests: the Console reads on focus, after a relevant write Call, and on request, and shows when it last read.
- Design is approved before production code is written. Three approvals: brief and structure, wireframes, high-fidelity design.

## Ethical stance
- No Console telemetry. Emulator telemetry is off in the supplied compose file, with one documented line to turn it on.
- Recorded Calls stay in memory on the machine, limited to the latest 5,000 and cleared on demand. Signatures and session tokens are never stored.
- Setup says what is recorded before recording begins, including that DynamoDB items and SQS bodies are shown unmasked. A headers-and-status-only setting is available.
- The Console says what it cannot see or detect wherever that limits an answer.
- Friction matches consequence: one delete takes one plain confirmation; a bulk purge names the resource and the count.

## Success
A Developer whose SDK call failed through the Gateway finds it, reads its request and response, and tells their own mistake from an Emulator Gap in under a minute without the CLI. A Developer finds every resource a run created in the Curated Services. For any other service the Emulator offers, a Developer reaches its resources or a stated reason there is no list, and can send any of its operations.

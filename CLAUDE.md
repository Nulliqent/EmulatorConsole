# CLAUDE.md

## Reference repos (read-only)

`aws-emulator/` and `api-models-aws/` are other people's GitHub repos, cloned here for reference only. Read them to understand the emulator and the Smithy models. Never edit, build into, commit or open PRs or issues against them. The console's own code lives outside them.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `Nulliqent/EmulatorConsole`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Agent workflow for code changes

Every code-change task runs up to six subagents. Pass `model` explicitly on each Agent call, and `effort` where one is given. Every agent runs on the 5.5 models: `sonnet` means Sonnet 5.5 (`claude-sonnet-5-5`), `opus` means Opus 5.5 (`claude-opus-5-5`) and `haiku` means Haiku 5.5 (`claude-haiku-5-5`). If an alias resolves to any other version, stop and tell the user.

0. **UI/UX designer** (`model: sonnet`). Runs only when the task touches a service or page that has no UI in the design (`DESIGN.md` and the approved wireframes). Designs that page to match the design system and ADR 0005 (generated pages for every service, hand-designed pages for Curated Services), and hands the design to the implementer.
1. **Implementer** (`model: sonnet`, `effort: medium`). Makes the code changes.
2. **User simulator** (`model: sonnet`, `effort: medium`). Acts as a real user. Runs the change and interacts with it, for example by driving the console UI or calling the emulator through the Gateway. Reports what works, what breaks and what is confusing.
3. **Code reviewer** (`model: opus`, `effort: medium`). Reviews the quality of the changed code: correctness, maintainability, module boundaries, tests.
4. **Security reviewer** (`model: opus`, `effort: medium`). Reviews the security of the changed code, for example credential handling, the Gateway and origin checks, masking of recorded Calls, and input validation.

5. **Committer** (agent type `committer`, defined in `.claude/agents/committer.md`: Haiku 5.5). Runs only after 2, 3 and 4 all pass. Squashes the ticket's commits, pushes the ticket branch, and opens a pull request whose body says `Closes #<ticket>`. It does not merge unless the user says to. It reports the PR link so the next ticket can start.

Run 0 first when it applies, then 1. Run 2, 3 and 4 after 1 finishes; they can run in parallel. Send any findings from 2–4 back to the implementer. Run 5 last, once every review is clean.

**Re-checks after fixes.** The full code review (3) and security review (4) run on Opus 5.5 once per ticket. After the implementer fixes their findings, do not re-run 2, 3 and 4. Run **one** re-check reviewer (`model: sonnet`, `effort: medium`) that verifies only the listed findings were fixed and that the fix diff adds no new problem. If the fixes touch security-sensitive code (credentials, the Gateway proxy or origin checks, Docker or CI permissions), the re-check covers the security findings too.

### Moving to the next ticket

When the committer starts, the orchestrating session (the main conversation that spawns these subagents) checks whether the next ticket is ready to start, and if it is, starts its workflow at once, concurrently with the committer. Do not wait for the PR to merge.

- A ticket is ready when each of its blockers is either closed, or has a PR open from a committer. Use the ticket order and the blocking links in the tracker (see `docs/agents/issue-tracker.md`).
- If a blocker's PR is still open, branch the new ticket from that PR's branch, not from `main`, and say so in the new PR.
- Run each ticket's subagents in its own git worktree (`isolation: "worktree"`), so concurrent tickets never touch the same working tree.
- Concurrent agents share one e2e stack (compose project `console-e2e`, ports 19297/19300). Each agent takes a lock before bringing it up (`mkdir <scratchpad>/e2e.lock`, waiting while it exists), and releases it with `rmdir` right after teardown. An agent never tears down a stack it didn't start.
- If no ticket is ready, or the next one is `ready-for-human`, stop and tell the user.

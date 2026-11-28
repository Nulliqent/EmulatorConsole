## Voice and Tone Framework

### Voice

**Exact, not technical for its own sake.** Use the AWS name for an AWS thing and plain English for everything else.
- Do: "ListActivities answered 500 InternalFailure."
- Don't: "Upstream returned an unhandled server fault."

**Evidence first, then judgment, and say how far the judgment goes.**
- Do: "Lambda defines this error for Invoke, so it reads as a refused request. The Console can't tell whether AWS would refuse it too."
- Don't: "You made a mistake in your request."

**Neutral about fault.** Nobody is blamed, including the Emulator.
- Do: "The Emulator hasn't implemented DescribeDBProxyEndpoints."
- Don't: "The Emulator failed to handle your request."

**Short.** Developers read this beside their code. One idea per sentence, and no sentence a heading already says.
- Do: "No state machines in us-east-1."
- Don't: "It looks like there aren't any state machines here yet! Create one to get started."

### Tone by context

| Context | Tone | Example |
|---|---|---|
| Diagnosis of a failed Call | Plain, careful about limits | "A server error EventBridge doesn't define for PutRule. It could come from the Emulator or from something in the request." |
| Empty list | Factual, with the next step | "No state machines in us-east-1. Calls to Step Functions were seen in eu-west-1." |
| Connection or restart | Direct, with the command | "The Emulator isn't answering. Restart it with `docker compose restart`." |
| Destructive confirmation | Serious, names what is lost | "Delete order-flow? This can't be undone." |
| Success | Brief | "Copied" |

### Rules for every string

- Sentence case. API names keep their spelling: CreateStateMachine, stateMachineArn.
- Contractions are fine: "isn't", "can't", "doesn't".
- No exclamation marks, no "please", no "oops", no "simply".
- "You" only where it is needed to say who acts.
- Times are local, 24-hour, with seconds in lists ("14:05:31") and the full ISO form in details.
- Numbers are digits with thousands separators ("5,000").
- Generated strings come from templates in this document, never from joining words in code.

## Terminology

Domain terms are defined in the [glossary](../../GLOSSARY.md). These are the interface words beside them.

| Word | Means | Don't use |
|---|---|---|
| Send | Make one request with an operation's form | Run, execute, submit, invoke (except Lambda's Invoke operation) |
| Read | The Console fetching what the Emulator holds | Load, fetch, sync, poll |
| Refresh | Read again now | Reload, sync |
| Find | Search for a service or operation by name, from any page | Search everything, command palette |
| Filter | Narrow what is already on this page | Search |
| Not implemented in 1.0.509 | The Emulator version named has no handler for this operation | Unsupported, unavailable, coming soon |
| Not offered | In AWS's model but not in this Emulator's list | Missing, disabled |
| First seen | When the Console first saw this run | Started, uptime |
| Destructive | An operation that deletes or irreversibly changes what it names | Dangerous |

## Copy Deck

Strings already in the wireframes are not repeated. `{name}` marks a value from the Emulator or the model. ⇄ marks a string likely to expand in translation.

### Top bar and sidebar

| Where | String | State |
|---|---|---|
| Find placeholder | Find a service or operation | |
| Find hint | ⌘K (macOS) / Ctrl K | |
| Connection, normal | Connected · {address} | |
| Connection, not answering | Not answering · {address} | A1 |
| Set a Marker, disabled reason | Can't set a Marker while the Emulator isn't answering. | A1 |
| Connection, Console not answering | Status unknown | A1 |
| Set a Marker, disabled reason, Console not answering | Can't set a Marker while the Console isn't answering. | A1 |
| Connection, first read | Checking the Emulator. | |
| Skip link | Skip to content | |
| Hide sidebar / Show sidebar | Hide sidebar · Show sidebar | |

### Notices

| Where | Title | Text | Actions | State |
|---|---|---|---|---|
| Below top bar | The Emulator isn't answering | Last answer at {time}. What's on screen may be out of date. | Copy restart command | A1 |
| Below top bar | The Emulator isn't answering | Last answer at {time}. It may have stopped after a period with no API calls. | Copy start command | A3 |
| Below top bar | The Console isn't answering | Check that it is running. | Start it with `docker compose up -d` (shown beside the text) | A1 |
| Below top bar | The Emulator has restarted and its resources were lost | Noticed at {time}. Calls from the earlier run are kept. Its Markers have ended. | Dismiss | A2 |

Before the first answer, a notice's text reads "No answer since the Console started." in place of "Last answer at {time}." The notice shows A3 only when nothing is listening at the Emulator's address; any other silence is A1.

### Connection page

| Where | String | State |
|---|---|---|
| Not trusted, no ca.pem | Not trusted: this run's ca.pem isn't there | A1 |
| Not trusted, other CA | Not trusted: the certificate doesn't chain to this run's ca.pem | A1 |
| Step not run | Not checked | A1 |
| Panel heading (visually hidden) | Steps | |
| Keys missing | Not found: {path} | A1 |
| Last answer | Last answer at {time}. | A1 |
| Restart line, stopped Emulator | Start it with: | A3 |
| Try again, running | Checking… | A1 |
| Copy button name on the page | Copy restart command from the Connection page · Copy start command from the Connection page | A1, A3 |

### Pages not built yet

| Where | String | State |
|---|---|---|
| Placeholder page | This page isn't built yet. | |
| No page at the address, title | Page not found | |
| No page at the address, text | There is no page at this address. | |

### Lists

| Where | String | State |
|---|---|---|
| Refresh, reading | Reading… | A4 |
| After 10 s | Still reading. The Emulator is slow to answer. | A4 |
| After 30 s | No answer after 30 s. | A4 |
| End of first page | Read more · {count} read so far | A5 |
| Filter note | Filtering {count} read rows. | A5 |
| Empty, this Region | No {resource plural} in {region} | |
| Empty, other Regions | Calls to {service} were seen in {regions}. | |
| Empty, never anywhere | No {resource plural} in {region}. | |
| Not implemented | {operation} isn't implemented in {version}. | |
| Unread, error | {operation} answered {status} {error}. | D2 |
| Needs input | {operation} needs {members}. | |
| Global service | Not used by {service}. | D3 |
| Detail from list | {operation} isn't implemented in {version}, so these are the fields from the list. | D4 |

### Calls and Verdicts

| Where | String | State |
|---|---|---|
| Verdict: Request Rejected | {service} defines this error for {operation}, so it reads as a refused request. The Console can't tell whether AWS would refuse it too. | |
| Verdict: Emulator Gap, 501 | The Emulator answered 501: it hasn't implemented this operation. Changing the request won't help. | |
| Verdict: Emulator Gap, UnknownService | The Emulator doesn't offer {service}. Changing the request won't help. | |
| Verdict: Emulator Gap, InvalidAction | The Emulator doesn't recognize {operation}, though AWS defines it. Changing the request won't help. | |
| Verdict: Unclear, undeclared error | {error} isn't an error {service} defines for {operation}. It could come from the Emulator or from something in the request. | |
| Verdict: Unclear, unreadable | This response doesn't match the model for {operation}. | C7 |
| Verdict: Unclear, signature | Signature checks failed through the Gateway. Try sending it straight to the Emulator. | |
| Filter, no match | No Calls match "{text}". | C1 |
| Limit | Older Calls are removed to keep the latest 5,000. | C2 |
| New Calls | {count} new Calls | C3 |
| Body cut | Cut at 256 KB of {size}. | C4 |
| Binary body | Binary body, {size}. Not shown. | C5 |
| Sensitive | Hidden · Show | C6 |
| Waiting | Waiting · No response after 60 s. | C8 |
| Body not recorded | Body not recorded | B3 |
| Clear dialog | Clear all Calls? · The Console keeps no other copy. · Cancel · Clear | C9 |
| Missing Call | Not listed? A request sent straight to the Emulator isn't recorded. Set up the Gateway. | |

### Gateway setup

| Where | String | State |
|---|---|---|
| Port in use | The Gateway couldn't start: port {port} is in use. | B1 |
| Browser refused | Refused {count} requests sent from a browser page. Last at {time}. | B2 |
| TLS refused | A TLS connection was refused because the caller didn't trust the Gateway's certificate. | B4 |
| First Call | First Call recorded: {operation} at {time}. | |
| Always recording | The Gateway records whenever the Console runs, with or without an open tab. Shown beside the endpoint, after "Recording is on." | |
| Port in use, help | The Console works without it. To use another port, set this in docker-compose.yaml and restart the Console: `GATEWAY_PORT={port+1}` · Copy the line | B1 |
| Gateway failed | The Gateway couldn't start. The Console works without it. | |
| Browser refused, one | Refused 1 request sent from a browser page. Last at {time}. | B2 |
| TLS refused, count | …certificate. Once, last at {time}. / {count} times, last at {time}. | B4 |
| TLS help | Use the http line above, or have your SDK trust the Gateway's certificate: (then the `curl` and `NODE_EXTRA_CA_CERTS` lines) | B4 |
| Console silent | The Console didn't answer. | |
| SDK settings | Three copyable lines: `AWS_ENDPOINT_URL=http://127.0.0.1:{port}`, `AWS_SHARED_CREDENTIALS_FILE=~/.aws/emulator/{port}/emulator_credentials`, `AWS_REGION=us-east-1`. Then: Use the Emulator's own keys, as above, and any Region. Your SDK signs with them and the Emulator checks the signature. | |
| Certificate, title | If your SDK follows https URLs | B4 |
| Certificate, why | SQS queue URLs and presigned S3 links come back from the Emulator as https. They reach the Gateway, and are recorded, only when your SDK trusts the Gateway's certificate: | B4 |
| Certificate, steps | 1. Download the certificate: `curl -o gateway.pem {console}/api/gateway/certificate` · 2. Tell your SDK to trust it, for Node and for the AWS CLI and other SDKs: `NODE_EXTRA_CA_CERTS=./gateway.pem` `AWS_CA_BUNDLE=./gateway.pem` | B4 |
| Certificate, virtual host | https to virtual-host bucket names (bucket.localhost) isn't supported. Use path style, or plain http. | B4 |
| Straight to the Emulator (replaces the prototype line) | SQS queue URLs and presigned S3 links lead back to the Gateway. URLs for other services may lead straight to the Emulator, and requests to those aren't recorded. | |
| TLS help (replaces the B4 help) | Use the http line above, or follow the certificate steps. | B4 |
| Setting failed | Couldn't change the setting. The Console didn't answer. (the box goes back to what it was) | |
| Body removed | Body removed to save memory. (in place of a body, on the oldest Calls past 200 MB of bodies) | C2 |
| Body withheld | Not shown: this body could not be checked for sensitive values. Show reveals it. | C6 |
| Gateway unreachable, to the SDK | The Gateway couldn't reach the Emulator. / The Emulator didn't answer in time. (code `ServiceUnavailable`, in the protocol of the request) | |
| Gateway Host refused, to the caller | Host not allowed. The Gateway answers to localhost and 127.0.0.1; set GATEWAY_HOSTS to allow another name. (421) | |

### Operation form

| Where | String | State |
|---|---|---|
| Optional disclosure | Add an optional field | |
| Field error, not ARN | Not an ARN. You can still send it. | E7 |
| Field error, required | {member} is required. You can still send without it. | E7 |
| Restored | Restored the input you left at {time}. · Clear form | E1 |
| Sending | Sending… · Cancel | E2 |
| No response | No response after 30 s. The request may still have reached the Emulator. | E2 |
| JSON error | The JSON doesn't parse at line {line}. | E3 |
| Event streams | Event streams can't be sent from the Console. | E4 |
| Blob input | Text · Base64 · File | E5 |
| Confirm, delete | Send {operation}? · This deletes the {resource} and can't be undone. · Cancel · Delete | |
| Confirm, terminate | Send {operation}? · This terminates the {resource} and can't be undone. · Cancel · Terminate | |
| Confirm, purge | Purge {queue}? · This deletes about {count} messages and can't be undone. · Cancel · Purge | |

### Markers

| Where | String | State |
|---|---|---|
| Setting | Reading {service} ({n} of 8)… | F1 |
| Not compared | Not compared: {service} didn't answer. | F1 |
| Nothing changed | Nothing added or removed since {time}. | F2 |
| Other Region | This Marker was set in {region}. · Switch to {region} | F3 |
| Ended | Ended with the run | A2 |

## Content Model

| Content | Limit and truncation |
|---|---|
| Resource names and ARNs in tables | Truncate in the middle to the column width, keeping the last segment whole. Full value on hover, in the detail pane and to screen readers. |
| Operation names in tables | Never truncated; the column wraps at capitals. |
| Error messages from the Emulator | First 200 characters in the list, in full in the detail. |
| Bodies | 256 KB recorded; displayed in full up to that. |
| Notice titles | 70 characters ⇄ |
| Button labels | 24 characters ⇄; layouts allow 40% growth. |
| Service titles | As in the Service Model, without a leading "AWS" or "Amazon"; SDK ID after it when they differ. |

Generated strings are reviewed when the pinned model or the Emulator version changes. A template no generated page uses is removed at that review.

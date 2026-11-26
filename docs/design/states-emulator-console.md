## State Inventory

Severity: Critical causes confusion or data loss; Major significantly harms the experience; Minor reduces trust or perceived quality; Cosmetic is a nice-to-have.

### Every page

| ID | State | What the person sees | What they can do | Recovery and timings | Severity |
|---|---|---|---|---|---|
| A1 | Emulator stops answering | A notice under the top bar: "The Emulator isn't answering." The address and the last answer time stay in the top bar. Data already on screen stays, marked with its read time. Set a Marker and every Send are disabled, each saying why. | Read what is on screen; copy `docker compose restart` | The Console checks health every 5 s while stopped, and every 30 s otherwise. When it answers with the same keys, the notice goes without a message. With new keys, A2 follows. | Critical |
| A2 | Emulator restarted (new keys) | Restart notice on every page until dismissed (drawn). Lists re-read on next focus. Open forms keep their input. | Dismiss; show the earlier run's Calls | Earlier Markers end and show "Ended with the run". Sent operations from the earlier run stay listed, marked with that run. | Critical |
| A3 | Emulator stopped after its idle time | As A1, plus: "It may have stopped after a period with no API calls." | Copy `docker compose up -d` | Health checks do not keep it running ([spikes](spikes-2026-11-25.md)). | Major |
| A4 | Reading a list or detail | The table header and the previous rows stay. Empty tables show three placeholder rows. After 1 s the Refresh button says "Reading…" and cannot be pressed twice. | Go elsewhere; the read continues | After 10 s: "Still reading. The Emulator is slow to answer." with Cancel. After 30 s the read stops with E2. | Major |
| A5 | A list has more items than one page | The first page shows, with "Read more" at the end of the table and the count read so far. | Read more; filter what has been read | Each page is read on request. Filtering applies to read rows and says so: "Filtering 100 read rows." | Major |
| A6 | Long names and ARNs | In tables, names lose their middle: `arn:aws:lambda:…function:resize-thumbnails`. The full value shows in the detail pane, on hover and to screen readers. | Copy the full value | Detail panes wrap with no truncation. | Minor |
| A7 | Active Region changed | Lists re-read for the new Region. Calls are unaffected. Open Markers say "Set in us-east-1" and offer to switch back. | Switch back | Region is kept per browser. | Major |
| A8 | Second browser tab | Both tabs work. A write in one is seen in the other on next focus. | None needed | Pane widths and Region are shared through browser storage; the last change wins. | Minor |
| A9 | Copy | The button says "Copied" for 2 s. | None needed | If the clipboard is refused: "Couldn't copy. Select the text and copy it." | Cosmetic |
| A10 | Window narrower than 640 px, or zoom at 200–400% | One column. The sidebar becomes a menu button. Tables keep their own horizontal scroll; nothing else scrolls sideways. | Every task | Applies down to 320 CSS px. | Critical |

### Setup

| ID | State | What the person sees | What they can do | Recovery and timings | Severity |
|---|---|---|---|---|---|
| B1 | Gateway port in use | Gateway page: "The Gateway couldn't start: port 9300 is in use." The Console works without it. | Copy the line that changes the port in docker-compose.yaml | Takes effect on restart of the Console. | Major |
| B2 | Request from a browser refused | Gateway page and Calls: "Refused 3 requests sent from a browser page." With the time of the last one. | Read why | Counted for the run. The browser request gets 403 with a message naming the Console. | Minor |
| B3 | Headers and status only | Every Call says "Body not recorded" in place of each body. The setting is shown on Calls. | Turn the setting off | Applies to new Calls only; recorded bodies stay as they were. | Minor |
| B4 | Gateway used over TLS without trust | The Call is not recorded, since the connection never completes. Gateway page: "A TLS connection was refused because the caller didn't trust the Gateway's certificate." | Use the http line, or copy the certificate path | The count resets with the run. | Major |

### Calls

| ID | State | What the person sees | What they can do | Recovery and timings | Severity |
|---|---|---|---|---|---|
| C1 | No Calls match the filter | "No Calls match 'putitem'." Filter chips that are on are listed. | Clear the filter; turn chips off | | Minor |
| C2 | Call limit reached | At the end of the list: "Older Calls are removed to keep the latest 5,000." | Clear Calls | Shown once the first Call is removed. | Minor |
| C3 | Many Calls arriving | New Calls join the list without moving the selected row. When the list is scrolled: "12 new Calls" at its top. | Show new Calls | Announcement rules are in the accessibility document. | Major |
| C4 | Body cut at 256 KB | The body ends with "Cut at 256 KB of 1.8 MB." | Copy what was kept | | Minor |
| C5 | Body is binary or compressed | "Binary body, 48 KB. Not shown." With the content type. | Copy as base64 | | Minor |
| C6 | Sensitive field | Value shown as "Hidden". A Show button reveals it for that Call only. | Show; hide again | Hidden again on leaving the Call. | Major |
| C7 | Response cannot be read with the model | The raw response, with "This response doesn't match the model for PutRule." The Verdict is Unclear. | Copy | | Major |
| C8 | Call still in progress | Row shows "Waiting" in place of the status. Detail shows the request only. | Wait; go elsewhere | Response appears when it arrives. After 60 s: "No response after 60 s." | Minor |
| C9 | Clear Calls | Confirmation (alert): "Clear all Calls?" "The Console keeps no other copy." Buttons: Cancel, Clear. | Cancel; Clear | Escape cancels. Neither button is the default. | Major |

### Services and resources

| ID | State | What the person sees | What they can do | Recovery and timings | Severity |
|---|---|---|---|---|---|
| D1 | Service the Emulator doesn't offer (from Find) | "AWS Emulator doesn't offer OpenSearch Memory." | Find another | | Minor |
| D2 | List answers a modelled or undeclared error | "ListActivities answered 500 InternalFailure." Last rows read stay, marked with their read time (drawn). | Try again; open the Call-like detail | The Verdict rules apply. | Major |
| D3 | Global service | IAM, S3 bucket list and others read without a Region. The Region picker says "Not used by IAM." | | | Minor |
| D4 | Detail operation not implemented | The fields from the list, with "DescribeVpcEndpoint isn't implemented in 1.0.509, so these are the fields from the list." | Open the operation | | Minor |

### Operation form

| ID | State | What the person sees | What they can do | Recovery and timings | Severity |
|---|---|---|---|---|---|
| E1 | Leaving with unsent input | Input is kept per operation for the browser session. Returning shows "Restored the input you left at 14:09." | Clear the form | Kept until the tab closes. | Critical |
| E2 | No response | After 2 s Cancel appears. After 30 s: "No response after 30 s." The input stays. | Cancel; send again | The request may still have reached the Emulator; the message says so. | Major |
| E3 | Fields and JSON disagree | Switching to Fields with JSON that does not parse: "The JSON doesn't parse at line 4." The view stays on JSON. | Fix the JSON | | Major |
| E4 | Member the form cannot draw | Event streams: "Event streams can't be sent from the Console." Send is disabled with that reason. | Use the SDK | | Minor |
| E5 | Blob or streaming input | A choice of text, base64 or file. | Choose a file | | Minor |
| E6 | Response is large | Over 256 KB: the first 256 KB, as C4. | Copy | | Minor |
| E7 | Input breaks the model | Field marked; Send stays available (drawn). | Send anyway | | Minor |

### Markers

| ID | State | What the person sees | What they can do | Recovery and timings | Severity |
|---|---|---|---|---|---|
| F1 | Setting a Marker | "Reading S3 (2 of 8)…" in the button area. | Cancel | A service that cannot be read is named and left out: "Not compared: SNS didn't answer." | Major |
| F2 | Nothing changed | "Nothing added or removed since 14:02." With the limits (drawn). | Compare again | | Minor |
| F3 | Marker from another Region | "This Marker was set in us-east-1." | Switch to us-east-1 | | Minor |

## Edge Case Catalog

| Scenario | What the design does now | Change | Severity |
|---|---|---|---|
| The Console's own reads may keep an idle Emulator alive | Not addressed | Reads happen only on focus, after a write Call, or on request, so a Console left in a background tab sends nothing. | Major |
| Two Emulators on different ports | One Emulator per Console | Calls through the Gateway still reach only the configured one; setup says which. | Minor |
| A Call from another SDK fails signature checks through the Gateway | Untested outside JavaScript | Verdict Unclear, with: "Signature checks failed through the Gateway. Try sending it straight to the Emulator." | Major |
| 436 services in the A–Z list | Drawn as a table | Filter field keeps focus on open; letters jump with the keyboard. | Minor |
| An operation with 60 optional fields | Optional fields behind a disclosure | Disclosure lists names; a filter appears past 12. | Minor |
| No Console tab is open while code calls the Gateway | Records, and nothing says so | Keeps recording. The Gateway page says Calls are recorded whenever the Console runs, open tab or not, and the endpoint shows that recording is on. | Major |
| Text in another script in a resource name | Not drawn | Names render as given; no layout depends on name width. | Cosmetic |

## Open Questions

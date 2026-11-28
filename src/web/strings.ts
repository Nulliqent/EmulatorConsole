// Every string the shell shows. The copy deck, docs/design/copy-emulator-console.md, is the one home for them
// ("deck"); "prototype" marks a string from docs/design/prototype that the deck also lists.

export const S = {
  appName: "Emulator Console", // prototype
  tagline: "for AWS Emulator", // prototype
  notAffiliated: "Not affiliated with AWS.", // prototype
  skip: "Skip to content", // deck
  hideSidebar: "Hide sidebar", // deck
  showSidebar: "Show sidebar", // deck
  menu: "Menu", // prototype
  findPlaceholder: "Find a service or operation", // deck
  regionLabel: "Active Region", // prototype
  setMarker: "Set a Marker", // prototype
  markerReason: "Can't set a Marker while the Emulator isn't answering.", // deck
  connected: (address: string) => `Connected · ${address}`, // deck
  notAnswering: (address: string) => `Not answering · ${address}`, // deck

  noticeDownTitle: "The Emulator isn't answering", // deck A1
  noticeDownText: (time: string) => `Last answer at ${time}. What's on screen may be out of date.`, // deck A1
  noticeIdleText: (time: string) => `Last answer at ${time}. It may have stopped after a period with no API calls.`, // deck A3
  noticeNeverAnswered: "No answer since the Console started.", // deck
  copyRestart: "Copy restart command", // deck A1
  copyStart: "Copy start command", // deck A3
  restartCommand: "docker compose restart", // deck
  startCommand: "docker compose up -d", // deck
  noticeRestartedTitle: "The Emulator has restarted and its resources were lost", // deck A2
  noticeRestartedText: (time: string) => `Noticed at ${time}. Calls from the earlier run are kept. Its Markers have ended.`, // deck A2
  dismiss: "Dismiss", // deck A2
  consoleDownTitle: "The Console isn't answering", // deck
  consoleDownText: "Check that it is running.", // deck
  statusUnknown: "Status unknown", // deck
  markerReasonConsole: "Can't set a Marker while the Console isn't answering.", // deck
  lastAnswerAt: (time: string) => `Last answer at ${time}.`, // deck
  copyStartOnPage: "Copy start command from the Connection page", // accessible name; not shown
  copyRestartOnPage: "Copy restart command from the Connection page", // accessible name; not shown

  copied: "Copied", // deck
  copyFailed: "Couldn't copy. Select the text and copy it.", // deck A9

  announceDown: "The Emulator isn't answering.", // accessibility doc
  announceUp: "The Emulator is answering again.", // accessibility doc
  announceRestarted: "The Emulator restarted. Its resources were lost.", // accessibility doc

  connectionTitle: "Connection", // prototype
  connectionSub: "The Console connects to one Emulator, set when it starts.", // prototype
  connectionSteps: "Steps", // deck
  stepHeader: "Step", // prototype
  resultHeader: "Result", // prototype
  reach: (address: string) => `Reach ${address}`, // prototype
  trust: "Trust the certificate", // prototype
  keys: "Read the keys", // prototype
  answered: "Answered", // prototype
  noAnswer: "No answer", // prototype
  trusted: "Trusted", // prototype
  keysRead: (path: string) => `Read: ${path}`, // prototype
  notChecked: "Not checked", // deck
  noCa: "Not trusted: this run's ca.pem isn't there", // deck
  untrusted: "Not trusted: the certificate doesn't chain to this run's ca.pem", // deck
  keysMissing: (path: string) => `Not found: ${path}`, // deck
  restartIt: "Restart it with:", // prototype
  startIt: "Start it with:", // deck
  tryAgain: "Try again", // prototype
  checking: "Checking…", // deck
  tabConnection: "Connection", // prototype
  tabGateway: "Gateway", // prototype

  gatewaySub: "Optional. Services, Operations and Markers work without it.", // prototype
  recordedTitle: "What is recorded", // prototype
  recordedText: "Every request sent through the Gateway and its response, in memory on this computer only. DynamoDB items and SQS message bodies are shown as sent.", // prototype
  keptLabel: "Kept", // prototype
  keptText: "Latest 5,000 Calls, bodies up to 256 KB", // prototype
  neverKeptLabel: "Never kept", // prototype
  neverKeptText: "Signatures and session tokens", // prototype
  hiddenLabel: "Hidden until shown", // prototype
  hiddenText: "Fields AWS marks as sensitive", // prototype
  headersOnly: "Record headers and status only", // prototype
  pointTitle: "Point your SDK at the Gateway", // prototype
  copyEndpoint: "Copy", // prototype
  copyEndpointOnPage: "Copy the SDK settings", // accessible name; not shown
  sdkNeeds: "Use the Emulator's own keys, as above, and any Region. Your SDK signs with them and the Emulator checks the signature.", // deck
  certTitle: "If your SDK follows https URLs", // deck
  certWhy: "SQS queue URLs and presigned S3 links come back from the Emulator as https. They reach the Gateway, and are recorded, only when your SDK trusts the Gateway's certificate:", // deck
  certStep1: "1. Download the certificate:", // deck
  certStep2: "2. Tell your SDK to trust it, for Node and for the AWS CLI and other SDKs:", // deck
  certNoVirtualHost: "https to virtual-host bucket names (bucket.localhost) isn't supported. Use path style, or plain http.", // deck
  waitingFirst: "Waiting for the first Call.", // prototype
  firstCall: (operation: string, time: string) => `First Call recorded: ${operation} at ${time}.`, // deck
  updatesWhen: "This page updates when one arrives.", // prototype
  browserRefusedNote: "Requests from a browser are refused.", // prototype
  straightToEmulator: "SQS queue URLs and presigned S3 links lead back to the Gateway. URLs for other services may lead straight to the Emulator, and requests to those aren\u2019t recorded.", // deck
  recordsAlways: "The Gateway records whenever the Console runs, with or without an open tab.", // decisions 2026-11-26
  recordingOn: "Recording is on.", // decisions 2026-11-26
  gatewayPortInUse: (port: number) => `The Gateway couldn't start: port ${port} is in use.`, // deck B1
  gatewayPortInUseHelp: "The Console works without it. To use another port, set this in docker-compose.yaml and restart the Console:", // deck B1
  gatewayFailed: "The Gateway couldn't start. The Console works without it.", // added
  copyPortLine: "Copy the line", // deck B1
  refusedFromBrowser: (count: number, time: string) => `Refused ${count} ${count === 1 ? "request" : "requests"} sent from a browser page. Last at ${time}.`, // deck B2
  tlsRefused: (count: number, time: string) => `A TLS connection was refused because the caller didn't trust the Gateway's certificate. ${count === 1 ? "Once" : `${count} times`}, last at ${time}.`, // deck B4
  tlsHelp: "Use the http line above, or follow the certificate steps.", // deck B4
  settingFailed: "Couldn't change the setting. The Console didn't answer.", // deck
  gatewayUnknown: "The Console didn't answer.", // added
  servicesTitle: "Services", // prototype
  servicesOffered: (count: number) => `${count} offered by this Emulator`, // prototype
  seenThisRun: "Seen this run", // prototype
  filterServices: "Filter services", // prototype (accessible name)
  filterServicesPlaceholder: "Filter services by name or SDK ID", // deck
  filterGroup: "Show only", // deck (accessible name of the chip group)
  chipCurated: "Curated", // prototype
  chipLists: "Has resource lists", // prototype
  chipImplemented: (version: string) => `Everything implemented in ${version}`, // deck
  curatedBadge: "Curated", // prototype
  colService: "Service", // prototype
  colSdkId: "SDK ID", // prototype
  colResources: "Resources", // prototype
  colEmulator: (version: string) => `Emulator ${version}`, // prototype
  resourcesListed: "Listed", // prototype
  resourcesGetSearch: "Lists by Get or Search", // deck
  resourcesNeedInput: "Lists need input", // prototype
  resourcesNone: "No list", // deck
  allImplemented: "All implemented", // prototype
  someNotImplemented: "Some not implemented", // prototype
  servicesShown: (shown: number, total: number) => (shown === total ? `${total} services` : `${shown} of ${total} services`), // deck
  servicesNoMatch: (text: string, withFilters: boolean) => (text ? (withFilters ? `No services match "${text}" with these filters.` : `No services match "${text}".`) : "No services match these filters."), // deck
  clearFilters: "Clear filters", // deck
  servicesFailed: "Couldn't read the list of services.", // deck
  labelsNote: (version: string) => `Labels describe Emulator ${version}. The Emulator doesn't report its version, so yours may differ.`, // prototype
  servicesLoading: "Reading the list of services…", // deck
  servicesTable: "Services table", // deck (accessible name of the table)
  colEmulatorPlain: "Emulator", // deck (heading while the version is not yet read)
  servicesJumpHint: "Focus a service and type letters to jump to it.", // deck

  findLabel: "Find", // deck
  findGroupServices: "Services", // prototype
  findGroupOperations: "Operations", // prototype
  findResults: (count: number) => (count === 0 ? "No results" : count === 1 ? "1 result" : `${count} results`), // deck (announced)
  findResultsCapped: (count: number) => `${count} results, more not shown`, // deck (announced when the cap cut the list)
  findNotImplemented: (version: string) => `Not implemented in ${version}`, // prototype
  findNoMatch: (text: string) => `No service or operation matches "${text}".`, // deck
  findBrowse: "Browse all services", // prototype
  findNotOffered: (service: string) => `AWS Emulator doesn't offer ${service}.`, // deck D1
  findMoreServices: (count: number) => `${count} more services. Type more to narrow them.`, // deck
  findMoreOperations: (count: number) => `${count} more operations. Type more to narrow them.`, // deck
  findFailed: "Couldn't search. The Console isn't answering.", // deck

  tabResources: "Resources", // prototype
  tabOperations: "Operations", // prototype
  tabCalls: "Calls", // prototype
  crumbServices: "Services", // prototype
  serviceNotFoundTitle: "Service not found", // deck
  serviceNotFoundText: (name: string) => `The Emulator doesn't offer a service called ${name}.`, // deck

  placeholder: "This page isn't built yet.", // deck
  notFoundTitle: "Page not found", // deck
  notFoundText: "There is no page at this address.", // deck
  loading: "Checking the Emulator.", // deck
} as const;

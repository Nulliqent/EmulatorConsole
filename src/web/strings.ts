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

  placeholder: "This page isn't built yet.", // deck
  notFoundTitle: "Page not found", // deck
  notFoundText: "There is no page at this address.", // deck
  loading: "Checking the Emulator.", // deck
} as const;

import { useState } from "react";
import type { ConnectionSteps } from "../../shared/api";
import { CopyButton } from "../CopyButton";
import { formatTime } from "../format";
import { Icon } from "../icons";
import { stoppedCleanly } from "../emulatorState";
import { Link, useRouter } from "../router";
import { S } from "../strings";
import { useStatus } from "../status";
import { Page } from "./Page";

function SetupTabs() {
  const { pathname: path } = useRouter();
  const gateway = path === "/setup/gateway";
  return (
    <nav className="tabs glass" aria-label="Setup">
      <Link to="/setup" aria-current={gateway ? undefined : "page"}>
        {S.tabConnection}
      </Link>
      <Link to="/setup/gateway" aria-current={gateway ? "page" : undefined}>
        {S.tabGateway}
      </Link>
    </nav>
  );
}

function trustText(trust: ConnectionSteps["trust"]): string {
  return { trusted: S.trusted, untrusted: S.untrusted, "no-ca": S.noCa, unknown: S.notChecked }[trust];
}

function reachText(reach: ConnectionSteps["reach"]): string {
  return { answered: S.answered, "no-answer": S.noAnswer, unknown: S.notChecked }[reach];
}

/** Setup › Connection (`scr-connect`): the three steps and what each found. */
export function Connection() {
  const { emulator, checkNow } = useStatus();
  const [checking, setChecking] = useState(false);
  const down = emulator !== null && !emulator.reachable;
  const idle = emulator !== null && stoppedCleanly(emulator);
  const command = idle ? S.startCommand : S.restartCommand;

  async function tryAgain() {
    if (checking) return;
    setChecking(true);
    await checkNow();
    setChecking(false);
  }

  return (
    <Page title={S.connectionTitle} sub={S.connectionSub}>
      <SetupTabs />
      <div className="panel pad connection">
        <h2 className="sr">{S.connectionSteps}</h2>
        {emulator === null ? (
          <p className="muted">{S.loading}</p>
        ) : (
          <>
            {down && (
              <div className="callout bad">
                <Icon name="alert" />
                <div>
                  <b>{S.noticeDownTitle}</b>
                  <p>{emulator.lastAnswerAt ? S.lastAnswerAt(formatTime(emulator.lastAnswerAt)) : S.noticeNeverAnswered}</p>
                </div>
              </div>
            )}
            <table className="t" data-testid="steps">
              <thead>
                <tr>
                  <th scope="col">{S.stepHeader}</th>
                  <th scope="col">{S.resultHeader}</th>
                </tr>
              </thead>
              <tbody>
                <tr data-step="reach">
                  <td>{S.reach(emulator.address)}</td>
                  <td>{reachText(emulator.steps.reach)}</td>
                </tr>
                <tr data-step="trust">
                  <td>{S.trust}</td>
                  <td>{trustText(emulator.steps.trust)}</td>
                </tr>
                <tr data-step="keys">
                  <td>{S.keys}</td>
                  <td>{emulator.steps.keys === "read" ? S.keysRead(emulator.keysPath) : S.keysMissing(emulator.keysPath)}</td>
                </tr>
              </tbody>
            </table>
            {down && (
              <>
                <p className="after">{idle ? S.startIt : S.restartIt}</p>
                <pre className="code" tabIndex={0}>
                  {command}
                </pre>
                <div className="acts">
                  <CopyButton
                    text={command}
                    label={idle ? S.copyStart : S.copyRestart}
                    ariaLabel={idle ? S.copyStartOnPage : S.copyRestartOnPage}
                  />
                  <button type="button" className="btn primary" onClick={tryAgain} aria-disabled={checking}>
                    {checking ? S.checking : S.tryAgain}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

export function Gateway() {
  return (
    <Page title={S.tabGateway}>
      <SetupTabs />
      <p className="muted">{S.placeholder}</p>
    </Page>
  );
}

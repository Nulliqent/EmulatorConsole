import { useState } from "react";
import type { ConnectionSteps } from "../../shared/api";
import { CopyButton } from "../CopyButton";
import { formatTime } from "../format";
import { Icon } from "../icons";
import { stoppedCleanly } from "../emulatorState";
import { Link, useRouter } from "../router";
import { S } from "../strings";
import { useStatus } from "../status";
import { firstCallText, useGatewayStatus } from "../gateway";
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

/** The SDK settings and the statement that recording is on. Shown wherever the endpoint is shown. */
export function EndpointLine({ endpoint, keysPath, state }: { endpoint: string; keysPath: string | undefined; state: "listening" | "port-in-use" | "failed" }) {
  const lines = [
    `AWS_ENDPOINT_URL=${endpoint}`,
    ...(keysPath ? [`AWS_SHARED_CREDENTIALS_FILE=~/${keysPath}`] : []),
    "AWS_REGION=us-east-1",
  ].join("\n");
  return (
    <>
      <pre className="code" tabIndex={0} data-testid="endpoint">
        {lines}
      </pre>
      <div className="acts">
        <CopyButton text={lines} label={S.copyEndpoint} ariaLabel={S.copyEndpointOnPage} />
      </div>
      <p className="meta">{S.sdkNeeds}</p>
      <p className="meta" data-testid="recording">
        {state === "listening" ? `${S.recordingOn} ` : ""}
        {S.recordsAlways}
      </p>
    </>
  );
}

/** Setup > Gateway (`scr-gateway`). */
export function Gateway() {
  const { status, failed, saveFailed, setHeadersOnly } = useGatewayStatus();
  const { emulator } = useStatus();
  const portLine = status ? `GATEWAY_PORT=${status.port + 1}` : "";
  const refused = status?.refusedFromBrowser;
  const tlsRefused = status?.tlsRefused;
  const certUrl = status ? `${window.location.origin}${status.certificatePath}` : "";
  return (
    <Page title={S.tabGateway} sub={S.gatewaySub}>
      <SetupTabs />
      {failed && <p className="muted">{S.gatewayUnknown}</p>}
      {status === null ? (
        !failed && <p className="muted">{S.loading}</p>
      ) : (
        <div className="grid2">
          <section className="panel pad" aria-labelledby="gw-recorded">
            <h2 id="gw-recorded">{S.recordedTitle}</h2>
            <p>{S.recordedText}</p>
            <table className="t">
              <tbody>
                <tr><th scope="row">{S.keptLabel}</th><td>{S.keptText}</td></tr>
                <tr><th scope="row">{S.neverKeptLabel}</th><td>{S.neverKeptText}</td></tr>
                <tr><th scope="row">{S.hiddenLabel}</th><td>{S.hiddenText}</td></tr>
              </tbody>
            </table>
            <label className="check">
              <input type="checkbox" checked={status.headersOnly} onChange={(e) => void setHeadersOnly(e.target.checked)} /> {S.headersOnly}
            </label>
            {saveFailed && <p className="meta" role="alert" data-testid="save-failed">{S.settingFailed}</p>}
          </section>
          <section className="panel pad" aria-labelledby="gw-point">
            <h2 id="gw-point">{S.pointTitle}</h2>
            {status.state === "listening" ? (
              <>
                <EndpointLine endpoint={status.endpoint} keysPath={emulator?.keysPath} state={status.state} />
                <p className="inline-status" data-testid="first-call">
                  <Icon name="info" />
                  <span>
                    <b>{status.firstCall ? firstCallText(status.firstCall) : S.waitingFirst}</b>{" "}
                    {status.firstCall ? S.browserRefusedNote : `${S.updatesWhen} ${S.browserRefusedNote}`}
                  </span>
                </p>
                <h3 className="steps-title">{S.certTitle}</h3>
                <p className="meta">{S.certWhy}</p>
                <ol className="steps">
                  <li>
                    {S.certStep1}
                    <pre className="code" tabIndex={0}>{`curl -o gateway.pem ${certUrl}`}</pre>
                  </li>
                  <li>
                    {S.certStep2}
                    <pre className="code" tabIndex={0}>{"NODE_EXTRA_CA_CERTS=./gateway.pem\nAWS_CA_BUNDLE=./gateway.pem"}</pre>
                  </li>
                </ol>
                <p className="meta">{S.certNoVirtualHost}</p>
                <p className="meta">{S.straightToEmulator}</p>
              </>
            ) : (
              <div className="callout bad" data-testid="gateway-down">
                <Icon name="alert" />
                <div>
                  <b>{status.state === "port-in-use" ? S.gatewayPortInUse(status.port) : S.gatewayFailed}</b>
                  {status.state === "port-in-use" && (
                    <>
                      <p>{S.gatewayPortInUseHelp}</p>
                      <pre className="code" tabIndex={0}>{portLine}</pre>
                      <div className="acts"><CopyButton text={portLine} label={S.copyPortLine} /></div>
                    </>
                  )}
                </div>
              </div>
            )}
            {refused && refused.count > 0 && (
              <p className="meta" data-testid="refused">{S.refusedFromBrowser(refused.count, formatTime(refused.lastAt!))}</p>
            )}
            {tlsRefused && tlsRefused.count > 0 && (
              <p className="meta" data-testid="tls-refused">{S.tlsRefused(tlsRefused.count, formatTime(tlsRefused.lastAt!))} {S.tlsHelp}</p>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

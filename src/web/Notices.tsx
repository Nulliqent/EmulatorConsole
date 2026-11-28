import type { EmulatorStatus } from "../shared/api";
import { CopyButton } from "./CopyButton";
import { stoppedCleanly } from "./emulatorState";
import { focusHeading } from "./focus";
import { formatTime } from "./format";
import { Icon } from "./icons";
import { S } from "./strings";
import { useStatus } from "./status";

export function DownNotice({ emulator }: { emulator: EmulatorStatus }) {
  const idle = stoppedCleanly(emulator);
  const command = idle ? S.startCommand : S.restartCommand;
  const text = emulator.lastAnswerAt
    ? (idle ? S.noticeIdleText : S.noticeDownText)(formatTime(emulator.lastAnswerAt))
    : S.noticeNeverAnswered;
  return (
    <div className="notice alert" data-testid="notice-down" data-state={idle ? "A3" : "A1"}>
      <Icon name="alert" />
      <div className="notice-body">
        <h2>{S.noticeDownTitle}</h2>
        <p>{text}</p>
      </div>
      <div className="notice-acts">
        <code className="cmd">{command}</code>
        <CopyButton text={command} label={idle ? S.copyStart : S.copyRestart} />
      </div>
    </div>
  );
}

export function RestartNotice({ at, onDismiss }: { at: string; onDismiss: () => void }) {
  return (
    <div className="notice alert" data-testid="notice-restart">
      <Icon name="alert" />
      <div className="notice-body">
        <h2>{S.noticeRestartedTitle}</h2>
        <p>{S.noticeRestartedText(formatTime(at).slice(0, 5))}</p>
      </div>
      <div className="notice-acts">
        <button type="button" className="btn" onClick={onDismiss}>
          {S.dismiss}
        </button>
      </div>
    </div>
  );
}

/** Notices sit below the toolbar on every page. Announcements are made by the status provider, not here. */
export function Notices() {
  const { emulator, consoleDown, restartVisible, dismissRestart } = useStatus();
  return (
    <div className="notices">
      {consoleDown && (
        <div className="notice alert" data-testid="notice-console">
          <Icon name="alert" />
          <div className="notice-body">
            <h2>{S.consoleDownTitle}</h2>
            <p>{S.consoleDownText}</p>
          </div>
          <div className="notice-acts">
            <code className="cmd">{S.startCommand}</code>
          </div>
        </div>
      )}
      {emulator && !emulator.reachable && <DownNotice emulator={emulator} />}
      {restartVisible && emulator?.restartedAt && (
        <RestartNotice
          at={emulator.restartedAt}
          onDismiss={() => {
            // The Dismiss button is about to leave the page; focus goes to the page's h1 rather than to nothing.
            focusHeading();
            dismissRestart();
          }}
        />
      )}
    </div>
  );
}

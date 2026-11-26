import type { Ref } from "react";
import { FIND_HINT } from "./FindDialog";
import { Icon } from "./icons";
import { REGIONS, useRegion } from "./region";
import { S } from "./strings";
import { useStatus } from "./status";

type Props = {
  onFind: () => void;
  sidebarHidden: boolean;
  onShowSidebar: () => void;
  showSidebarRef: Ref<HTMLButtonElement>;
};

export function Toolbar({ onFind, sidebarHidden, onShowSidebar, showSidebarRef }: Props) {
  const { emulator, consoleDown } = useStatus();
  const [region, setRegion] = useRegion();
  const address = emulator?.address ?? "";
  // When the Console itself isn't answering, what the page last knew about the Emulator is stale: show unknown.
  const unknown = consoleDown || emulator === null;
  const down = !unknown && !emulator.reachable;
  const blocked = consoleDown || down;
  const reason = consoleDown ? S.markerReasonConsole : down ? S.markerReason : null;
  const options = REGIONS.includes(region) ? REGIONS : [region, ...REGIONS];

  return (
    <header className="toolbar-wrap" aria-label="Toolbar">
      <div className="toolbar">
        {sidebarHidden && (
          <button type="button" className="capsule glass showside" ref={showSidebarRef} onClick={onShowSidebar}>
            <Icon name="sidebar" />
            {S.showSidebar}
          </button>
        )}
        <button type="button" className="capsule glass findbtn" onClick={onFind} aria-haspopup="dialog">
          <Icon name="find" />
          {S.findPlaceholder}
          <kbd>{FIND_HINT}</kbd>
        </button>
        <span className="grow" />
        <label className="capsule glass regioncap">
          <span className="sr">{S.regionLabel}</span>
          <select className="region" value={region} onChange={(e) => setRegion(e.target.value)}>
            {options.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Icon name="chevrons" />
        </label>
        <span className={`capsule glass conn${down || consoleDown ? " down" : ""}`} data-testid="conn">
          {unknown ? (consoleDown ? S.statusUnknown : S.loading) : down ? S.notAnswering(address) : S.connected(address)}
        </span>
        {/* aria-disabled, not disabled, so the button keeps focus and its reason can be read. Markers arrive in #13. */}
        <button
          type="button"
          className="capsule primary"
          data-testid="set-marker"
          aria-disabled={blocked}
          aria-describedby={reason ? "marker-reason" : undefined}
          onClick={(e) => {
            if (blocked) e.preventDefault();
          }}
        >
          {S.setMarker}
        </button>
      </div>
      {reason && (
        <p className="marker-reason" id="marker-reason" data-testid="marker-reason">
          {reason}
        </p>
      )}
    </header>
  );
}

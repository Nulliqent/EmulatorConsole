import { forwardRef, useImperativeHandle, useRef } from "react";
import { S } from "./strings";

/** The Find shortcut: Command-K on macOS, Control-K elsewhere. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const FIND_HINT = IS_MAC ? "⌘K" : "Ctrl K";

export type FindHandle = { open: () => void };

/**
 * Find's frame. It is an empty dialog for now: the native dialog owns whether it is open (showModal, Escape and a
 * click on the backdrop close it) and returns focus to the control that opened it. showModal() moves focus to the
 * input, the dialog's first focusable control. Results come later.
 */
export const FindDialog = forwardRef<FindHandle>(function FindDialog(_props, ref) {
  const dialog = useRef<HTMLDialogElement>(null);

  useImperativeHandle(ref, () => ({
    open: () => {
      if (dialog.current && !dialog.current.open) dialog.current.showModal();
    },
  }));

  return (
    <dialog
      ref={dialog}
      id="find"
      aria-label="Find"
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close(); // the backdrop
      }}
    >
      <div className="dlg">
        <input type="text" placeholder={S.findPlaceholder} aria-label={S.findPlaceholder} autoComplete="off" />
      </div>
    </dialog>
  );
});

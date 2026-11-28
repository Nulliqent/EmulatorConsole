/** Moves focus to the page's h1 (keyboard map: page load, navigation, and Dismiss on the restart notice). */
export function focusHeading(): void {
  document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
}

import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, consoleSees } from "./console.js";
import { restartEmulator, startEmulator, stopEmulator } from "./emulator.js";

// These tests stop and restart the stack's Emulator. Each leaves it running, and only acts on a stack this
// checkout started (see emulator.ts).
test.describe.configure({ mode: "serial" });

const NOTICE_WITHIN_MS = 35_000;

test.beforeEach(async ({ page }) => {
  // A start that was left half done by an earlier failure.
  try {
    startEmulator();
  } catch {
    // Already running.
  }
  await consoleSees(page.request, true);
});

test.afterAll(async ({ browser }) => {
  try {
    startEmulator();
  } catch {
    // Already running.
  }
  const page = await browser.newPage();
  await consoleSees(page.request, true);
  await page.close();
});

test("stopping the Emulator shows the notice within 35 s, and starting it clears it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await page.goto("/run");
  await expect(page.getByTestId("conn")).toHaveText("Connected · 127.0.0.1:19297");

  stopEmulator();
  const stoppedAt = Date.now();
  const notice = page.getByTestId("notice-down");
  await expect(notice).toBeVisible({ timeout: NOTICE_WITHIN_MS });
  console.log(`notice shown ${Date.now() - stoppedAt} ms after stop`);
  await expect(notice.getByRole("heading", { name: "The Emulator isn't answering" })).toBeVisible();
  await expect(notice).toContainText(/Last answer at \d\d:\d\d:\d\d\./);
  await expect(page.getByTestId("conn")).toHaveText("Not answering · 127.0.0.1:19297");
  await expect(page.getByTestId("live-assertive")).toHaveText("The Emulator isn't answering.");

  // The down state, with the notice and the reason line, passes the same accessibility checks (contrast included).
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), scheme).toEqual([]);
  }

  // The reason Set a Marker is unavailable is visible text, and the button keeps focus.
  const marker = page.getByTestId("set-marker");
  await expect(marker).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("marker-reason")).toBeVisible();
  await expect(page.getByTestId("marker-reason")).toHaveText("Can't set a Marker while the Emulator isn't answering.");
  await expect(marker).toHaveAccessibleDescription("Can't set a Marker while the Emulator isn't answering.");
  await marker.focus();
  await expect(marker).toBeFocused();

  // The notice follows to other pages, and its Copy button says Copied.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Calls" }).click();
  await expect(notice).toBeVisible();
  // With a notice showing, the landmarks are still exactly banner, navigation "Main" and main.
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("navigation")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  for (const role of ["region", "complementary", "contentinfo", "form", "search"] as const) {
    await expect(page.getByRole(role), role).toHaveCount(0);
  }
  // Nothing is listening, so this is A3: the idle-stop line and the start command.
  await expect(notice).toHaveAttribute("data-state", "A3");
  await expect(notice).toContainText("It may have stopped after a period with no API calls.");
  const copy = notice.getByRole("button", { name: "Copy start command" });
  await copy.click();
  await expect(notice.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(copy).toBeVisible({ timeout: 4000 }); // back to its label after 2 s
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("docker compose up -d");

  // The Connection page shows the step that failed.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Setup" }).click();
  await expect(page.locator('[data-step="reach"]')).toContainText("No answer");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // The notice's and the page's copy buttons have different names.
  await expect(page.getByRole("button", { name: "Copy start command", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Copy start command from the Connection page" })).toHaveCount(1);

  startEmulator();
  await expect(notice).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId("conn")).toHaveText("Connected · 127.0.0.1:19297");
  await expect(page.getByTestId("marker-reason")).toHaveCount(0);
  await expect(page.getByTestId("set-marker")).toHaveAttribute("aria-disabled", "false");
});

test("a restart shows the restart notice on every page, and Dismiss hides it for the session", async ({ page }) => {
  await page.goto("/calls");
  const restart = page.getByTestId("notice-restart");
  await expect(page.getByTestId("conn")).toHaveText(/Connected/);
  // An earlier test's restart stays on record in the Console; this tab's session hasn't dismissed it yet.
  if ((await restart.count()) > 0) await restart.getByRole("button", { name: "Dismiss" }).click();
  await expect(restart).toHaveCount(0);

  const focusBefore = await page.evaluate(() => document.activeElement?.tagName);
  restartEmulator();
  await expect(restart).toBeVisible({ timeout: 90_000 });
  await expect(restart.getByRole("heading", { name: "The Emulator has restarted and its resources were lost" })).toBeVisible();
  await expect(restart).toContainText(/Noticed at \d\d:\d\d\. Calls from the earlier run are kept\. Its Markers have ended\./);

  // Focus is unchanged by its arrival, and it follows the Developer around.
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(focusBefore);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Services" }).click();
  await expect(restart).toBeVisible();
  await page.goto("/setup");
  await expect(restart).toBeVisible();

  // The keys never reach the browser.
  const body = await (await page.request.get("/api/health")).text();
  const credentials = readFileSync(path.resolve(import.meta.dirname, "..", "..", ".aws", "e2e", "19297", "emulator_credentials"), "utf8");
  const values = [...credentials.matchAll(/=\s*(\S+)/g)].map((m) => m[1]!);
  expect(values.length).toBeGreaterThanOrEqual(2);
  // Booleans, so a failure never prints a key.
  for (const v of values) expect(body.includes(v), "the health response carries a key value").toBe(false);
  expect(body).not.toMatch(/fingerprint|hash|sha256/i);

  await restart.getByRole("button", { name: "Dismiss" }).click();
  await expect(restart).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Connection" })).toBeFocused(); // keyboard map: Dismiss
  await page.reload();
  await expect(page.getByTestId("conn")).toHaveText(/Connected/);
  await expect(restart).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Calls" }).click();
  await expect(restart).toHaveCount(0);
});

test("the notice and the page have no horizontal scroll at 320 px while the Emulator is down", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/setup");
  stopEmulator();
  try {
    await expect(page.getByTestId("notice-down")).toBeVisible({ timeout: NOTICE_WITHIN_MS });
    await expect(page.getByTestId("marker-reason")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    startEmulator();
    await consoleSees(page.request, true);
  }
});

test("when the Console itself doesn't answer, the toolbar shows unknown and Set a Marker is blocked", async ({ page }) => {
  await page.goto("/run");
  await expect(page.getByTestId("conn")).toHaveText(/Connected/);
  await page.route("**/api/health", (route) => route.abort());
  await expect(page.getByTestId("notice-console")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("conn")).toHaveText("Status unknown");
  await expect(page.getByTestId("set-marker")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("marker-reason")).toHaveText("Can't set a Marker while the Console isn't answering.");
  await page.unroute("**/api/health");
  await expect(page.getByTestId("conn")).toHaveText(/Connected/, { timeout: 10_000 });
  await expect(page.getByTestId("notice-console")).toHaveCount(0);
});

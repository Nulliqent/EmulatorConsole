import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { consoleSees } from "./console.js";

const PATHS = ["/run", "/calls", "/services", "/markers", "/setup", "/setup/gateway"];

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
}

// This file stands alone: it needs the Emulator answering, whatever ran before it.
test.beforeAll(async ({ request }) => {
  await consoleSees(request, true);
});

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

test.describe("the shell, Emulator answering", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`no axe violations (contrast, names, landmarks) on any page, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const p of PATHS) {
        await page.goto(p);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await axeViolations(page), p).toEqual([]);
      }
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto("/setup");
      expect(await axeViolations(page), "/setup at 320 px").toEqual([]);
    });
  }

  test("Escape closes the open menu below 640 px and returns focus to the Menu button", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 700 });
    await page.goto("/run");
    const menu = page.getByRole("button", { name: "Menu" });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("link", { name: "Calls" }).focus();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
  });

  test("serves real paths and shows the landmarks", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByRole("heading", { level: 1, name: "Connection" })).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByTestId("conn")).toHaveText(/^Connected · 127\.0\.0\.1:19297$/);
    expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
  });

  test("skip link is the first stop and moves focus to the h1", async ({ page }) => {
    await page.goto("/calls");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Calls" })).toBeFocused();
  });

  test("navigation moves focus to the new page's h1 and keeps the URL real", async ({ page }) => {
    await page.goto("/run");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Setup" }).click();
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { level: 1, name: "Connection" })).toBeFocused();
    await page.getByRole("navigation", { name: "Setup" }).getByRole("link", { name: "Gateway" }).click();
    await expect(page).toHaveURL(/\/setup\/gateway$/);
    await expect(page.getByRole("heading", { level: 1, name: "Gateway" })).toBeFocused();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Connection" })).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Setup" })).toHaveAttribute("aria-current", "page");
  });

  test("Find opens from the button and from the shortcut, and Escape returns focus", async ({ page }) => {
    await page.goto("/run");
    const find = page.getByRole("button", { name: /Find a service or operation/ });
    await find.click();
    const dialog = page.getByRole("dialog", { name: "Find" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(find).toBeFocused();

    await page.getByRole("link", { name: "Skip to content" }).focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Set a Marker is available while the Emulator answers, with no reason shown", async ({ page }) => {
    await page.goto("/run");
    await expect(page.getByTestId("set-marker")).toHaveAttribute("aria-disabled", "false");
    await expect(page.getByTestId("marker-reason")).toHaveCount(0);
    await expect(page.getByTestId("notice-down")).toHaveCount(0);
  });

  test("the Region choice persists across reloads and is the one later reads use", async ({ page }) => {
    await page.goto("/run");
    const region = page.getByLabel("Active Region");
    await expect(region).toHaveValue("us-east-1");
    await region.selectOption("eu-west-1");
    await page.reload();
    await expect(page.getByLabel("Active Region")).toHaveValue("eu-west-1");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Calls" }).click();
    await expect(page.getByLabel("Active Region")).toHaveValue("eu-west-1");
    expect(await page.evaluate(() => localStorage.getItem("console.region"))).toBe("eu-west-1");
  });

  test("the Connection page shows the three steps", async ({ page }) => {
    await page.goto("/setup");
    const steps = page.getByTestId("steps");
    await expect(steps.locator('[data-step="reach"]')).toHaveText("Reach 127.0.0.1:19297Answered");
    await expect(steps.locator('[data-step="trust"]')).toHaveText("Trust the certificateTrusted");
    await expect(steps.locator('[data-step="keys"]')).toHaveText("Read the keysRead: .aws/emulator/19297/emulator_credentials");
  });

  test("the sidebar hides and shows, and focus follows", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/run");
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Show sidebar" })).toBeFocused();
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide sidebar" })).toBeFocused();
  });

  for (const width of [320, 400, 639]) {
    test(`no horizontal scroll at ${width} px on every page, and the menu opens`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      for (const p of PATHS) {
        await page.goto(p);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await noHorizontalScroll(page);
      }
      await page.goto("/setup");
      const menu = page.getByRole("button", { name: "Menu" });
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("link", { name: "Calls" })).toBeHidden();
      await menu.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await page.getByRole("link", { name: "Calls" }).click();
      await expect(page).toHaveURL(/\/calls$/);
      await noHorizontalScroll(page);
      // Every toolbar control is reachable and not covered at this width.
      for (const target of [page.getByRole("button", { name: /Find a service/ }), page.getByLabel("Active Region"), page.getByTestId("set-marker")]) {
        await expect(target).toBeVisible();
        const box = await target.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
    });
  }

  test("at 1280 px wide and 400% zoom equivalent (320 px), a long Region name does not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.addInitScript(() => localStorage.setItem("console.region", "ap-southeast-2"));
    await page.goto("/setup");
    await noHorizontalScroll(page);
  });

  test("glass has solid fallbacks for increased contrast", async ({ page }) => {
    await page.emulateMedia({ contrast: "more" });
    await page.goto("/run");
    const side = page.getByRole("navigation", { name: "Main" });
    const filter = await side.evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(filter).toBe("none");
  });

  test("glass is on the sidebar and the capsules, not on content", async ({ page }) => {
    await page.goto("/setup");
    const blur = (loc: ReturnType<Page["locator"]>) => loc.evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(await blur(page.getByRole("navigation", { name: "Main" }))).toContain("blur");
    expect(await blur(page.getByRole("button", { name: /Find a service/ }))).toContain("blur");
    expect(await blur(page.getByRole("main"))).toBe("none");
    expect(await blur(page.locator(".panel"))).toBe("none");
  });

  test("the Console refuses cross-site requests", async ({ request }) => {
    const evil = { origin: "https://evil.example", "x-console": "1" };
    expect((await request.post("/api/health/check", { headers: evil })).status()).toBe(403);
    expect((await request.post("/api/health/check", { headers: { ...evil, "sec-fetch-site": "cross-site", origin: "http://127.0.0.1:19298" } })).status()).toBe(403);
    // No Origin and no X-Console: refused.
    expect((await request.post("/api/health/check")).status()).toBe(403);
    const get = await request.get("/api/health");
    const body = await get.text();
    expect(body).not.toMatch(/emulator_credentials":|secret|AKIA/i);
    expect(Object.keys(JSON.parse(body).emulator).sort()).toEqual(
      ["address", "checkedAt", "keysPath", "lastAnswerAt", "port", "reachable", "restartedAt", "steps"].sort(),
    );
  });
});

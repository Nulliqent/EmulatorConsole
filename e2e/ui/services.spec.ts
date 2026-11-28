import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { ServicesResponse, ServiceSummary } from "../../src/shared/models.js";

// These tests read the Service Model index only, so they do not need the Emulator to answer.

const SHORTCUT = process.platform === "darwin" ? "Meta+k" : "Control+k";

let services: ServiceSummary[];
let version: string;
test.beforeAll(async ({ request }) => {
  const body = (await (await request.get("/api/services")).json()) as ServicesResponse;
  services = body.services;
  version = body.meta.emulator.version;
});

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const rows = (page: Page) => page.locator("#svcrows tr");
const filter = (page: Page) => page.getByRole("searchbox", { name: "Filter services" });
const count = (page: Page) => page.getByTestId("svccount");

test.describe("Services", () => {
  test("lists all 436 services under a heading that says how many the Emulator offers", async ({ page }) => {
    await page.goto("/services");
    await expect(page.getByRole("heading", { level: 1, name: "Services" })).toBeVisible();
    await expect(page.getByText("436 offered by this Emulator")).toBeVisible();
    await expect(rows(page)).toHaveCount(436);
    await expect(count(page)).toHaveText("436 services");
    await expect(page.getByRole("columnheader", { name: `Emulator ${version}` })).toBeVisible();
    // No Calls exist yet, so there is no "Seen this run" row.
    await expect(page.getByTestId("seen")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Seen this run" })).toHaveCount(0);
  });

  test("a row names the Curated badge, the SDK ID, the Resources state and the Emulator state", async ({ page }) => {
    await page.goto("/services");
    const dynamo = page.locator('#svcrows tr[data-slug="dynamodb"]');
    await expect(dynamo.getByRole("link", { name: "Amazon DynamoDB" })).toHaveAttribute("href", "/services/dynamodb");
    await expect(dynamo.getByText("Curated", { exact: true })).toBeVisible();
    await expect(dynamo.locator("td").nth(1)).toHaveText("DynamoDB");
    await expect(dynamo.locator("td").nth(2)).toHaveText("Listed");
    const some = services.find((s) => s.notImplemented + s.notInEmulator > 0 && s.listOperations.length === 0 && s.getOrSearchOperations.length === 0 && s.inputListOperations.length === 0)!;
    await expect(page.locator('#svcrows tr[data-slug="budgets"] td').nth(2)).toHaveText("Lists need input");
    await expect(page.locator('#svcrows tr[data-slug="api-gateway"] td').nth(2)).toHaveText("Lists by Get or Search");
    const row = page.locator(`#svcrows tr[data-slug="${some.slug}"]`);
    await expect(row.locator("td").nth(2)).toHaveText("No list");
    await expect(row.locator("td").nth(3)).toHaveText("Some not implemented");
    const all = services.find((s) => s.notImplemented + s.notInEmulator === 0)!;
    await expect(page.locator(`#svcrows tr[data-slug="${all.slug}"] td`).nth(3)).toHaveText("All implemented");
    // 436 rows, but Curated is the only badge on eight of them.
    await expect(page.locator("#svcrows .badge")).toHaveCount(8);
  });

  test("the Service column has no sort control and no aria-sort", async ({ page }) => {
    await page.goto("/services");
    await expect(page.locator("thead button")).toHaveCount(0);
    await expect(page.locator("thead [aria-sort]")).toHaveCount(0);
    const titles = await page.locator("#svcrows a.svc").allTextContents();
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  });

  test("filtering by text keeps focus in the field and updates the count", async ({ page }) => {
    await page.goto("/services");
    const field = filter(page);
    await field.click();
    await page.keyboard.type("dynamo");
    await expect(field).toBeFocused();
    const expected = services.filter((s) => `${s.title} ${s.sdkId} ${s.slug}`.toLowerCase().includes("dynamo")).length;
    await expect(rows(page)).toHaveCount(expected);
    await expect(count(page)).toHaveText(`${expected} of 436 services`);
    await expect(field).toBeFocused();
    await field.fill("");
    await expect(rows(page)).toHaveCount(436);
    // SDK ID, with different case and a space.
    await field.fill("SECRETS manager");
    await expect(rows(page)).toHaveCount(1);
  });

  test("the count is announced politely after typing pauses", async ({ page }) => {
    await page.goto("/services");
    await filter(page).fill("lambda");
    await expect(page.getByTestId("live-polite")).toHaveText(/^\d+ of 436 services$/);
  });

  test("the three filters narrow the list, alone and together, and say whether they are on", async ({ page }) => {
    await page.goto("/services");
    const chip = (name: string) => page.getByRole("button", { name, exact: true });
    await chip("Curated").click();
    await expect(chip("Curated")).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(8);

    await chip("Curated").click();
    await chip("Has resource lists").click();
    // "Has resource lists" tests listOperations, not listClass.
    await expect(rows(page)).toHaveCount(services.filter((s) => s.listOperations.length > 0).length);
    const classedListNoOps = services.find((s) => s.listClass === "list" && s.listOperations.length === 0)!;
    await expect(page.locator(`#svcrows tr[data-slug="${classedListNoOps.slug}"]`)).toHaveCount(0);

    await chip("Everything implemented in 1.0.509").click();
    await expect(rows(page)).toHaveCount(services.filter((s) => (s.listOperations.length > 0) && s.notImplemented + s.notInEmulator === 0).length);

    await chip("Has resource lists").click();
    await expect(rows(page)).toHaveCount(services.filter((s) => s.notImplemented + s.notInEmulator === 0).length);
    await chip("Everything implemented in 1.0.509").click();
    await expect(rows(page)).toHaveCount(436);
  });

  test("a filter that matches nothing says so and clears", async ({ page }) => {
    await page.goto("/services");
    await filter(page).fill("zzzzqq");
    await expect(page.getByTestId("svcnomatch")).toContainText('No services match "zzzzqq".');
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(rows(page)).toHaveCount(436);
    await expect(filter(page)).toHaveValue("");
  });

  test("with a filter on, the no-match line says so, and the count is announced even when it is unchanged", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("button", { name: "Curated", exact: true }).click();
    await filter(page).fill("zzzzqq");
    await expect(page.getByTestId("svcnomatch")).toContainText('No services match "zzzzqq" with these filters.');
    // Same count (0) twice: still announced the second time.
    await expect(page.getByTestId("live-polite")).toHaveText("0 of 436 services");
    await page.evaluate(() => (document.querySelector('[data-testid="live-polite"]')!.textContent = ""));
    await filter(page).fill("zzzzqqq");
    await expect(page.getByTestId("live-polite")).toHaveText("0 of 436 services");
  });

  test("filter chips look like buttons (bordered) and the filter bar is solid, not glass", async ({ page }) => {
    await page.goto("/services");
    const chip = page.getByRole("button", { name: "Curated", exact: true });
    expect(await chip.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("1px");
    const bar = page.getByRole("group", { name: "Show only" });
    expect(await bar.evaluate((e) => getComputedStyle(e).backdropFilter)).toBe("none");
    // At 320 px the chips wrap as a row of chips, each still bordered.
    await page.setViewportSize({ width: 320, height: 700 });
    for (const name of ["Curated", "Has resource lists", /^Everything implemented/]) {
      const c = page.getByRole("button", { name });
      await expect(c).toBeVisible();
      expect(await c.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("1px");
    }
  });

  test("names the table and says letters jump", async ({ page }) => {
    await page.goto("/services");
    await expect(page.getByRole("region", { name: "Services table" })).toBeVisible();
    await expect(page.getByText("Focus a service and type letters to jump to it.")).toBeVisible();
  });

  test("reading the list shows the table header with three placeholder rows, then the rows", async ({ page }) => {
    await page.route(/\/api\/services$/, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto("/services");
    await expect(page.getByRole("columnheader", { name: "Service", exact: true })).toBeVisible();
    await expect(page.getByTestId("svcplaceholder")).toHaveCount(3);
    await expect(page.getByText("Reading the list of services…")).toBeVisible();
    await expect(rows(page)).toHaveCount(436);
    await expect(page.getByTestId("svcplaceholder")).toHaveCount(0);
  });

  test("when the list can't be read it says so, and Try again reads it", async ({ page }) => {
    let fail = true;
    await page.route(/\/api\/services$/, (route) => (fail ? route.abort() : route.continue()));
    await page.goto("/services");
    await expect(page.locator(".callout[role=alert]")).toContainText("Couldn't read the list of services.");
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(rows(page)).toHaveCount(436);
    await expect(page.locator(".callout[role=alert]")).toHaveCount(0);
  });

  test("typing in the field stays responsive with all 436 rows", async ({ page }) => {
    await page.goto("/services");
    await filter(page).click();
    // Each key shows in the field at once, even while the 436 rows re-render behind it: no keystroke is dropped.
    const text = "simple queue service";
    for (let i = 1; i <= text.length; i++) {
      await page.keyboard.press(text[i - 1] === " " ? "Space" : text[i - 1]!);
      expect(await filter(page).inputValue()).toBe(text.slice(0, i));
    }
    await expect(filter(page)).toBeFocused();
    await expect(rows(page)).toHaveCount(1);
  });

  test("keyboard: Down Arrow leaves the field for the list; letters jump; arrows, Home and End move", async ({ page }) => {
    await page.goto("/services");
    await filter(page).focus();
    await page.keyboard.press("ArrowDown");
    const first = page.locator("#svcrows a.svc").first();
    await expect(first).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#svcrows a.svc").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(first).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(filter(page)).toBeFocused();
    await page.keyboard.press("ArrowDown");

    await page.keyboard.press("d");
    const afterD = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expect(afterD.toLowerCase().startsWith("d")).toBe(true);
    const nextD = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#svcrows a.svc"));
      const i = links.indexOf(document.activeElement as HTMLAnchorElement);
      const d = links.filter((l) => l.textContent!.toLowerCase().startsWith("d"));
      return d[(d.indexOf(links[i]!) + 1) % d.length]!.textContent;
    });
    await page.keyboard.press("d");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(nextD);

    await page.keyboard.press("End");
    const last = await page.locator("#svcrows a.svc").last().textContent();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(last);
    await page.keyboard.press("Home");
    await expect(first).toBeFocused();

    // Letters typed together make one prefix.
    await page.waitForTimeout(800);
    await page.keyboard.type("amazon");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toMatch(/^Amazon/);
    // A space inside the buffer is part of the prefix; a lone first space does nothing.
    await page.waitForTimeout(800);
    await page.keyboard.type("amazon s");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toMatch(/^Amazon S/);
    const before = await page.evaluate(() => document.activeElement?.textContent);
    await page.waitForTimeout(800);
    await page.keyboard.press("Space");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(before);
  });

  test("a row opens the service's page, with focus on its h1 and the three tabs", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("link", { name: "Amazon DynamoDB", exact: true }).click();
    await expect(page).toHaveURL(/\/services\/dynamodb$/);
    await expect(page.getByRole("heading", { level: 1, name: "Amazon DynamoDB" })).toBeFocused();
    const tabs = page.getByRole("navigation", { name: "Amazon DynamoDB" });
    await expect(tabs.getByRole("link", { name: "Resources" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Operations" })).toHaveAttribute("href", "/services/dynamodb/ops");
    await expect(tabs.getByRole("link", { name: "Calls" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Services" })).toHaveAttribute("aria-current", "page");
  });

  test("an unknown service says so", async ({ page }) => {
    await page.goto("/services/no-such-service");
    await expect(page.getByRole("heading", { level: 1, name: "Service not found" })).toBeVisible();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`no axe violations, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/services");
      await expect(rows(page)).toHaveCount(436);
      expect(await axeViolations(page)).toEqual([]);
      await page.getByRole("button", { name: "Curated", exact: true }).click();
      expect(await axeViolations(page), "with a filter on").toEqual([]);
      await filter(page).fill("zzzz");
      expect(await axeViolations(page), "no match").toEqual([]);
      await page.goto("/services/s3/ops/ListBuckets");
      await expect(page.getByRole("heading", { level: 1, name: "ListBuckets" })).toBeVisible();
      expect(await axeViolations(page), "service frame").toEqual([]);
    });
  }

  test("reflows at 320 px: no sideways page scroll, the table scrolls inside its region", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/services");
    await expect(rows(page)).toHaveCount(436);
    await noHorizontalScroll(page);
    await expect(filter(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Everything implemented in 1.0.509" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.goto("/services/s3");
    await noHorizontalScroll(page);
  });
});

test.describe("Find", () => {
  const find = (page: Page) => page.getByRole("button", { name: /Find a service or operation/ });
  const dialog = (page: Page) => page.getByRole("dialog", { name: "Find" });
  const combo = (page: Page) => dialog(page).getByRole("combobox");
  const status = (page: Page) => page.getByTestId("find-status");
  /** Types the text and waits until the answer for exactly that text is shown (the status is empty until then). */
  async function search(page: Page, text: string) {
    await combo(page).fill(text);
    await expect(status(page)).not.toHaveText("");
  }

  test("is a combobox that names the active option and moves with the arrow keys", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await expect(combo(page)).toBeFocused();
    await expect(combo(page)).toHaveAttribute("aria-autocomplete", "list");
    await search(page, "bucket");
    await expect(combo(page)).toHaveAttribute("aria-expanded", "true");
    const options = dialog(page).getByRole("option");
    const first = await options.first().getAttribute("id");
    // The first option is highlighted and Enter opens it, but nothing is named until an arrow key moves.
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await expect(combo(page)).not.toHaveAttribute("aria-activedescendant", /.+/);
    expect(first).toMatch(/^find-opt-o-[a-z0-9-]+-[A-Za-z]+$/); // content-based, stable between searches
    // The first Arrow Down names option 0, so it is heard; the next moves on.
    await page.keyboard.press("ArrowDown");
    await expect(combo(page)).toHaveAttribute("aria-activedescendant", first!);
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    const second = await options.nth(1).getAttribute("id");
    await expect(combo(page)).toHaveAttribute("aria-activedescendant", second!);
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.first()).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("ArrowUp");
    await expect(combo(page)).toHaveAttribute("aria-activedescendant", first!);
    // Focus never leaves the input.
    await expect(combo(page)).toBeFocused();
  });

  test("groups Services before Operations; each operation carries its service", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await search(page, "s3");
    await expect(dialog(page).getByRole("group", { name: "Services" })).toBeVisible();
    await search(page, "ListBuckets");
    const op = dialog(page).getByRole("option", { name: /^ListBuckets Amazon Simple Storage Service/ });
    await expect(op).toBeVisible();
    await expect(dialog(page).getByRole("group", { name: "Operations" })).toBeVisible();
    // Services come first when both match.
    await search(page, "dynamodb");
    await expect(dialog(page).getByRole("group", { name: "Services" })).toBeVisible();
    const labels = await dialog(page).getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-labelledby")));
    expect(labels[0]).toBe("find-g-services");
  });

  test("an operation the Emulator lacks says so, with the version", async ({ page, request }) => {
    const ec2 = (await (await request.get("/api/service?slug=ec2")).json()) as { operations: { name: string; implementation: string }[] };
    const stub = ec2.operations.find((o) => o.implementation !== "implemented")!;
    await page.goto("/run");
    await find(page).click();
    await search(page, stub.name);
    const option = dialog(page).getByRole("option", { name: new RegExp(`^${stub.name} .*Not implemented in ${version.replace(/\./g, "\\.")}`) }).first();
    await expect(option).toBeVisible();
    await expect(option).toContainText(`Not implemented in ${version}`);
    // An implemented one has no such label.
    await search(page, "ListBuckets");
    await expect(dialog(page).getByRole("option", { name: /^ListBuckets / }).first()).not.toContainText("Not implemented");
  });

  test("announces the result count politely as the query changes", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await expect(status(page)).toHaveAttribute("aria-live", "polite");
    await combo(page).fill("ListBuckets");
    await expect(status(page)).toHaveText(/^\d+ results?$/);
    await combo(page).fill("zzzzqq");
    await expect(status(page)).toHaveText("No results");
    await combo(page).fill("dynamodb");
    await expect(status(page)).toHaveText(/^\d+ results?$/);
  });

  test("says when the cap left results out, and announces the D1 line when it is all there is", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await combo(page).fill("a");
    await expect(status(page)).toHaveText("20 results, more not shown");
    await combo(page).fill("OpenSearch Memory");
    await expect(status(page)).toHaveText("AWS Emulator doesn't offer Amazon OpenSearch Memory.");
  });

  test("one letter does not name models the Emulator lacks", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await search(page, "a");
    await expect(page.getByTestId("find-notoffered")).toHaveCount(0);
  });

  test("Enter pressed before the answer arrives opens the first result when it does", async ({ page }) => {
    await page.route(/\/api\/find\?q=ListBuckets$/, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto("/run");
    await find(page).click();
    await combo(page).fill("ListBuckets");
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible(); // still waiting for the answer
    await expect(page).toHaveURL(/\/services\/s3\/ops\/ListBuckets$/);
    await expect(page.getByRole("heading", { level: 1, name: "ListBuckets" })).toBeFocused();
  });

  test("a failed search says so", async ({ page }) => {
    await page.route(/\/api\/find\?q=bucket$/, (route) => route.abort());
    await page.goto("/run");
    await find(page).click();
    // Let the Curated Services for the empty text arrive first, so a kept earlier answer would show beside the error.
    await expect(dialog(page).getByRole("option")).toHaveCount(8);
    await combo(page).fill("bucket");
    await expect(status(page)).toHaveText("Couldn't search. The Console isn't answering.");
    await expect(dialog(page).getByText("Couldn't search. The Console isn't answering.").last()).toBeVisible();
    await expect(dialog(page).getByRole("option")).toHaveCount(0);
  });

  test("reopening Find does not show the last answer", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await search(page, "ListBuckets");
    await expect(dialog(page).getByRole("option", { name: /^ListBuckets / }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    // Hold back the answer for the empty query, so a stale list would show if it were kept.
    await page.route(/\/api\/find\?q=$/, async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });
    await find(page).click();
    await expect(combo(page)).toHaveValue("");
    await expect(dialog(page).getByRole("option")).toHaveCount(0);
    await expect(dialog(page).getByRole("option").first()).toBeVisible(); // then the Curated Services arrive
    await expect(dialog(page).getByRole("option", { name: /^ListBuckets / })).toHaveCount(0);
  });

  test("Enter opens the active result and focus lands on that page's h1", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await search(page, "ListBuckets");
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/services\/s3\/ops\/ListBuckets$/);
    await expect(page.getByRole("heading", { level: 1, name: "ListBuckets" })).toBeFocused();

    // A mouse choice does the same, and so does choosing the page that is already open.
    await page.keyboard.press(SHORTCUT);
    await expect(combo(page)).toHaveValue("");
    await search(page, "dynamodb");
    await dialog(page).getByRole("option", { name: /Amazon DynamoDB/ }).first().click();
    await expect(page).toHaveURL(/\/services\/dynamodb$/);
    await expect(page.getByRole("heading", { level: 1, name: "Amazon DynamoDB" })).toBeFocused();
    await page.keyboard.press(SHORTCUT);
    await expect(combo(page)).toHaveValue(""); // reset on open, so typing the same text again is a change
    await search(page, "dynamodb");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Amazon DynamoDB" })).toBeFocused();
  });

  test("Escape returns focus to the control that opened Find", async ({ page }) => {
    await page.goto("/services");
    await find(page).click();
    await combo(page).fill("s3");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(find(page)).toBeFocused();

    const skipTarget = filter(page);
    await skipTarget.focus();
    await page.keyboard.press(SHORTCUT);
    await expect(combo(page)).toBeFocused();
    await expect(combo(page)).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(skipTarget).toBeFocused();
  });

  test("with no match it says so and offers Browse all services", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await search(page, "zzzzqq");
    const line = page.getByTestId("find-nomatch");
    await expect(line).toContainText('No service or operation matches "zzzzqq".');
    await expect(combo(page)).toHaveAttribute("aria-expanded", "false");
    await line.getByRole("link", { name: "Browse all services" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/services$/);
    await expect(page.getByRole("heading", { level: 1, name: "Services" })).toBeFocused();
  });

  test("a service the Emulator doesn't offer is named (D1)", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await combo(page).fill("OpenSearch Memory");
    await expect(page.getByTestId("find-notoffered")).toContainText("AWS Emulator doesn't offer Amazon OpenSearch Memory.");
    await expect(dialog(page).getByRole("link", { name: "Browse all services" })).toBeVisible();
  });

  test("caps the list and says how many more there are", async ({ page }) => {
    await page.goto("/run");
    await find(page).click();
    await search(page, "a");
    await expect(dialog(page).getByRole("option")).toHaveCount(20);
    await expect(dialog(page)).toContainText(/\d+ more services\. Type more to narrow them\./);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`no axe violations with results, no match and at 320 px, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/run");
      await find(page).click();
      await search(page, "bucket");
      await page.keyboard.press("ArrowDown");
      expect(await axeViolations(page), "results").toEqual([]);
      await search(page, "zzzzqq");
      await expect(page.getByTestId("find-nomatch")).toBeVisible();
      expect(await axeViolations(page), "no match").toEqual([]);
      await search(page, "OpenSearch Memory");
      await expect(page.getByTestId("find-notoffered")).toBeVisible();
      expect(await axeViolations(page), "not offered").toEqual([]);
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 320, height: 700 });
      await find(page).click();
      await search(page, "ListBuckets");
      await noHorizontalScroll(page);
      const box = await dialog(page).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      expect(await axeViolations(page), "320 px").toEqual([]);
    });
  }
});

import { expect, test } from "@playwright/test";
import { BASE, consoleSees } from "./console.js";
import { restartConsole } from "./emulator.js";

const GATEWAY = "http://127.0.0.1:19300";

test.beforeAll(async ({ request }) => {
  await consoleSees(request, true);
});

test("the Gateway page shows the first Call when it arrives, without a reload, and says it records without a tab", async ({ page, request }) => {
  const cleared = await request.post(`${BASE}/api/calls/clear`, { headers: { origin: BASE, "x-console": "1" } });
  expect(cleared.status()).toBe(200);

  await page.goto("/setup/gateway");
  await expect(page.getByRole("heading", { level: 1, name: "Gateway" })).toBeVisible();
  await expect(page.getByTestId("endpoint")).toContainText(`AWS_ENDPOINT_URL=${GATEWAY}`);
  await expect(page.getByTestId("endpoint")).toContainText("AWS_SHARED_CREDENTIALS_FILE=~/.aws/emulator/19297/emulator_credentials");
  await expect(page.getByTestId("endpoint")).toContainText("AWS_REGION=us-east-1");
  await expect(page.getByText("1. Download the certificate:")).toBeVisible();
  await expect(page.getByTestId("first-call")).toContainText("Waiting for the first Call.");
  await expect(page.getByTestId("recording")).toContainText("records whenever the Console runs, with or without an open tab");
  await expect(page.getByRole("checkbox", { name: "Record headers and status only" })).not.toBeChecked();

  // A Call arrives (from a script, not a browser page): the page updates by itself.
  const res = await request.get(`${GATEWAY}/`);
  expect(res.status()).toBeGreaterThan(0);
  await expect(page.getByTestId("first-call")).toContainText("First Call recorded:", { timeout: 10_000 });

  // A request from a browser is refused and counted on the page.
  const refused = await request.get(`${GATEWAY}/`, { headers: { origin: "http://evil.example" } });
  expect(refused.status()).toBe(403);
  await expect(page.getByTestId("refused")).toContainText("sent from a browser page", { timeout: 10_000 });

  // The setting is kept by the Console and restored.
  const box = page.getByRole("checkbox", { name: "Record headers and status only" });
  await box.check();
  await expect.poll(async () => (await (await request.get(`${BASE}/api/gateway`)).json()).headersOnly).toBe(true);
  await box.uncheck();
  await expect.poll(async () => (await (await request.get(`${BASE}/api/gateway`)).json()).headersOnly).toBe(false);
});

test("the Gateway's certificate stays the same when the Console restarts", async ({ request }) => {
  const before = await (await request.get(`${BASE}/api/gateway/certificate`)).text();
  expect(before).toContain("BEGIN CERTIFICATE");
  restartConsole();
  await expect
    .poll(async () => (await request.get(`${BASE}/api/gateway/certificate`).then((r) => r.text(), () => "")), { timeout: 60_000, intervals: [1000] })
    .toBe(before);
});

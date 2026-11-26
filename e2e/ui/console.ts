import { expect, type APIRequestContext } from "@playwright/test";

export const BASE = process.env.CONSOLE_URL ?? "http://127.0.0.1:19298";

/** Asks the Console to check the Emulator now, the way its own page does (Origin and X-Console). */
export async function checkNow(request: APIRequestContext) {
  const res = await request.post(`${BASE}/api/health/check`, { headers: { origin: BASE, "x-console": "1" } });
  expect(res.status()).toBe(200);
}

/** Waits until the Console's health route says the Emulator is (or isn't) reachable. */
export async function consoleSees(request: APIRequestContext, reachable: boolean, timeout = 60_000) {
  await expect
    .poll(
      async () => {
        await checkNow(request);
        return (await (await request.get(`${BASE}/api/health`)).json()).emulator.reachable;
      },
      { timeout, intervals: [1000] },
    )
    .toBe(reachable);
}

// The paid scan price comes from env and may never fall below the facilitator fee plus margin.
import { describe, expect, it, vi } from "vitest";
import worker from "../src/worker.ts";
import { scanPriceAtomic } from "../src/x402.ts";

const PAY_TO = "0x" + "d".repeat(40);
const ctx = { waitUntil() {} } as unknown as ExecutionContext;
const post = () => new Request("https://s/v1/scan", { method: "POST", body: JSON.stringify({ address: "0x" + "a".repeat(40) }) });
const run = (extra: Record<string, string> = {}) =>
  worker.fetch(post(), { DB: {} as D1Database, PAY_TO, FACILITATOR_URL: "https://fac.test", ...extra }, ctx);

describe("paid scan price", () => {
  it("quotes 20000 atomic by default, in body and header", async () => {
    const r = await run();
    expect(r.status).toBe(402);
    const b: any = await r.json();
    expect(b.accepts[0].amount).toBe("20000");
    expect(b.description).toContain("$0.02");
    expect(r.headers.get("payment-required")).toBeTruthy();
  });
  it("SCAN_PRICE_USD overrides the amount", async () => {
    const b: any = await (await run({ SCAN_PRICE_USD: "0.05" })).json();
    expect(b.accepts[0].amount).toBe("50000");
  });
  it("price below fee + margin answers 503 not_configured and never calls the facilitator", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    for (const env of <Record<string, string>[]>[{ SCAN_PRICE_USD: "0.002" }, { SCAN_PRICE_USD: "0.0169" }, { SCAN_PRICE_USD: "abc" }, { SCAN_PRICE_USD: "0.02", SETTLE_FEE_USD: "0.02" }]) {
      const r = await run(env);
      expect(r.status).toBe(503);
      expect(((await r.json()) as any).error.code).toBe("not_configured");
    }
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
  it("boundary: exactly fee + 0.002 is allowed", () => {
    expect(scanPriceAtomic("0.017", "0.015")).toBe("17000");
    expect(scanPriceAtomic("0.016999", "0.015")).toBeNull();
  });
});

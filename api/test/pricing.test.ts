import { describe, expect, test } from "vitest";
import { MODELS, findModel, freeModelIds } from "../src/models.ts";
import { billMicro, ceilingMicro, costMicro, estimateInputTokens, refundMicro, usd } from "../src/pricing.ts";

const granite = findModel("granite-4.0-micro")!; // in 0.021, out 0.14 per 1M

describe("pricing", () => {
  test("cost is exact in micro-USD, no float drift", () => {
    // 1000 * 0.021 float-multiplies to 21.000000000000004; the integer math must give exactly 21.
    expect(costMicro({ inPerM: 0.021, outPerM: 0 }, 1000, 0)).toBe(21);
    expect(costMicro(granite, 1_000_000, 1_000_000)).toBe(161_000); // $0.021 + $0.14 = $0.161
  });
  test("any real usage costs at least one micro-dollar", () => {
    expect(costMicro(granite, 1, 0)).toBe(1);
    expect(costMicro(granite, 0, 0)).toBe(0);
  });
  test("every catalog price converts to whole thousandths", () => {
    for (const m of MODELS) {
      expect(Math.abs(m.inPerM * 1000 - Math.round(m.inPerM * 1000))).toBeLessThan(1e-9);
      expect(Math.abs(m.outPerM * 1000 - Math.round(m.outPerM * 1000))).toBeLessThan(1e-9);
    }
  });
  test("ceiling = estimated input + max_tokens at the posted rate", () => {
    const c = ceilingMicro(granite, 500, 1024);
    expect(c).toBe(costMicro(granite, 500, 1024));
    expect(c).toBeGreaterThanOrEqual(1);
  });
  test("input estimate is generous: at least bytes/3", () => {
    const text = "x".repeat(3000);
    expect(estimateInputTokens([{ role: "user", content: text }], 1)).toBeGreaterThanOrEqual(1000);
  });
  test("refund = ceiling - actual, never negative", () => {
    expect(refundMicro(1000, 400)).toBe(600);
    expect(refundMicro(1000, 1000)).toBe(0);
    expect(refundMicro(1000, 1200)).toBe(0);
  });
  test("cache hit bills 50%, holder discount stacks, always rounded up", () => {
    expect(billMicro(1000, { hit: true })).toBe(500);
    expect(billMicro(1000, { discountPct: 20 })).toBe(800);
    expect(billMicro(1000, { hit: true, discountPct: 20 })).toBe(400);
    expect(billMicro(3, { hit: true })).toBe(2); // 1.5 rounds up
    expect(billMicro(0, { hit: true })).toBe(0);
  });
  test("usd formatting", () => expect(usd(213)).toBe("0.000213"));
  test("free playground models: cheapest three non-deprecated chat models", () => {
    const ids = [...freeModelIds()];
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      const m = findModel(id)!;
      expect(m.type).toBe("chat");
      expect(m.deprecates).toBeUndefined();
    }
  });
});

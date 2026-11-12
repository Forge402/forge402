import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { toFunctionSelector } from "viem";
import { cloneTarget, hasSelector, implementationFromSlot, looksLikeToken, readContractFacts, scanPowers, SELECTOR_GROUPS } from "../src/contract.ts";
import type { RpcClient } from "../src/rpc.ts";

const sel = (s: string) => toFunctionSelector(s).slice(2);
// Solidity-style dispatcher fragment: PUSH4 <selector> EQ ...
const dispatcher = (...sigs: string[]) => "0x6080604052" + sigs.map((s) => "8063" + sel(s) + "14610011").join("") + "5f80fd";
const REAL = readFileSync(new URL("./fixtures/token-code.hex", import.meta.url), "utf8").trim();
const IMPL = "bebebebebebebebebebebebebebebebebebebebe";
const CLONE_1167 = "0x363d3d373d3d3d363d73" + IMPL + "5af43d82803e903d91602b57fd5bf3";

describe("selector detection", () => {
  it("real token bytecode is an ERC-20 with none of the dangerous selectors", () => {
    expect(looksLikeToken(REAL)).toBe(true);
    expect(Object.values(scanPowers(REAL)).every((v) => v === false)).toBe(true);
  });
  it("finds each power group in a dispatcher", () => {
    const code = dispatcher("transfer(address,uint256)", "mint(address,uint256)", "blacklist(address)", "setBuyTax(uint256)", "pause()", "setMaxWallet(uint256)", "enableTrading()", "upgradeTo(address)");
    expect(scanPowers(code)).toEqual({ hasMint: true, hasBlacklist: true, hasFeeSetter: true, hasPause: true, hasLimits: true, hasTradingToggle: true, hasUpgrade: true });
  });
  it("does not match a selector that sits off a byte boundary or without PUSH4", () => {
    const s = sel("mint(address,uint256)");
    expect(hasSelector("0x6080" + s, s)).toBe(false); // no 63 prefix
    expect(hasSelector("0x608" + "63" + s + "00", s)).toBe(false); // odd offset
  });
  it("every selector in every group is 4 bytes", () => {
    for (const g of Object.values(SELECTOR_GROUPS)) for (const s of g) expect(s).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("EIP-1167", () => {
  it("reads the target of the standard minimal proxy", () => expect(cloneTarget(CLONE_1167)).toBe("0x" + IMPL));
  it("reads the PUSH20 variant with different tail bytes", () => expect(cloneTarget("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + IMPL + "5af43d82803e903d91602b57fd5bf3")).toBe("0x" + IMPL));
  it("never calls a long contract a clone", () => expect(cloneTarget(REAL)).toBeNull());
});

describe("EIP-1967 slot parsing", () => {
  it("parses an address word", () => expect(implementationFromSlot("0x" + "0".repeat(24) + IMPL)).toBe("0x" + IMPL));
  it("empty slot and junk are null", () => {
    expect(implementationFromSlot("0x" + "0".repeat(64))).toBeNull();
    expect(implementationFromSlot("0x1234")).toBeNull();
    expect(implementationFromSlot(undefined)).toBeNull();
  });
});

describe("readContractFacts", () => {
  const word = (hex: string) => "0x" + hex.padStart(64, "0");
  const rpcFor = (code: string, slot: string, owner: string): RpcClient => ({
    async batch(calls) {
      return calls.map((c) => {
        const m = c.method, data = (c.params[0] as any)?.data as string | undefined;
        if (m === "eth_getCode") return { ok: true as const, value: c.params[0] === "0x" + IMPL ? REAL : code };
        if (m === "eth_getStorageAt") return { ok: true as const, value: slot };
        if (data === "0x8da5cb5b") return { ok: true as const, value: owner };
        if (data === "0x18160ddd") return { ok: true as const, value: word("3e8") };
        if (data?.startsWith("0x70a08231")) return { ok: true as const, value: word("12c") }; // 300 of 1000 = 30%
        return { ok: true as const, value: "0x" };
      });
    },
  });
  it("follows a clone to its implementation and reads the owner share", async () => {
    const f = await readContractFacts(rpcFor(CLONE_1167, "0x" + "0".repeat(64), word("aa".repeat(20))), "0x" + "11".repeat(20));
    expect(f).toMatchObject({ isClone: true, cloneTarget: "0x" + IMPL, scanned: "implementation", looksLikeToken: true, hasMint: false, ownerRenounced: false, totalSupply: "1000", ownerBalance: "300" });
  });
  it("reads a renounced owner and an EIP-1967 proxy", async () => {
    const f = await readContractFacts(rpcFor("0x600160005500", word(IMPL), word("0")), "0x" + "22".repeat(20));
    expect(f).toMatchObject({ isClone: false, implSlot: "0x" + IMPL, ownerRenounced: true });
  });
  it("an address with no code is not a contract", async () => {
    const f = await readContractFacts(rpcFor("0x", "0x", "0x"), "0x" + "33".repeat(20));
    expect(f.isContract).toBe(false);
  });
});

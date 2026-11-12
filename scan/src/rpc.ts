// Batched JSON-RPC over fetch. Copied and trimmed from reinkeep/collector/src/contract-facts.ts.
import { decodeAbiParameters, hexToString } from "viem";
import { requestJson, HttpError, type Fetcher, type Sleep } from "./http-json.ts";

export type RpcCall = { method: string; params: unknown[] };
export type RpcResult = { ok: true; value: unknown } | { ok: false; code: number; message: string };
export type RpcClient = { batch(calls: RpcCall[]): Promise<RpcResult[]> };

const MAX_BATCH = 10;

// url: one URL, or an ordered list (custom nodes first, the public node last). Per batch there are at most 2 attempts in
// total, so fallback never multiplies the subrequest count: one URL = 2 tries on it; several = 1 try on each of the first 2.
// URLs carry API keys, so they are never logged or put into error messages.
export function createRpcClient(o: { url: string | string[]; fetch: Fetcher; sleep: Sleep }): RpcClient {
  const urls = (Array.isArray(o.url) ? o.url : [o.url]).filter(Boolean);
  const send = async (body: string): Promise<unknown> => {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body };
    if (urls.length < 2) return requestJson(urls[0], init, { fetch: o.fetch, sleep: o.sleep, tries: 2 });
    try {
      return await requestJson(urls[0], init, { fetch: o.fetch, sleep: o.sleep, tries: 1 });
    } catch (e) {
      if (!(e instanceof HttpError) || (e.status !== 0 && e.status !== 429)) throw e; // 429, 5xx and network errors only
      return requestJson(urls[1], init, { fetch: o.fetch, sleep: o.sleep, tries: 1 });
    }
  };
  return {
    async batch(calls) {
      if (calls.length < 1 || calls.length > MAX_BATCH) throw new RangeError(`a batch holds 1 to ${MAX_BATCH} calls`);
      const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: c.method, params: c.params })));
      const json = await send(body);
      if (!Array.isArray(json)) throw new HttpError(200, "the RPC node did not answer the batch with a list");
      const byId = new Map<number, any>();
      for (const item of json) if (item && typeof item === "object" && typeof item.id === "number") byId.set(item.id, item);
      return calls.map((_, i) => {
        const item = byId.get(i + 1);
        if (!item) throw new HttpError(200, `the RPC node left out answer ${i + 1} of ${calls.length}`);
        if (item.error) return { ok: false as const, code: Number(item.error.code), message: String(item.error.message ?? "") };
        return { ok: true as const, value: item.result };
      });
    },
  };
}

export function decodeText(hex: unknown): string | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  let text: string | null = null;
  try {
    text = decodeAbiParameters([{ type: "string" }], hex as `0x${string}`)[0] as string;
  } catch {
    if (hex.length === 66) text = hexToString(hex as `0x${string}`, { size: 32 });
  }
  const clean = (text ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64);
  return clean || null;
}

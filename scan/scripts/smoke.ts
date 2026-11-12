// Live smoke test from your own machine: node scripts/smoke.ts 0xTOKEN [rpcUrl]
// Runs the real scan logic against the real chain and DexScreener. No AI binding here, so the summary is the rule-written one.
import { createRpcClient } from "../src/rpc.ts";
import { scanToken } from "../src/scan.ts";

const address = process.argv[2];
const rpcUrl = process.argv[3] ?? process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
if (!address) { console.error("usage: node scripts/smoke.ts 0xTOKEN [rpcUrl]"); process.exit(1); }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const detail = await scanToken(address, {
  rpc: createRpcClient({ url: rpcUrl, fetch, sleep }), fetch, sleep, now: Date.now, tickerOthers: async () => 0,
});
console.log(JSON.stringify(detail.result, null, 2));

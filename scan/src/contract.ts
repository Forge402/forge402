// Contract facts straight from the chain. Adapted from reinkeep/collector/src/contract-facts.ts, with more selector
// groups (fees, limits, trading switch) and an owner-balance read.
//
// Honest limits: powers are found by looking for the 4-byte selectors of COMMON function names in the bytecode.
// A function with an unusual name is not seen, so "none found" never means "cannot happen". Proxies and clones are
// followed to their implementation. Role-based control (AccessControl) is not read.
import { toFunctionSelector } from "viem";
import { HttpError } from "./http-json.ts";
import { decodeText, type RpcClient } from "./rpc.ts";
import type { ContractFacts } from "./types.ts";

const sel = (signature: string) => toFunctionSelector(signature).slice(2).toLowerCase();
const group = (sigs: string[]) => sigs.map(sel);

export const SELECTOR_GROUPS = {
  mint: group(["mint(address,uint256)", "mint(uint256)", "mint(address)", "mintTo(address,uint256)", "issue(uint256)"]),
  blacklist: group(["blacklist(address)", "addToBlacklist(address)", "setBlacklist(address,bool)", "blacklistAddress(address)", "addBlackList(address)", "blockAddress(address)", "blocklist(address)", "addToBlocklist(address)", "setBlocklist(address,bool)", "setBlockList(address,bool)"]),
  fee: group(["setFee(uint256)", "setFees(uint256,uint256)", "setTax(uint256)", "setTaxFee(uint256)", "setBuyFee(uint256)", "setSellFee(uint256)", "setBuyTax(uint256)", "setSellTax(uint256)", "updateFees(uint256,uint256)", "setTaxes(uint256,uint256)"]),
  pause: group(["pause()", "pause(bool)", "setPaused(bool)"]),
  limits: group(["setMaxTx(uint256)", "setMaxTxAmount(uint256)", "setMaxTransactionAmount(uint256)", "setMaxWallet(uint256)", "setMaxWalletAmount(uint256)", "setLimits(uint256,uint256)", "removeLimits()"]),
  trading: group(["enableTrading()", "setTradingEnabled(bool)", "openTrading()", "setTrading(bool)", "disableTrading()", "setTradingOpen(bool)"]),
  upgrade: group(["upgradeTo(address)", "upgradeToAndCall(address,bytes)"]),
} as const;

const OWNER = "0x8da5cb5b";
const TOTAL_SUPPLY = "0x18160ddd";
const DECIMALS = "0x313ce567";
const SYMBOL = "0x95d89b41";
const NAME = "0x06fdde03";
const BALANCE_OF = "0x70a08231";
export const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // EIP-1967
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// A clone is a tiny contract that pushes an address and runs GAS, DELEGATECALL (5a f4). EIP-1167 and its variants share
// that shape; real contracts are far longer, so anything over 64 bytes is never a clone.
const MAX_CLONE_BYTES = 64;
export function cloneTarget(codeHex: string): string | null {
  const code = codeHex.toLowerCase();
  if ((code.length - 2) / 2 > MAX_CLONE_BYTES) return null;
  for (let at = code.indexOf("73", 2); at !== -1; at = code.indexOf("73", at + 1)) {
    if (at % 2 !== 0) continue;
    const target = code.slice(at + 2, at + 42);
    if (code.slice(at + 42, at + 46) === "5af4" && /^[0-9a-f]{40}$/.test(target)) return "0x" + target;
  }
  return null;
}

// Solidity and Vyper dispatchers compare against PUSH4 <selector>. Match only on a whole-byte boundary.
export function hasSelector(codeHex: string, selector: string): boolean {
  const code = codeHex.toLowerCase();
  const needle = "63" + selector;
  for (let at = code.indexOf(needle, 2); at !== -1; at = code.indexOf(needle, at + 1)) if (at % 2 === 0) return true;
  return false;
}

const ERC20_CORE = [sel("transfer(address,uint256)"), sel("balanceOf(address)")];
export const looksLikeToken = (code: string) => ERC20_CORE.some((s) => hasSelector(code, s));

export type Powers = { hasMint: boolean; hasBlacklist: boolean; hasFeeSetter: boolean; hasPause: boolean; hasLimits: boolean; hasTradingToggle: boolean; hasUpgrade: boolean };
export function scanPowers(code: string): Powers {
  const any = (list: readonly string[]) => list.some((s) => hasSelector(code, s));
  const g = SELECTOR_GROUPS;
  return { hasMint: any(g.mint), hasBlacklist: any(g.blacklist), hasFeeSetter: any(g.fee), hasPause: any(g.pause), hasLimits: any(g.limits), hasTradingToggle: any(g.trading), hasUpgrade: any(g.upgrade) };
}

const isWord = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
export function wordToAddress(word: string): string | null {
  return /^0x0{24}[0-9a-fA-F]{40}$/.test(word) ? "0x" + word.slice(26).toLowerCase() : null;
}
// Read an EIP-1967 slot answer: an address, or null when the slot is empty or not an address.
export function implementationFromSlot(word: unknown): string | null {
  if (!isWord(word)) return null;
  const a = wordToAddress(word);
  return a && a !== ZERO_ADDRESS ? a : null;
}

export async function readContractFacts(rpc: RpcClient, token: string): Promise<ContractFacts> {
  const [code, slot, owner, supply, decimals, symbol, name] = await rpc.batch([
    { method: "eth_getCode", params: [token, "latest"] },
    { method: "eth_getStorageAt", params: [token, IMPLEMENTATION_SLOT, "latest"] },
    { method: "eth_call", params: [{ to: token, data: OWNER }, "latest"] },
    { method: "eth_call", params: [{ to: token, data: TOTAL_SUPPLY }, "latest"] },
    { method: "eth_call", params: [{ to: token, data: DECIMALS }, "latest"] },
    { method: "eth_call", params: [{ to: token, data: SYMBOL }, "latest"] },
    { method: "eth_call", params: [{ to: token, data: NAME }, "latest"] },
  ]);
  if (!code.ok || typeof code.value !== "string" || !/^0x[0-9a-fA-F]*$/.test(code.value)) throw new HttpError(200, "could not read the token's code");
  const bytecode = code.value.toLowerCase();
  const codeSize = (bytecode.length - 2) / 2;

  const base: ContractFacts = {
    token, isContract: codeSize > 0, codeSize, looksLikeToken: null, isClone: false, cloneTarget: null, implSlot: null, scanned: "self",
    hasOwnerFunction: null, owner: null, ownerRenounced: null, hasMint: null, hasBlacklist: null, hasFeeSetter: null, hasPause: null,
    hasLimits: null, hasTradingToggle: null, hasUpgrade: null, totalSupply: null, decimals: null, symbol: null, name: null, ownerBalance: null,
  };
  if (codeSize === 0) return base;

  const cloned = cloneTarget(bytecode);
  const implSlot = cloned ? null : implementationFromSlot(slot.ok ? slot.value : null);
  const implementation = cloned ?? implSlot;

  // Owner first, so the second batch can also read what the owner holds.
  let hasOwnerFunction: boolean | null = null;
  let ownerAddress: string | null = null;
  if (!owner.ok || owner.value === "0x") hasOwnerFunction = false;
  else if (isWord(owner.value)) {
    ownerAddress = wordToAddress(owner.value);
    hasOwnerFunction = ownerAddress !== null ? true : null;
  }
  const ownerRenounced = ownerAddress === null ? null : ownerAddress === ZERO_ADDRESS;

  const second = [];
  if (implementation) second.push({ method: "eth_getCode", params: [implementation, "latest"] });
  const wantOwnerBalance = ownerAddress !== null && ownerAddress !== ZERO_ADDRESS;
  if (wantOwnerBalance) second.push({ method: "eth_call", params: [{ to: token, data: BALANCE_OF + "0".repeat(24) + ownerAddress!.slice(2) }, "latest"] });
  const extra = second.length ? await rpc.batch(second) : [];
  const implCode = implementation ? extra[0] : undefined;
  const balRes = wantOwnerBalance ? extra[extra.length - 1] : undefined;

  const codeToScan = !implementation ? bytecode : implCode?.ok && typeof implCode.value === "string" && /^0x[0-9a-fA-F]{2,}$/.test(implCode.value) ? implCode.value : null;
  const tokenLike = codeToScan ? looksLikeToken(codeToScan) : null;
  const powers = codeToScan && tokenLike ? scanPowers(codeToScan) : null;

  return {
    ...base,
    looksLikeToken: tokenLike,
    isClone: cloned !== null,
    cloneTarget: cloned,
    implSlot,
    scanned: implementation ? "implementation" : "self",
    hasOwnerFunction,
    owner: ownerAddress,
    ownerRenounced,
    hasMint: powers?.hasMint ?? null,
    hasBlacklist: powers?.hasBlacklist ?? null,
    hasFeeSetter: powers?.hasFeeSetter ?? null,
    hasPause: powers?.hasPause ?? null,
    hasLimits: powers?.hasLimits ?? null,
    hasTradingToggle: powers?.hasTradingToggle ?? null,
    hasUpgrade: powers?.hasUpgrade ?? null,
    totalSupply: supply.ok && isWord(supply.value) ? BigInt(supply.value).toString() : null,
    decimals: decimals.ok && isWord(decimals.value) && BigInt(decimals.value) <= 255n ? Number(BigInt(decimals.value)) : null,
    symbol: symbol.ok ? decodeText(symbol.value) : null,
    name: name.ok ? decodeText(name.value) : null,
    ownerBalance: balRes?.ok && isWord(balRes.value) ? BigInt(balRes.value).toString() : null,
  };
}

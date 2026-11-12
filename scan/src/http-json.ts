// Polite JSON over HTTP, for sources we do not control.
//  - an honest, descriptive User-Agent (never a disguise as a browser)
//  - retries only on "slow down" (429) and server errors, with a growing pause that honours Retry-After
//  - a bot-check page (Cloudflare "Just a moment...") is a hard stop: BlockedError, no retry, no workaround
//  - fetch, sleep and the clock are passed in, so tests never touch the network or wait
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// The source kept saying "slow down" (429) through every retry. The source is busy; nothing is wrong with what we asked.
export class RateLimited extends HttpError {
  constructor(message: string) {
    super(429, message);
  }
}

// The source is asking for a human. We stop and say so instead of trying to get around it.
export class BlockedError extends Error {}

// This run's allowance of outgoing requests is spent. Retrying cannot help, so it is never retried.
export class BudgetExhausted extends Error {}

export const USER_AGENT = "forge402-scan/0.1 (read-only chain and market data)";

export type RequestOptions = { fetch: Fetcher; sleep: Sleep; tries?: number; timeoutMs?: number; maxRetryAfterMs?: number };

export async function requestJson(url: string, init: RequestInit, opts: RequestOptions): Promise<unknown> {
  const tries = opts.tries ?? 4;
  const maxWait = opts.maxRetryAfterMs ?? 30_000;
  let lastProblem = "no attempt made";
  let lastStatus = 0;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res: Response;
    try {
      res = await opts.fetch(url, {
        ...init,
        headers: { accept: "application/json", "user-agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
    } catch (err) {
      if (err instanceof BudgetExhausted) throw err;
      lastProblem = `network error: ${(err as Error).message}`;
      lastStatus = 0;
      if (attempt < tries) await opts.sleep(Math.min(2000 * attempt, maxWait));
      continue;
    }
    if (res.headers.get("cf-mitigated") === "challenge") {
      throw new BlockedError(`${new URL(url).host} asks for a human check (bot challenge). Not retrying and not working around it.`);
    }
    if (res.status === 429 || res.status >= 500) {
      lastProblem = `HTTP ${res.status}`;
      lastStatus = res.status;
      if (attempt < tries) {
        const asked = Number(res.headers.get("retry-after"));
        await opts.sleep(Math.min(Number.isFinite(asked) && asked > 0 ? asked * 1000 : 2000 * attempt, maxWait));
      }
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} from ${new URL(url).host}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(res.status, `${new URL(url).host} did not return JSON`);
    }
  }
  if (lastStatus === 429) throw new RateLimited(`gave up after ${tries} tries (${lastProblem})`);
  throw new HttpError(0, `gave up after ${tries} tries (${lastProblem})`);
}


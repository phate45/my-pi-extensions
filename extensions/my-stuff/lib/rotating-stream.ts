/**
 * Wraps a pi-ai streamSimple so each request leases a key from a pool and a
 * rate-limited or rejected key is retried on the next key.
 *
 * Two properties matter here:
 *
 * Events reach the caller only once an attempt is known healthy, so a rotated
 * attempt never emits a partial message that the retry then duplicates.
 *
 * The 429 is observed through an injected fetch. pi-ai calls `onResponse` only
 * after the SDK request resolves, so on a 429 the SDK throws first and the status
 * is never reported; wrapping fetch is the only place the real status code and
 * `retry-after` survive.
 */

import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type FetchFunction,
  type Model,
  type ProviderHeaders,
  type SimpleStreamOptions,
  type StreamFunction,
} from "@earendil-works/pi-ai";
import { type KeyOutcome, type KeyPool, type Lease, PoolUnavailableError } from "./key-pool.js";

export const DEFAULT_ROTATION_BUDGET_MS = 60_000;

const RATE_LIMITED = /\b429\b|rate[\s_-]*limit|too many requests|quota\s*(exceeded|limit)/i;
const REJECTED_KEY = /\b40[13]\b|unauthorized|forbidden|invalid\s*(api[\s_-]*)?key|authentication/i;

type Observed = {
  status?: number;
  retryAfterMs?: number;
};

type Rotation = {
  outcome: Extract<KeyOutcome, "rate_limited" | "invalid">;
  cooldownMs?: number;
};

type Verdict =
  | { kind: "completed" }
  | { kind: "rotate"; rotation: Rotation; problem: string }
  | { kind: "relayed" }
  /** Content reached the caller but the provider never sent a terminal event. */
  | { kind: "truncated" };

export type RotatingStreamConfig = {
  pool: KeyPool;
  /** The underlying API implementation, e.g. getApiProvider("openai-completions").streamSimple. */
  streamSimple: StreamFunction<Api, SimpleStreamOptions>;
  providerId: string;
  rotationBudgetMs?: number;
  notify?: (message: string) => void;
  now?: () => number;
};

export function parseRetryAfterMs(headers: Headers, now: number): number | undefined {
  const milliseconds = headers.get("retry-after-ms");
  if (milliseconds) {
    const value = Number.parseFloat(milliseconds);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const seconds = headers.get("retry-after");
  if (!seconds) return undefined;

  const asSeconds = Number.parseFloat(seconds);
  if (Number.isFinite(asSeconds)) return asSeconds > 0 ? asSeconds * 1000 : undefined;

  const asDate = Date.parse(seconds);
  if (Number.isNaN(asDate)) return undefined;
  const delta = asDate - now;
  return delta > 0 ? delta : undefined;
}

/**
 * Decide whether a failed attempt is the key's fault. Only a rate limit or a
 * rejected credential rotates; anything else belongs to pi's own retry, and
 * rotating on it would burn the pool on a fault no other key can fix.
 */
export function classifyFailure(
  observed: Observed,
  message: string | undefined,
): Rotation | undefined {
  if (observed.status !== undefined) {
    if (observed.status === 429) {
      return {
        outcome: "rate_limited",
        ...(observed.retryAfterMs ? { cooldownMs: observed.retryAfterMs } : {}),
      };
    }
    if (observed.status === 401 || observed.status === 403) return { outcome: "invalid" };
    return undefined;
  }

  if (!message) return undefined;
  if (RATE_LIMITED.test(message)) return { outcome: "rate_limited" };
  if (REJECTED_KEY.test(message)) return { outcome: "invalid" };
  return undefined;
}

/**
 * Put the leased key in the Authorization header as well as in `apiKey`.
 *
 * A provider registered with `authHeader: true` receives an Authorization for the
 * credential pi resolved, and pi-ai merges those headers over the client defaults
 * while the SDK ranks default headers above the key the client was built with. The
 * leased key reaches the wire only if it also owns this header. Existing entries go
 * by case-insensitive name, because the merge downstream is case-sensitive and two
 * spellings would both survive it.
 */
function withLeasedAuth(headers: ProviderHeaders | undefined, key: string): ProviderHeaders {
  const merged: ProviderHeaders = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== "authorization") merged[name] = value;
  }
  merged.Authorization = `Bearer ${key}`;
  return merged;
}

function observingFetch(
  base: FetchFunction | undefined,
  observed: Observed,
  now: () => number,
): FetchFunction {
  const inner = base ?? globalThis.fetch;
  return async (input, init) => {
    const response = await inner(input, init);
    observed.status = response.status;
    observed.retryAfterMs = parseRetryAfterMs(response.headers, now());
    return response;
  };
}

function terminalMessage(
  model: Model<Api>,
  stopReason: "error" | "aborted",
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Relay `source` into `out`, holding events back until the attempt proves healthy. */
async function relay(
  source: AsyncIterable<AssistantMessageEvent>,
  out: AssistantMessageEventStream,
  observed: Observed,
): Promise<Verdict> {
  const held: AssistantMessageEvent[] = [];
  let relaying = false;

  const flush = () => {
    for (const event of held) out.push(event);
    held.length = 0;
    relaying = true;
  };

  for await (const event of source) {
    if (event.type === "error") {
      const problem = event.error?.errorMessage ?? `HTTP ${observed.status ?? "?"}`;
      if (!relaying) {
        const rotation = classifyFailure(observed, event.error?.errorMessage);
        if (rotation) return { kind: "rotate", rotation, problem };
      }
      flush();
      out.push(event);
      out.end();
      return { kind: "relayed" };
    }

    if (event.type === "done") {
      flush();
      out.push(event);
      out.end();
      return { kind: "completed" };
    }

    if (relaying) {
      out.push(event);
      continue;
    }

    // Status is unknown only until the injected fetch resolves, so this holds
    // back the "start" event and nothing more.
    if (observed.status === undefined) {
      held.push(event);
      continue;
    }

    const rotation = classifyFailure(observed, undefined);
    if (rotation) return { kind: "rotate", rotation, problem: `HTTP ${observed.status}` };

    flush();
    out.push(event);
  }

  if (!relaying) {
    return {
      kind: "rotate",
      rotation: { outcome: "rate_limited" },
      problem: "the provider stream ended without a result",
    };
  }
  return { kind: "truncated" };
}

export function createRotatingStreamSimple(config: RotatingStreamConfig) {
  const { pool, streamSimple, providerId } = config;
  const budgetMs = config.rotationBudgetMs ?? DEFAULT_ROTATION_BUDGET_MS;
  const now = config.now ?? Date.now;
  const notify = config.notify ?? (() => {});

  return function rotatingStreamSimple(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream {
    const out = createAssistantMessageEventStream();

    void (async () => {
      const deadlineAt = now() + budgetMs;
      let attempts = 0;
      let lastProblem = "no attempt was made";

      for (;;) {
        let lease: Lease;
        try {
          lease = await pool.acquire(options?.signal, deadlineAt);
        } catch (error) {
          if (isAbort(error)) {
            out.push({
              type: "error",
              reason: "aborted",
              error: terminalMessage(model, "aborted"),
            });
            out.end();
            return;
          }
          if (error instanceof PoolUnavailableError) {
            lastProblem = `${lastProblem}; ${error.message}`;
            break;
          }
          throw error;
        }

        attempts++;
        try {
          const observed: Observed = {};
          const verdict = await relay(
            streamSimple(model, context, {
              ...options,
              apiKey: lease.key,
              headers: withLeasedAuth(options?.headers, lease.key),
              fetch: observingFetch(options?.fetch, observed, now),
              // This wrapper owns retrying, and pi-ai's own retry would burn the
              // backoff on the key that just failed.
              maxRetries: 0,
            }),
            out,
            observed,
          );

          if (verdict.kind === "completed") {
            pool.report(lease, "ok");
            return;
          }
          if (verdict.kind === "relayed") {
            pool.report(lease, "error");
            return;
          }
          if (verdict.kind === "truncated") {
            pool.report(lease, "error");
            out.push({
              type: "error",
              reason: "error",
              error: terminalMessage(
                model,
                "error",
                `${providerId}: the provider stream ended mid-message on ${lease.label}`,
              ),
            });
            out.end();
            return;
          }

          lastProblem = verdict.problem;
          pool.report(lease, verdict.rotation.outcome, verdict.rotation.cooldownMs);
          notify(
            `${providerId}: ${verdict.rotation.outcome === "rate_limited" ? "rate limited" : "key rejected"} on ${lease.label}, rotating`,
          );
        } catch (error) {
          if (options?.signal?.aborted || isAbort(error)) {
            out.push({
              type: "error",
              reason: "aborted",
              error: terminalMessage(model, "aborted"),
            });
            out.end();
            return;
          }
          pool.report(lease, "error");
          out.push({
            type: "error",
            reason: "error",
            error: terminalMessage(
              model,
              "error",
              error instanceof Error ? error.message : String(error),
            ),
          });
          out.end();
          return;
        } finally {
          pool.release(lease);
        }
      }

      out.push({
        type: "error",
        reason: "error",
        error: terminalMessage(
          model,
          "error",
          `${providerId}: ${attempts} attempt(s) across ${pool.size} key(s) failed within ${Math.round(budgetMs / 1000)}s. Last error: ${lastProblem}`,
        ),
      });
      out.end();
    })();

    return out;
  };
}

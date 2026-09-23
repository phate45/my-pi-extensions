import { describe, expect, test } from "bun:test";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  normalizeContext,
  createAssistantMessageEventStream,
  type FetchFunction,
  type Model,
  type ProviderHeaders,
  type SimpleStreamOptions,
  type StreamFunction,
} from "@earendil-works/pi-ai";
import { KeyPool, type KeyPoolOptions } from "../../extensions/my-stuff/lib/key-pool.js";
import {
  classifyFailure,
  createRotatingStreamSimple,
  parseRetryAfterMs,
} from "../../extensions/my-stuff/lib/rotating-stream.js";

const model = {
  id: "z-ai/glm-5.3-flash",
  provider: "tensorx",
  api: "openai-completions",
  name: "GLM 5.3 Flash",
} as unknown as Model<Api>;

const context = normalizeContext({ messages: [] } as Context);

const keys = [
  { key: "sk-key-one-aaaaaaaaaaaa", label: "one" },
  { key: "sk-key-two-bbbbbbbbbbbb", label: "two" },
  { key: "sk-key-three-cccccccccc", label: "three" },
];

function blankMessage(): AssistantMessage {
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
    stopReason: "pending",
    timestamp: 0,
  } as AssistantMessage;
}

type AttemptSpec = {
  status: number;
  /** Present for a failing attempt; absent for a successful one. */
  error?: string;
  retryAfter?: string;
  text?: string;
  /** Emit start, then end the stream with no terminal event. */
  truncate?: boolean;
  throws?: string;
  /**
   * Emit start before the error. pi-ai does not do this on a 429 (the SDK throws
   * before the start event), so this exercises the mid-stream status guard.
   */
  startBeforeError?: boolean;
};

/**
 * Stands in for a pi-ai API implementation. Each call consumes the next spec,
 * reports its status through the injected fetch, then emits matching events.
 */
function createFakeApi(specs: AttemptSpec[]) {
  const usedKeys: string[] = [];
  const usedHeaders: (ProviderHeaders | undefined)[] = [];
  let current: AttemptSpec = specs[0]!;

  const baseFetch = (async () => {
    const headers = new Headers();
    if (current.retryAfter) headers.set("retry-after", current.retryAfter);
    return new Response(null, { status: current.status, headers });
  }) as unknown as FetchFunction;

  const streamSimple: StreamFunction<Api, SimpleStreamOptions> = (_model, _context, options) => {
    current = specs[Math.min(usedKeys.length, specs.length - 1)]!;
    usedKeys.push(options?.apiKey ?? "<none>");
    usedHeaders.push(options?.headers);
    const spec = current;
    const stream = createAssistantMessageEventStream();

    void (async () => {
      if (spec.throws) throw new Error(spec.throws);
      await options?.fetch?.("https://api.tensorx.ai/v1/chat/completions");

      // A failing request never reaches the start event in pi-ai: the SDK throws
      // and the adapter emits only the error.
      if (spec.error && !spec.startBeforeError) {
        stream.push({
          type: "error",
          reason: "error",
          error: { ...blankMessage(), stopReason: "error", errorMessage: spec.error },
        });
        return;
      }

      stream.push({ type: "start", partial: blankMessage() });
      if (spec.truncate) {
        stream.push({ type: "text_start", contentIndex: 0, partial: blankMessage() });
        stream.end();
        return;
      }
      if (spec.error) {
        stream.push({
          type: "error",
          reason: "error",
          error: { ...blankMessage(), stopReason: "error", errorMessage: spec.error },
        });
        return;
      }
      stream.push({ type: "text_start", contentIndex: 0, partial: blankMessage() });
      stream.push({
        type: "text_delta",
        contentIndex: 0,
        delta: spec.text ?? "ok",
        partial: blankMessage(),
      });
      stream.push({ type: "done", reason: "stop", message: blankMessage() });
    })().catch(() => {
      stream.push({
        type: "error",
        reason: "error",
        error: { ...blankMessage(), stopReason: "error", errorMessage: spec.throws ?? "thrown" },
      });
    });

    return stream;
  };

  return { streamSimple, baseFetch, usedKeys, usedHeaders };
}

/** Every Authorization on a request, whatever case it was written in. */
function authorizations(headers: ProviderHeaders | undefined): (string | null)[] {
  return Object.entries(headers ?? {})
    .filter(([name]) => name.toLowerCase() === "authorization")
    .map(([, value]) => value);
}

function fakeClock(start = 1_000) {
  let current = start;
  const options: KeyPoolOptions = {
    now: () => current,
    sleep: async (ms, signal) => {
      if (signal?.aborted) {
        const error = new Error("Request aborted");
        error.name = "AbortError";
        throw error;
      }
      current += ms;
    },
  };
  return {
    options,
    now: () => current,
    get time() {
      return current;
    },
  };
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function run(specs: AttemptSpec[], overrides: { poolKeys?: typeof keys; budgetMs?: number } = {}) {
  const clock = fakeClock();
  const pool = new KeyPool(overrides.poolKeys ?? keys, { ...clock.options, cooldownMs: 5_000 });
  const api = createFakeApi(specs);
  const notices: string[] = [];

  const rotating = createRotatingStreamSimple({
    pool,
    streamSimple: api.streamSimple,
    providerId: "tensorx",
    rotationBudgetMs: overrides.budgetMs ?? 60_000,
    notify: (message) => notices.push(message),
    now: clock.now,
  });

  return { clock, pool, api, notices, rotating };
}

describe("rotating stream on a rate limit", () => {
  test("retries on the next key and the caller sees one clean message", async () => {
    const { rotating, api, pool } = run([
      { status: 429, error: '429 {"message":"rate limit exceeded"}' },
      { status: 200, text: "hello" },
    ]);

    const events = await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(events.filter((event) => event.type === "start")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("done");
    expect(api.usedKeys).toEqual([keys[0]!.key, keys[1]!.key]);
    expect(pool.status()[0]?.rateLimited).toBe(1);
    expect(pool.status()[1]?.ok).toBe(1);
  });

  test("puts the rate-limited key on cooldown so it is skipped next", async () => {
    const { rotating, api, pool } = run([
      { status: 429, error: "429 rate limit" },
      { status: 200 },
    ]);

    await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(pool.status()[0]?.cooldownRemainingMs).toBe(5_000);
    expect(pool.status()[0]?.cooldownReason).toBe("rate_limited");
  });

  test("uses the server's retry-after over the configured cooldown", async () => {
    const { rotating, api, pool } = run([
      { status: 429, error: "429 rate limit", retryAfter: "45" },
      { status: 200 },
    ]);

    await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(pool.status()[0]?.cooldownRemainingMs).toBe(45_000);
  });

  test("withholds a failed attempt's events so the retry cannot duplicate output", async () => {
    const { rotating, api } = run([
      { status: 429, error: "429 rate limit", startBeforeError: true },
      { status: 200, text: "hello" },
    ]);

    const events = await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(events.filter((event) => event.type === "start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "text_delta")).toHaveLength(1);
    expect(api.usedKeys).toHaveLength(2);
  });

  test("announces each rotation", async () => {
    const { rotating, api, notices } = run([
      { status: 429, error: "429 rate limit" },
      { status: 200 },
    ]);

    await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(notices).toEqual(["tensorx: rate limited on one, rotating"]);
  });
});

describe("rotating stream and the request credential", () => {
  test("carries the leased key in the Authorization header, not only in apiKey", async () => {
    const { rotating, api } = run([{ status: 429, error: "429 rate limit" }, { status: 200 }]);

    await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(authorizations(api.usedHeaders[0])).toEqual([`Bearer ${keys[0]!.key}`]);
    expect(authorizations(api.usedHeaders[1])).toEqual([`Bearer ${keys[1]!.key}`]);
  });

  test("replaces the Authorization the caller resolved and keeps its other headers", async () => {
    const { rotating, api } = run([{ status: 429, error: "429 rate limit" }, { status: 200 }]);

    await collect(
      rotating(model, context, {
        fetch: api.baseFetch,
        headers: { Authorization: "Bearer sk-resolved-elsewhere", "x-trace": "keep-me" },
      }),
    );

    expect(authorizations(api.usedHeaders[0])).toEqual([`Bearer ${keys[0]!.key}`]);
    expect(authorizations(api.usedHeaders[1])).toEqual([`Bearer ${keys[1]!.key}`]);
    expect(api.usedHeaders[1]?.["x-trace"]).toBe("keep-me");
  });

  test("replaces a lowercase authorization rather than sending both", async () => {
    const { rotating, api } = run([{ status: 200 }]);

    await collect(
      rotating(model, context, {
        fetch: api.baseFetch,
        headers: { authorization: "Bearer sk-resolved-elsewhere" },
      }),
    );

    expect(authorizations(api.usedHeaders[0])).toEqual([`Bearer ${keys[0]!.key}`]);
  });

  test("leaves the caller's headers object untouched", async () => {
    const { rotating, api } = run([{ status: 200 }]);
    const headers = { Authorization: "Bearer sk-resolved-elsewhere" };

    await collect(rotating(model, context, { fetch: api.baseFetch, headers }));

    expect(headers).toEqual({ Authorization: "Bearer sk-resolved-elsewhere" });
  });
});

describe("rotating stream on a rejected key", () => {
  test("rotates on 401 and holds the key for the invalid cooldown", async () => {
    const clock = fakeClock();
    const pool = new KeyPool(keys, {
      ...clock.options,
      cooldownMs: 5_000,
      invalidCooldownMs: 600_000,
    });
    const api = createFakeApi([{ status: 401, error: "401 invalid api key" }, { status: 200 }]);
    const rotating = createRotatingStreamSimple({
      pool,
      streamSimple: api.streamSimple,
      providerId: "tensorx",
      now: clock.now,
    });

    const events = await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(events.at(-1)?.type).toBe("done");
    expect(pool.status()[0]?.invalid).toBe(1);
    expect(pool.status()[0]?.cooldownRemainingMs).toBe(600_000);
  });
});

describe("rotating stream on faults that are not the key's", () => {
  test("relays a 500 instead of burning another key", async () => {
    const { rotating, api, pool } = run([
      { status: 500, error: "500 internal server error" },
      { status: 200 },
    ]);

    const events = await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(events.at(-1)?.type).toBe("error");
    expect(api.usedKeys).toHaveLength(1);
    expect(pool.status()[0]?.cooldownRemainingMs).toBe(0);
  });

  test("relays a thrown transport failure without rotating", async () => {
    const { rotating, api } = run([{ status: 0, throws: "socket hang up" }, { status: 200 }]);

    const events = await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(events.at(-1)?.type).toBe("error");
    expect(api.usedKeys).toHaveLength(1);
  });

  test("ends a truncated stream with an error rather than hanging", async () => {
    const { rotating, api } = run([{ status: 200, truncate: true }]);
    const stream = rotating(model, context, { fetch: api.baseFetch });

    const events = await collect(stream);
    const result = await stream.result();

    expect(events.at(-1)?.type).toBe("error");
    expect(result.errorMessage).toContain("ended mid-message");
  });
});

describe("rotating stream when the pool runs dry", () => {
  test("waits out a cooldown inside the budget instead of giving up", async () => {
    const { rotating, api, clock } = run(
      [
        { status: 429, error: "429 rate limit" },
        { status: 429, error: "429 rate limit" },
        { status: 200 },
      ],
      { poolKeys: [keys[0]!, keys[1]!], budgetMs: 60_000 },
    );
    const startedAt = clock.time;

    const events = await collect(rotating(model, context, { fetch: api.baseFetch }));

    expect(events.at(-1)?.type).toBe("done");
    expect(api.usedKeys).toHaveLength(3);
    expect(clock.time - startedAt).toBeGreaterThanOrEqual(5_000);
  });

  test("fails with a message naming the attempts and the last error", async () => {
    const { rotating, api } = run(
      [{ status: 429, error: "429 quota exceeded", retryAfter: "600" }],
      {
        poolKeys: [keys[0]!, keys[1]!],
        budgetMs: 10_000,
      },
    );
    const stream = rotating(model, context, { fetch: api.baseFetch });

    await collect(stream);
    const result = await stream.result();

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("2 attempt(s) across 2 key(s)");
    expect(result.errorMessage).toContain("quota exceeded");
  });
});

describe("rotating stream and cancellation", () => {
  test("reports an aborted turn rather than a rotation failure", async () => {
    const controller = new AbortController();
    const { rotating, api, pool } = run([{ status: 429, error: "429 rate limit" }], {
      poolKeys: [keys[0]!],
    });

    const first = await pool.acquire();
    pool.release(first);
    pool.report(first, "rate_limited");
    controller.abort();

    const stream = rotating(model, context, { fetch: api.baseFetch, signal: controller.signal });
    const events = await collect(stream);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", reason: "aborted" });
  });
});

describe("classifyFailure", () => {
  test("trusts an observed status over the error text", () => {
    expect(classifyFailure({ status: 500 }, "rate limit exceeded")).toBeUndefined();
    expect(classifyFailure({ status: 429 }, "something else")).toEqual({ outcome: "rate_limited" });
  });

  test("carries an observed retry-after into the cooldown", () => {
    expect(classifyFailure({ status: 429, retryAfterMs: 9_000 }, undefined)).toEqual({
      outcome: "rate_limited",
      cooldownMs: 9_000,
    });
  });

  test("treats 401 and 403 as a rejected key", () => {
    expect(classifyFailure({ status: 401 }, undefined)).toEqual({ outcome: "invalid" });
    expect(classifyFailure({ status: 403 }, undefined)).toEqual({ outcome: "invalid" });
  });

  test("falls back to the message when no status was observed", () => {
    expect(classifyFailure({}, "429 Too Many Requests")).toEqual({ outcome: "rate_limited" });
    expect(classifyFailure({}, "invalid api key")).toEqual({ outcome: "invalid" });
    expect(classifyFailure({}, "context length exceeded")).toBeUndefined();
    expect(classifyFailure({}, undefined)).toBeUndefined();
  });
});

describe("parseRetryAfterMs", () => {
  const now = Date.parse("2026-09-02T22:00:00Z");

  test("prefers retry-after-ms", () => {
    expect(
      parseRetryAfterMs(new Headers({ "retry-after-ms": "1500", "retry-after": "60" }), now),
    ).toBe(1500);
  });

  test("reads seconds", () => {
    expect(parseRetryAfterMs(new Headers({ "retry-after": "30" }), now)).toBe(30_000);
  });

  test("reads an HTTP date", () => {
    expect(
      parseRetryAfterMs(new Headers({ "retry-after": "Wed, 02 Sep 2026 22:00:30 GMT" }), now),
    ).toBe(30_000);
  });

  test("ignores a header that is absent, zero, or in the past", () => {
    expect(parseRetryAfterMs(new Headers(), now)).toBeUndefined();
    expect(parseRetryAfterMs(new Headers({ "retry-after": "0" }), now)).toBeUndefined();
    expect(
      parseRetryAfterMs(new Headers({ "retry-after": "Wed, 02 Sep 2026 21:59:00 GMT" }), now),
    ).toBeUndefined();
  });
});

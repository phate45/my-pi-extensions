/**
 * Drives the rotating wrapper through the real pi-ai openai-completions adapter
 * and observes what leaves as an HTTP request.
 *
 * A leased key only matters if it survives three layers below the pool: pi resolves
 * an Authorization header of its own when a provider sets `authHeader: true`, pi-ai
 * merges the caller's headers over its client defaults, and openai-node ranks
 * `defaultHeaders` above the key the client was built with. A stubbed adapter shows
 * none of that, so the credential is asserted here on the request itself.
 */

import { describe, expect, test } from "bun:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { KeyPool } from "../../extensions/my-stuff/lib/key-pool.js";
import { createRotatingStreamSimple } from "../../extensions/my-stuff/lib/rotating-stream.js";

const model = {
  id: "z-ai/glm-5.3-flash",
  provider: "tensorx",
  api: "openai-completions",
  name: "GLM 5.3 Flash",
  baseUrl: "https://api.tensorx.invalid/v1",
  contextWindow: 128_000,
  maxTokens: 8_192,
  input: [],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as unknown as Model<Api>;

const context = { messages: [{ role: "user", content: "hi" }] } as unknown as Context;

const keys = [
  { key: "sk-key-one-aaaaaaaaaaaa", label: "one" },
  { key: "sk-key-two-bbbbbbbbbbbb", label: "two" },
  { key: "sk-key-three-cccccccccc", label: "three" },
];

/** Answers every request with a 429 and records the Authorization it was sent. */
function rateLimitingEndpoint() {
  const sent: (string | null)[] = [];

  const fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    sent.push(headers.get("authorization"));
    return new Response(JSON.stringify({ error: { message: "rate limit exceeded" } }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;

  return { fetch, sent };
}

function rotatingAgainstRealAdapter() {
  const impl = getApiProvider("openai-completions" as Api);
  if (!impl) throw new Error("no openai-completions API implementation");

  return createRotatingStreamSimple({
    pool: new KeyPool(keys, { cooldownMs: 30_000 }),
    streamSimple: impl.streamSimple,
    providerId: "tensorx",
    // Short enough that the run ends once every key is cooling, instead of
    // waiting out a cooldown for the length of the test.
    rotationBudgetMs: 1,
  });
}

async function drain(stream: AsyncIterable<unknown>) {
  for await (const _event of stream) {
    // The events are irrelevant here; the requests are the subject.
  }
}

describe("rotation on the wire", () => {
  test("sends each attempt under a different key", async () => {
    const endpoint = rateLimitingEndpoint();
    const rotating = rotatingAgainstRealAdapter();

    await drain(rotating(model, context, { fetch: endpoint.fetch as never }));

    expect(endpoint.sent).toEqual(keys.map((entry) => `Bearer ${entry.key}`));
  });

  test("overrides the Authorization pi resolved from its own credential", async () => {
    const endpoint = rateLimitingEndpoint();
    const rotating = rotatingAgainstRealAdapter();

    await drain(
      rotating(model, context, {
        fetch: endpoint.fetch as never,
        // What pi hands a provider registered with `authHeader: true`.
        apiKey: keys[0]!.key,
        headers: { Authorization: `Bearer ${keys[0]!.key}` },
      }),
    );

    expect(endpoint.sent).toEqual(keys.map((entry) => `Bearer ${entry.key}`));
    expect(endpoint.sent.filter((value) => value === `Bearer ${keys[0]!.key}`)).toHaveLength(1);
  });
});

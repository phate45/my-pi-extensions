import { describe, expect, test } from "bun:test";
import {
  KeyPool,
  PoolUnavailableError,
  maskKey,
  type KeyPoolOptions,
} from "../../extensions/my-stuff/lib/key-pool.js";

/** Deterministic clock whose sleep advances time instead of waiting on it. */
function fakeClock(start = 1_000) {
  let current = start;
  const slept: number[] = [];
  const options: KeyPoolOptions = {
    now: () => current,
    sleep: async (ms, signal) => {
      if (signal?.aborted) {
        const error = new Error("Request aborted");
        error.name = "AbortError";
        throw error;
      }
      slept.push(ms);
      current += ms;
    },
  };
  return {
    options,
    slept,
    advance: (ms: number) => {
      current += ms;
    },
    get time() {
      return current;
    },
  };
}

const keys = [
  { key: "sk-aaaaaaaaaaaaaaaaaaaa", label: "one" },
  { key: "sk-bbbbbbbbbbbbbbbbbbbb", label: "two" },
  { key: "sk-cccccccccccccccccccc", label: "three" },
];

describe("KeyPool selection", () => {
  test("spreads concurrent leases across distinct keys", async () => {
    const pool = new KeyPool(keys, fakeClock().options);

    const leases = [await pool.acquire(), await pool.acquire(), await pool.acquire()];

    expect(new Set(leases.map((lease) => lease.label))).toEqual(new Set(["one", "two", "three"]));
  });

  test("prefers the least recently used key once all are idle", async () => {
    const clock = fakeClock();
    const pool = new KeyPool(keys, clock.options);

    const first = await pool.acquire();
    pool.release(first);
    clock.advance(10);
    const second = await pool.acquire();
    pool.release(second);
    clock.advance(10);

    const third = await pool.acquire();

    expect(third.label).toBe("three");
  });

  test("returns to a released key rather than an in-flight one", async () => {
    const clock = fakeClock();
    const pool = new KeyPool([keys[0]!, keys[1]!], clock.options);

    const held = await pool.acquire();
    clock.advance(10);
    const other = await pool.acquire();
    pool.release(other);
    clock.advance(10);

    const next = await pool.acquire();

    expect(next.label).toBe(other.label);
    expect(next.label).not.toBe(held.label);
  });
});

describe("KeyPool cooldowns", () => {
  test("skips a rate-limited key until its cooldown expires", async () => {
    const clock = fakeClock();
    const pool = new KeyPool([keys[0]!, keys[1]!], { ...clock.options, cooldownMs: 5_000 });

    const first = await pool.acquire();
    pool.release(first);
    pool.report(first, "rate_limited");

    const second = await pool.acquire();
    expect(second.label).not.toBe(first.label);
  });

  test("honors a server-supplied cooldown over the configured default", async () => {
    const clock = fakeClock();
    const pool = new KeyPool([keys[0]!], { ...clock.options, cooldownMs: 1_000 });

    const lease = await pool.acquire();
    pool.release(lease);
    pool.report(lease, "rate_limited", 30_000);

    await pool.acquire();

    expect(clock.slept.reduce((total, ms) => total + ms, 0)).toBeGreaterThanOrEqual(30_000);
  });

  test("waits out the cooldown when every key is limited", async () => {
    const clock = fakeClock();
    const pool = new KeyPool([keys[0]!, keys[1]!], { ...clock.options, cooldownMs: 4_000 });

    for (const _ of [0, 1]) {
      const lease = await pool.acquire();
      pool.release(lease);
      pool.report(lease, "rate_limited");
    }

    const startedAt = clock.time;
    const recovered = await pool.acquire();

    expect(recovered.label).toBeDefined();
    expect(clock.time - startedAt).toBeGreaterThanOrEqual(4_000);
  });

  test("gives a bad key the longer invalid cooldown", async () => {
    const clock = fakeClock();
    const pool = new KeyPool([keys[0]!], {
      ...clock.options,
      cooldownMs: 1_000,
      invalidCooldownMs: 60_000,
    });

    const lease = await pool.acquire();
    pool.release(lease);
    pool.report(lease, "invalid");

    expect(pool.status()[0]?.cooldownRemainingMs).toBe(60_000);
    expect(pool.status()[0]?.cooldownReason).toBe("invalid");
  });

  test("a success clears an earlier cooldown", async () => {
    const clock = fakeClock();
    const pool = new KeyPool([keys[0]!], { ...clock.options, cooldownMs: 10_000 });

    const lease = await pool.acquire();
    pool.report(lease, "rate_limited");
    pool.report(lease, "ok");

    expect(pool.status()[0]?.cooldownRemainingMs).toBe(0);
  });
});

describe("KeyPool availability limits", () => {
  test("throws PoolUnavailableError when no key recovers before the deadline", async () => {
    const clock = fakeClock();
    const pool = new KeyPool([keys[0]!], { ...clock.options, cooldownMs: 120_000 });

    const lease = await pool.acquire();
    pool.release(lease);
    pool.report(lease, "rate_limited");

    const attempt = pool.acquire(undefined, clock.time + 10_000);

    await expect(attempt).rejects.toThrow(PoolUnavailableError);
  });

  test("throws PoolUnavailableError when the pool holds no enabled keys", async () => {
    const pool = new KeyPool([{ ...keys[0]!, enabled: false }], fakeClock().options);

    await expect(pool.acquire()).rejects.toThrow(PoolUnavailableError);
  });

  test("propagates an abort as AbortError rather than a pool failure", async () => {
    const clock = fakeClock();
    const pool = new KeyPool([keys[0]!], { ...clock.options, cooldownMs: 60_000 });
    const controller = new AbortController();

    const lease = await pool.acquire();
    pool.release(lease);
    pool.report(lease, "rate_limited");
    controller.abort();

    await expect(pool.acquire(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("KeyPool bookkeeping", () => {
  test("setKeys drops state for removed keys and keeps it for survivors", async () => {
    const clock = fakeClock();
    const pool = new KeyPool([keys[0]!, keys[1]!], clock.options);

    const lease = await pool.acquire();
    pool.release(lease);
    pool.report(lease, "rate_limited");
    pool.setKeys([lease.key === keys[0]!.key ? keys[0]! : keys[1]!]);

    expect(pool.size).toBe(1);
    expect(pool.status()[0]?.rateLimited).toBe(1);
  });

  test("status reports in-flight leases and masks key material", async () => {
    const pool = new KeyPool([keys[0]!], fakeClock().options);

    await pool.acquire();
    const [row] = pool.status();

    expect(row?.inFlight).toBe(1);
    expect(row?.masked).toBe("sk-aaa…aaaa");
    expect(row?.masked).not.toContain(keys[0]!.key);
  });

  test("maskKey hides short keys entirely", () => {
    expect(maskKey("sk-short")).toBe("…");
  });
});

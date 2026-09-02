/**
 * A pool of interchangeable API keys for one provider, with per-key cooldowns.
 *
 * Selection is fewest-in-flight, then least-recently-used, so concurrent
 * subagents spread across distinct keys instead of stacking on one.
 */

export type KeyOutcome = "ok" | "rate_limited" | "invalid" | "error";

export type PoolKey = {
  key: string;
  label: string;
  enabled?: boolean;
};

export type Lease = {
  key: string;
  label: string;
};

export type KeyStatus = {
  label: string;
  masked: string;
  enabled: boolean;
  inFlight: number;
  ok: number;
  rateLimited: number;
  invalid: number;
  errors: number;
  cooldownRemainingMs: number;
  cooldownReason?: "rate_limited" | "invalid";
};

/** Thrown by acquire when no key can be leased before the caller's deadline. */
export class PoolUnavailableError extends Error {
  readonly earliestRecoveryMs: number;

  constructor(earliestRecoveryMs: number) {
    super(
      Number.isFinite(earliestRecoveryMs)
        ? `every key is cooling down; earliest recovery in ${Math.ceil(earliestRecoveryMs / 1000)}s`
        : "no enabled keys in the pool",
    );
    this.name = "PoolUnavailableError";
    this.earliestRecoveryMs = earliestRecoveryMs;
  }
}

export const DEFAULT_COOLDOWN_MS = 20_000;
export const DEFAULT_INVALID_COOLDOWN_MS = 600_000;

/** Upper bound on a single wait, so a long cooldown still re-evaluates the pool periodically. */
const MAX_WAIT_SLICE_MS = 5_000;
const MIN_WAIT_SLICE_MS = 25;

export type KeyPoolOptions = {
  cooldownMs?: number;
  invalidCooldownMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

type KeyState = {
  inFlight: number;
  ok: number;
  rateLimited: number;
  invalid: number;
  errors: number;
  cooldownUntil: number;
  cooldownReason?: "rate_limited" | "invalid";
  lastUsed: number;
};

function createState(): KeyState {
  return {
    inFlight: 0,
    ok: 0,
    rateLimited: 0,
    invalid: 0,
    errors: 0,
    cooldownUntil: 0,
    lastUsed: 0,
  };
}

export function maskKey(key: string): string {
  if (key.length <= 12) return "…";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function abortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class KeyPool {
  private keys: PoolKey[];
  private readonly states = new Map<string, KeyState>();
  private readonly cooldownMs: number;
  private readonly invalidCooldownMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(keys: PoolKey[], options: KeyPoolOptions = {}) {
    this.keys = keys;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.invalidCooldownMs = options.invalidCooldownMs ?? DEFAULT_INVALID_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
  }

  /** Replace the key list, preserving live state for keys that survive. */
  setKeys(keys: PoolKey[]): void {
    this.keys = keys;
    const surviving = new Set(keys.map((entry) => entry.key));
    for (const key of [...this.states.keys()]) {
      if (!surviving.has(key)) this.states.delete(key);
    }
  }

  get size(): number {
    return this.enabled().length;
  }

  private enabled(): PoolKey[] {
    return this.keys.filter((entry) => entry.enabled !== false);
  }

  private state(key: string): KeyState {
    let state = this.states.get(key);
    if (!state) {
      state = createState();
      this.states.set(key, state);
    }
    return state;
  }

  /**
   * Lease the best available key, waiting out cooldowns until `deadlineAt`.
   * Throws PoolUnavailableError when no key can recover in time, AbortError
   * when the signal fires.
   */
  async acquire(signal?: AbortSignal, deadlineAt?: number): Promise<Lease> {
    for (;;) {
      if (signal?.aborted) throw abortError();

      const now = this.now();
      const entries = this.enabled();
      if (entries.length === 0) throw new PoolUnavailableError(Number.POSITIVE_INFINITY);

      const ready = entries
        .map((entry) => ({ entry, state: this.state(entry.key) }))
        .filter((candidate) => candidate.state.cooldownUntil <= now);

      if (ready.length > 0) {
        ready.sort(
          (a, b) => a.state.inFlight - b.state.inFlight || a.state.lastUsed - b.state.lastUsed,
        );
        const chosen = ready[0];
        if (!chosen) throw new PoolUnavailableError(Number.POSITIVE_INFINITY);
        chosen.state.inFlight++;
        chosen.state.lastUsed = now;
        return { key: chosen.entry.key, label: chosen.entry.label };
      }

      const earliest = Math.min(...entries.map((entry) => this.state(entry.key).cooldownUntil));
      if (deadlineAt !== undefined && earliest > deadlineAt) {
        throw new PoolUnavailableError(earliest - now);
      }
      const remaining = earliest - now;
      await this.sleep(
        Math.max(MIN_WAIT_SLICE_MS, Math.min(remaining, MAX_WAIT_SLICE_MS)),
        signal,
      );
    }
  }

  release(lease: Lease): void {
    const state = this.state(lease.key);
    state.inFlight = Math.max(0, state.inFlight - 1);
  }

  report(lease: Lease, outcome: KeyOutcome, cooldownMs?: number): void {
    const state = this.state(lease.key);
    const now = this.now();
    switch (outcome) {
      case "ok":
        state.ok++;
        state.cooldownUntil = 0;
        state.cooldownReason = undefined;
        break;
      case "rate_limited":
        state.rateLimited++;
        state.cooldownUntil = Math.max(state.cooldownUntil, now + (cooldownMs ?? this.cooldownMs));
        state.cooldownReason = "rate_limited";
        break;
      case "invalid":
        state.invalid++;
        state.cooldownUntil = Math.max(state.cooldownUntil, now + this.invalidCooldownMs);
        state.cooldownReason = "invalid";
        break;
      case "error":
        state.errors++;
        break;
    }
  }

  status(): KeyStatus[] {
    const now = this.now();
    return this.keys.map((entry) => {
      const state = this.state(entry.key);
      const cooldownRemainingMs = Math.max(0, state.cooldownUntil - now);
      return {
        label: entry.label,
        masked: maskKey(entry.key),
        enabled: entry.enabled !== false,
        inFlight: state.inFlight,
        ok: state.ok,
        rateLimited: state.rateLimited,
        invalid: state.invalid,
        errors: state.errors,
        cooldownRemainingMs,
        ...(cooldownRemainingMs > 0 && state.cooldownReason
          ? { cooldownReason: state.cooldownReason }
          : {}),
      };
    });
  }
}

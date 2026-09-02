import { defineExtensionConfig } from "../../infra/lib/extension-config.js";
import { DEFAULT_COOLDOWN_MS, DEFAULT_INVALID_COOLDOWN_MS } from "./key-pool.js";
import { DEFAULT_ROTATION_BUDGET_MS } from "./rotating-stream.js";

export type TensorxProviderConfig = {
  /** How long a key rests after a 429 when the server sends no retry-after. */
  cooldownMs: number;
  /** How long a key rests after a 401/403. */
  invalidCooldownMs: number;
  /** Wall-clock ceiling on rotating and waiting before a request is failed. */
  rotationBudgetMs: number;
};

export const DEFAULT_TENSORX_PROVIDER_CONFIG: TensorxProviderConfig = {
  cooldownMs: DEFAULT_COOLDOWN_MS,
  invalidCooldownMs: DEFAULT_INVALID_COOLDOWN_MS,
  rotationBudgetMs: DEFAULT_ROTATION_BUDGET_MS,
};

function positiveMs(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function normalizeTensorxProviderConfig(
  raw: Record<string, unknown> | undefined,
  defaults: TensorxProviderConfig = DEFAULT_TENSORX_PROVIDER_CONFIG,
): TensorxProviderConfig {
  return {
    cooldownMs: positiveMs(raw?.cooldownMs, defaults.cooldownMs),
    invalidCooldownMs: positiveMs(raw?.invalidCooldownMs, defaults.invalidCooldownMs),
    rotationBudgetMs: positiveMs(raw?.rotationBudgetMs, defaults.rotationBudgetMs),
  };
}

export const tensorxProviderConfig = defineExtensionConfig({
  defaults: DEFAULT_TENSORX_PROVIDER_CONFIG,
  normalize: normalizeTensorxProviderConfig,
});

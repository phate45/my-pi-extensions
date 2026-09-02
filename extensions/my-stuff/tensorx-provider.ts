/**
 * TensorX provider, backed by a pool of API keys.
 *
 * TensorX rate-limits each key independently, so a 429 on one key is survivable by
 * retrying the same request on another. Keys live in ~/.pi/agent/tensorx-keys.json;
 * with fewer than two the provider registers exactly as a plain provider does and pi
 * resolves the single credential from auth.json.
 */

import type { Api } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import { KeyPool, type KeyStatus } from "./lib/key-pool.js";
import { createRotatingStreamSimple } from "./lib/rotating-stream.js";
import { loadTensorxKeys } from "./lib/tensorx-keys.js";
import { TENSORX_API, TENSORX_BASE_URL, tensorxModels } from "./lib/tensorx-models.js";
import {
  type TensorxProviderConfig,
  tensorxProviderConfig,
} from "./lib/tensorx-provider-config.js";

const PROVIDER_ID = "tensorx";

export function formatPoolStatus(rows: KeyStatus[], keysPath: string): string {
  if (rows.length === 0) return `No TensorX keys configured. Add them to ${keysPath}.`;

  const lines = rows.map((row) => {
    const state = !row.enabled
      ? "disabled"
      : row.cooldownRemainingMs > 0
        ? `${row.cooldownReason === "invalid" ? "rejected" : "limited"} ${Math.ceil(row.cooldownRemainingMs / 1000)}s`
        : "ready";
    return `${row.label} (${row.masked})  ${state}  in-flight ${row.inFlight}  ok ${row.ok}  429 ${row.rateLimited}  auth ${row.invalid}  err ${row.errors}`;
  });

  return [`TensorX key pool (${keysPath})`, ...lines].join("\n");
}

export default defineManagedExtension({
  name: "tensorx-provider",
  // No feature flag, unlike every other entrypoint in this folder. advisor runs pi
  // with `myStuff: false` and selects tensorx as its provider, so putting this behind
  // that flag would leave every advisor run without a model.
  config: tensorxProviderConfig,
  setup(pi: ExtensionAPI, getConfig: () => TensorxProviderConfig) {
    const config = getConfig();
    const loaded = loadTensorxKeys();
    const warnings = [...loaded.warnings];

    const pool = new KeyPool(loaded.keys, {
      cooldownMs: config.cooldownMs,
      invalidCooldownMs: config.invalidCooldownMs,
    });

    let ui: ExtensionContext["ui"] | undefined;
    const notify = (message: string) => {
      try {
        ui?.notify(message, "warning");
      } catch {
        // The UI is gone during reload or shutdown; notices are best-effort.
      }
    };

    const impl = pool.size >= 2 ? getApiProvider(TENSORX_API as Api) : undefined;
    if (pool.size >= 2 && !impl) {
      warnings.push(`no "${TENSORX_API}" API implementation; key rotation is off`);
    }

    pi.registerProvider(PROVIDER_ID, {
      name: "TensorX",
      baseUrl: TENSORX_BASE_URL,
      api: TENSORX_API,
      // pi requires apiKey (or oauth) to be present when models are defined, but the
      // credential resolution order is CLI -> auth.json -> env. Rotation supplies the
      // real key per request; without a pool the key comes from auth.json. This env
      // reference only satisfies the field requirement and stays unresolved.
      apiKey: "$TENSORX_API_KEY",
      authHeader: true,
      models: tensorxModels(),
      ...(impl
        ? {
            streamSimple: createRotatingStreamSimple({
              pool,
              streamSimple: impl.streamSimple,
              providerId: PROVIDER_ID,
              rotationBudgetMs: config.rotationBudgetMs,
              notify,
            }),
          }
        : {}),
    });

    pi.on("session_start", async (_event, ctx) => {
      ui = ctx.ui;
      for (const warning of warnings) ctx.ui.notify(`tensorx: ${warning}`, "warning");
      warnings.length = 0;
    });

    pi.registerCommand(PROVIDER_ID, {
      description: "Show the TensorX key pool: rotation state, cooldowns, and per-key counters",
      handler: async (_args, ctx) => {
        ctx.ui.notify(formatPoolStatus(pool.status(), loaded.path), "info");
      },
    });
  },
});

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import tensorxProvider, { formatPoolStatus } from "../../extensions/my-stuff/tensorx-provider.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempPiEnv, writeJson } from "../helpers/temp-env.js";

const realAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  resetBundleConfigForTests();
  if (realAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = realAgentDir;
});

/**
 * Each case runs against a throwaway agent directory. The seeded keys file is
 * asserted inside it, which also proves the redirect held and no case reached the
 * real one.
 */
async function withAgentDir(
  keys: unknown | undefined,
  run: (agentDir: string) => Promise<void> | void,
): Promise<void> {
  const env = await createTempPiEnv();
  try {
    const agentDir = env.agentDir;
    await writeJson(path.join(agentDir, "auth.json"), { tensorx: { key: "sk-from-auth" } });
    if (keys !== undefined) await writeJson(path.join(agentDir, "tensorx-keys.json"), keys);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    await run(agentDir);
  } finally {
    await env.cleanup();
  }
}

describe("tensorx provider registration", () => {
  test("registers the catalog with rotation once the pool holds two keys", async () => {
    await withAgentDir(
      { keys: [{ key: "sk-one-aaaaaaaaaaaaaa", label: "one" }, { key: "sk-two-bbbbbbbbbbbbbb", label: "two" }] },
      () => {
        const { pi, providers, commands } = createMockExtensionAPI();

        tensorxProvider(pi);

        const provider = providers.get("tensorx");
        expect(provider?.baseUrl).toBe("https://api.tensorx.ai/v1");
        expect(provider?.api).toBe("openai-completions");
        expect(typeof provider?.streamSimple).toBe("function");
        expect(commands).toContain("tensorx");
      },
    );
  });

  test("registers without rotation when only one key is configured", async () => {
    await withAgentDir({ keys: [{ key: "sk-only-aaaaaaaaaaaa", label: "only" }] }, () => {
      const { pi, providers } = createMockExtensionAPI();

      tensorxProvider(pi);

      expect(providers.get("tensorx")?.streamSimple).toBeUndefined();
    });
  });

  test("falls back to the auth.json credential on a first run", async () => {
    await withAgentDir(undefined, (agentDir) => {
      const { pi, providers } = createMockExtensionAPI();

      tensorxProvider(pi);

      expect(providers.get("tensorx")?.streamSimple).toBeUndefined();
      expect(existsSync(path.join(agentDir, "tensorx-keys.json"))).toBe(true);
    });
  });

  test("keeps the DeepSeek chat-template thinking wiring intact", async () => {
    await withAgentDir({ keys: [{ key: "sk-only-aaaaaaaaaaaa" }] }, () => {
      const { pi, providers } = createMockExtensionAPI();

      tensorxProvider(pi);

      const models = providers.get("tensorx")?.models as { id: string; compat: Record<string, unknown> }[];
      const deepseek = models.find((entry) => entry.id === "deepseek/deepseek-v4-pro");
      const glm = models.find((entry) => entry.id === "z-ai/glm-5.3-flash");

      expect(deepseek?.compat.thinkingFormat).toBe("chat-template");
      expect(deepseek?.compat.chatTemplateKwargs).toEqual({ thinking: { $var: "thinking.enabled" } });
      expect(deepseek?.compat.maxTokensField).toBe("max_tokens");
      expect(glm?.compat.thinkingFormat).toBeUndefined();
      expect(models).toHaveLength(8);
    });
  });
});

/**
 * advisor drives pi with its own bundle settings
 * (`advisorlib/advisor-pi-settings.json`) and turns the `myStuff` feature flag off,
 * which disables every other extension in this folder. advisor selects `tensorx` as
 * its provider, so this entrypoint has to stay outside that flag or every advisor run
 * loses its model. Adding `featureFlag: "myStuff"` here to match the neighbouring
 * files is the tidy-up that would break it.
 */
describe("tensorx provider under advisor's bundle settings", () => {
  const ADVISOR_SETTINGS = {
    featureFlags: { ccLike: true, myStuff: false, headless: true },
    extensions: {
      "background-tasks": { enabled: false },
      "skill-tool": { enabled: false },
      subagents: { enabled: false },
    },
  };

  test("still registers when myStuff is off", async () => {
    await withAgentDir({ keys: [{ key: "sk-one-aaaaaaaaaaaaaa" }, { key: "sk-two-bbbbbbbbbbbb" }] }, () => {
      const { pi, providers } = createMockExtensionAPI();
      setBundleConfigForTests(ADVISOR_SETTINGS);

      tensorxProvider(pi);

      expect(providers.has("tensorx")).toBe(true);
      expect(typeof providers.get("tensorx")?.streamSimple).toBe("function");
    });
  });

  test("an explicit per-extension disable still switches it off", async () => {
    await withAgentDir({ keys: [{ key: "sk-one-aaaaaaaaaaaaaa" }] }, () => {
      const { pi, providers } = createMockExtensionAPI();
      setBundleConfigForTests({
        ...ADVISOR_SETTINGS,
        extensions: { ...ADVISOR_SETTINGS.extensions, "tensorx-provider": { enabled: false } },
      });

      tensorxProvider(pi);

      expect(providers.has("tensorx")).toBe(false);
    });
  });
});

describe("formatPoolStatus", () => {
  test("points at the keys file when the pool is empty", () => {
    expect(formatPoolStatus([], "/tmp/tensorx-keys.json")).toContain("/tmp/tensorx-keys.json");
  });

  test("renders state per key without exposing key material", () => {
    const output = formatPoolStatus(
      [
        {
          label: "one",
          masked: "sk-one…aaaa",
          enabled: true,
          inFlight: 1,
          ok: 4,
          rateLimited: 2,
          invalid: 0,
          errors: 0,
          cooldownRemainingMs: 12_000,
          cooldownReason: "rate_limited",
        },
        {
          label: "two",
          masked: "sk-two…bbbb",
          enabled: false,
          inFlight: 0,
          ok: 0,
          rateLimited: 0,
          invalid: 1,
          errors: 0,
          cooldownRemainingMs: 0,
        },
      ],
      "/tmp/tensorx-keys.json",
    );

    expect(output).toContain("one (sk-one…aaaa)  limited 12s");
    expect(output).toContain("two (sk-two…bbbb)  disabled");
    expect(output).not.toContain("sk-one-");
  });
});

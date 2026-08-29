import { afterEach, describe, expect, test } from "bun:test";
import askUserExtension from "../../extensions/my-stuff/ask-user.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("ask-user extension", () => {
  test("registers the ask_user tool when enabled", () => {
    const { pi, tools } = createMockExtensionAPI();

    askUserExtension(pi);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "ask_user",
      label: "Ask User",
      promptGuidelines: [expect.stringContaining("ask_user"), expect.stringContaining("ask_user")],
    });
  });

  test("skips registration when the myStuff feature flag is disabled", () => {
    const { pi, tools } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: { myStuff: false },
      extensions: { "ask-user": { enabled: true } },
    });

    askUserExtension(pi);

    expect(tools).toHaveLength(0);
  });

  test("skips registration when headless is enabled", () => {
    const { pi, tools } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: { headless: true },
      extensions: { "ask-user": { enabled: true } },
    });

    askUserExtension(pi);

    expect(tools).toHaveLength(0);
  });

  test("registers the ask_user tool in RPC mode even when headless", () => {
    const originalArgv = [...process.argv];
    process.argv = [...originalArgv, "--mode", "rpc"];
    try {
      const { pi, tools } = createMockExtensionAPI();
      setBundleConfigForTests({
        featureFlags: { headless: true },
        extensions: { "ask-user": { enabled: true } },
      });

      askUserExtension(pi);

      expect(tools).toHaveLength(1);
    } finally {
      process.argv = originalArgv;
    }
  });

  test("accepts --mode=rpc as the RPC registration signal", () => {
    const originalArgv = [...process.argv];
    process.argv = [...originalArgv, "--mode=rpc"];
    try {
      const { pi, tools } = createMockExtensionAPI();

      askUserExtension(pi);

      expect(tools).toHaveLength(1);
    } finally {
      process.argv = originalArgv;
    }
  });

  test("still skips registration in print mode when headless is enabled", () => {
    const originalArgv = [...process.argv];
    process.argv = [...originalArgv, "--mode", "print"];
    try {
      const { pi, tools } = createMockExtensionAPI();

      askUserExtension(pi);

      expect(tools).toHaveLength(0);
    } finally {
      process.argv = originalArgv;
    }
  });
});

describe("ask-user rpc execute", () => {
  type RpcTool = {
    execute: (
      toolCallId: string,
      params: { question: string; options: Array<{ label: string }> },
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: {
        mode: "rpc";
        ui: {
          select: (
            title: string,
            options: string[],
            opts?: { signal?: AbortSignal },
          ) => Promise<string | undefined>;
        };
      },
    ) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;
  };

  const params = {
    question: "Which framework?",
    options: [{ label: "React" }, { label: "Vue" }],
  };

  function loadTool(): RpcTool {
    const { pi, tools } = createMockExtensionAPI();
    askUserExtension(pi);
    return tools[0] as RpcTool;
  }

  test("reports a selected option", async () => {
    const tool = loadTool();

    const result = await tool.execute("call-1", params, undefined, undefined, {
      mode: "rpc",
      ui: { select: async () => "Vue" },
    });

    expect(result.details).toEqual({
      question: "Which framework?",
      options: ["React", "Vue"],
      answer: "Vue",
      wasCustom: false,
      cancelled: false,
    });
  });

  test("treats a non-option answer as the user's custom answer", async () => {
    const tool = loadTool();

    const result = await tool.execute("call-1", params, undefined, undefined, {
      mode: "rpc",
      ui: { select: async () => "Svelte, actually" },
    });

    expect(result.details).toEqual({
      question: "Which framework?",
      options: ["React", "Vue"],
      answer: "Svelte, actually",
      wasCustom: true,
      cancelled: false,
    });
  });

  test("reports a dismissed question", async () => {
    const tool = loadTool();

    const result = await tool.execute("call-1", params, undefined, undefined, {
      mode: "rpc",
      ui: { select: async () => undefined },
    });

    expect(result.details).toEqual({
      question: "Which framework?",
      options: ["React", "Vue"],
      answer: null,
      wasCustom: false,
      cancelled: true,
    });
  });

  test("passes the abort signal through to the dialog", async () => {
    const tool = loadTool();
    const controller = new AbortController();
    let received: { signal?: AbortSignal } | undefined;

    await tool.execute("call-1", params, controller.signal, undefined, {
      mode: "rpc",
      ui: {
        select: (_title, _options, opts) => {
          received = opts;
          return Promise.resolve(undefined);
        },
      },
    });

    expect(received?.signal).toBe(controller.signal);
  });
});

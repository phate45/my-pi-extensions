import { afterEach, describe, expect, test } from "bun:test";
import abbreviationsExtension from "../../extensions/my-stuff/abbreviations.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import {
  applyPlainSpaceAbbreviation,
  expandInputAbbreviations,
} from "../../extensions/my-stuff/lib/abbreviation-engine.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("abbreviation engine", () => {
  test("expands exact plain-enter abbreviations only", () => {
    const config = {
      entries: {
        hnd: {
          kind: "plain" as const,
          space: "/from-handoff ",
          enter: "/from-handoff Propose how to continue.",
        },
      },
    };

    expect(expandInputAbbreviations("hnd", config)).toBe("/from-handoff Propose how to continue.");
    expect(expandInputAbbreviations("prefix hnd", config)).toBeUndefined();
  });

  test("composes contiguous bang abbreviations at the end", () => {
    const config = {
      entries: {
        "!test": { kind: "bang" as const, append: "Write a proper test." },
        "!safe": { kind: "bang" as const, append: "Avoid risky changes." },
      },
    };

    expect(expandInputAbbreviations("Refactor this !safe !test", config)).toBe(
      "Refactor this\n\nAvoid risky changes.\n\nWrite a proper test.",
    );
    expect(expandInputAbbreviations("!safe !test", config)).toBe(
      "Avoid risky changes.\n\nWrite a proper test.",
    );
  });

  test("does not partially expand unknown trailing bang tokens", () => {
    const config = {
      entries: {
        "!test": { kind: "bang" as const, append: "Write a proper test." },
      },
    };

    expect(expandInputAbbreviations("Refactor this !test !missing", config)).toBeUndefined();
  });

  test("expands plain-space abbreviations only for exact full-input matches at the cursor end", () => {
    const config = {
      entries: {
        hnd: { kind: "plain" as const, space: "/from-handoff " },
      },
    };

    expect(applyPlainSpaceAbbreviation("hnd", { line: 0, col: 3 }, config)).toBe("/from-handoff ");
    expect(applyPlainSpaceAbbreviation("hnd extra", { line: 0, col: 3 }, config)).toBeUndefined();
    expect(applyPlainSpaceAbbreviation("hnd", { line: 0, col: 2 }, config)).toBeUndefined();
  });
});

describe("abbreviations extension", () => {
  test("registers handlers even when config has no entries", () => {
    const { pi, handlers } = createMockExtensionAPI();

    abbreviationsExtension(pi);

    expect(handlers.get("session_start")?.length).toBe(1);
    expect(handlers.get("input")?.length).toBe(1);
  });

  test("registers session_start and input handlers when entries exist", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        abbreviations: {
          config: {
            entries: {
              hnd: "/from-handoff",
            },
          },
        },
      },
    });

    abbreviationsExtension(pi);

    expect(handlers.get("session_start")?.length).toBe(1);
    expect(handlers.get("input")?.length).toBe(1);
  });

  test("picks up config loaded after extension setup", async () => {
    const { pi, handlers } = createMockExtensionAPI();

    abbreviationsExtension(pi);

    setBundleConfigForTests({
      extensions: {
        abbreviations: {
          config: {
            entries: {
              hnd: {
                space: "/from-handoff ",
                enter: "/from-handoff Propose how to continue.",
              },
            },
          },
        },
      },
    });

    const handler = handlers.get("input")?.[0];
    await expect(handler?.({ text: "hnd" }, {})).resolves.toEqual({
      action: "transform",
      text: "/from-handoff Propose how to continue.",
    });
  });

  test("skips registration when disabled in bundle config", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        abbreviations: { enabled: false },
      },
    });

    abbreviationsExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when the myStuff feature flag is disabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        myStuff: false,
      },
      extensions: {
        abbreviations: {
          enabled: true,
          config: {
            entries: {
              hnd: "/from-handoff",
            },
          },
        },
      },
    });

    abbreviationsExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("skips registration when headless is enabled", () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        headless: true,
      },
      extensions: {
        abbreviations: {
          enabled: true,
          config: {
            entries: {
              hnd: "/from-handoff",
            },
          },
        },
      },
    });

    abbreviationsExtension(pi);

    expect([...handlers.keys()]).toEqual([]);
  });

  test("transforms matching input at send time", async () => {
    const { pi, handlers } = createMockExtensionAPI();
    setBundleConfigForTests({
      extensions: {
        abbreviations: {
          config: {
            entries: {
              hnd: {
                space: "/from-handoff ",
                enter: "/from-handoff Propose how to continue.",
              },
              "!test": "Write a proper test.",
            },
          },
        },
      },
    });

    abbreviationsExtension(pi);
    const handler = handlers.get("input")?.[0];

    await expect(handler({ text: "hnd" }, {})).resolves.toEqual({
      action: "transform",
      text: "/from-handoff Propose how to continue.",
    });

    await expect(handler({ text: "Refactor this !test" }, {})).resolves.toEqual({
      action: "transform",
      text: "Refactor this\n\nWrite a proper test.",
    });

    await expect(handler({ text: "Refactor hnd in place" }, {})).resolves.toEqual({
      action: "continue",
    });
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { getExtensionConfig } from "../../extensions/infra/lib/extension-config.js";
import {
  DEFAULT_ABBREVIATIONS_CONFIG,
  abbreviationsConfig,
  normalizeAbbreviationsConfig,
} from "../../extensions/my-stuff/lib/abbreviations-config.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("abbreviations config", () => {
  test("defaults when config is absent", () => {
    expect(getExtensionConfig("abbreviations", abbreviationsConfig)).toEqual(
      DEFAULT_ABBREVIATIONS_CONFIG,
    );
  });

  test("normalizes raw string entries for plain and bang abbreviations", () => {
    expect(
      normalizeAbbreviationsConfig({
        entries: {
          hnd: "/from-handoff",
          "!test": "Write a proper test.",
        },
      }),
    ).toEqual({
      entries: {
        hnd: {
          kind: "plain",
          space: "/from-handoff",
          enter: "/from-handoff",
        },
        "!test": {
          kind: "bang",
          append: "Write a proper test.",
        },
      },
    });
  });

  test("normalizes structured entries and ignores invalid shapes", () => {
    setBundleConfigForTests({
      extensions: {
        abbreviations: {
          config: {
            entries: {
              hnd: {
                space: "/from-handoff ",
                enter: "/from-handoff Propose how to continue.",
              },
              sum: {
                enter: "Summarize this.",
              },
              "!safe": {
                append: "Avoid risky changes.",
              },
              brokenPlain: {
                append: "nope",
              },
              "!brokenBang": {
                space: "nope",
              },
            },
          },
        },
      },
    });

    expect(getExtensionConfig("abbreviations", abbreviationsConfig)).toEqual({
      entries: {
        hnd: {
          kind: "plain",
          space: "/from-handoff ",
          enter: "/from-handoff Propose how to continue.",
        },
        sum: {
          kind: "plain",
          enter: "Summarize this.",
        },
        "!safe": {
          kind: "bang",
          append: "Avoid risky changes.",
        },
      },
    });
  });
});

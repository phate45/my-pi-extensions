import { afterEach, describe, expect, test } from "bun:test";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import {
  DEFAULT_FRONTMATTER_TIMESTAMPS_CONFIG,
  getFrontmatterTimestampsConfig,
  normalizeFrontmatterTimestampsConfig,
} from "../../extensions/my-stuff/lib/frontmatter-timestamps-config.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("frontmatter-timestamps config", () => {
  test("defaults when config is absent", () => {
    expect(getFrontmatterTimestampsConfig()).toEqual(DEFAULT_FRONTMATTER_TIMESTAMPS_CONFIG);
  });

  test("reads valid config overrides", () => {
    setBundleConfigForTests({
      extensions: {
        "frontmatter-timestamps": {
          config: {
            includePaths: ["~/Documents/second-brain", "./notes"],
            includeExtensions: ["md", ".mdx"],
            includeTimezone: true,
          },
        },
      },
    });

    expect(getFrontmatterTimestampsConfig()).toEqual({
      includePaths: ["~/Documents/second-brain", "./notes"],
      includeExtensions: [".md", ".mdx"],
      includeTimezone: true,
    });
  });

  test("falls back for invalid config values", () => {
    expect(
      normalizeFrontmatterTimestampsConfig({
        includePaths: ["", 42, "  "] as unknown as string[],
        includeExtensions: ["", 42, "  "] as unknown as string[],
      }),
    ).toEqual(DEFAULT_FRONTMATTER_TIMESTAMPS_CONFIG);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { resetBundleConfigForTests, setBundleConfigForTests } from "../../extensions/infra/lib/bundle-config.js";
import {
  DEFAULT_WEB_RESEARCH_CONFIG,
  getWebResearchConfig,
  normalizeWebResearchConfig,
} from "../../extensions/my-stuff/lib/web-research-config.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("web-research config", () => {
  test("defaults when config is absent", () => {
    expect(getWebResearchConfig()).toEqual(DEFAULT_WEB_RESEARCH_CONFIG);
  });

  test("reads valid config overrides", () => {
    setBundleConfigForTests({
      extensions: {
        "web-research": {
          config: {
            defaultDepth: "deep",
            defaultFreshness: "live",
          },
        },
      },
    });

    expect(getWebResearchConfig()).toEqual({
      defaultDepth: "deep",
      defaultFreshness: "live",
    });
  });

  test("falls back for invalid config values", () => {
    expect(
      normalizeWebResearchConfig({
        defaultDepth: "sideways",
        defaultFreshness: "tomorrow",
      }),
    ).toEqual(DEFAULT_WEB_RESEARCH_CONFIG);
  });
});

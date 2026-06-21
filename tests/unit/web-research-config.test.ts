import { afterEach, describe, expect, test } from "bun:test";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { getExtensionConfig } from "../../extensions/infra/lib/extension-config.js";
import {
  DEFAULT_WEB_RESEARCH_CONFIG,
  normalizeWebResearchConfig,
  webResearchConfig,
} from "../../extensions/my-stuff/lib/web-research-config.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("web-research config", () => {
  test("defaults when config is absent", () => {
    expect(getExtensionConfig("web-research", webResearchConfig)).toEqual(
      DEFAULT_WEB_RESEARCH_CONFIG,
    );
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

    expect(getExtensionConfig("web-research", webResearchConfig)).toEqual({
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

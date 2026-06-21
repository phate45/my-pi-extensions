import { afterEach, describe, expect, test } from "bun:test";
import webResearchExtension from "../../extensions/my-stuff/web-research.js";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("web-research extension", () => {
  test("registers its tool when enabled", () => {
    const { pi, tools } = createMockExtensionAPI();

    webResearchExtension(pi);

    expect(tools).toHaveLength(1);
  });

  test("skips tool registration when myStuff feature flag is disabled", () => {
    const { pi, tools } = createMockExtensionAPI();
    setBundleConfigForTests({
      featureFlags: {
        myStuff: false,
      },
      extensions: {
        "web-research": { enabled: true },
      },
    });

    webResearchExtension(pi);

    expect(tools).toHaveLength(0);
  });
});

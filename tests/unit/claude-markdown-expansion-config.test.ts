import { afterEach, describe, expect, test } from "bun:test";
import {
  resetBundleConfigForTests,
  setBundleConfigForTests,
} from "../../extensions/infra/lib/bundle-config.js";
import { getExtensionConfig } from "../../extensions/infra/lib/extension-config.js";
import {
  claudeMarkdownExpansionConfig,
  DEFAULT_CLAUDE_MARKDOWN_EXPANSION_CONFIG,
  normalizeClaudeMarkdownExpansionConfig,
} from "../../extensions/cc-like/lib/claude-markdown-expansion-config.js";

afterEach(() => {
  resetBundleConfigForTests();
});

describe("claude markdown expansion config", () => {
  test("defaults when config is absent", () => {
    expect(getExtensionConfig("cc-markdown-preprocessor", claudeMarkdownExpansionConfig)).toEqual(
      DEFAULT_CLAUDE_MARKDOWN_EXPANSION_CONFIG,
    );
  });

  test("reads valid config overrides", () => {
    setBundleConfigForTests({
      extensions: {
        "cc-markdown-preprocessor": {
          config: {
            disableBash: true,
            disableIncludes: false,
          },
        },
      },
    });

    expect(getExtensionConfig("cc-markdown-preprocessor", claudeMarkdownExpansionConfig)).toEqual({
      disableBash: true,
      disableIncludes: false,
    });
  });

  test("falls back for invalid config values", () => {
    expect(
      normalizeClaudeMarkdownExpansionConfig({
        disableBash: "sure" as unknown as boolean,
        disableIncludes: 42 as unknown as boolean,
      }),
    ).toEqual(DEFAULT_CLAUDE_MARKDOWN_EXPANSION_CONFIG);
  });
});

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CC_CONTEXT_LOCAL_FILES_CONFIG,
  DEFAULT_CC_RESOURCE_PATHS_CONFIG,
  normalizeCcContextLocalFilesConfig,
  normalizeCcResourcePathsConfig,
} from "../../extensions/cc-like/lib/claude-resource-load-config.js";

describe("claude resource load config", () => {
  test("uses defaults for missing context config", () => {
    expect(normalizeCcContextLocalFilesConfig(undefined)).toEqual(
      DEFAULT_CC_CONTEXT_LOCAL_FILES_CONFIG,
    );
  });

  test("normalizes partial context file overrides", () => {
    expect(
      normalizeCcContextLocalFilesConfig({
        claudeFiles: {
          global: false,
          local: false,
        },
      }),
    ).toEqual({
      claudeFiles: {
        global: false,
        project: true,
        local: false,
      },
    });
  });

  test("uses defaults for missing resource path config", () => {
    expect(normalizeCcResourcePathsConfig(undefined)).toEqual(DEFAULT_CC_RESOURCE_PATHS_CONFIG);
  });

  test("normalizes command and skill source overrides", () => {
    expect(
      normalizeCcResourcePathsConfig({
        commands: {
          global: false,
          loadInHeadless: true,
        },
        skills: {
          project: false,
        },
      }),
    ).toEqual({
      commands: {
        global: false,
        project: true,
        loadInHeadless: true,
      },
      skills: {
        global: true,
        project: false,
      },
    });
  });
});

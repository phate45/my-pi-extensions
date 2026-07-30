import { describe, expect, test } from "bun:test";
import ccLikeExtension, { ccLikeExtensions } from "../../extensions/cc-like/index.js";
import { getManagedExtensionDescriptors } from "../../extensions/infra/lib/managed-extension.js";

const EXPECTED_EXTENSION_ORDER = [
  "system-prompt-markdown-preprocessor",
  "cc-context-local-files",
  "cc-markdown-preprocessor",
  "cc-resource-paths",
  "claude-rules",
  "context",
  "custom-header",
  "git-context",
  "interactive-at-read",
  "skill-prompts",
  "skill-tool",
];

describe("cc-like composite entrypoint", () => {
  test("composes child extensions in explicit ascending filename order", () => {
    expect(
      ccLikeExtensions.flatMap((extension) =>
        getManagedExtensionDescriptors(extension).map((descriptor) => descriptor.name),
      ),
    ).toEqual(EXPECTED_EXTENSION_ORDER);
  });

  test("exposes every child descriptor through the package entrypoint", () => {
    expect(
      getManagedExtensionDescriptors(ccLikeExtension).map((descriptor) => descriptor.name),
    ).toEqual(EXPECTED_EXTENSION_ORDER);
  });
});

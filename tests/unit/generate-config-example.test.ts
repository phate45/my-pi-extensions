import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  buildExampleBundleSettings,
  generateExampleConfig,
  loadManagedExtensionDescriptors,
  loadPackageExtensionPaths,
} from "../../scripts/generate-config-example.ts";

const repoRoot = path.resolve(import.meta.dir, "../..");

describe("generate-config example", () => {
  test("discovers managed extension descriptors from package entrypoints", async () => {
    const entryPaths = await loadPackageExtensionPaths(repoRoot);
    const descriptors = await loadManagedExtensionDescriptors(entryPaths);
    const ccLikeEntryPaths = entryPaths.filter((entryPath) =>
      entryPath.includes(`${path.sep}extensions${path.sep}cc-like${path.sep}`),
    );

    expect(ccLikeEntryPaths).toEqual([path.join(repoRoot, "extensions", "cc-like", "index.ts")]);
    expect(descriptors.some((descriptor) => descriptor.name === "web-research")).toBe(true);
    expect(
      descriptors
        .filter((descriptor) => descriptor.featureFlag === "ccLike")
        .map((descriptor) => descriptor.name),
    ).toEqual([
      "cc-context-local-files",
      "cc-markdown-preprocessor",
      "cc-resource-paths",
      "context",
      "custom-header",
      "git-context",
      "interactive-at-read",
      "skill-prompts",
      "skill-tool",
      "system-prompt-markdown-preprocessor",
    ]);
  });

  test("builds the checked-in example config deterministically", async () => {
    const generated = await generateExampleConfig(repoRoot);
    const checkedIn = (await Bun.file(
      path.join(repoRoot, "my-pi-settings.example.json"),
    ).json()) as ReturnType<typeof buildExampleBundleSettings>;

    expect(generated).toEqual(checkedIn);
  });
});

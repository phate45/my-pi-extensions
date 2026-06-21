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

    expect(descriptors.some((descriptor) => descriptor.name === "web-research")).toBe(true);
    expect(descriptors.some((descriptor) => descriptor.name === "cc-markdown-preprocessor")).toBe(
      true,
    );
  });

  test("builds the checked-in example config deterministically", async () => {
    const generated = await generateExampleConfig(repoRoot);
    const checkedIn = (await Bun.file(
      path.join(repoRoot, "my-pi-settings.example.json"),
    ).json()) as ReturnType<typeof buildExampleBundleSettings>;

    expect(generated).toEqual(checkedIn);
  });
});

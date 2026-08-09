import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getCompatibilityDecision,
  promoteCompatibilityDependencies,
  trustedPiArgs,
  updatePiDevelopmentDependencies,
} from "../../scripts/compat.ts";

describe("compatibility target selection", () => {
  test("exits early when the pinned SDK already matches npm latest", () => {
    expect(getCompatibilityDecision("0.84.1", "0.84.1")).toEqual({ kind: "current" });
  });

  test("exits early when the pinned SDK is newer than npm latest", () => {
    expect(getCompatibilityDecision("0.85.0", "0.84.1")).toEqual({ kind: "current" });
  });

  test("selects npm latest when it is newer than the pinned SDK", () => {
    expect(getCompatibilityDecision("0.83.0", "0.84.1")).toEqual({
      kind: "test",
      currentVersion: "0.83.0",
      targetVersion: "0.84.1",
    });
  });
});

describe("compatibility runtime smoke test", () => {
  test("pre-approves project trust for startup commands", () => {
    expect(trustedPiArgs(["--help"])).toEqual(["--approve", "--help"]);
  });
});

describe("compatibility dependency update", () => {
  test("pins Pi packages and Pi's TypeBox version without changing runtime peers", () => {
    const packageJson = {
      devDependencies: {
        "@biomejs/biome": "^2.5.0",
        "@earendil-works/pi-ai": "0.83.0",
        "@earendil-works/pi-coding-agent": "0.83.0",
        "@earendil-works/pi-tui": "0.83.0",
        typebox: "1.3.7",
      },
      peerDependencies: {
        "@earendil-works/pi-coding-agent": "*",
        "@earendil-works/pi-ai": "*",
        "@earendil-works/pi-tui": "*",
        typebox: "*",
      },
    };

    const updated = updatePiDevelopmentDependencies(packageJson, "0.84.1", "1.4.0");

    expect(updated.devDependencies).toEqual({
      "@biomejs/biome": "^2.5.0",
      "@earendil-works/pi-ai": "0.84.1",
      "@earendil-works/pi-coding-agent": "0.84.1",
      "@earendil-works/pi-tui": "0.84.1",
      typebox: "1.4.0",
    });
    expect(updated.peerDependencies).toEqual(packageJson.peerDependencies);
    expect(packageJson.devDependencies["@earendil-works/pi-coding-agent"]).toBe("0.83.0");
  });

  test("rejects a package manifest without the pinned Pi SDK dependency", () => {
    expect(() =>
      updatePiDevelopmentDependencies({ devDependencies: {} }, "0.84.1", "1.3.7"),
    ).toThrow("missing @earendil-works/pi-coding-agent");
  });

  test("promotes only the tested dependency manifest and lockfile", () => {
    const source = mkdtempSync(join(tmpdir(), "compat-source-"));
    const destination = mkdtempSync(join(tmpdir(), "compat-destination-"));
    try {
      writeFileSync(join(source, "package.json"), '{"version":"tested"}\n');
      writeFileSync(join(source, "bun.lock"), "tested lock\n");
      writeFileSync(join(source, "README.md"), "do not promote\n");
      writeFileSync(join(destination, "package.json"), '{"version":"old"}\n');
      writeFileSync(join(destination, "bun.lock"), "old lock\n");
      writeFileSync(join(destination, "README.md"), "keep me\n");

      promoteCompatibilityDependencies(source, destination);

      expect(readFileSync(join(destination, "package.json"), "utf8")).toContain("tested");
      expect(readFileSync(join(destination, "bun.lock"), "utf8")).toBe("tested lock\n");
      expect(readFileSync(join(destination, "README.md"), "utf8")).toBe("keep me\n");
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(destination, { recursive: true, force: true });
    }
  });
});

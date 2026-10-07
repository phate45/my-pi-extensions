import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCompatibilityEnv,
  formatCompatibilityBunfig,
  getCompatibilityDecision,
  getPiReleaseAgeExcludes,
  parseCompatibilityArgs,
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

  test("an explicit target rechecks the current pin and permits older-version checks", () => {
    for (const target of ["1.0.4", "1.0.3"]) {
      expect(getCompatibilityDecision("1.0.4", target, true)).toEqual({
        kind: "test",
        currentVersion: "1.0.4",
        targetVersion: target,
      });
    }
  });

  test("selects npm latest when it is newer than the pinned SDK", () => {
    expect(getCompatibilityDecision("0.83.0", "0.84.1")).toEqual({
      kind: "test",
      currentVersion: "0.83.0",
      targetVersion: "0.84.1",
    });
  });
});

describe("compatibility arguments", () => {
  test("defaults to checking latest without promotion", () => {
    expect(parseCompatibilityArgs([])).toEqual({ apply: false, target: undefined });
  });

  test("accepts an exact target with or without promotion", () => {
    expect(parseCompatibilityArgs(["--target", "1.0.4"])).toEqual({
      apply: false,
      target: "1.0.4",
    });
    expect(parseCompatibilityArgs(["--apply", "--target", "1.0.4"])).toEqual({
      apply: true,
      target: "1.0.4",
    });
    expect(parseCompatibilityArgs(["--target", "1.1.0-rc.1"]).target).toBe("1.1.0-rc.1");
  });

  test("rejects tags, ranges, missing values, and unknown flags", () => {
    for (const target of ["latest", "^1.0.4", "1.0", "1.0.4 || 1.0.5", ""]) {
      expect(() => parseCompatibilityArgs(["--target", target])).toThrow("exact Pi version");
    }
    expect(() => parseCompatibilityArgs(["--target"])).toThrow();
    expect(() => parseCompatibilityArgs(["--typo"])).toThrow();
  });
});

describe("compatibility environment", () => {
  test("isolates home, config, and sessions while preserving command lookup", () => {
    const root = mkdtempSync(join(tmpdir(), "compat-env-"));
    const inherited = {
      HOME: "/ambient/home",
      PI_CODING_AGENT_DIR: "/ambient/agent",
      PI_CODING_AGENT_SESSION_DIR: "/ambient/sessions",
      CLAUDE_PROJECT_DIR: "/ambient/project",
      PATH: "/tools/bin",
    };
    try {
      const env = createCompatibilityEnv(root, inherited);
      expect(env.HOME).toBe(join(root, "home"));
      expect(env.PI_CODING_AGENT_DIR).toBe(join(root, "agent"));
      expect(env.PI_CODING_AGENT_SESSION_DIR).toBe(join(root, "sessions"));
      expect(env.CLAUDE_PROJECT_DIR).toBeUndefined();
      expect(env.PATH).toBe(inherited.PATH);
      expect(env.PI_OFFLINE).toBe("1");
      expect(env.PI_TELEMETRY).toBe("0");
      expect(existsSync(env.HOME!)).toBe(true);
      expect(inherited.HOME).toBe("/ambient/home");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("compatibility runtime smoke test", () => {
  test("pre-approves project trust for startup commands", () => {
    expect(trustedPiArgs(["--help"])).toEqual(["--approve", "--help"]);
  });
});

describe("compatibility supply-chain quarantine", () => {
  test("exempts the recursive @earendil-works dependency closure", () => {
    const dependencies = new Map<string, Record<string, string>>([
      ["@earendil-works/pi-ai", { "@earendil-works/pi-telemetry": "^0.85.1" }],
      ["@earendil-works/pi-client", { "@earendil-works/pi-protocol": "^0.85.1" }],
      ["@earendil-works/chord", { yargs: "^17.7.2" }],
    ]);

    expect(
      getPiReleaseAgeExcludes(
        {
          "@earendil-works/pi-ai": "^0.85.1",
          "@earendil-works/pi-client": "^0.85.1",
          "@earendil-works/chord": "^0.85.1",
          chalk: "^5.6.2",
        },
        (packageName) => dependencies.get(packageName) ?? {},
      ),
    ).toEqual([
      "@earendil-works/chord",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-client",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-protocol",
      "@earendil-works/pi-telemetry",
      "@earendil-works/pi-tui",
    ]);
  });

  test("keeps the five-day quarantine for unrelated dependencies", () => {
    expect(formatCompatibilityBunfig(["@earendil-works/pi-ai", "@earendil-works/pi-tui"])).toBe(
      `# Generated only inside the disposable Pi compatibility snapshot.\n[install]\nminimumReleaseAge = 432000\nminimumReleaseAgeExcludes = [\n  "@earendil-works/pi-ai",\n  "@earendil-works/pi-tui",\n]\n`,
    );
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
      writeFileSync(join(source, "bunfig.toml"), "snapshot quarantine exception\n");
      writeFileSync(join(source, "README.md"), "do not promote\n");
      writeFileSync(join(destination, "package.json"), '{"version":"old"}\n');
      writeFileSync(join(destination, "bun.lock"), "old lock\n");
      writeFileSync(join(destination, "bunfig.toml"), "keep global policy\n");
      writeFileSync(join(destination, "README.md"), "keep me\n");

      promoteCompatibilityDependencies(source, destination);

      expect(readFileSync(join(destination, "package.json"), "utf8")).toContain("tested");
      expect(readFileSync(join(destination, "bun.lock"), "utf8")).toBe("tested lock\n");
      expect(readFileSync(join(destination, "bunfig.toml"), "utf8")).toBe("keep global policy\n");
      expect(readFileSync(join(destination, "README.md"), "utf8")).toBe("keep me\n");
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(destination, { recursive: true, force: true });
    }
  });
});

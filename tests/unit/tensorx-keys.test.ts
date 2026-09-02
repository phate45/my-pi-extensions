import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  loadTensorxKeys,
  normalizeKeys,
  readAuthJsonKey,
} from "../../extensions/my-stuff/lib/tensorx-keys.js";
import { createTempPiEnv, writeJson } from "../helpers/temp-env.js";

async function withAgentDir<T>(run: (agentDir: string) => Promise<T>): Promise<T> {
  const env = await createTempPiEnv();
  try {
    return await run(env.agentDir);
  } finally {
    await env.cleanup();
  }
}

describe("normalizeKeys", () => {
  test("accepts bare strings and labelled objects", () => {
    const { keys } = normalizeKeys({
      keys: ["sk-plain", { key: "sk-labelled", label: "work" }, { key: "sk-off", enabled: false }],
    });

    expect(keys).toEqual([
      { key: "sk-plain", label: "key-1" },
      { key: "sk-labelled", label: "work" },
      { key: "sk-off", label: "key-3", enabled: false },
    ]);
  });

  test("drops a duplicate key so one quota is not counted as two lanes", () => {
    const { keys, warnings } = normalizeKeys({
      keys: [{ key: "sk-same", label: "a" }, { key: "sk-same", label: "b" }],
    });

    expect(keys).toHaveLength(1);
    expect(keys[0]?.label).toBe("a");
    expect(warnings[0]).toContain("duplicate");
  });

  test("reports entries with no usable key instead of silently skipping them", () => {
    const { keys, warnings } = normalizeKeys({ keys: [{ label: "empty" }, "", 42] });

    expect(keys).toHaveLength(0);
    expect(warnings).toHaveLength(3);
  });

  test("rejects a document without a keys array", () => {
    expect(normalizeKeys({ tensorx: "sk-nope" }).warnings[0]).toContain('"keys" array');
  });
});

describe("readAuthJsonKey", () => {
  test("reads the existing tensorx credential", async () => {
    await withAgentDir(async (agentDir) => {
      await writeJson(path.join(agentDir, "auth.json"), {
        tensorx: { type: "api", key: "sk-from-auth" },
      });

      expect(readAuthJsonKey(agentDir)).toBe("sk-from-auth");
    });
  });

  test("returns undefined when there is no tensorx entry", async () => {
    await withAgentDir(async (agentDir) => {
      await writeJson(path.join(agentDir, "auth.json"), { deepinfra: { key: "sk-other" } });

      expect(readAuthJsonKey(agentDir)).toBeUndefined();
    });
  });
});

describe("loadTensorxKeys", () => {
  test("seeds a 0600 keys file from auth.json on first run", async () => {
    await withAgentDir(async (agentDir) => {
      await writeJson(path.join(agentDir, "auth.json"), { tensorx: { key: "sk-from-auth" } });

      const loaded = loadTensorxKeys(agentDir);

      expect(loaded.keys).toEqual([{ key: "sk-from-auth", label: "key-1" }]);
      expect(loaded.warnings).toEqual([]);
      expect(statSync(loaded.path).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(loaded.path, "utf8"))).toEqual({
        keys: [{ key: "sk-from-auth", label: "key-1" }],
      });
    });
  });

  test("seeds an empty pool when auth.json has nothing to import", async () => {
    await withAgentDir(async (agentDir) => {
      const loaded = loadTensorxKeys(agentDir);

      expect(loaded.keys).toEqual([]);
      expect(statSync(loaded.path).mode & 0o777).toBe(0o600);
    });
  });

  test("reads an existing pool without touching auth.json", async () => {
    await withAgentDir(async (agentDir) => {
      await writeJson(path.join(agentDir, "auth.json"), { tensorx: { key: "sk-from-auth" } });
      await writeJson(path.join(agentDir, "tensorx-keys.json"), {
        keys: [{ key: "sk-one", label: "one" }, { key: "sk-two", label: "two" }],
      });

      const loaded = loadTensorxKeys(agentDir);

      expect(loaded.keys.map((entry) => entry.label)).toEqual(["one", "two"]);
      expect(loaded.keys.map((entry) => entry.key)).not.toContain("sk-from-auth");
    });
  });

  test("warns when the keys file is readable by others", async () => {
    await withAgentDir(async (agentDir) => {
      const keysPath = path.join(agentDir, "tensorx-keys.json");
      await writeJson(keysPath, { keys: ["sk-one"] });

      const loaded = loadTensorxKeys(agentDir);

      expect(loaded.warnings.some((warning) => warning.includes("chmod 600"))).toBe(true);
    });
  });

  test("resolves the agent directory from PI_CODING_AGENT_DIR", async () => {
    const previous = process.env.PI_CODING_AGENT_DIR;
    await withAgentDir(async (agentDir) => {
      await writeJson(path.join(agentDir, "tensorx-keys.json"), { keys: ["sk-from-env"] });
      process.env.PI_CODING_AGENT_DIR = agentDir;
      try {
        expect(loadTensorxKeys().keys[0]?.key).toBe("sk-from-env");
      } finally {
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previous;
      }
    });
  });

  test("surfaces a parse failure instead of throwing at startup", async () => {
    await withAgentDir(async (agentDir) => {
      const keysPath = path.join(agentDir, "tensorx-keys.json");
      await Bun.write(keysPath, "{ not json");

      const loaded = loadTensorxKeys(agentDir);

      expect(loaded.keys).toEqual([]);
      expect(loaded.warnings[0]).toContain("could not parse");
    });
  });
});

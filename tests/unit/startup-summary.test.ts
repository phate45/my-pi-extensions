import { describe, expect, test } from "bun:test";
import type { SourceInfo } from "@earendil-works/pi-coding-agent";
import { formatLoadedExtensions } from "../../extensions/cc-like/lib/startup-summary.js";

const cwd = "/workspace/project";

function inlineSourceInfo(): SourceInfo {
  return {
    path: "<inline:llama.cpp>",
    source: "inline",
    scope: "temporary",
    origin: "top-level",
    baseDir: cwd,
  };
}

describe("startup extension summary", () => {
  test("shows hidden extensions with an [H] suffix", () => {
    expect(
      formatLoadedExtensions(
        [
          {
            path: "<inline:llama.cpp>",
            resolvedPath: "<inline:llama.cpp>",
            hidden: true,
            sourceInfo: inlineSourceInfo(),
          },
        ],
        cwd,
      ),
    ).toEqual(["[inline]", "  [.] - <inline:llama.cpp> [H]"]);
  });

  test("leaves visible extension names unmarked", () => {
    expect(
      formatLoadedExtensions(
        [
          {
            path: "<inline:example>",
            resolvedPath: "<inline:example>",
            hidden: false,
            sourceInfo: { ...inlineSourceInfo(), path: "<inline:example>" },
          },
        ],
        cwd,
      ),
    ).toEqual(["[inline]", "  [.] - <inline:example>"]);
  });
});

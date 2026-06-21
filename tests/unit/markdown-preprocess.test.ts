import { describe, expect, test } from "bun:test";
import {
  renderCommandOutput,
  renderCommandStdoutOnSuccess,
} from "../../extensions/cc-like/lib/markdown-preprocess.js";

describe("markdown preprocess command rendering", () => {
  test("inlines stdout for successful commands", () => {
    expect(renderCommandStdoutOnSuccess("printf 'hi'", "hi\n", "", 0)).toBe("hi");
  });

  test("omits successful commands with empty stdout", () => {
    expect(renderCommandStdoutOnSuccess("true", "", "", 0)).toBeNull();
  });

  test("preserves xml output for failing commands", () => {
    expect(renderCommandStdoutOnSuccess("false", "", "boom\n", 1)).toBe(
      renderCommandOutput("false", "", "boom\n", 1),
    );
  });
});

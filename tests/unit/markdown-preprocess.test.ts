import { describe, expect, test } from "bun:test";
import {
  preprocessMarkdown,
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

describe("markdown preprocess Claude bash syntax", () => {
  test("executes backtick-wrapped bang commands without shell command substitution", async () => {
    const commands: string[] = [];
    const expanded = await preprocessMarkdown(
      "before\n!`echo hi`\nafter",
      "/tmp/prompt.md",
      "/tmp",
      {
        exec: async (command) => {
          commands.push(command);
          return { stdout: "hi\n", stderr: "", code: 0 };
        },
        renderCommand: (_command, result) => result.stdout.trimEnd(),
        renderFile: () => null,
      },
    );

    expect(commands).toEqual(["echo hi"]);
    expect(expanded).toBe("before\nhi\nafter");
  });

  test("executes fenced bang command blocks as one multiline script", async () => {
    const commands: string[] = [];
    const raw = ["before", "```!", "printf 'pwd\\n---\\n'", "pwd", "```", "after"].join("\n");

    const expanded = await preprocessMarkdown(raw, "/tmp/prompt.md", "/tmp", {
      exec: async (command) => {
        commands.push(command);
        return { stdout: "pwd\n---\n/tmp\n", stderr: "", code: 0 };
      },
      renderCommand: (_command, result) => result.stdout.trimEnd(),
      renderFile: () => null,
    });

    expect(commands).toEqual(["printf 'pwd\\n---\\n'\npwd"]);
    expect(expanded).toBe("before\npwd\n---\n/tmp\nafter");
  });

  test("preserves disabled backtick and fenced bang commands", async () => {
    const raw = ["!`echo hi`", "```!", "echo fenced", "```"].join("\n");

    const expanded = await preprocessMarkdown(raw, "/tmp/prompt.md", "/tmp", {
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
      renderCommand: (_command, result) => result.stdout,
      renderFile: () => null,
      shouldExpandCommand: () => false,
    });

    expect(expanded).toBe(raw);
  });

  test("leaves ordinary code fences untouched", async () => {
    const raw = ["```bash", "echo not executed", "```"].join("\n");

    const expanded = await preprocessMarkdown(raw, "/tmp/prompt.md", "/tmp", {
      exec: async () => {
        throw new Error("should not execute");
      },
      renderCommand: () => null,
      renderFile: () => null,
    });

    expect(expanded).toBe(raw);
  });
});

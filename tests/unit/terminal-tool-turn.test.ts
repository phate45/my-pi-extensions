import { describe, expect, test } from "bun:test";
import { createTerminalToolTurnTracker } from "../../extensions/infra/lib/terminal-tool-turn.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

describe("terminal tool turn tracker", () => {
  test("matches Pi's all-terminal batch semantics", async () => {
    const { pi, handlers } = createMockExtensionAPI();
    const tracker = createTerminalToolTurnTracker(pi);
    const toolEnd = handlers.get("tool_execution_end")?.[0];

    expect(tracker.concluded()).toBe(false);

    await toolEnd?.({ result: { terminate: true } }, {});
    expect(tracker.concluded()).toBe(true);

    await toolEnd?.({ result: {} }, {});
    expect(tracker.concluded()).toBe(false);
  });

  test("resets at turn start and on demand", async () => {
    const { pi, handlers } = createMockExtensionAPI();
    const tracker = createTerminalToolTurnTracker(pi);
    const toolEnd = handlers.get("tool_execution_end")?.[0];

    await toolEnd?.({ result: { terminate: true } }, {});
    await handlers.get("turn_start")?.[0]?.({}, {});
    expect(tracker.concluded()).toBe(false);

    await toolEnd?.({ result: { terminate: true } }, {});
    tracker.reset();
    expect(tracker.concluded()).toBe(false);
  });
});

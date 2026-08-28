import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerPattyWithoutAgentBg } from "../../extensions/my-stuff/background-tasks.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";

describe("background tasks adapter", () => {
  test("forwards Patty registrations except agent_bg", () => {
    const { pi, tools } = createMockExtensionAPI();
    const registeredApiMethods: string[] = [];

    registerPattyWithoutAgentBg(pi, (adaptedPi) => {
      for (const name of ["bash", "bash_bg", "jobs", "job_decide", "agent_bg", "monitor"]) {
        adaptedPi.registerTool({ name } as ToolDefinition);
      }
      adaptedPi.on("session_start", () => {});
      registeredApiMethods.push("on");
    });

    expect(tools.map((tool) => (tool as ToolDefinition).name)).toEqual([
      "bash",
      "bash_bg",
      "jobs",
      "job_decide",
      "monitor",
    ]);
    expect(registeredApiMethods).toEqual(["on"]);
  });
});

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type EventName = Parameters<ExtensionAPI["on"]>[0];

export type MockExtensionAPI = {
  pi: ExtensionAPI;
  handlers: Map<string, Function[]>;
};

export function createMockExtensionAPI(): MockExtensionAPI {
  const handlers = new Map<string, Function[]>();

  const pi: Partial<ExtensionAPI> = {
    on(event: EventName, handler: Function) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return undefined; },
    registerMessageRenderer() {},
    sendMessage() {},
    sendUserMessage() {},
    appendEntry() {},
    setSessionName() {},
    getSessionName() { return undefined; },
    setLabel() {},
    async exec() { return { stdout: "", stderr: "", code: 0, killed: false }; },
    getActiveTools() { return []; },
    getAllTools() { return []; },
    setActiveTools() {},
    getCommands() { return []; },
    getThemes() { return []; },
    registerProvider() {},
    setThinkingLevel() {},
    getThinkingLevel() { return "medium" as const; },
  };

  return {
    pi: pi as ExtensionAPI,
    handlers,
  };
}

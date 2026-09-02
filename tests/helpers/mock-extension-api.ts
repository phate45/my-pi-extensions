import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type EventName = Parameters<ExtensionAPI["on"]>[0];

export type MockExtensionAPI = {
  pi: ExtensionAPI;
  handlers: Map<string, Function[]>;
  messageRenderers: Map<string, Function>;
  tools: unknown[];
  commands: string[];
  providers: Map<string, Record<string, unknown>>;
  sentMessages: unknown[];
  sentUserMessages: unknown[];
};

export function createMockExtensionAPI(): MockExtensionAPI {
  const handlers = new Map<string, Function[]>();
  const messageRenderers = new Map<string, Function>();
  const tools: unknown[] = [];
  const commands: string[] = [];
  const providers = new Map<string, Record<string, unknown>>();
  const sentMessages: unknown[] = [];
  const sentUserMessages: unknown[] = [];

  const pi: Partial<ExtensionAPI> = {
    on(event: EventName, handler: Function) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(tool) {
      tools.push(tool);
    },
    registerCommand(name) {
      commands.push(name);
    },
    registerShortcut() {},
    registerFlag() {},
    getFlag() {
      return undefined;
    },
    registerMessageRenderer(customType, renderer) {
      messageRenderers.set(customType, renderer);
    },
    sendMessage(message, options) {
      sentMessages.push({ message, options });
    },
    sendUserMessage(content, options) {
      sentUserMessages.push({ content, options });
    },
    appendEntry() {},
    setSessionName() {},
    getSessionName() {
      return undefined;
    },
    setLabel() {},
    async exec() {
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
    getActiveTools() {
      return [];
    },
    getAllTools() {
      return [];
    },
    setActiveTools() {},
    getCommands() {
      return [];
    },
    getThemes() {
      return [];
    },
    registerProvider(nameOrProvider: unknown, config?: unknown) {
      if (typeof nameOrProvider === "string") {
        providers.set(nameOrProvider, (config ?? {}) as Record<string, unknown>);
        return;
      }
      const provider = nameOrProvider as { id?: string; name?: string };
      providers.set(provider.id ?? provider.name ?? "", provider as Record<string, unknown>);
    },
    setThinkingLevel() {},
    getThinkingLevel() {
      return "medium" as const;
    },
  };

  return {
    pi: pi as ExtensionAPI,
    handlers,
    messageRenderers,
    tools,
    commands,
    providers,
    sentMessages,
    sentUserMessages,
  };
}

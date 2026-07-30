import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import { discoverClaudeResourceDirs } from "./lib/claude-resource-discovery.js";
import { type ClaudeRulesConfig, claudeRulesConfig } from "./lib/claude-resource-load-config.js";
import {
  type ClaudeRule,
  discoverClaudeRulesInDirectories,
  extractClaudeRuleTarget,
  ruleMatchesTarget,
} from "./lib/claude-rules.js";
import { resolveProjectRoot } from "./lib/git-project-root.js";

export const CLAUDE_RULES_MESSAGE_TYPE = "claude-rules";
const FILE_TOOLS = new Set(["read", "edit", "write"]);

type PendingRule = {
  rule: ClaudeRule;
  targets: Set<string>;
};

type ClaudeRulesMessageDetails = {
  sources: string[];
  targets: Record<string, string[]>;
};

export default defineManagedExtension({
  name: "claude-rules",
  featureFlag: "ccLike",
  config: claudeRulesConfig,
  setup(pi: ExtensionAPI, getConfig: () => ClaudeRulesConfig) {
    let rules: ClaudeRule[] = [];
    let reportWarning: (message: string) => void = (message) => {
      process.stderr.write(`${message}\n`);
    };
    const injectedRuleIds = new Set<string>();
    const pendingRules = new Map<string, PendingRule>();
    const reportedDiagnostics = new Set<string>();

    pi.registerMessageRenderer<ClaudeRulesMessageDetails>(
      CLAUDE_RULES_MESSAGE_TYPE,
      (message, { expanded }, theme) => {
        const sources = message.details?.sources ?? [];
        const summary = `Loaded rules:\n${sources.map((source) => `↳ ${source}`).join("\n")}`;
        if (!expanded) return new Text(theme.fg("muted", summary), 0, 0);

        const targets = sources
          .map((source) => {
            const matches = message.details?.targets[source] ?? [];
            return `${source} → ${matches.length > 0 ? matches.join(", ") : "unconditional"}`;
          })
          .join("\n");
        const content =
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content, null, 2);
        return new Text(
          `${theme.fg("accent", "Loaded rules:")}\n${theme.fg("dim", targets)}\n\n${content}`,
          0,
          0,
        );
      },
    );

    const reloadRules = async (cwd: string) => {
      const config = getConfig();
      const directories = discoverClaudeResourceDirs(cwd, "rules", {
        includeGlobal: config.global,
        includeProject: config.project,
      });
      const discovery = await discoverClaudeRulesInDirectories(directories);
      for (const diagnostic of discovery.diagnostics) {
        const key = `${diagnostic.sourceLabel}:${diagnostic.reason}`;
        if (reportedDiagnostics.has(key)) continue;
        reportedDiagnostics.add(key);
        reportWarning(`[claude-rules] skipped ${diagnostic.sourceLabel}: ${diagnostic.reason}`);
      }
      rules = discovery.rules;
    };

    const createInjection = (entries: PendingRule[]) => {
      const sorted = [...entries].sort(comparePendingRules);
      const sources = sorted.map((entry) => entry.rule.sourceLabel);
      const targets = Object.fromEntries(
        sorted.map((entry) => [entry.rule.sourceLabel, [...entry.targets].sort()]),
      );
      const content = sorted
        .map((entry) => `## Rule: ${entry.rule.sourceLabel}\n\n${entry.rule.body}`)
        .join("\n\n---\n\n");
      return {
        customType: CLAUDE_RULES_MESSAGE_TYPE,
        content,
        display: true,
        details: { sources, targets } satisfies ClaudeRulesMessageDetails,
      };
    };

    const addPending = (rule: ClaudeRule, target?: string) => {
      const pending = pendingRules.get(rule.id);
      if (pending) {
        if (target) pending.targets.add(target);
        return;
      }
      pendingRules.set(rule.id, {
        rule,
        targets: new Set(target ? [target] : []),
      });
    };

    pi.on("session_start", async (_event, ctx) => {
      reportWarning = ctx.hasUI
        ? (message) => ctx.ui.notify(message, "warning")
        : (message) => process.stderr.write(`${message}\n`);
      injectedRuleIds.clear();
      pendingRules.clear();
      reportedDiagnostics.clear();
      await reloadRules(ctx.cwd);
    });

    pi.on("before_agent_start", async (_event, ctx) => {
      await reloadRules(ctx.cwd);
      for (const rule of rules) {
        if (!rule.paths && !injectedRuleIds.has(rule.id)) addPending(rule);
      }
      const pending = [...pendingRules.values()];
      if (pending.length === 0) return;

      const message = createInjection(pending);
      for (const entry of pending) injectedRuleIds.add(entry.rule.id);
      pendingRules.clear();
      return { message };
    });

    pi.on("tool_call", async (event, ctx) => {
      if (!FILE_TOOLS.has(event.toolName)) return;
      const rawPath = (event.input as { path?: unknown }).path;
      if (typeof rawPath !== "string") return;

      const projectRoot = resolveProjectRoot(ctx.cwd);
      const target = extractClaudeRuleTarget(rawPath, ctx.cwd, projectRoot);
      if (!target) return;

      await reloadRules(ctx.cwd);
      let foundFreshRule = false;
      for (const rule of rules) {
        if (injectedRuleIds.has(rule.id)) continue;
        if (!rule.paths) {
          addPending(rule);
          foundFreshRule = true;
          continue;
        }
        if (!ruleMatchesTarget(rule, target)) continue;
        addPending(rule, target);
        foundFreshRule = true;
      }

      if (!foundFreshRule || event.toolName === "read") return;
      return {
        block: true,
        reason: `[claude-rules] Tool \`${event.toolName}\` paused so matching rules can load. Review them, then retry the mutation.`,
      };
    });

    pi.on("turn_end", () => {
      const pending = [...pendingRules.values()];
      if (pending.length === 0) return;

      pi.sendMessage(createInjection(pending), { deliverAs: "steer" });
      for (const entry of pending) injectedRuleIds.add(entry.rule.id);
      pendingRules.clear();
    });

    pi.on("session_compact", async (_event, ctx) => {
      injectedRuleIds.clear();
      pendingRules.clear();
      await reloadRules(ctx.cwd);
      const unconditional = rules
        .filter((rule) => !rule.paths)
        .map((rule) => ({ rule, targets: new Set<string>() }));
      if (unconditional.length === 0) return;

      pi.sendMessage(createInjection(unconditional));
      for (const entry of unconditional) injectedRuleIds.add(entry.rule.id);
    });
  },
});

function comparePendingRules(left: PendingRule, right: PendingRule): number {
  return (
    right.rule.priority - left.rule.priority ||
    left.rule.sourceLabel.localeCompare(right.rule.sourceLabel)
  );
}

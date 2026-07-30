import { composeManagedExtensions } from "../infra/lib/managed-extension.js";
import systemPromptMarkdownPreprocessor from "./00-system-prompt-markdown-preprocessor.js";
import ccContextLocalFiles from "./10-cc-context-local-files.js";
import ccMarkdownPreprocessor from "./cc-markdown-preprocessor.js";
import ccResourcePaths from "./cc-resource-paths.js";
import claudeRules from "./claude-rules.js";
import context from "./context.js";
import customHeader from "./custom-header.js";
import gitContext from "./git-context.js";
import interactiveAtRead from "./interactive-at-read.js";
import skillPrompts from "./skill-prompts.js";
import skillTool from "./skill-tool.js";

export const ccLikeExtensions = [
  systemPromptMarkdownPreprocessor,
  ccContextLocalFiles,
  ccMarkdownPreprocessor,
  ccResourcePaths,
  claudeRules,
  context,
  customHeader,
  gitContext,
  interactiveAtRead,
  skillPrompts,
  skillTool,
] as const;

export default composeManagedExtensions(ccLikeExtensions);

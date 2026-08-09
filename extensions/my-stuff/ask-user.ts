import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { isFeatureFlagEnabled } from "../infra/lib/bundle-config.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

const optionSchema = Type.Object({
  label: Type.String({ description: "Short display label for this option." }),
  description: Type.Optional(
    Type.String({ description: "Optional one-line description shown below the label." }),
  ),
});

const askUserSchema = Type.Object({
  question: Type.String({ description: "The question to ask the user." }),
  options: Type.Array(optionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description:
      "Two to five answer options. A free-form answer option is appended automatically; never include one.",
  }),
});

type AskUserInput = Static<typeof askUserSchema>;

type AskUserDetails = {
  question: string;
  options: string[];
  answer: string | null;
  wasCustom: boolean;
  cancelled: boolean;
};

type Selection = { answer: string; wasCustom: boolean; index?: number } | null;

type DisplayOption = {
  label: string;
  description?: string;
  isOther?: boolean;
};

function wrapText(text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export default defineManagedExtension({
  name: "ask-user",
  featureFlag: "myStuff",
  setup(pi: ExtensionAPI) {
    if (isFeatureFlagEnabled("headless")) return;

    pi.registerTool({
      name: "ask_user",
      label: "Ask User",
      description:
        "Ask the user one multiple-choice question with 2-5 options. A free-form answer option is added automatically, and the user may dismiss the question.",
      promptSnippet: "Ask one multiple-choice question with a free-form answer option.",
      promptGuidelines: [
        "Use ask_user rather than plain text when a user question has enumerable answers.",
        "Use ask_user for exactly one question; ask follow-up questions in subsequent calls.",
      ],
      parameters: askUserSchema,

      async execute(_toolCallId, params: AskUserInput, signal, _onUpdate, ctx) {
        const reply = (text: string, answer: string | null = null, wasCustom = false) => ({
          content: [{ type: "text" as const, text }],
          details: {
            question: params.question,
            options: params.options.map((option) => option.label),
            answer,
            wasCustom,
            cancelled: answer === null,
          } satisfies AskUserDetails,
        });

        if (ctx.mode !== "tui") {
          return reply("No interactive TUI is available. Ask the user in plain text instead.");
        }
        if (signal?.aborted) return reply("Cancelled.");

        const options: DisplayOption[] = [
          ...params.options,
          { label: "Write my own answer…", isOther: true },
        ];

        const result = await ctx.ui.custom<Selection>((tui, theme, _keybindings, done) => {
          let optionIndex = 0;
          let editMode = false;
          let cachedLines: string[] | undefined;
          let cachedWidth: number | undefined;
          let settled = false;

          const finish = (selection: Selection) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", cancel);
            done(selection);
          };
          const cancel = () => finish(null);

          signal?.addEventListener("abort", cancel, { once: true });
          if (signal?.aborted) queueMicrotask(cancel);

          const editorTheme: EditorTheme = {
            borderColor: (text) => theme.fg("accent", text),
            selectList: {
              selectedPrefix: (text) => theme.fg("accent", text),
              selectedText: (text) => theme.fg("accent", text),
              description: (text) => theme.fg("muted", text),
              scrollInfo: (text) => theme.fg("dim", text),
              noMatch: (text) => theme.fg("warning", text),
            },
          };
          const editor = new Editor(tui, editorTheme);

          const refresh = () => {
            cachedLines = undefined;
            cachedWidth = undefined;
            tui.requestRender();
          };

          editor.onSubmit = (value) => {
            const answer = value.trim();
            if (answer) {
              finish({ answer, wasCustom: true });
              return;
            }
            editMode = false;
            editor.setText("");
            refresh();
          };

          const selectOption = (index: number) => {
            const selected = options[index];
            if (selected.isOther) {
              optionIndex = index;
              editMode = true;
              refresh();
              return;
            }
            finish({ answer: selected.label, wasCustom: false, index: index + 1 });
          };

          return {
            render(width: number) {
              if (cachedLines && cachedWidth === width) return cachedLines;
              const lines: string[] = [];
              const add = (line: string) => lines.push(truncateToWidth(line, width));
              const title = " Question ";

              add(
                theme.fg("accent", `─${title}${"─".repeat(Math.max(0, width - title.length - 1))}`),
              );
              for (const line of wrapText(params.question, Math.max(10, width - 2))) {
                add(` ${theme.fg("text", theme.bold(line))}`);
              }
              lines.push("");

              for (let index = 0; index < options.length; index++) {
                const option = options[index];
                const selected = index === optionIndex;
                const prefix = selected ? theme.fg("accent", " ❯ ") : "   ";
                const marker = option.isOther ? "✎" : `${index + 1}.`;
                const label = `${marker} ${option.label}`;
                add(
                  prefix + theme.fg(selected ? "accent" : option.isOther ? "muted" : "text", label),
                );
                if (option.description) add(`      ${theme.fg("muted", option.description)}`);
              }

              if (editMode) {
                lines.push("");
                add(theme.fg("muted", " Your answer:"));
                for (const line of editor.render(width - 2)) add(` ${line}`);
              }

              lines.push("");
              add(
                theme.fg(
                  "dim",
                  editMode
                    ? " Enter submit • Esc back to options"
                    : ` ↑↓ or 1-${options.length} select • Enter confirm • Esc dismiss`,
                ),
              );
              add(theme.fg("accent", "─".repeat(width)));
              cachedWidth = width;
              cachedLines = lines;
              return lines;
            },
            invalidate() {
              cachedLines = undefined;
              cachedWidth = undefined;
            },
            handleInput(data: string) {
              if (editMode) {
                if (matchesKey(data, Key.escape)) {
                  editMode = false;
                  editor.setText("");
                  refresh();
                  return;
                }
                editor.handleInput(data);
                refresh();
                return;
              }

              if (matchesKey(data, Key.up)) {
                optionIndex = (optionIndex - 1 + options.length) % options.length;
                refresh();
                return;
              }
              if (matchesKey(data, Key.down)) {
                optionIndex = (optionIndex + 1) % options.length;
                refresh();
                return;
              }
              if (data.length === 1 && data >= "1" && data <= String(options.length)) {
                selectOption(Number(data) - 1);
                return;
              }
              if (matchesKey(data, Key.enter)) {
                selectOption(optionIndex);
                return;
              }
              if (matchesKey(data, Key.escape)) finish(null);
            },
            dispose() {
              signal?.removeEventListener("abort", cancel);
            },
          };
        });

        if (!result) {
          return reply("User dismissed the question without answering. Do not assume an answer.");
        }
        if (result.wasCustom) {
          return reply(`User wrote their own answer: ${result.answer}`, result.answer, true);
        }
        return reply(`User selected option ${result.index}: ${result.answer}`, result.answer);
      },

      renderCall(args, theme) {
        let text = theme.fg("toolTitle", theme.bold("ask_user "));
        text += theme.fg("muted", typeof args.question === "string" ? args.question : "");
        const options = Array.isArray(args.options) ? (args.options as DisplayOption[]) : [];
        if (options.length > 0) {
          text += `\n${theme.fg("dim", `  ${options.map((option, index) => `${index + 1}. ${option.label}`).join("  ")}`)}`;
        }
        return new Text(text, 0, 0);
      },

      renderResult(result, _options, theme) {
        const details = result.details as AskUserDetails | undefined;
        if (!details) {
          const first = result.content[0];
          return new Text(first?.type === "text" ? first.text : "", 0, 0);
        }
        if (details.cancelled || details.answer === null) {
          return new Text(theme.fg("warning", "✗ dismissed"), 0, 0);
        }
        if (details.wasCustom) {
          return new Text(
            theme.fg("success", "✓ ") +
              theme.fg("muted", "(wrote) ") +
              theme.fg("accent", details.answer),
            0,
            0,
          );
        }
        const index = details.options.indexOf(details.answer) + 1;
        const answer = index > 0 ? `${index}. ${details.answer}` : details.answer;
        return new Text(theme.fg("success", "✓ ") + theme.fg("accent", answer), 0, 0);
      },
    });
  },
});

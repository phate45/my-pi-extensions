import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { isFeatureFlagEnabled } from "../infra/lib/bundle-config.js";
import { registerInputTransform } from "../infra/lib/input-pipeline.js";
import { defineManagedExtension } from "../infra/lib/managed-extension.js";
import {
  applyPlainSpaceAbbreviation,
  expandInputAbbreviations,
  hasConfiguredAbbreviations,
} from "./lib/abbreviation-engine.js";
import { abbreviationsConfig, type AbbreviationsConfig } from "./lib/abbreviations-config.js";

class AbbreviationEditor extends CustomEditor {
  constructor(
    tui: ConstructorParameters<typeof CustomEditor>[0],
    theme: ConstructorParameters<typeof CustomEditor>[1],
    keybindings: ConstructorParameters<typeof CustomEditor>[2],
    private readonly config: AbbreviationsConfig,
  ) {
    super(tui, theme, keybindings);
  }

  override handleInput(data: string): void {
    if (matchesKey(data, Key.space)) {
      const expanded = applyPlainSpaceAbbreviation(this.getText(), this.getCursor(), this.config);
      if (expanded !== undefined) {
        this.setText(expanded);
        return;
      }
    }

    super.handleInput(data);
  }
}

export default defineManagedExtension({
  name: "abbreviations",
  featureFlag: "myStuff",
  config: abbreviationsConfig,
  setup(pi: ExtensionAPI, getConfig: () => AbbreviationsConfig) {
    if (isFeatureFlagEnabled("headless")) return;

    pi.on("session_start", (_event, ctx) => {
      if (ctx.mode !== "tui") return;

      const config = getConfig();
      if (!hasConfiguredAbbreviations(config)) return;

      if (ctx.ui.getEditorComponent()) return;

      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        return new AbbreviationEditor(tui, theme, keybindings, config);
      });
    });

    registerInputTransform("abbreviations", ({ text }) => {
      const config = getConfig();
      const transformed = expandInputAbbreviations(text, config);
      if (transformed === undefined) return undefined;
      return { text: transformed };
    });
  },
});

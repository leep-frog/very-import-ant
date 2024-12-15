// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { Diagnostic, Workspace } from '@astral-sh/ruff-wasm-nodejs';

const LINT_CONFIG = new Workspace({
  lint: {
    select: [
      'F821',
    ],
  },
});

const LINT_ERROR_REGEX = /^Undefined name `(.+)`$/;

const RUFF_FORMAT_DEPTH_LIMIT = 5;

const ALL_CHARACTERS = "\n`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:\"ZXCVBNM<>?";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

  const vif = new VeryImportantFormatter(context);

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider({
      language: "python",
      scheme: "file",
    }, vif),

    vscode.languages.registerDocumentRangeFormattingEditProvider({
      language: "python",
      scheme: "file",
    }, vif),

    // Handle settings updates
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("very-import-ant")) {
        vif.reload(context);
      }
    }),
  );
}

interface VeryImportantText {
  edits: vscode.TextEdit[][];
  text: string;
  error?: string;
}

interface AutoImport {
  variable: string;
  import: string;
}

interface VeryImportantSettings {
  enabled: boolean;
  autoImports: Map<string, string[]>;
  onTypeRegistration: vscode.Disposable;
}

class VeryImportantFormatter implements vscode.DocumentFormattingEditProvider, vscode.OnTypeFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {

  settings: VeryImportantSettings;

  constructor(context: vscode.ExtensionContext) {
    this.settings = this.reloadSettings(context);
  }

  reload(context: vscode.ExtensionContext) {
    this.settings = this.reloadSettings(context);
  }

  private reloadSettings(context: vscode.ExtensionContext): VeryImportantSettings {
    const config = vscode.workspace.getConfiguration("very-import-ant");

    const autoImports: AutoImport[] = config.get<AutoImport[]>("autoImports", []);

    const autoImportMap: Map<string, string[]> = new Map<string, string[]>();
    for (const autoImport of autoImports) {
      if (autoImportMap.has(autoImport.variable)) {
        autoImportMap.get(autoImport.variable)!.push(autoImport.import);
      } else {
        autoImportMap.set(autoImport.variable, [autoImport.import]);
      }
    }

    const otc = config.get<string>("onTypeTriggerCharacters", "");

    if (this.settings?.onTypeRegistration) {
      this.settings.onTypeRegistration.dispose();
    }

    const reg = vscode.languages.registerOnTypeFormattingEditProvider({
      language: "python",
      scheme: "file",
    }, this, otc.at(0) || "\n", ...otc.slice(1));

    context.subscriptions.push(reg);

    return {
      // Note that the secondary values are soft defaults and only fallbacks to avoid
      // undefined values. Actual defaults are set in package.json.
      enabled: config.get<boolean>("format.enable", false),
      autoImports: autoImportMap,
      onTypeRegistration: reg,
    };
  }

  provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    console.log(`Formatting doc`);
    return this.formatDocument(document);
  }

  provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    console.log(`Formatting range`);
    // TODO: have ruff only inspect the range
    return this.formatDocument(document);
  }

  provideDocumentRangesFormattingEdits(document: vscode.TextDocument, ranges: vscode.Range[], options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    console.log(`Formatting ranges`);
    // TODO: have ruff only inspect the range
    return this.formatDocument(document);
  }

  provideOnTypeFormattingEdits(document: vscode.TextDocument, position: vscode.Position, ch: string, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    console.log(`Formatting on type`);
    return this.formatDocument(document);
  }

  formatDocument(document: vscode.TextDocument): vscode.ProviderResult<vscode.TextEdit[]> {

    if (!this.settings.enabled) {
      vscode.window.showErrorMessage("The Very Import-ant formatter is not enabled! Set `very-import-ant.format.enable` to true in your VS Code settings");
      return;
    }

    const text = document.getText();

    // Find all undefined variables
    const diagnostics: Diagnostic[] = LINT_CONFIG.check(text);

    console.log(`ruff diagnosticts: ${JSON.stringify(diagnostics)}`);

    // Map all undefined variables to their imports (if included in settings)
    const importsToAdd = [...new Set(diagnostics.flatMap((diagnostic) => {
      const match = LINT_ERROR_REGEX.exec(diagnostic.message);

      const variableName = match?.at(1);
      if (!variableName) {
        vscode.window.showErrorMessage(`Undefined variable could not be determined from error message (${diagnostic.message})`);
        return [];
      }

      return this.settings.autoImports.get(variableName) || [];
    }))];

    if (!importsToAdd.length) {
      return;
    }

    // Generate the new text
    const vit: VeryImportantText = {
      edits: [],
      text: text,
    };
    this.addImports(vit, importsToAdd);

    // Return an error if there was an issue
    if (vit.error) {
      vscode.window.showErrorMessage(vit.error);
      return;
    }

    // Simply return single set of edits if only run once
    if (vit.edits.length <= 1) {
      return vit.edits.at(0);
    }

    // Otherwise, replace the entire document, as vscode expects all TextEdit
    // objects to reference the original document's positions (not incremental).
    return [{
      range: new vscode.Range(0, 0, document.lineCount, 0),
      newText: vit.text,
    }];
  }

  private addImports(vit: VeryImportantText, importsToAdd: string[]): undefined {

    // Unfortunately, ruff iterates on fixes for other clients (e.g. CLI)
    // but doesn't plan to support it for the npm package: https://github.com/astral-sh/ruff/issues/14928
    // Fortunately, it's not too, too difficult to iterate ourselves,
    // but we should look to thoroughly test this logic.
    if (vit.edits.length > RUFF_FORMAT_DEPTH_LIMIT) {
      vit.error = `Formatting error (depth-limit). Please open a GitHub issue and include the contents of your file.`;
      return;
    }

    let isortConfig;
    try {
      isortConfig = new Workspace({
        lint: {
          select: [
            'I001',
            'I002',
          ],
          isort: {
            'required-imports': importsToAdd,
            'lines-after-imports': 2,
            'combine-as-imports': true,
          },
        },
      });
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to create import config: ${e}`);
      return;
    }

    const diags: Diagnostic[] = isortConfig.check(vit.text);

    const edits = diags.flatMap(diag => diag.fix?.edits || []).map((edit): vscode.TextEdit => {
      return {
        range: new vscode.Range(edit.location.row - 1, edit.location.column - 1, edit.end_location.row - 1, edit.end_location.column - 1),
        newText: edit.content || "",
      };
    });

    if (!edits.length) {
      return;
    }

    console.log(`Adding edits: ${JSON.stringify(edits)}`);

    vit.text = this.applyEdits(vit.text, edits);
    vit.edits.push(edits);
    this.addImports(vit, importsToAdd);
  }

  private applyEdits(text: string, edits: vscode.TextEdit[]): string {
    return edits.reduce(
      (accumulatedText, edit) => this.applyEdit(accumulatedText, edit),
      text,
    );
  }

  private applyEdit(text: string, edit: vscode.TextEdit): string {
    const lines = text.split("\n");

    const preamble = lines.slice(0, edit.range.start.line);
    preamble.push(lines[edit.range.start.line].slice(0, edit.range.start.character));

    const editLines: string[] = [];

    // Add preamble lines
    if (edit.range.start.line > 0) {
      editLines.push(
        lines.slice(0, edit.range.start.line).join("\n"),
        "\n",
      );
    }

    editLines.push(
      // Add preamble characters
      lines[edit.range.start.line + 1].slice(0, edit.range.start.character),

      // Add new text
      edit.newText,

      // Add postamble characters
      lines[edit.range.end.line].slice(edit.range.end.character),
    );

    // Add postamble lines
    if (edit.range.end.line + 1 < lines.length) {
      editLines.push(
        "\n",
        lines.slice(edit.range.end.line + 1).join("\n"),
      );
    }

    return editLines.join("");
  }
}

// This method is called when your extension is deactivated
export function deactivate() { }

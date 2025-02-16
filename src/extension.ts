import * as vscode from 'vscode';

import { Diagnostic, Workspace } from '@astral-sh/ruff-wasm-nodejs';
import { merge } from './range-merge';

enum RuffCode {
  UNUSED_IMPORT = 'F401',
  UNDEFINED_NAME = 'F821',
  UNSORTED_IMPORTS = 'I001',
  MISSING_REQUIRED_IMPORT = 'I002',
};

const LINT_ERROR_REGEX = /^Undefined name `(.+)`$/;

const RUFF_FORMAT_DEPTH_LIMIT = 5;

function documentSelector(): vscode.DocumentSelector {
  return {
    language: "python",
    // No scheme because we want to format regular python files as well as notebooks
  };
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

  const vif = new VeryImportantFormatter(context);

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(documentSelector(), vif),

    vscode.languages.registerDocumentRangeFormattingEditProvider(documentSelector(), vif),

    // Handle settings updates
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("very-import-ant")) {
        vif.reload(context);
      }
    }),
  );
}

interface AutoImport {
  variable: string;
  import: string;
}

interface VeryImportantSettings {
  enabled: boolean;
  autoImports: Map<string, string[]>;
  onTypeRegistration: vscode.Disposable;
  alwaysImport: string[];
  removeUnusedImports: boolean;
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

    const reg = vscode.languages.registerOnTypeFormattingEditProvider(documentSelector(), this, otc.at(0) || "\n", ...otc.slice(1));

    context.subscriptions.push(reg);

    return {
      // Note that the secondary values are soft defaults and only fallbacks to avoid
      // undefined values. Actual defaults are set in package.json.
      enabled: config.get<boolean>("format.enable", false),
      autoImports: autoImportMap,
      onTypeRegistration: reg,
      alwaysImport: config.get<string[]>("alwaysImport", []),
      removeUnusedImports: config.get<boolean>("removeUnusedImports", false),
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
    const lint_config = new Workspace({
      lint: {
        select: [
          RuffCode.UNDEFINED_NAME,
          ...(this.settings.removeUnusedImports ? [RuffCode.UNUSED_IMPORT] : []),
        ],
      },
    });
    const diagnostics: Diagnostic[] = lint_config.check(text);

    console.log(`ruff diagnosticts: ${JSON.stringify(diagnostics)}`);

    // Map all undefined variables to their imports (if included in settings)
    const importsToAdd = [...new Set([
      ...this.settings.alwaysImport,
      ...new Set(diagnostics.filter(diagnostic => diagnostic.code === RuffCode.UNDEFINED_NAME).flatMap((diagnostic) => {

        const match = LINT_ERROR_REGEX.exec(diagnostic.message);

        const variableName = match?.at(1);
        if (!variableName) {
          // Ignore syntax errors
          if (diagnostic.message.startsWith("SyntaxError")) {
            return [];
          }

          vscode.window.showErrorMessage(`Undefined variable could not be determined from error message (${JSON.stringify(diagnostic)})`);
          return [];
        }

        return this.settings.autoImports.get(variableName) || [];
      })),
    ])];

    const hasUnusedImports = diagnostics.filter(diagnostic => diagnostic.code === RuffCode.UNUSED_IMPORT);
    if (!hasUnusedImports && !importsToAdd.length) {
      return;
    }

    // Generate the new text
    const allEdits: vscode.TextEdit[][] = [];
    const [edittedText, successs] = this.addImports(text, importsToAdd, allEdits);
    if (!successs) {
      return [];
    }

    // Simply return single set of edits if only run once
    if (allEdits.length <= 0) {
      return allEdits.at(0);
    }

    // Otherwise, replace the entire document, as vscode expects all TextEdit
    // objects to reference the original document's positions (not incremental).
    return [{
      range: new vscode.Range(0, 0, document.lineCount, 0),
      newText: edittedText,
    }];
  }

  private addImports(text: string, importsToAdd: string[], editList: vscode.TextEdit[][]): [string, boolean] {

    // Unfortunately, ruff iterates on fixes for other clients (e.g. CLI)
    // but doesn't plan to support it for the npm package: https://github.com/astral-sh/ruff/issues/14928
    // Fortunately, it's not too, too difficult to iterate ourselves,
    // but we should look to thoroughly test this logic.
    if (editList.length > RUFF_FORMAT_DEPTH_LIMIT) {
      vscode.window.showInformationMessage(`Formatting error (depth-limit). Please open a GitHub issue and include the contents of your file.`);
      return ["", false];
    }

    let isortConfig;
    try {
      isortConfig = new Workspace({
        lint: {
          select: [
            RuffCode.UNSORTED_IMPORTS,
            RuffCode.MISSING_REQUIRED_IMPORT,
            ...(this.settings.removeUnusedImports ? [RuffCode.UNUSED_IMPORT] : []),
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
      return ["", false];
    }

    const diags: Diagnostic[] = isortConfig.check(text);

    const edits = merge(diags.flatMap(diag => diag.fix?.edits || []).map((edit): vscode.TextEdit => {
      return {
        range: new vscode.Range(edit.location.row - 1, edit.location.column - 1, edit.end_location.row - 1, edit.end_location.column - 1),
        newText: edit.content || "",
      };
    }));

    if (!edits.length) {
      return [text, true];
    }

    console.log(`Adding edits: ${JSON.stringify(edits)}`);
    editList.push(edits);
    return this.addImports(this.applyEdits(text, edits), importsToAdd, editList);
  }

  private applyEdits(text: string, edits: vscode.TextEdit[]): string {
    // Edits are sorted from beginning to end of document, so apply in
    // reverse order to ensure that (line, character) pointers always
    // point to the proper positions.
    return edits.reverse().reduce(
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

import * as vscode from 'vscode';

import { Diagnostic, Workspace } from '@astral-sh/ruff-wasm-nodejs';
import path from 'path';
import { merge } from './range-merge';

enum RuffCode {
  UNUSED_IMPORT = 'F401',
  UNDEFINED_NAME = 'F821',
  UNSORTED_IMPORTS = 'I001',
  MISSING_REQUIRED_IMPORT = 'I002',
};

const NOTEBOOK_SCHEME = "vscode-notebook-cell";

const ALL_SUPPORTED_SCHEMES = [
  "file",
  NOTEBOOK_SCHEME,
  "untitled",
];

const LINT_ERROR_REGEX = /^Undefined name `(.+)`$/;

const RUFF_FORMAT_DEPTH_LIMIT = 5;

function documentSelector(scheme: string): vscode.DocumentSelector {
  return {
    language: "python",
    scheme: scheme,
  };
}

class TruncatedOutputChannel {

  private outputChannel: vscode.OutputChannel;
  private logs: string[];
  enabled: boolean;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.logs = [];
    this.enabled = true;
  }

  log(message: string, reset?: boolean, force?: boolean) {
    if (!this.enabled && !force) {
      return;
    }

    if (reset) {
      this.outputChannel.clear();
      this.logs = [];
    }

    this.logs.push(message);
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(900);
      this.outputChannel.replace(this.logs.join("\n"));
    } else {
      this.outputChannel.appendLine(message);
    }
  }
}

interface AddAutoImportItem extends vscode.QuickPickItem { }

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

  const vif = new VeryImportantFormatter(context);

  context.subscriptions.push(
    // Handle settings updates
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("very-import-ant")) {
        vif.reload(context);
      }
    }),

    vscode.commands.registerCommand("very-import-ant.addAutoImport", async () => vif.addAutoImport()),
  );
}

interface AutoImport {
  variable: string;
  import: string;
}

interface VeryImportantSettings {
  enabled: boolean;
  autoImports: Map<string, string[]>;
  alwaysImport: string[];
  removeUnusedImports: boolean;
  organizeImports: boolean;
  reloadableRegistrations: vscode.Disposable[];
}

class VeryImportantFormatter implements vscode.DocumentFormattingEditProvider, vscode.OnTypeFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {

  settings: VeryImportantSettings;
  outputChannel: TruncatedOutputChannel;

  constructor(context: vscode.ExtensionContext) {
    this.outputChannel = new TruncatedOutputChannel(vscode.window.createOutputChannel("very-import-ant"));
    this.settings = this.reloadSettings(context);
  }

  reload(context: vscode.ExtensionContext) {
    this.settings = this.reloadSettings(context);
  }

  settingsJSON(verboseSettings: any): string {
    const replacer = (key: string, value: any): any => {
      // Ignore keys
      if (["reloadableRegistrations"].includes(key)) {
        return;
      }

      // Convert map to record so it's actually serialized properly
      if (value instanceof Map) {
        let record: Record<string, any> = {};
        for (let [mapKey, mapValue] of value) {
          record[mapKey] = mapValue;
        }
        return record;
      }

      // Otherwise, return regular value
      return value;
    };

    return JSON.stringify(verboseSettings, replacer, 2);
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

    // this.settings can be undefined (when this is called on initialization)
    // hence why we need the (`?` and `|| []`), otherwise the extensions fails
    // without making much noise.
    for (const registration of (this.settings?.reloadableRegistrations || [])) {
      registration.dispose();
    }

    const ignoreSchemes = new Set<string>(config.get<string[]>("ignoreSchemes", []));
    const activeSchemes = ALL_SUPPORTED_SCHEMES.filter(scheme => !ignoreSchemes.has(scheme));

    const enabled = config.get<boolean>("format.enable", false);

    const newRegistrations = [];
    if (enabled) {
      for (const scheme of activeSchemes) {
        newRegistrations.push(
          vscode.languages.registerOnTypeFormattingEditProvider(documentSelector(scheme), this, otc.at(0) || "\n", ...otc.slice(1)),
          vscode.languages.registerDocumentFormattingEditProvider(documentSelector(scheme), this),
          vscode.languages.registerDocumentRangeFormattingEditProvider(documentSelector(scheme), this),
        );
      }
    }

    context.subscriptions.push(...newRegistrations);

    // Note that the order of the fields is how they will be displayed in the output channel.
    const verboseSettings = {
      // Note that the secondary values are soft defaults and only fallbacks to avoid
      // undefined values. Actual defaults are set in package.json.
      enabled: enabled,
      // This is only added here for JSON output in output channel; it is not
      // included in the settings object returned
      outputEnabled: config.get<boolean>("output.enable", false),
      removeUnusedImports: config.get<boolean>("removeUnusedImports", false),
      organizeImports: config.get<boolean>("organizeImports", false),
      alwaysImport: config.get<string[]>("alwaysImport", []),
      autoImports: autoImportMap,
      reloadableRegistrations: newRegistrations,
    };

    this.outputChannel.enabled = verboseSettings.outputEnabled;
    this.outputChannel.log(`Very-Import-Any Settings:\n${this.settingsJSON(verboseSettings)}`, true, true);

    return verboseSettings;
  }

  provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    this.outputChannel.log('Formatting doc', true);
    return this.formatDocument(document, true);
  }

  provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    this.outputChannel.log(`Formatting range`, true);
    // TODO: have ruff only inspect the range
    return this.formatDocument(document, false);
  }

  provideDocumentRangesFormattingEdits(document: vscode.TextDocument, ranges: vscode.Range[], options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    this.outputChannel.log(`Formatting ranges`, true);
    // TODO: have ruff only inspect the range
    return this.formatDocument(document, false);
  }

  provideOnTypeFormattingEdits(document: vscode.TextDocument, position: vscode.Position, ch: string, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
    this.outputChannel.log(`Formatting on type (ch:${ch})`, true);
    return this.formatDocument(document, false);
  }

  formatDocument(document: vscode.TextDocument, fullFormat: boolean): vscode.ProviderResult<vscode.TextEdit[]> {
    try {
      if (!this.settings.enabled) {
        vscode.window.showErrorMessage("The Very Import-ant formatter is not enabled! Set `very-import-ant.format.enable` to true in your VS Code settings");
        return;
      }

      const text = document.getText();
      const [magicConversions, magiclessText] = this.popMagicCommands(text);

      const [importsToAdd, ok] = this.determineImports(document, magiclessText);
      if (!ok) {
        return;
      }

      return this.fixDocument(document, magiclessText, importsToAdd, fullFormat, magicConversions);
    } catch (e) {
      vscode.window.showErrorMessage(`Unexpected formatting error: ${e}`);
    }
  }

  private popMagicCommands(text: string): [Map<string, string>, string] {
    const magicConversions = new Map<string, string>();

    const magiclessLines = [];
    for (const line of text.split("\n")) {
      if (line.startsWith("%")) {
        const magiclessLine = line.replace(/^%/, "#");
        magiclessLines.push(magiclessLine);
        magicConversions.set(magiclessLine, line);
      } else {
        magiclessLines.push(line);
      }
    }
    return [magicConversions, magiclessLines.join("\n")];
  }

  private pushMagicCommands(magiclessText: string, magicConversions: Map<string, string>): string {
    const lines = [];
    for (const line of magiclessText.split("\n")) {
      lines.push(magicConversions.get(line) ?? line);
    }
    return lines.join("\n");
  }

  private fixDocument(document: vscode.TextDocument, text: string, importsToAdd: string[], fullFormat: boolean, magicConversions: Map<string, string>): vscode.ProviderResult<vscode.TextEdit[]> {
    // Generate the new text
    const allEdits: vscode.TextEdit[][] = [];

    // Unfortunately, ruff iterates on fixes for other clients (e.g. CLI)
    // but doesn't plan to support it for the npm package: https://github.com/astral-sh/ruff/issues/14928
    // Fortunately, it's not too, too difficult to iterate ourselves,
    // but we should look to thoroughly test this logic.

    const ruffConfigs: RuffConfig[] = [
      this.addImportsConfig(document, importsToAdd, fullFormat),
      ...this.removeUnusedImportsConfigs(document, fullFormat),
    ];

    // We use prevText here (instead of counting edits for example)
    // because there are cases where an auto-import causes an unrelated
    // import to be added ({variable: "pd", import: "from some import thing"}).
    // If we counted edits, this would recur, but if check the text, then it does not.
    let prevText = text + "a";
    for (let i = 0; prevText !== text; i++) {
      prevText = text;

      for (const ruffConfig of ruffConfigs) {
        this.outputChannel.log(`Running ruff with config: ${JSON.stringify(ruffConfig)}`);
        const [editedText, success] = this.applyRuffConfig(text, allEdits, ruffConfig);
        if (!success) {
          return;
        }
        text = editedText;
      }

      // Stop if recursion is appearing to get into a cycle.
      if (i > RUFF_FORMAT_DEPTH_LIMIT) {
        vscode.window.showErrorMessage(`Formatting error (depth-limit). Please open a GitHub issue and include the contents of your file.`);
        return;
      }
    }

    // Simply return single set of edits if only run once
    if (allEdits.length <= 0 && magicConversions.size === 0) {
      return allEdits.at(0);
    }

    // Otherwise, replace the entire document, as vscode expects all TextEdit
    // objects to reference the original document's positions (not incremental).
    return [{
      range: new vscode.Range(0, 0, document.lineCount, 0),
      newText: this.pushMagicCommands(text, magicConversions),
    }];
  }

  private getCombinedNotebookCellText(document: vscode.TextDocument, stopAtCurrent: boolean): string | undefined {
    // Get the NotebookDocument from the active text document
    const notebook = vscode.workspace.notebookDocuments.find(nb =>
      nb.getCells().some(cell => cell.document.uri.toString() === document.uri.toString())
    );
    if (!notebook) {
      vscode.window.showErrorMessage(`Failed to get NotebookDocument reference from TextDocument!`);
      return;
    }

    // Only get the cells up to and including the relevant cell (so if we use a variable in a cell before
    // it's imported, we still force that to be added).
    const upToCells: string[] = [];

    for (const cell of notebook.getCells().filter(cell => cell.kind === vscode.NotebookCellKind.Code)) {
      const [_, magiclessText] = this.popMagicCommands(cell.document.getText());
      upToCells.push(magiclessText);
      if (stopAtCurrent && cell.document.uri.toString() === document.uri.toString()) {
        break;
      }
    }

    return upToCells.join("\n");
  }

  private determineImports(document: vscode.TextDocument, text: string): [string[], boolean] {
    // Find all undefined variables
    let [undefinedImports, ok] = this.getUndefinedVariableAutoImports(text);
    this.outputChannel.log(`Found undefined variables: ${JSON.stringify([...undefinedImports], undefined, 2)}`);
    if (!ok) {
      return [[], false];
    }

    if (document.uri.scheme === NOTEBOOK_SCHEME) {
      const notebookCellText = this.getCombinedNotebookCellText(document, true);
      if (!notebookCellText) {
        return [[], false];
      }

      // Run ruff on the merged text from all code cells
      const [undefinedFileImports, ok] = this.getUndefinedVariableAutoImports(notebookCellText);
      this.outputChannel.log(`Found undefined file imports: ${JSON.stringify([...undefinedFileImports], undefined, 2)}`);
      if (!ok) {
        return [[], false];
      }

      // Take the intersection of the two sets so that we only consider imports
      // that are needed when both the single cell and the entire document have
      // the undefined name reference.
      undefinedImports = new Set<string>([...undefinedImports].filter(imp => undefinedFileImports.has(imp)));
      this.outputChannel.log(`Combined undefined imports: ${JSON.stringify([...undefinedFileImports], undefined, 2)}`);
    }

    return [[...new Set([
      ...this.getAlwaysImports(document),
      ...undefinedImports,
    ])], true];
  }

  private findUndefinedVariables(text: string): [Set<string>, boolean] {
    const [diagnostics, ok] = this.runRuffConfig(text, {
      lint: {
        select: [
          RuffCode.UNDEFINED_NAME,
        ],
      },
    });
    if (!ok) {
      return [new Set(), false];
    }

    return [new Set(diagnostics.filter(diagnostic => diagnostic.code === RuffCode.UNDEFINED_NAME).flatMap((diagnostic) => {

      const match = LINT_ERROR_REGEX.exec(diagnostic.message);

      const variableName = match?.at(1);
      if (!variableName) {
        vscode.window.showErrorMessage(`Undefined variable could not be determined from error message (${JSON.stringify(diagnostic)})`);
        return [];
      }

      return variableName;
    })), true];
  }

  private getUndefinedVariableAutoImports(text: string): [Set<string>, boolean] {
    // Find all undefined variables
    const [undefinedVariables, ok] = this.findUndefinedVariables(text);
    if (!ok) {
      return [new Set(), false];
    }

    // Map all undefined variables to their imports (if included in settings)
    const undefinedImports = [...undefinedVariables].flatMap((variable) => this.settings.autoImports.get(variable) || []);
    return [new Set(undefinedImports), true];
  }

  private getAlwaysImports(document: vscode.TextDocument): string[] {
    // We don't want to always import in notebook mode, but if we do
    // just add a separate setting per scheme (notebook vs python).
    // There is an open VS Code issue to have this natively: https://github.com/microsoft/vscode/issues/195011
    // so perhaps we can just leave as is until that is implemented.
    if (document.uri.scheme === NOTEBOOK_SCHEME || this.isInitFile(document)) {
      return [];
    }
    return this.settings.alwaysImport;
  }

  private isInitFile(document: vscode.TextDocument): boolean {
    return path.basename(document.fileName) === "__init__.py";
  }

  private removeUnusedImportsConfigs(document: vscode.TextDocument, fullFormat: boolean): RuffConfig[] {
    // Same reasoning as getAlwaysImport above for some of these conditions.
    if (!fullFormat || document.uri.scheme === NOTEBOOK_SCHEME || !this.settings.removeUnusedImports || this.isInitFile(document)) {
      return [];
    }
    return [{
      lint: {
        select: [
          RuffCode.UNUSED_IMPORT,
          RuffCode.MISSING_REQUIRED_IMPORT,
        ],
        isort: {
          "required-imports": this.getAlwaysImports(document)
        },
      }
    }];
  }

  private addImportsConfig(document: vscode.TextDocument, importsToAdd: string[], fullFormat: boolean): RuffConfig {
    return {
      lint: {
        select: [
          ...((fullFormat && this.settings.organizeImports && !this.isInitFile(document)) ? [RuffCode.UNSORTED_IMPORTS] : []),
          RuffCode.MISSING_REQUIRED_IMPORT,
        ],
        isort: {
          'required-imports': importsToAdd,
          'lines-after-imports': fullFormat ? 2 : undefined,
          'combine-as-imports': true,
          "split-on-trailing-comma": false,
        },
      },
      "line-length": 80,
      format: {
        "skip-magic-trailing-comma": true,
      },
    };
  }

  private applyRuffConfig(text: string, editList: vscode.TextEdit[][], ruffConfig: RuffConfig): [string, boolean] {
    const [diags, ok] = this.runRuffConfig(text, ruffConfig);

    if (!ok) {
      return ["", false];
    }

    this.outputChannel.log(`Pre merged edits:`);
    for (const diag of diags) {
      this.outputChannel.log(JSON.stringify(diag.fix));
    }

    return [this.applyDiagnosticEdits(text, diags, editList), true];
  }

  private applyDiagnosticEdits(text: string, diagnostics: Diagnostic[], editList: vscode.TextEdit[][]): string {
    const edits = merge(diagnostics.flatMap(diag => diag.fix?.edits || []).map((edit): vscode.TextEdit => {
      return {
        range: new vscode.Range(edit.location.row - 1, edit.location.column - 1, edit.end_location.row - 1, edit.end_location.column - 1),
        newText: edit.content || "",
      };
    }));

    if (edits.length === 0) {
      return text;
    }

    this.outputChannel.log(`Adding edits: ${JSON.stringify(edits)}`);
    editList.push(edits);
    return this.applyEdits(text, edits);
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
      lines[edit.range.start.line].slice(0, edit.range.start.character),

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

  private runRuffConfig(text: string, ruffConfig: RuffConfig): [Diagnostic[], boolean] {
    let isortConfig;
    try {
      isortConfig = new Workspace(ruffConfig);
      return [isortConfig.check(text), true];
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to create ruff config: ${e}`);
      return [[], false];
    }
  }

  async addAutoImportForVariable(variable: string | undefined) {

    // Get the variable (if unset)
    if (!variable) {
      variable = await vscode.window.showInputBox({
        title: "Variable",
        validateInput: (input) => {
          if (input.length === 0) {
            return {
              message: "Variable cannot be empty",
              severity: vscode.InputBoxValidationSeverity.Error,
            };
          }

          const importPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
          if (!importPattern.test(input)) {
            return {
              message: "Variable must be a valid Python identifier",
              severity: vscode.InputBoxValidationSeverity.Error,
            };
          }
        },
      });
      if (!variable) {
        return;
      }
    }

    // Get the import statement
    const importStatement = await vscode.window.showInputBox({
      title: "Import statement",
      prompt: `Enter the import statement for ${variable}`,
      value: `from  import ${variable}`,
      valueSelection: [5, 5],
    });
    if (!importStatement) {
      return;
    }

    // Update the config
    const config = vscode.workspace.getConfiguration(`very-import-ant`);
    const existingImports = config.get<AutoImport[]>("autoImports", []);

    let updated = false;
    for (const existingImport of existingImports) {
      if (existingImport.variable === variable) {
        existingImport.import = importStatement;
        updated = true;
        break;
      }
    }

    if (!updated) {
      existingImports.push({ variable, import: importStatement });
    }

    // Sort by import statement so that imports from the same packages are grouped together
    const sortedImports = existingImports.sort((a, b) => a.import.localeCompare(b.import));

    config.update("autoImports", sortedImports, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Successfully added import to auto-imports!`);
  }

  async guessNewAutoImport(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return false;
    }

    const docText = editor.document.uri.scheme === NOTEBOOK_SCHEME ? this.getCombinedNotebookCellText(editor.document, false) : editor.document.getText();
    if (!docText) {
      return false;
    }
    const [undefinedVariables, ok] = this.findUndefinedVariables(docText);
    if (undefinedVariables.size === 0) {
      return false;
    }

    // Have the user select from one of the known undefined imports
    const variableQuickInput = vscode.window.createQuickPick<AddAutoImportItem>();
    const items = [...undefinedVariables].sort().map((variable) => {
      return {
        label: variable,
      };
    });

    const otherText = "Other...";
    variableQuickInput.items = [
      ...items,
      { label: otherText },
    ];

    const disposables = [
      variableQuickInput.onDidAccept(async e => {
        variableQuickInput.dispose();

        if (variableQuickInput.activeItems.length === 0) {
          return;
        } else if (variableQuickInput.activeItems.length > 1) {
          vscode.window.showErrorMessage("Multiple selections made?!?!?");
          return;
        }

        // Get the variable the user selected
        let variable = variableQuickInput.selectedItems.at(0)?.label;
        if (!variable) {
          return;
        }

        // Ask the user for input if not one of the undefined ones
        this.addAutoImportForVariable(variable === otherText ? undefined : variable);
      }),

      // Close on variableQuickInput hide
      variableQuickInput.onDidHide(async e => {
        variableQuickInput.dispose();
        disposables.forEach(d => d.dispose);
      }),
    ];
    variableQuickInput.show();
    return true;
  }

  async addAutoImport() {
    if (await this.guessNewAutoImport()) {
      return;
    }
    this.addAutoImportForVariable(undefined);
  }
}

// This method is called when your extension is deactivated
export function deactivate() { }


// Below are just typed Ruff object definitions
interface RuffConfig {
  lint: LintConfig;
  format?: FormatConfig;
  'line-length'?: number;
}

interface LintConfig {
  select?: string[];
  isort?: ISortConfig;
}

interface ISortConfig {
  'required-imports'?: string[];
  'lines-after-imports'?: number;
  'combine-as-imports'?: boolean;
  // If we ever want a different import block style, see the below link:
  // https://pycqa.github.io/isort/docs/configuration/multi_line_output_modes.html
  'split-on-trailing-comma'?: boolean;
}

interface FormatConfig {
  'skip-magic-trailing-comma'?: boolean;
}

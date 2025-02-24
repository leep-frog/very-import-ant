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

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.logs = [];
  }

  log(message: string, reset?: boolean) {

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
  reloadableRegistrations: vscode.Disposable[];
}

class VeryImportantFormatter implements vscode.DocumentFormattingEditProvider, vscode.OnTypeFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {

  settings: VeryImportantSettings;
  outputChannel: TruncatedOutputChannel;

  constructor(context: vscode.ExtensionContext) {
    this.settings = this.reloadSettings(context);
    this.outputChannel = new TruncatedOutputChannel(vscode.window.createOutputChannel("very-import-ant"));
    this.outputChannel.log(`Initial settings: ${JSON.stringify(this.settings)}`);
  }

  reload(context: vscode.ExtensionContext) {
    this.settings = this.reloadSettings(context);
    this.outputChannel.log(`Reloaded settings: ${JSON.stringify(this.settings)}`);
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

    const newRegistrations = [];
    for (const scheme of activeSchemes) {
      newRegistrations.push(
        vscode.languages.registerOnTypeFormattingEditProvider(documentSelector(scheme), this, otc.at(0) || "\n", ...otc.slice(1)),
        vscode.languages.registerDocumentFormattingEditProvider(documentSelector(scheme), this),
        vscode.languages.registerDocumentRangeFormattingEditProvider(documentSelector(scheme), this),
      );
    }

    context.subscriptions.push(...newRegistrations);

    return {
      // Note that the secondary values are soft defaults and only fallbacks to avoid
      // undefined values. Actual defaults are set in package.json.
      enabled: config.get<boolean>("format.enable", false),
      autoImports: autoImportMap,
      reloadableRegistrations: newRegistrations,
      alwaysImport: config.get<string[]>("alwaysImport", []),
      removeUnusedImports: config.get<boolean>("removeUnusedImports", false),
    };
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
    if (!this.settings.enabled) {
      vscode.window.showErrorMessage("The Very Import-ant formatter is not enabled! Set `very-import-ant.format.enable` to true in your VS Code settings");
      return;
    }

    const text = document.getText();

    const [importsToAdd, ok] = this.determineImports(document, text);
    if (!ok) {
      return;
    }

    return this.fixDocument(document, text, importsToAdd, fullFormat);
  }

  private fixDocument(document: vscode.TextDocument, text: string, importsToAdd: string[], fullFormat: boolean): vscode.ProviderResult<vscode.TextEdit[]> {
    // Generate the new text
    const allEdits: vscode.TextEdit[][] = [];

    // Unfortunately, ruff iterates on fixes for other clients (e.g. CLI)
    // but doesn't plan to support it for the npm package: https://github.com/astral-sh/ruff/issues/14928
    // Fortunately, it's not too, too difficult to iterate ourselves,
    // but we should look to thoroughly test this logic.

    const ruffConfigs: RuffConfig[] = [
      this.addImportsConfig(importsToAdd, fullFormat),
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
        const [edittedText, successs] = this.applyRuffConfig(text, allEdits, ruffConfig);
        if (!successs) {
          return;
        }
        text = edittedText;
      }

      // Stop if recursion is appearing to get into a cycle.
      if (i > RUFF_FORMAT_DEPTH_LIMIT) {
        vscode.window.showErrorMessage(`Formatting error (depth-limit). Please open a GitHub issue and include the contents of your file.`);
        return;
      }
    }

    // Simply return single set of edits if only run once
    if (allEdits.length <= 0) {
      return allEdits.at(0);
    }

    // Otherwise, replace the entire document, as vscode expects all TextEdit
    // objects to reference the original document's positions (not incremental).
    return [{
      range: new vscode.Range(0, 0, document.lineCount, 0),
      newText: text,
    }];
  }

  private determineImports(document: vscode.TextDocument, text: string): [string[], boolean] {
    // Find all undefined variables
    let [undefinedImports, ok] = this.findUndefinedVariables(text);
    if (!ok) {
      return [[], false];
    }

    if (document.uri.scheme === NOTEBOOK_SCHEME) {
      // Get the NotebookDocument from the active text document
      const notebook = vscode.workspace.notebookDocuments.find(nb =>
        nb.getCells().some(cell => cell.document.uri.toString() === document.uri.toString())
      );
      if (!notebook) {
        vscode.window.showErrorMessage(`Failed to get NotebookDocument reference from TextDocument!`);
        return [[], false];
      }

      // Only get the cells up to and including the relevant cell (so if we use a variable in a cell before
      // it's imported, we still force that to be added).
      const upToCells: string[] = [];
      for (const cell of notebook.getCells().filter(cell => cell.kind === vscode.NotebookCellKind.Code)) {
        upToCells.push(cell.document.getText());
        if (cell.document.uri.toString() === document.uri.toString()) {
          break;
        }
      }

      // Run ruff on the merged text from all code cells
      const [undefinedFileImports, ok] = this.findUndefinedVariables(upToCells.join("\n"));
      if (!ok) {
        return [[], false];
      }

      // Take the intersection of the two sets so that we only consider imports
      // that are needed when both the single cell and the entire document have
      // the undefined name reference.
      undefinedImports = new Set<string>([...undefinedImports].filter(imp => undefinedFileImports.has(imp)));
    }

    return [[...new Set([
      ...this.getAlwaysImports(document),
      ...undefinedImports,
    ])], true];
  }

  private findUndefinedVariables(text: string): [Set<string>, boolean] {
    // Find all undefined variables
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

    // Map all undefined variables to their imports (if included in settings)
    const undefinedImports = new Set(diagnostics.filter(diagnostic => diagnostic.code === RuffCode.UNDEFINED_NAME).flatMap((diagnostic) => {

      const match = LINT_ERROR_REGEX.exec(diagnostic.message);

      const variableName = match?.at(1);
      if (!variableName) {
        vscode.window.showErrorMessage(`Undefined variable could not be determined from error message (${JSON.stringify(diagnostic)})`);
        return [];
      }

      return this.settings.autoImports.get(variableName) || [];
    }));

    return [undefinedImports, true];
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

  private addImportsConfig(importsToAdd: string[], fullFormat: boolean): RuffConfig {
    return {
      lint: {
        select: [
          ...(fullFormat ? [RuffCode.UNSORTED_IMPORTS] : []),
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

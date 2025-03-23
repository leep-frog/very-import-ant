import { CloseQuickPickAction, cmd, combineInteractions, delay, SelectItemQuickPickAction, SimpleTestCase, SimpleTestCaseProps, UserInteraction, Waiter } from '@leep-frog/vscode-test-stubber';
import { writeFileSync } from 'fs';
import path from 'path';
import * as vscode from 'vscode';

function startingFile(...filename: string[]) {
  return path.resolve(__dirname, "..", "..", "src", "test", "test-workspace", path.join(...filename));
}

function sel(line: number, char: number): vscode.Selection {
  return new vscode.Selection(line, char, line, char);
}

const MAX_WAIT = 250;

function getUri(...filename: string[]): vscode.Uri {
  const p = path.resolve("..", "..", "src", "test", "test-workspace", path.join(...filename));
  return vscode.Uri.file(p);
}

function openTestWorkspaceFile(...filename: string[]): UserInteraction {
  return cmd("vscode.open", getUri(...filename));
}

function notebookText(cells: NotebookCell[]): string {
  return JSON.stringify({
    cells: cells.map(cell => ({
      cell_type: cell.kind,
      execution_count: null,
      metadata: {},
      outputs: [],
      source: cell.contents.join("\n"),
    })),
    metadata: {
      language_info: {
        name: "python"
      },
    },
    nbformat: 4,
    nbformat_minor: 2
  });
}

function _waitForDocChange(containsText: string): UserInteraction {
  return new Waiter(5, () => {
    return !!(vscode.window.activeTextEditor!.document.getText().includes(containsText));
  }, MAX_WAIT / 5);
}

function _waitForDocUnchange(doesNotContainText: string): UserInteraction {
  return new Waiter(5, () => {
    return !(vscode.window.activeTextEditor!.document.getText().includes(doesNotContainText));
  }, MAX_WAIT / 5);
}

function _runAndWait(cmds: UserInteraction[], containsText?: string, doesNotContainText?: string): UserInteraction {
  const userInteractions: UserInteraction[] = [
    ...cmds,
  ];

  if (containsText) {
    userInteractions.push(_waitForDocChange(containsText));
  }
  if (doesNotContainText) {
    userInteractions.push(_waitForDocUnchange(doesNotContainText));
  }

  if (containsText || doesNotContainText) {
    userInteractions.push(
      // Need an additional delay for the cursor to get to where it needs to be
      delay(25),
    );
  } else {
    // We want to give time for the format operation to execute,
    // even if we expect no changes.
    userInteractions.push(delay(MAX_WAIT));
  }

  return combineInteractions(...userInteractions);
}

function formatDoc(props?: {
  containsText?: string;
  doesNotContainText?: string
  notebook?: boolean;
}): UserInteraction {
  return _runAndWait([cmd(props?.notebook ? "notebook.format" : "editor.action.formatDocument")], props?.containsText, props?.doesNotContainText);
}

function formatOnType(typeText: string, containsText?: string): UserInteraction {
  return _runAndWait([cmd("type", { text: typeText })], containsText);
}

function formatOnPaste(containsText?: string): UserInteraction {
  return _runAndWait([cmd("editor.action.clipboardPasteAction")], containsText);
}

interface VeryImportConfig {
  onTypeTriggerCharacters?: string;
  enabled?: boolean;
  undefinedAutoImports?: boolean;
  autoImports?: {
    variable: string;
    import: string;
  }[],
  alwaysImport?: string[];
  removeUnusedImports?: boolean;
  organizeImports?: boolean;
  ignoreSchemes?: string[];
}

function defaultSettings(config?: VeryImportConfig) {

  let opts = {};

  if (config?.undefinedAutoImports) {
    opts = {
      ...opts,
      "very-import-ant.autoImports": undefined,
    };
  } else if (config?.autoImports !== undefined) {
    opts = {
      ...opts,
      "very-import-ant.autoImports": config.autoImports,
    };
  }

  return {
    "[python]": {
      "editor.formatOnType": true,
      "editor.formatOnPaste": true,
      "editor.formatOnSave": true,
      "editor.defaultFormatter": "groogle.very-import-ant",
    },
    "files.eol": "\n",
    "very-import-ant.format.enable": config?.enabled ?? true,
    "very-import-ant.removeUnusedImports": config?.removeUnusedImports ?? false,
    "very-import-ant.organizeImports": config?.organizeImports ?? true,
    "very-import-ant.alwaysImport": config?.alwaysImport ?? [],
    "very-import-ant.ignoreSchemes": config?.ignoreSchemes ?? [],
    "very-import-ant.onTypeTriggerCharacters": config?.onTypeTriggerCharacters,
    "notebook.defaultFormatter": "groogle.very-import-ant",
    "notebook.formatOnCellExecution": true,
    "notebook.formatOnSave.enabled": true,
    ...opts,
  };
}

interface NotebookCell {
  contents: string[];
  kind: 'code' | 'markdown';
}

interface TestCase extends SimpleTestCaseProps {
  name: string;
  settings: any;
  initFile?: boolean;
  fileContents?: string[];
  runSolo?: boolean;
  notebookContents?: NotebookCell[];
}



const testCases: TestCase[] = [
  // enable setting tests
  {
    name: "Fails if disabled",
    settings: defaultSettings({ enabled: false }),
    fileContents: [
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "def func():",
      "    _ = pd",
    ],
  },
  {
    name: "Works if enabled",
    settings: defaultSettings({ enabled: true }),
    fileContents: [
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    expectedSelections: [sel(3, 0)]
  },
  {
    name: "Doesn't work again if disabled again",
    settings: defaultSettings({ enabled: false }),
    fileContents: [
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "def func():",
      "    _ = pd",
    ],
  },
  // No-op tests
  {
    name: "Handles empty file",
    settings: defaultSettings(),
    fileContents: [],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [""],
  },
  {
    name: "Handles syntax errors",
    settings: defaultSettings(),
    fileContents: [
      "def func():",
      "",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "def func():",
      "",
    ],
  },
  {
    name: "Handles more syntax errors",
    settings: defaultSettings(),
    fileContents: [
      "from else import somewhere",
      "from somewhere import else",
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "from else import somewhere",
      "from somewhere import else",
      "",
      "def func():",
      "    _ = pd",
    ],
  },
  {
    name: "Handles syntax error in autoImports",
    settings: defaultSettings({
      autoImports: [{ variable: "pd", import: "from else import somewhere" }],
    }),
    fileContents: [
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "",
      "def func():",
      "    _ = pd",
    ],
    errorMessage: {
      expectedMessages: [
        `Failed to create ruff config: Error: Error: Expected a module name at byte range 5..9`,
      ],
    }
  },
  {
    name: "Ignores unsupported undefined variable name",
    settings: defaultSettings(),
    fileContents: [
      "def func():",
      "    _ = idk",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "def func():",
      "    _ = idk",
    ],
  },
  {
    name: "Handles invalid import (as the file text will be idenitcal before and after, so iteration ends)",
    settings: defaultSettings({
      removeUnusedImports: true,
      autoImports: [
        {
          variable: "pd",
          import: "from some import thing",
        },
      ],
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
  },
  {
    name: "Adds import for single supported variable when indentation is included",
    settings: defaultSettings(),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "Adds import when module doc included",
    settings: defaultSettings(),
    fileContents: [
      `"""Some docstring."""`,
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      `"""Some docstring."""`,
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
  },
  {
    name: "Adds import for single supported variable",
    settings: defaultSettings(),
    fileContents: [
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    expectedSelections: [sel(3, 0)],
  },
  {
    name: "Adds single import for multiple undefined refs",
    settings: defaultSettings(),
    fileContents: [
      "def func():",
      "    _ = pd",
      "    df = pd.DataFrame",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    df = pd.DataFrame",
    ],
    expectedSelections: [sel(3, 0)],
  },
  {
    name: "Imports all built-in imports",
    settings: defaultSettings(),
    fileContents: [
      "def func():",
      "    _ = pd",
      "    arr = np.array()",
      "    da = xr.DataArray()",
      "    xrt.assert_equal(da, da)",
      // Add some duplicates too
      "    other = np.array()",
      "    another = pd.DataFrame()",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "import numpy as np",
      "import pandas as pd",
      "import xarray as xr",
      "from xarray import testing as xrt",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    arr = np.array()",
      "    da = xr.DataArray()",
      "    xrt.assert_equal(da, da)",
      // Add some duplicates too
      "    other = np.array()",
      "    another = pd.DataFrame()",
    ],
    expectedSelections: [sel(6, 0)],
  },
  {
    name: "Adds auto-imports from settings",
    settings: defaultSettings(),
    fileContents: [
      "def func():",
      "    _ = pd",
      "    arr = np.array()",
      "    da = xr.DataArray()",
      "    xrt.assert_equal(da, da)",
      // Add some duplicates too
      "    other = np.array()",
      "    another = pd.DataFrame()",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "import numpy as np",
      "import pandas as pd",
      "import xarray as xr",
      "from xarray import testing as xrt",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    arr = np.array()",
      "    da = xr.DataArray()",
      "    xrt.assert_equal(da, da)",
      // Add some duplicates too
      "    other = np.array()",
      "    another = pd.DataFrame()",
    ],
    expectedSelections: [sel(6, 0)],
  },
  {
    name: "Recurs to fix import order for imports from same source",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "alpha",
          import: "from greece import a as alpha",
        },
        {
          variable: "beta",
          import: "from greece import b as beta",
        },
      ],
    }),
    fileContents: [
      "def func():",
      "    _ = alpha",
      "    k = beta + 2",
      "    return beta - alpha",
    ],
    userInteractions: [
      formatDoc({ containsText: "greece" }),
    ],
    expectedText: [
      "from greece import a as alpha, b as beta",
      "",
      "",
      "def func():",
      "    _ = alpha",
      "    k = beta + 2",
      "    return beta - alpha",
    ],
    expectedSelections: [sel(3, 0)],
  },
  {
    name: "Adds import to list",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "alpha",
          import: "from greece import a as alpha",
        },
        {
          variable: "beta",
          import: "from greece import b as beta",
        },
      ],
    }),
    fileContents: [
      "from greece import b as beta",
      "",
      "def func():",
      "    _ = alpha",
      "    k = beta + 2",
      "    return beta - alpha",
    ],
    userInteractions: [
      formatDoc({ containsText: "import a" }),
    ],
    expectedText: [
      "from greece import a as alpha, b as beta",
      "",
      "",
      "def func():",
      "    _ = alpha",
      "    k = beta + 2",
      "    return beta - alpha",
    ],
  },
  {
    name: "Recurs with multiple imports",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "pd",
          import: "import pandas as pd",
        },
        {
          variable: "np",
          import: "import numpy as np",
        },
        {
          variable: "xr",
          import: "import xarray as xr",
        },
        {
          variable: "alpha",
          import: "from greece import a as alpha",
        },
        {
          variable: "beta",
          import: "from greece import b as beta",
        },
      ],
    }),
    fileContents: [
      "def func():",
      "    _ = alpha",
      "    k = beta + 2",
      "    np.array(alpha, beta)",
      "    xr.DataArray(alpha, beta)",
      "    return beta - alpha",
    ],
    userInteractions: [
      formatDoc({ containsText: "numpy" }),
    ],
    expectedText: [
      "import numpy as np",
      "import xarray as xr",
      "from greece import a as alpha, b as beta",
      "",
      "",
      "def func():",
      "    _ = alpha",
      "    k = beta + 2",
      "    np.array(alpha, beta)",
      "    xr.DataArray(alpha, beta)",
      "    return beta - alpha",
    ],
    expectedSelections: [sel(5, 0)],
  },
  {
    name: "Works with multiple values for single alias",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "multi",
          import: "from pair import left",
        },
        {
          variable: "multi",
          import: "from pair import right",
        },
        {
          variable: "multi",
          import: "from another import multi",
        },
      ],
    }),
    fileContents: [
      "def func():",
      "    _ = multi",
    ],
    userInteractions: [
      formatDoc({ containsText: "pair" }),
    ],
    expectedText: [
      "from another import multi",
      "from pair import left, right",
      "",
      "",
      "def func():",
      "    _ = multi",
    ],
    expectedSelections: [sel(4, 0)],
  },
  {
    name: "Handles identical ruff fixes with import block",
    settings: defaultSettings({
      removeUnusedImports: true,
    }),
    fileContents: [
      "from p import (",
      "    one,",
      "    two,",
      "    three,",
      ")",
      "",
      "",
      "_ = one",
    ],
    userInteractions: [
      formatDoc({ doesNotContainText: "three" }),
    ],
    expectedText: [
      "from p import one",
      "",
      "",
      "_ = one",
    ],
  },
  {
    name: "Handles identical ruff fixes with import statement",
    settings: defaultSettings({
      removeUnusedImports: true,
    }),
    fileContents: [
      "from p import one, two, three",
      "",
      "",
      "_ = one",
    ],
    userInteractions: [
      formatDoc({ doesNotContainText: "three" }),
    ],
    expectedText: [
      "from p import one",
      "",
      "",
      "_ = one",
    ],
  },
  {
    name: "Handles ruff fixes that intersect only at a single character (a range where range.isEmpty() is true)",
    settings: defaultSettings({
      removeUnusedImports: true,
    }),
    fileContents: [
      `from __future__ import annotations`,
      ``,
      `import traceback`,
      `from typing import Any, Callable, Dict`,
      ``,
      `def func() -> Any:`,
      `    pass`,
      ``,
    ],
    userInteractions: [
      formatDoc({ doesNotContainText: "traceback" }),
    ],
    expectedText: [
      `from __future__ import annotations`,
      ``,
      `from typing import Any`,
      ``,
      ``,
      `def func() -> Any:`,
      `    pass`,
      ``,
    ],
  },
  // Organize import tests
  {
    name: "Organizes imports",
    settings: defaultSettings(),
    fileContents: [
      "import pandas as pd",
      "from numbers import two",
      "import numpy as np",
      "",
      "from numbers import three, one",
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "from numbers import one, three, two",
      "",
      "import numpy as np",
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
  },
  {
    name: "Doesn't organize imports if organizeImports is false",
    settings: defaultSettings({
      organizeImports: false,
    }),
    fileContents: [
      "import pandas as pd",
      "from numbers import two",
      "import numpy as np",
      "",
      "from numbers import three, one",
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "import pandas as pd",
      "from numbers import two",
      "import numpy as np",
      "",
      "from numbers import three, one",
      "",
      "def func():",
      "    _ = pd",
    ],
  },
  {
    name: "Doesn't organize imports for __init__.py file",
    settings: defaultSettings({
      organizeImports: true,
    }),
    initFile: true,
    fileContents: [
      "import pandas as pd",
      "from numbers import two",
      "import numpy as np",
      "",
      "from numbers import three, one",
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "import pandas as pd",
      "from numbers import two",
      "import numpy as np",
      "",
      "from numbers import three, one",
      "",
      "def func():",
      "    _ = pd",
    ],
  },
  {
    name: "Organizes import when adding an import",
    settings: defaultSettings(),
    fileContents: [
      "import pandas as pd",
      "from numbers import two",
      "import numpy as np",
      "",
      "from numbers import three, one",
      "",
      "def func():",
      "    _ = xr",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "from numbers import one, three, two",
      "",
      "import numpy as np",
      "import pandas as pd",
      "import xarray as xr",
      "",
      "",
      "def func():",
      "    _ = xr",
    ],
  },
  {
    name: "Doesn't organize imports when adding an import if organizeImports is false",
    settings: defaultSettings({
      organizeImports: false,
    }),
    fileContents: [
      "import pandas as pd",
      "from numbers import two",
      "import numpy as np",
      "",
      "from numbers import three, one",
      "",
      "def func():",
      "    _ = xr",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "import xarray as xr",
      "import pandas as pd",
      "from numbers import two",
      "import numpy as np",
      "",
      "from numbers import three, one",
      "",
      "def func():",
      "    _ = xr",
    ],
  },
  // Test format triggering
  {
    name: "Format onSave fixes everything",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "np",
          import: "import numpy as np",
        },
        {
          variable: "xyz",
          import: "from alphabet import tail as xyz",
        },
      ],
      alwaysImport: [
        "from france import un",
        "from france import deux",
        "from italy import wine",
      ],
    }),
    fileContents: [
      "from alphabet import abc, fgh, jkl",
      "from italy import food",
      "",
      "from alphabet import de",
      "def func():",
      "    _ = pd",
      "    _ = food + de + abc + jkl + xyz",
      "    _ = np",
    ],
    userInteractions: [
      cmd("workbench.action.files.save"),
      _waitForDocChange("pandas"),
      // Need to wait a little bit longer to ensure the save action completes
      // after the formatting step runs (since the above only waits for the formatting to occur).
      delay(25),
    ],
    expectedText: [
      `import numpy as np`,
      `from alphabet import abc, de, fgh, jkl, tail as xyz`,
      `from france import deux, un`,
      `from italy import food, wine`,
      ``,
      ``,
      `def func():`,
      `    _ = pd`,
      `    _ = food + de + abc + jkl + xyz`,
      `    _ = np`,
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "Format with command fixes everything",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "np",
          import: "import numpy as np",
        },
        {
          variable: "xyz",
          import: "from alphabet import tail as xyz",
        },
      ],
      alwaysImport: [
        "from france import un",
        "from france import deux",
        "from italy import wine",
      ],
    }),
    fileContents: [
      "from alphabet import abc, fgh, jkl",
      "from italy import food",
      "",
      "from alphabet import de",
      "def func():",
      "    _ = pd",
      "    _ = food + de + abc + jkl + xyz",
      "    _ = np",
    ],
    userInteractions: [
      formatDoc({
        containsText: "pandas",
      }),
    ],
    expectedText: [
      `import numpy as np`,
      `from alphabet import abc, de, fgh, jkl, tail as xyz`,
      `from france import deux, un`,
      `from italy import food, wine`,
      ``,
      ``,
      `def func():`,
      `    _ = pd`,
      `    _ = food + de + abc + jkl + xyz`,
      `    _ = np`,
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "Formats onPaste",
    settings: defaultSettings({
      onTypeTriggerCharacters: "q",
    }),
    fileContents: [
      "_ = np",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    ",
    ],
    userInteractions: [
      cmd("cursorTop"),
      cmd("cursorEndSelect"),
      cmd("editor.action.clipboardCutAction"),
      cmd("cursorBottom"),
      formatOnPaste("numpy")
    ],
    expectedText: [
      "import numpy as np",
      "import pandas as pd",
      "",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    _ = np",
    ],
    expectedSelections: [sel(7, 10)],
  },
  {
    name: "Formats onType for first of more_trigger_characters",
    settings: defaultSettings({
      onTypeTriggerCharacters: "\ndp",
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    ",
    ],
    selections: [sel(4, 4)],
    userInteractions: [
      formatOnType("d", "pandas"),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    d",
    ],
    expectedSelections: [sel(5, 5)],
  },
  {
    // Note, this test is after the more_trigger_characters because we want
    // to confirm that any character (not just first_trigger_character)
    // will trigger formatting first (i.e. trigger works if the "first trigger character" typed
    // is contained in "more_trigger_characters")
    name: "Formats onType for first_trigger_character",
    settings: defaultSettings({
      onTypeTriggerCharacters: "\n",
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    selections: [sel(3, 10)],
    userInteractions: [
      formatOnType("\n", "pandas"),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    ",
    ],
    expectedSelections: [sel(5, 4)],
  },
  {
    name: "Formats onType does not fix everything",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "np",
          import: "import numpy as np",
        },
        {
          variable: "xyz",
          import: "from alphabet import tail as xyz",
        },
      ],
      alwaysImport: [
        "from france import un",
        "from france import deux",
        "from italy import wine",
      ],
    }),
    fileContents: [
      "from alphabet import abc, fgh, jkl",
      "from italy import food",
      "",
      "from alphabet import de",
      "def func():",
      "    _ = pd",
      "    _ = food + de + abc + jkl + xyz",
      "    _ = np",
    ],
    selections: [sel(7, 10)],
    userInteractions: [
      formatOnType("\n", "pandas"),
    ],
    expectedText: [
      `from alphabet import tail as xyz`,
      `from france import deux`,
      `from france import un`,
      `from italy import wine`,
      `import numpy as np`,
      `from alphabet import abc, fgh, jkl`,
      `from italy import food`,
      ``,
      `from alphabet import de`,
      `def func():`,
      `    _ = pd`,
      `    _ = food + de + abc + jkl + xyz`,
      `    _ = np`,
      `    `,
    ],
    expectedSelections: [sel(13, 4)],
  },
  {
    name: "Formats onType for onTypeTriggerCharacters when not a whitespace character",
    settings: defaultSettings({
      onTypeTriggerCharacters: "f",
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    ",
    ],
    selections: [sel(4, 4)],
    userInteractions: [
      formatOnType("f", "pandas"),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    f",
    ],
    expectedSelections: [sel(5, 5)],
  },
  {
    name: "Formats onType for onTypeTriggerCharacters defaults to \\n if undefined",
    // Note this test should be after a test that sets onTypeTriggerCharacters to not \n
    // (otherwise don't know if previous test run sets it to \n, or this test)
    settings: defaultSettings({
      onTypeTriggerCharacters: undefined,
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    selections: [sel(3, 10)],
    userInteractions: [
      formatOnType("\n", "pandas"),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    ",
    ],
    expectedSelections: [sel(5, 4)],
  },
  {
    name: "Formats onType for onTypeTriggerCharacters defaults to \\n if empty string",
    settings: defaultSettings({
      onTypeTriggerCharacters: "",
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    selections: [sel(3, 10)],
    userInteractions: [
      formatOnType("\n", "pandas"),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    ",
    ],
    expectedSelections: [sel(5, 4)],
  },
  {
    name: "Formats onType for second of more_trigger_characters",
    settings: defaultSettings({
      onTypeTriggerCharacters: "\ndp",
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    ",
    ],
    selections: [sel(4, 4)],
    userInteractions: [
      formatOnType("d", "pandas"),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    d",
    ],
    expectedSelections: [sel(5, 5)],
  },
  {
    name: "Formats onType and includes newly added undefined variable",
    settings: defaultSettings({
      onTypeTriggerCharacters: "\ndp",
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    n",
    ],
    selections: [sel(4, 5)],
    userInteractions: [
      formatOnType("p", "pandas"),
    ],
    expectedText: [
      "import numpy as np",
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    np",
    ],
    expectedSelections: [sel(6, 6)],
  },
  {
    name: "Does not format onType if not a trigger character",
    settings: defaultSettings({
      onTypeTriggerCharacters: "\ndp",
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    x",
    ],
    selections: [sel(4, 5)],
    userInteractions: [
      formatOnType("r"),
    ],
    expectedText: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    xr",
    ],
    expectedSelections: [sel(4, 6)],
  },
  {
    name: "Works if first_trigger_character is a letter",
    settings: defaultSettings({
      onTypeTriggerCharacters: "r",
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    x",
    ],
    selections: [sel(4, 5)],
    userInteractions: [
      formatOnType("r", "pandas"),
    ],
    expectedText: [
      "import pandas as pd",
      "import xarray as xr",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    xr",
    ],
    expectedSelections: [sel(6, 6)],
  },
  // Invalid import config tests
  {
    name: "Ignores invalid import rule if not used",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "pd",
          import: "import pandas as pd",
        },
        {
          variable: "np",
          import: "import numpy np",
        },
      ],
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "Catches invalid import rule if used",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "pd",
          import: "import pandas as pd",
        },
        {
          variable: "np",
          import: "import numpy np",
        },
      ],
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = np",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "",
      "",
      "def func():",
      "    _ = np",
    ],
    errorMessage: {
      expectedMessages: [
        `Failed to create ruff config: Error: Error: Expected ',', found name at byte range 13..15`,
      ],
    }
  },
  // Import spacing tests
  {
    name: "Combines new and existing import statements",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "one",
          import: "from numbers import one",
        },
        {
          variable: "three",
          import: "from numbers import trois as three",
        },
      ],
    }),
    fileContents: [
      `"""docstring"""`,
      "",
      "from numbers import two",
      "",
      "def func():",
      "    _ = one + three",
    ],
    userInteractions: [
      formatDoc({ containsText: "trois" }),
    ],
    expectedText: [
      `"""docstring"""`,
      "from numbers import one, trois as three, two",
      "",
      "",
      "def func():",
      "    _ = one + three",
    ],
  },
  // Always import tests
  {
    name: "adds single alwaysImport",
    settings: defaultSettings({
      alwaysImport: [
        'from forever import ever',
      ],
    }),
    fileContents: [
      `def one():`,
      `    return 1`,
      ``,
    ],
    userInteractions: [
      formatDoc({ containsText: "forever" }),
    ],
    expectedText: [
      `from forever import ever`,
      ``,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
    expectedSelections: [sel(3, 0)],
  },
  {
    name: "doesn't add alwaysImport in __init__.py file",
    settings: defaultSettings({
      alwaysImport: [
        'from forever import ever',
      ],
    }),
    initFile: true,
    fileContents: [
      `def one():`,
      `    return 1`,
      ``,
    ],
    userInteractions: [
      formatDoc({ containsText: "forever" }),
    ],
    expectedText: [
      `def one():`,
      `    return 1`,
      ``,
    ],
  },
  {
    name: "adds single alwaysImport to combined import",
    settings: defaultSettings({
      alwaysImport: [
        'from forever import ndever',
      ],
    }),
    fileContents: [
      `from forever import ever`,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
    userInteractions: [
      formatDoc({ containsText: "ndever" }),
    ],
    expectedText: [
      `from forever import ever, ndever`,
      ``,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
  },
  {
    name: "adds multiple alwaysImport",
    settings: defaultSettings({
      alwaysImport: [
        'from forever import ndever',
        'from something import elze',
        'from france import wine',
      ],
    }),
    fileContents: [
      `from forever import ever`,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
    userInteractions: [
      formatDoc({ containsText: "ndever" }),
    ],
    expectedText: [
      `from forever import ever, ndever`,
      `from france import wine`,
      `from something import elze`,
      ``,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
  },
  {
    name: "works when alwaysImport and autoImports overlap",
    settings: defaultSettings({
      autoImports: [
        {
          import: "from elsewhere import ndever",
          variable: "ndever",
        },
      ],
      alwaysImport: [
        'from forever import ndever',
      ],
    }),
    fileContents: [
      ``,
      `def one():`,
      `    _ = ndever`,
      `    return 1`,
      ``,
    ],
    userInteractions: [
      formatDoc({ containsText: "ndever" }),
    ],
    expectedText: [
      `from elsewhere import ndever`,
      `from forever import ndever`,
      ``,
      ``,
      `def one():`,
      `    _ = ndever`,
      `    return 1`,
      ``,
    ],
    expectedSelections: [sel(3, 0)],
  },
  // Notebook tests
  {
    name: "Adds import for notebook",
    settings: defaultSettings(),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = pd",
        ],
      }
    ],
    userInteractions: [
      formatDoc({
        containsText: "pandas",
        notebook: true,
      }),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "Imports all built-in imports for notebook",
    settings: defaultSettings(),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "def func():",
          "    _ = pd",
          "    arr = np.array()",
          "    da = xr.DataArray()",
          "    xrt.assert_equal(da, da)",
          // Add some duplicates too
          "    other = np.array()",
          "    another = pd.DataFrame()",
        ],
      },
    ],
    userInteractions: [
      formatDoc({
        containsText: "pandas",
        notebook: true,
      }),
    ],
    expectedText: [
      "import numpy as np",
      "import pandas as pd",
      "import xarray as xr",
      "from xarray import testing as xrt",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    arr = np.array()",
      "    da = xr.DataArray()",
      "    xrt.assert_equal(da, da)",
      // Add some duplicates too
      "    other = np.array()",
      "    another = pd.DataFrame()",
    ],
    expectedSelections: [sel(6, 0)],
  },
  {
    name: "Formats notebook onSave",
    settings: defaultSettings(),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = pd",
          "",
        ],
      },
    ],
    userInteractions: [
      cmd("workbench.action.files.save"),
      _waitForDocChange("pandas"),
      // Need to wait a little bit longer to ensure the save action completes
      // after the formatting step runs (since the above only waits for the formatting to occur).
      delay(50),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "",
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "alwaysImports is ignored for notebooks",
    settings: defaultSettings({
      alwaysImport: [
        "from alw import ays",
        "import numpy as np",
      ],
    }),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = pd",
          "",
        ],
      },
    ],
    userInteractions: [
      delay(25),
      cmd("workbench.action.files.save"),
      _waitForDocChange("pandas"),
      delay(25),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
      "",
    ],
    expectedSelections: [sel(2, 0)],
  },
  {
    name: "removeUnusedImports is ignored for notebooks",
    settings: defaultSettings({
      removeUnusedImports: true,
    }),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "from nunya import business",
          "",
          "def func():",
          "    _ = pd",
          "",
        ],
      },
    ],
    userInteractions: [
      cmd("workbench.action.files.save"),
      _waitForDocChange("pandas"),
      // Need to wait a little bit longer to ensure the save action completes
      // after the formatting step runs (since the above only waits for the formatting to occur).
      delay(50),
    ],
    expectedText: [
      "import pandas as pd",
      "from nunya import business",
      "",
      "",
      "def func():",
      "    _ = pd",
      "",
    ],
    expectedSelections: [sel(4, 0)],
  },
  // Notebook with multiple cells test
  {
    name: "Only current cell gets imports added (at first cell)",
    settings: defaultSettings(),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = pd",
        ],
      },
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = np",
        ],
      }
    ],
    userInteractions: [
      formatDoc({
        containsText: "pandas",
        notebook: true,
      }),
    ],
    // TODO: Test full notebook contents
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    expectedSelections: [sel(4, 10)],
  },
  {
    name: "Only current cell gets imports added (at second cell)",
    settings: defaultSettings(),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = pd",
        ],
      },
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = np",
        ],
      }
    ],
    userInteractions: [
      cmd('notebook.focusNextEditor'),
      formatDoc({
        containsText: "numpy",
        notebook: true,
      }),
    ],
    expectedText: [
      "import numpy as np",
      "",
      "",
      "def func():",
      "    _ = np",
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "Current cell only gets imports that aren't included in a previous cell",
    settings: defaultSettings(),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "import pandas as pd",
          "import unused as un",
          "",
        ],
      },
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = np",
          "    _ = pd",
          "",
        ],
      }
    ],
    userInteractions: [
      cmd('notebook.focusNextEditor'),
      formatDoc({
        containsText: "numpy",
        notebook: true,
      }),
    ],
    expectedText: [
      "import numpy as np",
      "",
      "",
      "def func():",
      "    _ = np",
      "    _ = pd",
      "",
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "If import is in a later cell, it still gets added",
    settings: defaultSettings(),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "def func():",
          "    _ = np",
          "    _ = pd",
          "",
        ],
      },
      {
        kind: 'code',
        contents: [
          "import pandas as pd",
          "import unused as un",
        ],
      }
    ],
    userInteractions: [
      formatDoc({
        containsText: "numpy",
        notebook: true,
      }),
    ],
    expectedText: [
      "import numpy as np",
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = np",
      "    _ = pd",
      "",
    ],
    expectedSelections: [sel(4, 0)],
  },
  {
    name: "Disregards markdown cells",
    settings: defaultSettings(),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "import pandas as pd",
          "import unused as un",
          "",
        ],
      },
      {
        kind: 'markdown',
        contents: [
          "import numpy as np",
          "",
        ],
      },
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = np",
          "    _ = pd",
          "",
        ],
      }
    ],
    userInteractions: [
      cmd('notebook.focusNextEditor'),
      cmd('notebook.focusNextEditor'),
      formatDoc({
        containsText: "numpy",
        notebook: true,
      }),
    ],
    expectedText: [
      "import numpy as np",
      "",
      "",
      "def func():",
      "    _ = np",
      "    _ = pd",
      "",
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "No formatting in markdown cell",
    settings: defaultSettings(),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "import pandas as pd",
          "import unused as un",
          "",
        ],
      },
      {
        kind: 'markdown',
        contents: [
          "# This is markdown",
          "",
          "",
          "def func():",
          "    _ = np",
          "    _ = pd",
          "",
        ],
      }
    ],
    userInteractions: [
      cmd('notebook.focusNextEditor'),
      formatDoc({
        notebook: true,
      }),
    ],
    // TODO: expected markdown editor
    // expectedText: [
    //   "# This is markdown",
    //   "",
    //   "",
    //   "def func():",
    //   "    _ = np",
    //   "    _ = pd",
    //   "",
    // ],
    // expectedSelections: [sel(1, 0)],
  },
  // Remove unused imports test
  {
    name: "removes unused import",
    settings: defaultSettings({
      removeUnusedImports: true,
    }),
    fileContents: [
      `import nunya`,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
    userInteractions: [
      formatDoc({ doesNotContainText: "nunya" }),
    ],
    expectedText: [
      ``,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
  },
  {
    name: "doesn't remove unused import in __init__.py file",
    settings: defaultSettings({
      removeUnusedImports: true,
    }),
    initFile: true,
    fileContents: [
      `import nunya`,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      `import nunya`,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
  },
  {
    name: "doesn't remove unused alwaysImport",
    settings: defaultSettings({
      removeUnusedImports: true,
      alwaysImport: [
        "import nunya",
      ],
    }),
    fileContents: [
      `import nunya`,
      `import other`,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
    userInteractions: [
      formatDoc({ doesNotContainText: "other" }),
    ],
    expectedText: [
      `import nunya`,
      ``,
      ``,
      `def one():`,
      `    return 1`,
      ``,
    ],
  },
  {
    name: "does a little bit of everything",
    settings: defaultSettings({
      removeUnusedImports: true,
      alwaysImport: [
        "import nunya",
        "import another",
      ],
      autoImports: [
        { variable: "pd", import: "import pandas as pd" },
      ],
    }),
    fileContents: [
      `import nunya`,
      `import other`,
      ``,
      `def one():`,
      `    _ = pd`,
      ``,
    ],
    userInteractions: [
      formatDoc({ doesNotContainText: "other" }),
    ],
    expectedText: [
      `import another`,
      `import nunya`,
      `import pandas as pd`,
      ``,
      ``,
      `def one():`,
      `    _ = pd`,
      ``,
    ],
  },
  {
    name: "handles removing unused imports and sorting imports simultaneously",
    settings: defaultSettings({
      removeUnusedImports: true,
    }),
    fileContents: [
      `from package import un as one, deux as two`,
      ``,
      ``,
      `def func():`,
      `    _=one`,
      ``,
    ],
    userInteractions: [
      formatDoc({ doesNotContainText: "deux" }),
    ],
    expectedText: [
      `from package import un as one`,
      ``,
      ``,
      `def func():`,
      `    _=one`,
      ``,
    ],
  },
  {
    name: "handles edit for notebook with single line",
    settings: defaultSettings({
      autoImports: [
        { variable: "pd", import: "import pandas as pd" },
      ],
    }),
    fileContents: [
      `_ = pd`,
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      `import pandas as pd`,
      ``,
      ``,
      `_ = pd`,
    ],
    expectedSelections: [sel(3, 0)],
  },
  {
    name: "fixes spacing in imports",
    settings: defaultSettings({
      autoImports: [
        { variable: "pd", import: "import pandas as pd" },
      ],
    }),
    fileContents: [
      `import numpy  as np`,
      `import pandas as  pd`,
      ``,
      ``,
      `_ = pd`,
      `_ = np`,
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      `import numpy as np`,
      `import pandas as pd`,
      ``,
      ``,
      `_ = pd`,
      `_ = np`,
    ],
  },
  // ignoreScheme tests
  {
    name: "Doesn't format python file if scheme is ignored",
    settings: defaultSettings({
      ignoreSchemes: ['file'],
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
  },
  {
    name: "Format python file if ignore scheme is removed (copy of previous test with ignoreScheme change)",
    settings: defaultSettings({
      ignoreSchemes: ['vscode-notebook-cell', 'untitled'],
    }),
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    userInteractions: [
      formatDoc({
        containsText: "pandas",
      }),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    expectedSelections: [sel(1, 0)],
  },
  {
    name: "Doesn't format notebook if scheme is ignored",
    settings: defaultSettings({
      ignoreSchemes: ['vscode-notebook-cell'],
    }),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = pd",
        ],
      },
    ],
    userInteractions: [
      formatDoc({
        notebook: true,
      }),
    ],
    expectedText: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
  },
  {
    name: "Format notebook if ignore scheme is removed (copy of previous test with ignoreScheme change)",
    settings: defaultSettings({
      ignoreSchemes: [],
    }),
    notebookContents: [
      {
        kind: 'code',
        contents: [
          "",
          "",
          "def func():",
          "    _ = pd",
        ],
      },
    ],
    userInteractions: [
      formatDoc({
        notebook: true,
        containsText: "pandas",
      }),
    ],
    expectedText: [
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    expectedSelections: [sel(1, 0)],
  },
  // TODO: untitled file tests (for both actual fixing and ignoring scheme
  // Probably will need to use new python file command to test this

  // Test import block styles
  {
    name: "Converts import block to one line",
    settings: defaultSettings(),
    fileContents: [
      "from typing import (",
      "    Any",
      ")",
      "",
      "def func() -> Any:",
      "    pass",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "from typing import Any",
      "",
      "",
      "def func() -> Any:",
      "    pass",
    ],
  },
  {
    name: "Converts import block with trailing comma to one line",
    settings: defaultSettings({
      removeUnusedImports: true,
    }),
    fileContents: [
      "from typing import (",
      "    Any,",
      ")",
      "",
      "def func() -> Any:",
      "    pass",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "from typing import Any",
      "",
      "",
      "def func() -> Any:",
      "    pass",
    ],
  },
  {
    name: "Removal of import in import block with no trailing comma gets condensed to one line",
    settings: defaultSettings({
      removeUnusedImports: true,
    }),
    fileContents: [
      "from typing import (",
      "    Any,",
      "    Dict,",
      "    Optional",
      ")",
      "",
      "def func(d: Optional[str]) -> Any:",
      "    pass",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "from typing import Any, Optional",
      "",
      "",
      "def func(d: Optional[str]) -> Any:",
      "    pass",
    ],
  },
  {
    name: "Removal of import in import block with trailing comma gets condensed to one line",
    settings: defaultSettings(),
    fileContents: [
      "from typing import Any, Optional",
      "",
      "def func(d: Optional[str]) -> Any:",
      "    pass",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      "from typing import Any, Optional",
      "",
      "",
      "def func(d: Optional[str]) -> Any:",
      "    pass",
    ],
  },
  {
    name: "Really long import line gets converted to multi-line",
    settings: defaultSettings(),
    fileContents: [
      "from typing import Another, Any, Basically, Dict, Finally, Optional, Other, Donzo",
      "",
      "def func():",
      "    pass",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      `from typing import (`,
      `    Another,`,
      `    Any,`,
      `    Basically,`,
      `    Dict,`,
      `    Donzo,`,
      `    Finally,`,
      `    Optional,`,
      `    Other,`,
      `)`,
      "",
      "",
      "def func():",
      "    pass",
    ],
  },
  {
    name: "Really long import block gets comma added",
    settings: defaultSettings(),
    fileContents: [
      `from typing import (`,
      `    Another,`,
      `    Any,`,
      `    Basically,`,
      `    Dict,`,
      `    Donzo,`,
      `    Finally,`,
      `    Optional,`,
      `    Other`,
      `)`,
      "",
      "def func():",
      "    pass",
    ],
    userInteractions: [
      formatDoc({ containsText: "pandas" }),
    ],
    expectedText: [
      `from typing import (`,
      `    Another,`,
      `    Any,`,
      `    Basically,`,
      `    Dict,`,
      `    Donzo,`,
      `    Finally,`,
      `    Optional,`,
      `    Other,`,
      `)`,
      "",
      "",
      "def func():",
      "    pass",
    ],
  },
  {
    name: "Does not add settings if no input box response for variable",
    settings: defaultSettings(),
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        undefined,
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
          validationMessage: {
            message: "Variable cannot be empty",
            severity: vscode.InputBoxValidationSeverity.Error,
          },
        },
      ],
    },
    workspaceConfiguration: {
      skip: false,
    }
  },
  {
    name: "Does not add settings if no input box response for import statement",
    settings: defaultSettings(),
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        "boopers",
        undefined,
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
        },
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for boopers",
            value: "from  import boopers",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    workspaceConfiguration: {
      skip: false,
    }
  },
  {
    name: "Adds new auto import setting",
    settings: defaultSettings(),
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        "boopers",
        "from super import boopers",
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
        },
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for boopers",
            value: "from  import boopers",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    informationMessage: {
      expectedMessages: [
        'Successfully added import to auto-imports!',
      ],
    },
    workspaceConfiguration: {
      skip: false,
      expectedWorkspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "boopers",
                  import: "from super import boopers",
                },
              ]],
            ])],
          ])],
        ]),
      },
    }
  },
  {
    name: "Fails to add new auto import setting if empty variable",
    settings: defaultSettings(),
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        "",
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
          validationMessage: {
            message: "Variable cannot be empty",
            severity: vscode.InputBoxValidationSeverity.Error,
          },
        },
      ],
    },
    workspaceConfiguration: {
      skip: false,
    }
  },
  {
    name: "Fails to add new auto import setting if invalid variable name",
    settings: defaultSettings(),
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        "some-name",
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
          validationMessage: {
            message: "Variable must be a valid Python identifier",
            severity: vscode.InputBoxValidationSeverity.Error,
          },
        },
      ],
    },
    workspaceConfiguration: {
      skip: false,
    }
  },
  {
    name: "Adds new auto import setting to existing list",
    settings: defaultSettings(),
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        "boopers",
        "from super import boopers",
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
        },
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for boopers",
            value: "from  import boopers",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    informationMessage: {
      expectedMessages: [
        'Successfully added import to auto-imports!',
      ],
    },
    workspaceConfiguration: {
      skip: false,
      workspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "else",
                  import: "from somewhere import else",
                },
              ]],
            ])],
          ])],
        ]),
      },
      expectedWorkspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "else",
                  import: "from somewhere import else",
                },
                {
                  variable: "boopers",
                  import: "from super import boopers",
                },
              ]],
            ])],
          ])],
        ]),
      },
    }
  },
  {
    name: "Overrides existing auto import setting",
    settings: defaultSettings(),
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        "boopers",
        "from super import boopers",
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
        },
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for boopers",
            value: "from  import boopers",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    informationMessage: {
      expectedMessages: [
        'Successfully added import to auto-imports!',
      ],
    },
    workspaceConfiguration: {
      skip: false,
      workspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "else",
                  import: "from somewhere import else",
                },
                {
                  variable: "boopers",
                  import: "from lame import boopers",
                },
              ]],
            ])],
          ])],
        ]),
      },
      expectedWorkspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "else",
                  import: "from somewhere import else",
                },
                {
                  variable: "boopers",
                  import: "from super import boopers",
                },
              ]],
            ])],
          ])],
        ]),
      },
    }
  },
  {
    name: "Adds auto import and sorts",
    settings: defaultSettings(),
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        "second",
        "from numbers import second",
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
        },
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for second",
            value: "from  import second",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    informationMessage: {
      expectedMessages: [
        'Successfully added import to auto-imports!',
      ],
    },
    workspaceConfiguration: {
      skip: false,
      workspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "third",
                  import: "from numbers import third",
                },
                {
                  variable: "first",
                  import: "from numbers import first",
                },
                {
                  variable: "else",
                  import: "from somewhere import else",
                },
                {
                  variable: "beta",
                  import: "from alpha import beta",
                },
              ]],
            ])],
          ])],
        ]),
      },
      expectedWorkspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "beta",
                  import: "from alpha import beta",
                },
                {
                  variable: "first",
                  import: "from numbers import first",
                },
                {
                  variable: "second",
                  import: "from numbers import second",
                },
                {
                  variable: "third",
                  import: "from numbers import third",
                },
                {
                  variable: "else",
                  import: "from somewhere import else",
                },
              ]],
            ])],
          ])],
        ]),
      },
    }
  },
  {
    name: "Adds auto import and sorts",
    settings: defaultSettings(),
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        "second",
        "from other import second",
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
        },
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for second",
            value: "from  import second",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    informationMessage: {
      expectedMessages: [
        'Successfully added import to auto-imports!',
      ],
    },
    workspaceConfiguration: {
      skip: false,
      workspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "beta",
                  import: "from alpha import beta",
                },
                {
                  variable: "first",
                  import: "from numbers import first",
                },
                {
                  variable: "second",
                  import: "from numbers import second",
                },
                {
                  variable: "third",
                  import: "from numbers import third",
                },
                {
                  variable: "else",
                  import: "from somewhere import else",
                },
              ]],
            ])],
          ])],
        ]),
      },
      expectedWorkspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "beta",
                  import: "from alpha import beta",
                },
                {
                  variable: "first",
                  import: "from numbers import first",
                },
                {
                  variable: "third",
                  import: "from numbers import third",
                },
                {
                  variable: "second",
                  import: "from other import second",
                },
                {
                  variable: "else",
                  import: "from somewhere import else",
                },
              ]],
            ])],
          ])],
        ]),
      },
    }
  },
  {
    name: "Adds auto import when editor but no undefined variables",
    settings: defaultSettings(),
    fileContents: [
      "from spain import uno",
      "from france import deux",
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    expectedText: [
      "from spain import uno",
      "from france import deux",
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
    ],
    inputBox: {
      inputBoxResponses: [
        "three",
        "from england import three",
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
        },
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for three",
            value: "from  import three",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    informationMessage: {
      expectedMessages: [
        'Successfully added import to auto-imports!',
      ],
    },
    workspaceConfiguration: {
      skip: false,
      expectedWorkspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "three",
                  import: "from england import three",
                },
              ]],
            ])],
          ])],
        ]),
      },
    }
  },
  // Tests for adding auto imports via quick pick
  {
    name: "No auto import added when quick pick is closed",
    settings: defaultSettings(),
    fileContents: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    expectedText: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
      new CloseQuickPickAction(),
    ],
    quickPick: {
      expectedQuickPicks: [
        [
          "deux",
          "uno",
          "Other...",
        ],
      ],
    },
    workspaceConfiguration: {
      skip: false,
    },
  },
  {
    name: "No auto import added when no quick pick selection is made",
    settings: defaultSettings(),
    fileContents: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    expectedText: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
      new SelectItemQuickPickAction([]),
    ],
    quickPick: {
      expectedQuickPicks: [
        [
          "deux",
          "uno",
          "Other...",
        ],
      ],
    },
    workspaceConfiguration: {
      skip: false,
    },
  },
  {
    name: "No auto import added and error message added when multiple quick pick selections made",
    settings: defaultSettings(),
    fileContents: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    expectedText: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
      new SelectItemQuickPickAction([
        "uno",
        "deux",
      ]),
    ],
    quickPick: {
      expectedQuickPicks: [
        [
          "deux",
          "uno",
          "Other...",
        ],
      ],
    },
    workspaceConfiguration: {
      skip: false,
    },
    errorMessage: {
      expectedMessages: [
        "Multiple selections made?!?!?",
      ],
    },
  },
  {
    name: "No auto import added if escape import statement input after quick pick selection",
    settings: defaultSettings(),
    fileContents: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    expectedText: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
      new SelectItemQuickPickAction([
        "uno",
      ]),
    ],
    inputBox: {
      inputBoxResponses: [
        undefined,
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for uno",
            value: "from  import uno",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    quickPick: {
      expectedQuickPicks: [
        [
          "deux",
          "uno",
          "Other...",
        ],
      ],
    },
    workspaceConfiguration: {
      skip: false,
    },
  },
  {
    name: "Auto import added if escape import statement input after quick pick selection",
    settings: defaultSettings(),
    fileContents: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    expectedText: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
      new SelectItemQuickPickAction([
        "uno",
      ]),
    ],
    inputBox: {
      inputBoxResponses: [
        "from spain import uno",
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for uno",
            value: "from  import uno",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    quickPick: {
      expectedQuickPicks: [
        [
          "deux",
          "uno",
          "Other...",
        ],
      ],
    },
    informationMessage: {
      expectedMessages: [
        'Successfully added import to auto-imports!',
      ],
    },
    workspaceConfiguration: {
      skip: false,
      expectedWorkspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "uno",
                  import: "from spain import uno",
                },
              ]],
            ])],
          ])],
        ]),
      },
    },
  },
  {
    name: "If other text is selected, then prompt for variable",
    settings: defaultSettings(),
    fileContents: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    expectedText: [
      "",
      "def func():",
      "    _ = uno",
      "    _ = deux",
      "",
    ],
    userInteractions: [
      cmd('very-import-ant.addAutoImport'),
      new SelectItemQuickPickAction([
        "Other...",
      ]),
    ],
    inputBox: {
      inputBoxResponses: [
        "three", // variable name
        "from england import three", // import statement
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Variable",
            validateInputProvided: true,
          },
        },
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for three",
            value: "from  import three",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    quickPick: {
      expectedQuickPicks: [
        [
          "deux",
          "uno",
          "Other...",
        ],
      ],
    },
    informationMessage: {
      expectedMessages: [
        'Successfully added import to auto-imports!',
      ],
    },
    workspaceConfiguration: {
      skip: false,
      expectedWorkspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "three",
                  import: "from england import three",
                },
              ]],
            ])],
          ])],
        ]),
      },
    },
  },
  {
    name: "Suggests undefined references across cells",
    settings: defaultSettings(),
    notebookContents: [
      {
        contents: [
          "def func():",
          "    _ = alpha",
        ],
        kind: 'code',
      },
      {
        // Markdown cell should be ignored
        contents: [
          "# This is markdown",
          "def func():",
          "    _ = beta",
        ],
        kind: 'markdown',
      },
      {
        contents: [
          "def func():",
          "    _ = delta",
        ],
        kind: 'code',
      },
    ],
    expectedText: [
      "# This is markdown",
      "def func():",
      "    _ = beta",
    ],
    userInteractions: [
      cmd('notebook.focusNextEditor'), // Should work even when we are in a markdown cell
      // expectedText only checks editor, not focused cell, so run this command to ensure we're in the markdown cell
      cmd('notebook.cell.edit'),
      cmd('very-import-ant.addAutoImport'),
      new SelectItemQuickPickAction(["delta"]),
    ],
    inputBox: {
      inputBoxResponses: [
        "from greece import delta", // import statement
      ],
      expectedInputBoxes: [
        {
          options: {
            title: "Import statement",
            prompt: "Enter the import statement for delta",
            value: "from  import delta",
            valueSelection: [5, 5],
            validateInputProvided: false,
          },
        },
      ],
    },
    quickPick: {
      expectedQuickPicks: [
        [
          "alpha",
          // No beta since it's in a markdown cell
          "delta",
          "Other...",
        ],
      ],
    },
    informationMessage: {
      expectedMessages: [
        'Successfully added import to auto-imports!',
      ],
    },
    workspaceConfiguration: {
      skip: false,
      expectedWorkspaceConfiguration: {
        configuration: new Map([
          [vscode.ConfigurationTarget.Global, new Map([
            ['very-import-ant', new Map([
              ['autoImports', [
                {
                  variable: "delta",
                  import: "from greece import delta",
                },
              ]],
            ])],
          ])],
        ]),
      },
    },
  },
  // Magic notebook commands
  {
    name: "Handles magic commands",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "pd",
          import: "import pandas as pd",
        },
      ],
    }),
    notebookContents: [
      {
        contents: [
          "%magic command",
          "",
          "def func():",
          "    _ = pd",
        ],
        kind: 'code',
      },
    ],
    expectedText: [
      "%magic command",
      "import pandas as pd",
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    expectedSelections: [sel(3, 0)],
    userInteractions: [
      formatDoc({
        notebook: true,
        containsText: "pandas",
      }),
    ],
  },
  {
    name: "Handles magic commands in previous cell",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "pd",
          import: "import pandas as pd",
        },
        {
          variable: "np",
          import: "import numpy as np",
        },
      ],
    }),
    notebookContents: [
      {
        contents: [
          "%magic command",
          "import pandas as pd",
          "",
        ],
        kind: 'code',
      },
      {
        contents: [
          "",
          "def func():",
          "    _ = pd",
          "    _ = np",
        ],
        kind: 'code',
      },
    ],
    expectedText: [
      "import numpy as np",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    _ = np",
    ],
    expectedSelections: [sel(2, 0)],
    userInteractions: [
      cmd('notebook.focusNextEditor'),
      formatDoc({
        notebook: true,
        containsText: "pandas",
      }),
    ],
  },
  {
    name: "Replaces multiple magic commands in previous cell",
    settings: defaultSettings({
      autoImports: [
        {
          variable: "pd",
          import: "import pandas as pd",
        },
        {
          variable: "np",
          import: "import numpy as np",
        },
      ],
    }),
    notebookContents: [
      {
        contents: [
          "%magic command",
          "%magic other",
          "import pandas as pd",
          "",
        ],
        kind: 'code',
      },
      {
        contents: [
          "%magic other",
          "",
          "def func():",
          "    _ = pd",
          "    _ = np",
        ],
        kind: 'code',
      },
    ],
    expectedText: [
      "%magic other",
      "import numpy as np",
      "",
      "",
      "def func():",
      "    _ = pd",
      "    _ = np",
    ],
    userInteractions: [
      cmd('notebook.focusNextEditor'),
      formatDoc({
        notebook: true,
        containsText: "pandas",
      }),
    ],
  },
  /* Useful for commenting out tests. */
];

class SettingsUpdate extends Waiter {

  private contents: any;
  private noOpValue: string;
  private initialized: boolean;

  constructor(contents: any, tcIdx: number) {
    super(5, () => {
      return vscode.workspace.getConfiguration('no-op').get('key') === this.noOpValue;
    }, 1000);

    this.contents = contents;
    this.initialized = false;
    this.noOpValue = `test-number-${tcIdx}`;
  }

  async do(): Promise<any> {
    if (!this.initialized) {
      this.initialized = true;
      const settingsFile = startingFile(".vscode", "settings.json");

      writeFileSync(settingsFile, JSON.stringify({
        ...this.contents,
        "no-op": {
          "key": this.noOpValue,
        },
      }, undefined, 2));
    }

    return super.do();
  }
}

suite('Extension Test Suite', () => {
  const requireSolo = testCases.some(tc => tc.runSolo);

  const filteredTests = testCases.filter((tc, idx) => idx === 0 || !requireSolo || tc.runSolo);

  filteredTests.forEach((tc, idx) => {

    test(`[${idx + 1} / ${filteredTests.length}]: ${tc.name}`, async () => {

      console.log(`========= Starting test: ${tc.name}`);

      if (tc.notebookContents) {
        writeFileSync(startingFile("simple.ipynb"), notebookText(tc.notebookContents));
        tc.userInteractions = [
          openTestWorkspaceFile("simple.ipynb"),
          _waitForDocChange(tc.notebookContents[0].contents.join("\n")),
          ...(tc.userInteractions || []),
        ];
      } else if (tc.fileContents) {
        const filename = !!tc.initFile ? "__init__.py" : "empty.py";
        writeFileSync(startingFile(filename), tc.fileContents.join("\n"));
        tc.file = startingFile(filename);
      }

      if (!tc.workspaceConfiguration) {
        tc.workspaceConfiguration = {
          skip: true,
        };
        tc.userInteractions = [
          new SettingsUpdate(tc.settings, idx),
          ...(tc.userInteractions || []),
        ];
      }

      // Run test
      await new SimpleTestCase(tc).runTest().catch((e: any) => {
        throw e;
      });
    });
  });
});

import { cmd, combineInteractions, delay, SimpleTestCase, SimpleTestCaseProps, UserInteraction, Waiter } from '@leep-frog/vscode-test-stubber';
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

function notebookText(text: string): string {
  return JSON.stringify({
    cells: [
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: text,
      },
    ],
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
    "very-import-ant.alwaysImport": config?.alwaysImport ?? [],
    "very-import-ant.ignoreSchemes": config?.ignoreSchemes ?? [],
    "very-import-ant.onTypeTriggerCharacters": config?.onTypeTriggerCharacters,
    "notebook.defaultFormatter": "groogle.very-import-ant",
    "notebook.formatOnCellExecution": true,
    "notebook.formatOnSave.enabled": true,
    ...opts,
  };
}

interface TestCase extends SimpleTestCaseProps {
  name: string;
  settings: any;
  fileContents: string[];
  runSolo?: boolean;
  notebook?: boolean;
}



const testCases: TestCase[] = [
  {
    name: "Fails if disabled",
    settings: defaultSettings({ enabled: false }),
    fileContents: [],
    userInteractions: [
      formatDoc(),
    ],
    expectedText: [""],
    errorMessage: {
      expectedMessages: [
        'The Very Import-ant formatter is not enabled! Set `very-import-ant.format.enable` to true in your VS Code settings',
      ],
    }
  },
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
    expectedSelections: [sel(1, 0)],
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
    expectedSelections: [sel(4, 10)],
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
    expectedSelections: [sel(9, 10)],
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
      `import numpy as np`,
      `from alphabet import tail as xyz`,
      `from france import deux`,
      `from france import un`,
      `from italy import wine`,
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
    expectedSelections: [sel(5, 19)],
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
    notebook: true,
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
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
    notebook: true,
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
    notebook: true,
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "",
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
    notebook: true,
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "",
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
    notebook: true,
    fileContents: [
      "from nunya import business",
      "",
      "def func():",
      "    _ = pd",
      "",
    ],
    userInteractions: [
      cmd("workbench.action.files.save"),
      _waitForDocChange("pandas"),
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
    expectedSelections: [sel(3, 0)],
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
    notebook: true,
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
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
    expectedSelections: [sel(3, 10)],
  },
  {
    name: "Format notebook if ignore scheme is removed (copy of previous test with ignoreScheme change)",
    settings: defaultSettings({
      ignoreSchemes: [],
    }),
    notebook: true,
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
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
    expectedSelections: [sel(4, 10)],
  },
  // TODO: untitled file tests (for both actual fixing and ignoring scheme
  // Probably will need to use new python file command to test this

  /* Useful for commenting out tests. */
];

class SettingsUpdate extends Waiter {

  private contents: any;
  private noOpValue: string;
  private initialized: boolean;

  constructor(contents: any, tcIdx: number) {
    super(5, () => {
      return vscode.workspace.getConfiguration('no-op').get('key') === this.noOpValue;
    });

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

  testCases.filter((tc, idx) => idx === 0 || !requireSolo || tc.runSolo).forEach((tc, idx) => {

    test(tc.name, async () => {

      console.log(`========= Starting test: ${tc.name}`);

      if (tc.notebook) {
        writeFileSync(startingFile("simple.ipynb"), notebookText(tc.fileContents.join("\n")));
        tc.userInteractions = [
          openTestWorkspaceFile("simple.ipynb"),
          _waitForDocChange(tc.fileContents.join("\n")),
          ...(tc.userInteractions || []),
        ];
      } else {
        writeFileSync(startingFile("empty.py"), tc.fileContents.join("\n"));
        tc.file = startingFile("empty.py");
      }
      tc.workspaceConfiguration = {
        skip: true,
      };
      tc.userInteractions = [
        new SettingsUpdate(tc.settings, idx),
        ...(tc.userInteractions || []),
      ];

      // Run test
      await new SimpleTestCase(tc).runTest().catch((e: any) => {
        throw e;
      });
    });
  });
});

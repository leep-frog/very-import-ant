import { cmd, combineInteractions, delay, SimpleTestCase, SimpleTestCaseProps, UserInteraction, Waiter, WorkspaceConfiguration } from '@leep-frog/vscode-test-stubber';
import { writeFileSync } from 'fs';
import path from 'path';
import * as vscode from 'vscode';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as myExtension from '../../extension';

function startingFile(filename: string) {
  return path.resolve(__dirname, "..", "..", "src", "test", "test-workspace", filename);
}

function sel(line: number, char: number): vscode.Selection {
  return new vscode.Selection(line, char, line, char);
}

function writeText(contents: string[]): UserInteraction {

  const waiter = new Waiter(10, () => {
    return vscode.window.activeTextEditor?.document.getText() === contents.join("\n");
  });
  return combineInteractions(
    cmd("cursorDownSelect"),
    cmd("deleteLeft"),
    cmd("type", { text: contents.join("\n") }),
    waiter,
  );
}

const FORMAT_DELAY = delay(250);

const FORMAT_DOC = combineInteractions(
  // TODO: determine what this actually needs to wait for (apparently waiter above is not sufficient)
  FORMAT_DELAY,
  cmd("editor.action.formatDocument"),
);

function defaultConfig(enabled?: boolean): WorkspaceConfiguration {
  return {
    configuration: new Map<vscode.ConfigurationTarget, Map<string, any>>([
      [vscode.ConfigurationTarget.Global, new Map<string, any>([
        ["files", new Map<string, any>([
          ["eol", "\n"],
        ])],
        ["very-import-ant", new Map<string, any>([
          ["format", new Map<string, any>([
            ["enable", enabled ?? true],
          ])],
          ["onTypeTriggerCharacters", "\ndp"],
          // TODO: vscode-test-stubber with configuration defaults?
          ["autoImports", [
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
              variable: "xrt",
              import: "from xarray import testing as xrt",
            },
            {
              variable: "alpha",
              import: "from greece import a as alpha",
            },
            {
              variable: "beta",
              import: "from greece import b as beta",
            },
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
          ]],
        ])],
      ])],
    ]),
    languageConfiguration: new Map<string, Map<vscode.ConfigurationTarget, Map<string, any>>>([
      ["python", new Map<vscode.ConfigurationTarget, Map<string, any>>([
        [vscode.ConfigurationTarget.Global, new Map<string, any>([
          ["editor", new Map<string, any>([
            ["defaultFormatter", "groogle.very-import-ant"],
            ["formatOnType", "true"],
          ])],
        ])],
      ])],
    ]),
  };
}

interface TestCase {
  name: string;
  fileContents: string[];
  stc: SimpleTestCaseProps;
  runSolo?: boolean;
}



const testCases: TestCase[] = [
  {
    name: "Fails if disabled",
    fileContents: [],
    stc: {
      userInteractions: [
        FORMAT_DOC,
      ],
      expectedText: [""],
      workspaceConfiguration: defaultConfig(false),
      expectedErrorMessages: [
        'The Very Import-ant formatter is not enabled! Set `very-import-ant.format.enable` to true in your VS Code settings',
      ],
    },
  },
  {
    name: "Handles empty file",
    fileContents: [],
    stc: {
      userInteractions: [
        FORMAT_DOC,
      ],
      expectedText: [""],
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Ignores unsupported undefined variable name",
    fileContents: [
      "def func():",
      "    _ = idk",
    ],
    stc: {
      userInteractions: [
        FORMAT_DOC,
      ],
      expectedText: [
        "def func():",
        "    _ = idk",
      ],
      workspaceConfiguration: defaultConfig(),
      expectedSelections: [sel(1, 11)],
    },
  },
  {
    name: "Adds import for single supported variable when indentation is included",
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    stc: {
      userInteractions: [
        FORMAT_DOC,
      ],
      expectedText: [
        "import pandas as pd",
        "",
        "",
        "def func():",
        "    _ = pd",
      ],
      expectedSelections: [sel(4, 10)],
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Adds import when module doc included",
    fileContents: [
      `"""Some docstring."""`,
      "",
      "def func():",
      "    _ = pd",
    ],
    stc: {
      userInteractions: [
        FORMAT_DOC,
      ],
      expectedText: [
        `"""Some docstring."""`,
        "import pandas as pd",
        "",
        "",
        "def func():",
        "    _ = pd",
      ],
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Adds import for single supported variable",
    fileContents: [
      "def func():",
      "    _ = pd",
    ],
    stc: {
      userInteractions: [
        FORMAT_DOC,
      ],
      expectedText: [
        "import pandas as pd",
        "",
        "",
        "def func():",
        "    _ = pd",
      ],
      expectedSelections: [sel(3, 0)],
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Adds single import for multiple undefined refs",
    fileContents: [
      "def func():",
      "    _ = pd",
      "    df = pd.DataFrame",
    ],
    stc: {
      userInteractions: [
        FORMAT_DOC,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Imports all built-in imports",
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
    stc: {
      userInteractions: [
        FORMAT_DOC,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Adds auto-imports from settings",
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
    stc: {
      userInteractions: [
        FORMAT_DOC,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Recurs to fix import order for imports from same source",
    fileContents: [
      "def func():",
      "    _ = alpha",
      "    k = beta + 2",
      "    return beta - alpha",
    ],
    stc: {
      userInteractions: [
        FORMAT_DOC,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Adds import to list",
    fileContents: [
      "from greece import b as beta",
      "",
      "def func():",
      "    _ = alpha",
      "    k = beta + 2",
      "    return beta - alpha",
    ],
    stc: {
      userInteractions: [
        FORMAT_DOC,
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
      // expectedSelections: [sel(3, 0)],
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Recurs with multiple imports",
    fileContents: [
      "def func():",
      "    _ = alpha",
      "    k = beta + 2",
      "    np.array(alpha, beta)",
      "    xr.DataArray(alpha, beta)",
      "    return beta - alpha",
    ],
    stc: {
      userInteractions: [
        FORMAT_DOC,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Works with multiple values for single alias",
    fileContents: [
      "def func():",
      "    _ = multi",
    ],
    stc: {
      userInteractions: [
        FORMAT_DOC,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Formats onType for first of more_trigger_characters",
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    ",
    ],
    stc: {
      selections: [sel(4, 4)],
      userInteractions: [
        cmd("type", { text: "d" }),
        FORMAT_DELAY,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    // Note, this test is after the more_trigger_characters because we want
    // to confirm that any character (not just first_trigger_character)
    // will trigger formatting first (i.e. trigger works if the "first trigger character" typed
    // is contained in "more_trigger_characters")
    name: "Formats onType for first_trigger_character",
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
    ],
    stc: {
      selections: [sel(3, 10)],
      userInteractions: [
        cmd("type", { text: "\n" }),
        FORMAT_DELAY,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Formats onType for second of more_trigger_characters",
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    ",
    ],
    stc: {
      selections: [sel(4, 4)],
      userInteractions: [
        cmd("type", { text: "d" }),
        FORMAT_DELAY,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Formats onType and includes newly added undefined variable",
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    n",
    ],
    stc: {
      selections: [sel(4, 5)],
      userInteractions: [
        cmd("type", { text: "p" }),
        FORMAT_DELAY,
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
      workspaceConfiguration: defaultConfig(),
    },
  },
  {
    name: "Does not format onType if not a trigger character",
    fileContents: [
      "",
      "",
      "def func():",
      "    _ = pd",
      "    x",
    ],
    stc: {
      selections: [sel(4, 5)],
      userInteractions: [
        cmd("type", { text: "r" }),
        FORMAT_DELAY,
      ],
      expectedText: [
        "",
        "",
        "def func():",
        "    _ = pd",
        "    xr",
      ],
      expectedSelections: [sel(4, 6)],
      workspaceConfiguration: defaultConfig(),
    },
  },
];

suite('Extension Test Suite', () => {
  const requireSolo = testCases.some(tc => tc.runSolo);

  testCases.filter(tc => !requireSolo || tc.runSolo).forEach(tc => {

    test(tc.name, async () => {

      console.log(`========= Starting test: ${tc.name}`);

      writeFileSync(startingFile("empty.py"), tc.fileContents.join("\n"));

      // Add reset command
      tc.stc.file = startingFile("empty.py");
      tc.stc.userInteractions = [
        cmd("very-import-ant.testReset"),
        ...(tc.stc.userInteractions || []),
      ];

      // Run test
      await new SimpleTestCase(tc.stc).runTest().catch((e: any) => {
        throw e;
      });
    });
  });
});

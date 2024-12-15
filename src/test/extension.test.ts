import { cmd, combineInteractions, delay, SimpleTestCase, SimpleTestCaseProps, UserInteraction } from '@leep-frog/vscode-test-stubber';
import { writeFileSync } from 'fs';
import path from 'path';
import * as vscode from 'vscode';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as myExtension from '../../extension';

function startingFile(...filename: string[]) {
  return path.resolve(__dirname, "..", "..", "src", "test", "test-workspace", path.join(...filename));
}

function sel(line: number, char: number): vscode.Selection {
  return new vscode.Selection(line, char, line, char);
}

const FORMAT_DELAY = delay(100);

const FORMAT_DOC = combineInteractions(
  // TODO: determine what this actually needs to wait for (apparently waiter above is not sufficient)
  FORMAT_DELAY,
  cmd("editor.action.formatDocument"),
);

interface VeryImportConfig {
  onTypeTriggerCharacters?: string;
  enabled?: boolean;
  undefinedAutoImports?: boolean;
  autoImports?: {
    variable: string;
    import: string;
  }[],
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
      "editor.defaultFormatter": "groogle.very-import-ant",
    },
    "files.eol": "\n",
    "very-import-ant.format.enable": config?.enabled ?? true,
    "very-import-ant.onTypeTriggerCharacters": config?.onTypeTriggerCharacters,
    ...opts,
  };
}

interface TestCase {
  name: string;
  settings: any;
  fileContents: string[];
  stc: SimpleTestCaseProps;
  runSolo?: boolean;
}



const testCases: TestCase[] = [
  {
    name: "Fails if disabled",
    settings: defaultSettings({ enabled: false }),
    fileContents: [],
    stc: {
      userInteractions: [
        FORMAT_DOC,
      ],
      expectedText: [""],
      expectedErrorMessages: [
        'The Very Import-ant formatter is not enabled! Set `very-import-ant.format.enable` to true in your VS Code settings',
      ],
    },
  },
  {
    name: "Handles empty file",
    settings: defaultSettings(),
    fileContents: [],
    stc: {
      userInteractions: [
        FORMAT_DOC,
      ],
      expectedText: [""],
    },
  },
  {
    name: "Ignores unsupported undefined variable name",
    settings: defaultSettings(),
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
      expectedSelections: [sel(1, 11)],
    },
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
    },
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
    },
  },
  {
    name: "Adds import for single supported variable",
    settings: defaultSettings(),
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
    },
  },
  {
    name: "Adds single import for multiple undefined refs",
    settings: defaultSettings(),
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
    },
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
    },
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
    },
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
    },
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
    },
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
    },
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
    },
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

    },
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
    },
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
    stc: {
      selections: [sel(4, 4)],
      userInteractions: [
        cmd("type", { text: "f" }),
        FORMAT_DELAY,
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
    },
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
    },
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
    },
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
    },
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
    },
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
    stc: {
      selections: [sel(4, 5)],
      userInteractions: [
        cmd("type", { text: "r" }),
        FORMAT_DELAY,
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
      expectedSelections: [sel(1, 0)],
    },
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
    stc: {
      userInteractions: [
        FORMAT_DOC,
      ],
      expectedText: [
        "",
        "",
        "def func():",
        "    _ = np",
      ],
      expectedErrorMessages: [
        `Failed to create import config: Error: Error: Expected ',', found name at byte range 13..15`,
      ],
    },
  },
  // Import spacing tests
  {
    name: "Catches invalid import rule if used",
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
    stc: {
      userInteractions: [
        FORMAT_DOC,
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
  },
];

class SettingsUpdate implements UserInteraction {

  private contents: any;

  constructor(contents: any) {
    this.contents = contents;
  }

  async do(): Promise<any> {
    const settingsFile = startingFile(".vscode", "settings.json");
    writeFileSync(settingsFile, JSON.stringify(this.contents, undefined, 2));
  }
}

suite('Extension Test Suite', () => {
  const requireSolo = testCases.some(tc => tc.runSolo);

  testCases.filter((tc, idx) => idx === 0 || !requireSolo || tc.runSolo).forEach((tc, idx) => {

    test(tc.name, async () => {

      console.log(`========= Starting test: ${tc.name}`);

      writeFileSync(startingFile("empty.py"), tc.fileContents.join("\n"));

      // Add reset command
      tc.stc.file = startingFile("empty.py");
      tc.stc.skipWorkspaceConfiguration = true;
      tc.stc.userInteractions = [
        new SettingsUpdate(tc.settings),
        delay(500),
        ...(tc.stc.userInteractions || []),
      ];

      // Run test
      await new SimpleTestCase(tc.stc).runTest().catch((e: any) => {
        throw e;
      });
    });
  });
});

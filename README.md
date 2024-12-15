# Very Import-ant (Fast, Customizable Auto-Imports)

> TODO: Add a gif of this in action (vs language server flow)

Existing Python language servers implement auto-importing, but with a few drawbacks:

1. The auto-import functionality requires the language server to
create a drop-down, which occasionally takes a while to load (frequently
it would have been quicker to just add the import line myself).

1. The user has to accept a selection from the drop-down, which is an interruption
to the coding flow (albeit a somewhat small one, but one nonetheless).

1. Most (all?) of the existing Python language servers for VS Code
(specifically Pylance) don't allow customizing auto-import aliases.
Instead they only support a fixed set of ones (e.g. `pd` for pandas, `np` for
numpy, etc.).

This extension aims to solve all of the above problems by providing
functionality to automatically add imports while you are typing,
without any interruption to your development flow.

## Setup

1. Install this extension

1. Add the following to your `settings.json`:
```json
{
  "[python]": {
    "editor.defaultFormatter": "groogle.very-import-ant",

    // If you want the imports to be added as you type
    "editor.formatOnType": true,
    // If you want the imports to be added only when you save the file
    "editor.formatOnSave": true,
    // If you want the imports to be added whenever you paste something into your editor
    "editor.formatOnPaste": true,
  },

  // If editor.formatOnType is true, these characters will be all characters
  // that trigger an import check/addition. It is recommended to make this
  // whitespace characters + the last letters of all imported variables
  // in the autoImports.variables setting (see below).
  "very-import-ant.onTypeTriggerCharacters": "\n \tdprt",

  // Add the following setting if you want to specify your own list
  // of auto-import variables.
  // The ones included below are all include by default.
  "very-import-ant.autoImports": [
    {
      "variable": "pd",
      "import": "import pandas as pd"
    },
    {
      "variable": "np",
      "import": "import numpy as np"
    },
    {
      "variable": "xr",
      "import": "import xarray as xr"
    },
    {
      "variable": "xrt",
      "import": "from xarray import testing as xrt"
    }
  ],
}
```

> This repository was initialized from the [vscode-python-tools-extension-template](https://github.com/microsoft/vscode-python-tools-extension-template).

# Very Import-ant (Fast, Customizable Auto-Imports)

<!-- TODO: Add a gif of this in action (vs language server flow) -->

Existing Python language servers implement auto-importing, but with a few drawbacks:

1. The auto-import functionality requires the language server to
create a drop-down, which occasionally takes a while to load (frequently
it would have been quicker to just add the import line myself).

1. The user has to accept a selection from the drop-down, which is
an interruption to the coding flow (albeit a somewhat small one).

1. Most (all?) of the existing Python language servers for VS Code
(specifically Pylance) don't allow customizing auto-import aliases.
Instead they only support a fixed set of ones (`pd` for pandas, `np` for
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
  },

  // Add the following setting if you want to specify your own list
  // of auto-import variables.
  // The ones included below are all include by default.
  "groogle.very-import-ant.auto-imports": [
    "import pandas as pd",
    "import numpy as np",
    "import xarray as xr",
    "from xarray import testing as xrt",
  ],
}
```

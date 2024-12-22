# Troubleshooting

## <a name="editor.formatOnType"></a>`editor.formatOnType` Not Working

### TLDR Cause

The [Pylance extension](https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance) occasionally gets picked for on-type formatting instead of this extension.

### Fix

To fix, simply set the below Pylance settings which will remove Pylance
from on-type formatting candidates:

```json
{
  "python.analysis.autoIndent": false,
  // This setting defaults to false so you don't need to set this
  // if you haven't set it to true elsewhere.
  "python.analysis.autoFormatStrings": false,
}
```

### Cause

According to [the documentation for on-type formatters](https://code.visualstudio.com/api/references/vscode-api#languages.registerOnTypeFormattingEditProvider), "Multiple providers can be registered for a language. In that case providers are sorted by their score".

Basically, Pylance provides an `onType` formatter and so does this extensions. Ultimately, the "score" for both extensions is the same, so sometimes Pylance wins and sometimes this extension wins.

import * as vscode from 'vscode';

export function merge(edits: vscode.TextEdit[]): vscode.TextEdit[] {
  // Sort by start position (and then by end position if those are the same).
  edits.sort((editA, editB): number => {
    const startCmp = editA.range.start.compareTo(editB.range.start);
    if (startCmp) {
      return startCmp;
    }

    return editA.range.end.compareTo(editB.range.end);
  });

  if (edits.length === 0) {
    return [];
  }

  const mergedEdits: vscode.TextEdit[] = [
    edits[0],
  ];

  // Iterate over the provided edits and merge overlapping ones
  for (const edit of edits.slice(1)) {
    const lastEdit = mergedEdits[mergedEdits.length - 1];

    // We only need to check against the last one since we sort by start.
    const intersection = edit.range.intersection(lastEdit.range);
    if (intersection) {
      // If they intersect, then just stick them together.
      mergedEdits[mergedEdits.length - 1] = {
        newText: lastEdit.newText + edit.newText,
        range: edit.range.union(lastEdit.range),
      };
    } else {
      mergedEdits.push(edit);
    }
  }

  return mergedEdits;
}

import * as vscode from 'vscode';

export function merge(edits: vscode.TextEdit[]): vscode.TextEdit[] {
  // Sort by start position
  edits.sort((editA, editB): number => {
    const startA = editA.range.start;
    const startB = editB.range.start;
    return startA.compareTo(startB);
  });

  if (edits.length === 0) {
    return [];
  }

  const lastEdit = edits[0];
  const mergedEdits: vscode.TextEdit[] = [
    lastEdit,
  ];

  // Iterate over the provided edits and merge overlapping ones
  for (const edit of edits.slice(1)) {

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

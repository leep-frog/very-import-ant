import * as vscode from 'vscode';

export function merge(edits: vscode.TextEdit[]): vscode.TextEdit[] {
  if (edits.length <= 1) {
    return edits;
  }

  // Sort by start position (and then by end position if those are the same).
  edits.sort((editA, editB): number => {
    const startCmp = editA.range.start.compareTo(editB.range.start);
    if (startCmp) {
      return startCmp;
    }

    const rangeCmp = editA.range.end.compareTo(editB.range.end);
    if (rangeCmp) {
      return rangeCmp;
    }

    return editA.newText < editB.newText ? -1 : 1;
  });


  const mergedEdits: vscode.TextEdit[] = [
    edits[0],
  ];

  // Iterate over the provided edits and merge overlapping ones
  for (const edit of edits.slice(1)) {
    const lastEdit = mergedEdits.at(-1)!;

    // Skip any edits that are equal
    // Note: this fixed a pretty annoying issue (if two unused imports in
    // the same statement (`from p import one, two, three` and only use `one`).
    // If other issues cause similar problems, maybe need a different solution (see comment in intersect block below)
    if (editsEqual(lastEdit, edit)) {
      continue;
    }

    // We only need to check against the last one since we sort by start.
    if (intersect(edit, lastEdit)) {
      // If they intersect, then just stick them together.
      // IMPORTANT NOTE: If we keep encountering issues, we can update our strategy
      // to simply skip edits that intersect with the previous edit. That way, we
      // still can run multiple intersections per ruff execution, but remove the chance for issues.
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

function editsEqual(editA: vscode.TextEdit, editB: vscode.TextEdit): boolean {
  return editA.range.isEqual(editB.range) && editA.newText === editB.newText && editA.newEol === editB.newEol;
}

function intersect(editA: vscode.TextEdit, editB: vscode.TextEdit) {
  const intersection = editA.range.intersection(editB.range);

  // Only consider it an intersection if the overlap is a non-empty range
  return !!intersection && !(intersection.isEmpty);
}

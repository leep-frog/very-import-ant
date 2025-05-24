import * as vscode from 'vscode';

export function disjointEdits(edits: vscode.TextEdit[]): vscode.TextEdit[] {
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


  const nonOverlappingEdits: vscode.TextEdit[] = [
    edits[0],
  ];

  // Iterate over the provided edits and skip overlapping ones
  for (const edit of edits.slice(1)) {
    const lastEdit = nonOverlappingEdits.at(-1)!;

    // Note: checking editsEqual fixed a pretty annoying issue (if two unused imports in
    // the same statement (`from p import one, two, three` and only use `one`).
    //
    // For overlapping edits, we used to try to intelligently merge them,
    // but sporadic issues kept popping up, decided to just skip edits
    // (for loop of edits will ensure the edit is still applied in the next go).
    if (editsEqual(edit, lastEdit) || intersect(edit, lastEdit)) {
      continue;
    } else {
      nonOverlappingEdits.push(edit);
    }
  }

  return nonOverlappingEdits;
}

function editsEqual(editA: vscode.TextEdit, editB: vscode.TextEdit): boolean {
  return editA.range.isEqual(editB.range) && editA.newText === editB.newText && editA.newEol === editB.newEol;
}

function intersect(editA: vscode.TextEdit, editB: vscode.TextEdit) {
  const intersection = editA.range.intersection(editB.range);

  // Only consider it an intersection if the overlap is a non-empty range
  return !!intersection && !(intersection.isEmpty);
}

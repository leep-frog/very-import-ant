// import { diffChars, diffLines } from 'diff';
import * as vscode from 'vscode';

export function generateAmbiguousEdits(document: vscode.TextDocument, modified: string): vscode.TextEdit[] {
  // These methods produce the proper transformations, but were producing suboptimal cursor movements.
  // I kept them around because they were fun to implement and may be useful in the future.
  // but I uninstalled the 'diff' package to save memory and reduce dependencies.

  // return diffEditsByLine(document, modified);
  // return diffEditsByCharacter(document, modified);

  return [{
    range: new vscode.Range(0, 0, document.lineCount, 0),
    newText: modified,
  }];
}


/*function diffEditsByLine(document: vscode.TextDocument, modified: string): vscode.TextEdit[] {
  const edits: vscode.TextEdit[] = [];
  const diff = diffLines(document.getText(), modified);
  let currentLine = 0;

  for (const part of diff) {
    if (part.added) {
      // Added text
      const pos = new vscode.Position(currentLine, 0);
      edits.push(vscode.TextEdit.insert(pos, part.value));
    } else if (part.removed) {
      const start = new vscode.Position(currentLine, 0);
      const end = new vscode.Position(currentLine + part.count, 0);
      edits.push(vscode.TextEdit.delete(new vscode.Range(start, end)));
      currentLine += part.count;
    } else {
      currentLine += part.count;
    }
  }

  return edits;
}


function diffEditsByCharacter(document: vscode.TextDocument, modified: string): vscode.TextEdit[] {
  const original = document.getText();
  const lineBreakPositions = [0];
  for (let i = 0; i < original.length; i++) {
    if (original[i] === '\n') {
      lineBreakPositions.push(i + 1);
    }
  }

  const edits: vscode.TextEdit[] = [];
  const diff = diffChars(original, modified);

  let characterPos = 0;
  let virtualLinePos = 0;
  let virtualCharPos = 0;

  for (const part of diff) {
    if (part.added) {
      // Added text
      const pos = new vscode.Position(virtualLinePos, virtualCharPos);
      edits.push(vscode.TextEdit.insert(pos, part.value));
      continue;
    }

    const start = new vscode.Position(virtualLinePos, virtualCharPos);

    characterPos += part.count;
    while (characterPos >= lineBreakPositions[virtualLinePos + 1]) {
      virtualLinePos++;
    }
    virtualCharPos = characterPos - lineBreakPositions[virtualLinePos];

    const end = new vscode.Position(virtualLinePos, virtualCharPos);

    if (part.removed) {
      edits.push(vscode.TextEdit.delete(new vscode.Range(start, end)));
    }
  }

  return edits;
}*/

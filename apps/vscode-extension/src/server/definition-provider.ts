import { Location, Range, TextDocumentPositionParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { WorkspaceIndex } from './workspace-index.js';

export function getDefinition(params: TextDocumentPositionParams, document: TextDocument, index: WorkspaceIndex): Location | null {
  const word = getWordAtPosition(document, params.position.line, params.position.character);
  if (!word) return null;

  // Look up model by name
  const modelEntry = index.getModel(word);
  if (modelEntry) {
    const line = Math.max(0, modelEntry.line - 1);
    return {
      uri: modelEntry.uri,
      range: Range.create(line, 0, line, word.length),
    };
  }

  return null;
}

function getWordAtPosition(document: TextDocument, line: number, character: number): string | null {
  const text = document.getText();
  const lines = text.split('\n');
  if (line >= lines.length) return null;

  const lineText = lines[line]!;
  if (character >= lineText.length) return null;

  // Find word boundaries
  let start = character;
  while (start > 0 && /[a-zA-Z0-9_$]/.test(lineText[start - 1]!)) {
    start--;
  }
  let end = character;
  while (end < lineText.length && /[a-zA-Z0-9_$]/.test(lineText[end]!)) {
    end++;
  }

  if (start === end) return null;
  return lineText.slice(start, end);
}

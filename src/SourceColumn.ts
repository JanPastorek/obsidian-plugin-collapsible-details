/**
 * Finds where in a source line the caret belongs, given the rendered text that sits
 * before the click.
 *
 * Rendered text is not the source: `**bold**` arrives as `bold`, a link as its label
 * alone. So the rendered prefix is matched against the source as a *subsequence* --
 * every rendered character must appear in order, and everything skipped over is
 * markup. Walking `[janpastorek.com](https://…)` for the prefix `janpastorek.com`
 * lands inside the brackets, which is where the text actually is.
 *
 * Returns 0 when the prefix cannot be traced, so a click always lands somewhere
 * sensible on the right line rather than nowhere.
 */
export function columnForRenderedPrefix(sourceLine: string, renderedPrefix: string): number {
  const wanted = renderedPrefix.replace(/\s+/g, " ").trimStart();
  if (wanted === "") {
    return leadingMarkupWidth(sourceLine);
  }

  let sourceIndex = 0;
  let wantedIndex = 0;
  while (sourceIndex < sourceLine.length && wantedIndex < wanted.length) {
    if (matches(sourceLine[sourceIndex], wanted[wantedIndex])) {
      wantedIndex++;
    }
    sourceIndex++;
  }
  // A partial match means the prefix spilled in from markup we cannot see; the start
  // of the line's content is a better guess than a position two thirds through it.
  return wantedIndex === wanted.length ? sourceIndex : leadingMarkupWidth(sourceLine);
}

function matches(source: string, rendered: string): boolean {
  if (source === rendered) {
    return true;
  }
  // Collapsed runs of whitespace, and the typographic substitutions Markdown makes.
  return /\s/.test(source) && rendered === " ";
}

/** The offset past a line's leading indent, list marker or heading hashes. */
function leadingMarkupWidth(sourceLine: string): number {
  return sourceLine.match(/^(\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?)/)?.[1].length ?? 0;
}

/** Absolute line numbers of the top-level list items in a block, in document order. */
export function topLevelListItemLines(
  blockLines: readonly string[],
  blockStartLine: number
): number[] {
  const marker = /^ {0,3}(?:[-*+]|\d+[.)])\s/;
  const lines: number[] = [];
  for (let i = 0; i < blockLines.length; i++) {
    if (marker.test(blockLines[i])) {
      lines.push(blockStartLine + i);
    }
  }
  return lines;
}

import { HtmlBlockNode } from "./BlockTree";

/**
 * The blocks actually shown as rendered output, given which ones are being edited.
 *
 * A block the cursor is inside stays as source, but its children are still candidates
 * — that recursion is what keeps one styling wrapper around a whole note from making
 * the note all-or-nothing. Both the decorations and the caret motion are derived from
 * this same list, so what you can arrow into is exactly what you can see.
 */
export function selectRenderedBlocks(
  nodes: readonly HtmlBlockNode[],
  isEdited: (startLine: number, endLine: number) => boolean
): HtmlBlockNode[] {
  const rendered: HtmlBlockNode[] = [];
  for (const node of nodes) {
    if (isEdited(node.range.startLine, node.range.endLine)) {
      rendered.push(...selectRenderedBlocks(node.children, isEdited));
    } else {
      rendered.push(node);
    }
  }
  return rendered;
}

/**
 * The block that pressing Down from `cursorLine` should step into.
 *
 * CodeMirror skips a replaced block entirely, because none of its lines are on
 * screen to land on. Moving the caret onto the block's first line instead reveals
 * its source, which is the only place there is to edit.
 */
export function blockBelow(
  rendered: readonly HtmlBlockNode[],
  cursorLine: number
): HtmlBlockNode | null {
  return rendered.find((node) => node.range.startLine === cursorLine + 1) ?? null;
}

/** The block that pressing Up from `cursorLine` should step into, entering at its last line. */
export function blockAbove(
  rendered: readonly HtmlBlockNode[],
  cursorLine: number
): HtmlBlockNode | null {
  return rendered.find((node) => node.range.endLine === cursorLine - 1) ?? null;
}

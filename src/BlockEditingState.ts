/** A selection range reduced to what the render decision needs. */
export interface SelectionSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * Decides whether a block should show its raw source instead of rendered output.
 *
 * Pure and dependency-free so it can be tested without an editor: the rule is the
 * whole of Live Preview's cursor-awareness, and it is easy to get the edges wrong.
 * Touching an edge counts as editing — a cursor resting on the opening or closing
 * tag line belongs to someone about to change that line.
 */
export function isBeingEdited(
  selection: readonly SelectionSpan[],
  from: number,
  to: number
): boolean {
  return selection.some((range) => range.from <= to && range.to >= from);
}

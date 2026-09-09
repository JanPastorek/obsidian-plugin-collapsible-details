import { HtmlBlockRange, HtmlBlockRangeScanner } from "./HtmlBlockRangeScanner";

/** A container block and the container blocks directly inside its body. */
export interface HtmlBlockNode {
  /** Line range in the *whole* document, not relative to any parent. */
  readonly range: HtmlBlockRange;
  readonly children: readonly HtmlBlockNode[];
}

/**
 * Builds the full nesting tree of container blocks.
 *
 * The scanner deliberately reports only outermost ranges, because that is what
 * Reading view's section machinery needs. But real notes wrap containers in
 * containers — a styling `<div>` around the whole note, sections inside it — and
 * treating such a note as one flat block leaves every inner container's Markdown
 * unparsed. Both views walk this tree instead: rendering descends it, and the
 * editor uses it to decide which single block the cursor is really in.
 */
export class BlockTree {
  static build(
    lines: readonly string[],
    supportedTags: ReadonlySet<string>,
    lineOffset = 0
  ): HtmlBlockNode[] {
    const ranges = HtmlBlockRangeScanner.scan(lines.join("\n"), supportedTags);
    return ranges.map((range) => {
      // Recurse over the body only: re-scanning the tag lines would rediscover
      // this same block forever.
      const bodyStart = range.startLine + 1;
      const bodyLines = lines.slice(bodyStart, range.endLine);
      return {
        range: {
          tag: range.tag,
          startLine: range.startLine + lineOffset,
          endLine: range.endLine + lineOffset,
        },
        children: BlockTree.build(bodyLines, supportedTags, lineOffset + bodyStart),
      };
    });
  }
}

import { HtmlTagPatterns } from "./HtmlTagPatterns";

/** Inclusive 0-indexed line range of a supported `<tag>...</tag>` container block. */
export interface HtmlBlockRange {
  readonly tag: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Scans full raw note text for supported container block ranges.
 *
 * Needed because Obsidian ends an HTML block at the first blank line, splitting a
 * block with blank-line bodies across multiple render sections; the ranges let the
 * post-processor re-assemble the block from source (req.md Phase 1.5).
 *
 * Rules: tags count only on their own lines; tags inside fenced code are ignored;
 * nesting of the *same* tag is tracked so the outer range extends to its matching
 * close; an unclosed opening yields no range and scanning resumes on the next line,
 * so a later well-formed block still renders.
 */
export class HtmlBlockRangeScanner {
  static scan(text: string, supportedTags: ReadonlySet<string>): HtmlBlockRange[] {
    if (supportedTags.size === 0) {
      return [];
    }
    const lines = text.split("\n");
    const inFence = HtmlBlockRangeScanner.computeFenceMask(lines);
    const ranges: HtmlBlockRange[] = [];
    let i = 0;
    while (i < lines.length) {
      const opening = inFence[i]
        ? null
        : HtmlTagPatterns.matchOpening(lines[i], supportedTags);
      if (opening !== null) {
        const endLine = HtmlBlockRangeScanner.findMatchingClose(
          lines,
          inFence,
          i,
          opening.tag,
          supportedTags
        );
        if (endLine !== -1) {
          ranges.push({ tag: opening.tag, startLine: i, endLine });
          i = endLine + 1;
          continue;
        }
      }
      i++;
    }
    return ranges;
  }

  /**
   * Line index of the close matching the opening at `openLine`, or -1 if unclosed.
   * Only tags of the same name change depth: a `</div>` inside a `<details>` block
   * is body content, not a boundary.
   */
  private static findMatchingClose(
    lines: string[],
    inFence: boolean[],
    openLine: number,
    tag: string,
    supportedTags: ReadonlySet<string>
  ): number {
    let depth = 1;
    for (let j = openLine + 1; j < lines.length; j++) {
      if (inFence[j]) {
        continue;
      }
      if (HtmlTagPatterns.matchOpening(lines[j], supportedTags)?.tag === tag) {
        depth++;
      } else if (HtmlTagPatterns.matchClosing(lines[j], supportedTags) === tag) {
        depth--;
        if (depth === 0) {
          return j;
        }
      }
    }
    return -1;
  }

  /** True for lines inside (or delimiting) a fenced code block, so tags there are ignored. */
  private static computeFenceMask(lines: string[]): boolean[] {
    const mask = new Array<boolean>(lines.length);
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (HtmlTagPatterns.FENCE_DELIMITER_LINE.test(lines[i])) {
        mask[i] = true;
        inFence = !inFence;
      } else {
        mask[i] = inFence;
      }
    }
    return mask;
  }
}

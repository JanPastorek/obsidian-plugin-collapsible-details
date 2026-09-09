import { HtmlTagPatterns } from "./HtmlTagPatterns";

/** Result of parsing a supported HTML container block from raw Markdown source. */
export interface ParsedHtmlBlock {
  /** Lowercased container tag name, e.g. `details` or `div`. */
  readonly tag: string;
  /** Inner text of the single-line `<summary>` tag; only ever set for `details`. */
  readonly summaryText: string | null;
  /** Raw Markdown body between summary (or opening tag) and the close, joined by `\n`. */
  readonly bodyMarkdown: string;
}

/**
 * Pure parser for the exact block shape this plugin supports (see req.md "Supported input"):
 *
 *   <details>            (or any configured container tag; own line, attributes allowed)
 *   <summary>...</summary>   (optional, `details` only; single line)
 *   ...markdown body...      (blank lines allowed — Phase 1.5)
 *   </details>               (own line)
 *
 * Anything else returns null so callers leave Obsidian's native rendering untouched.
 */
export class HtmlBlockParser {
  /**
   * Parses a source snippet expected to contain exactly one supported block
   * (blank lines around the block are tolerated). Returns null for any
   * unsupported or malformed shape.
   */
  static parse(source: string, supportedTags: ReadonlySet<string>): ParsedHtmlBlock | null {
    const lines = HtmlBlockParser.trimSurroundingBlankLines(source.split("\n"));
    if (lines.length < 2) {
      return null;
    }
    const opening = HtmlTagPatterns.matchOpening(lines[0], supportedTags);
    if (opening === null) {
      return null;
    }
    if (HtmlTagPatterns.matchClosing(lines[lines.length - 1], supportedTags) !== opening.tag) {
      return null;
    }

    const innerLines = lines.slice(1, lines.length - 1);
    const firstInner = innerLines.length > 0 ? innerLines[0] : null;
    // <summary> is meaningful only inside <details>; elsewhere it is body content.
    const summaryMatch =
      opening.tag === "details" && firstInner !== null
        ? firstInner.match(HtmlTagPatterns.SUMMARY_LINE)
        : null;
    // A <summary> that opens but is not a valid single line (e.g. spans multiple lines)
    // is malformed: rendering its tags as Markdown would diverge from native behavior.
    if (
      opening.tag === "details" &&
      summaryMatch === null &&
      firstInner !== null &&
      /^<summary/i.test(firstInner.trim())
    ) {
      return null;
    }
    const bodyLines = summaryMatch ? innerLines.slice(1) : innerLines;

    return {
      tag: opening.tag,
      summaryText: summaryMatch ? summaryMatch[1] : null,
      bodyMarkdown: bodyLines.join("\n"),
    };
  }

  private static trimSurroundingBlankLines(lines: string[]): string[] {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === "") start++;
    while (end > start && lines[end - 1].trim() === "") end--;
    return lines.slice(start, end);
  }
}

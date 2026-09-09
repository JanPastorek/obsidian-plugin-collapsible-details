/** Result of recognising an opening container tag alone on its line. */
export interface OpeningTagMatch {
  /** Lowercased tag name. */
  readonly tag: string;
  /** Raw attribute text between the tag name and `>`, `""` when there is none. */
  readonly attrs: string;
}

/**
 * Line-level recognition of the supported HTML container block shape, shared by
 * the scanner and the parser.
 *
 * WHAT (non-obvious regexes): a container tag must sit alone on its line. The
 * generic forms capture the tag name so a single pass can serve any configured
 * tag set. `(?:\s[^>]*)?` requires whitespace before an attribute list and stops
 * at the first `>`, so `<detailsfoo>` and `<details>x</details>` are not matched.
 */
export class HtmlTagPatterns {
  private static readonly OPENING_LINE = /^<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>\s*$/;
  private static readonly CLOSING_LINE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>\s*$/;

  /** Single-line `<summary>` (attributes allowed), capturing its inner content. */
  static readonly SUMMARY_LINE = /^<summary(?:\s[^>]*)?>(.*)<\/summary>\s*$/i;
  /** A fenced-code delimiter line (``` or ~~~, up to 3 leading spaces, per CommonMark). */
  static readonly FENCE_DELIMITER_LINE = /^ {0,3}(?:`{3,}|~{3,})/;

  /**
   * Returns the opening tag on this line when it names a supported tag, else null.
   * Self-closing tags (`<div />`) open no block and are rejected.
   */
  static matchOpening(line: string, supportedTags: ReadonlySet<string>): OpeningTagMatch | null {
    const match = line.match(HtmlTagPatterns.OPENING_LINE);
    if (match === null) {
      return null;
    }
    const tag = match[1].toLowerCase();
    const attrs = match[2] ?? "";
    if (!supportedTags.has(tag) || attrs.trimEnd().endsWith("/")) {
      return null;
    }
    return { tag, attrs };
  }

  /** Returns the closing tag name on this line when supported, else null. */
  static matchClosing(line: string, supportedTags: ReadonlySet<string>): string | null {
    const match = line.match(HtmlTagPatterns.CLOSING_LINE);
    if (match === null) {
      return null;
    }
    const tag = match[1].toLowerCase();
    return supportedTags.has(tag) ? tag : null;
  }
}

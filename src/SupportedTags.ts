/**
 * Normalizes the user-configurable tag list (a comma-separated settings string)
 * into the set of HTML container tags whose bodies are rendered as Markdown.
 */
export class SupportedTags {
  /** Handled as part of a `<details>` block, never as a container in its own right. */
  private static readonly RESERVED = new Set(["summary"]);

  /**
   * Void elements can never contain a body, so accepting them would only ever
   * produce unclosed blocks; excluded so a typo cannot disable a whole note.
   */
  private static readonly VOID = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
  ]);

  /** A syntactically valid HTML tag name (lowercase, letter-initial). */
  private static readonly TAG_NAME = /^[a-z][a-z0-9-]*$/;

  /**
   * Parses a comma-separated settings string. Invalid, reserved, void, and
   * duplicate entries are dropped silently: settings text is edited character by
   * character, so a half-typed tag must never throw into the render loop.
   */
  static parse(setting: string): Set<string> {
    const tags = new Set<string>();
    for (const raw of setting.split(",")) {
      const tag = raw.trim().toLowerCase();
      if (
        tag === "" ||
        !SupportedTags.TAG_NAME.test(tag) ||
        SupportedTags.RESERVED.has(tag) ||
        SupportedTags.VOID.has(tag)
      ) {
        continue;
      }
      tags.add(tag);
    }
    return tags;
  }
}

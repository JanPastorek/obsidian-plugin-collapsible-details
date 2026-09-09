import { describe, expect, it } from "vitest";
import { columnForRenderedPrefix, topLevelListItemLines } from "../src/SourceColumn";

/**
 * GIVEN a source line and the rendered text before a click
 * WHEN columnForRenderedPrefix is called
 * THEN it returns the source offset the caret should take.
 */
describe("columnForRenderedPrefix", () => {
  const at = (line: string, prefix: string) => columnForRenderedPrefix(line, prefix);

  it("THEN plain text maps one to one", () => {
    expect(at("hello world", "hello")).toBe(5);
  });

  it("THEN an empty prefix lands at the start of the content", () => {
    expect(at("hello world", "")).toBe(0);
  });

  it("THEN emphasis markers are skipped over", () => {
    // Rendered "Email" sits after the opening ** in "- **Email** ...".
    expect(at("- **Email** jan@example.com", "Email")).toBe(9);
  });

  it("THEN a link's label is found inside its brackets", () => {
    const line = "- **Web** [janpastorek.com](https://janpastorek.com/)";
    expect(at(line, "Web janpastorek.com")).toBe(26);
  });

  it("THEN a list marker is skipped for an empty prefix", () => {
    expect(at("- item text", "")).toBe(2);
  });

  it("THEN heading hashes are skipped for an empty prefix", () => {
    expect(at("## Education", "")).toBe(3);
  });

  it("THEN collapsed whitespace still matches", () => {
    expect(at("a    b", "a b")).toBe(6);
  });

  it("THEN an untraceable prefix falls back to the start of the content", () => {
    expect(at("- item text", "nothing like this")).toBe(2);
  });

  it("THEN a prefix longer than the line does not run past its end", () => {
    expect(at("short", "short and then some more")).toBe(0);
  });
});

/**
 * GIVEN the source lines of a rendered list
 * WHEN topLevelListItemLines is called
 * THEN each list item's own line is reported, so a click lands on the right bullet.
 */
describe("topLevelListItemLines", () => {
  it("THEN one line per item, continuation lines ignored", () => {
    const lines = [
      "- **2023–present** **Doctoral Student**",
      "\tFaculty of Mathematics",
      "- **2020** **Researcher intern**",
      "\tSlovak Academy of Sciences",
    ];
    expect(topLevelListItemLines(lines, 40)).toEqual([40, 42]);
  });

  it("THEN ordered lists count too", () => {
    expect(topLevelListItemLines(["1. one", "2) two"], 0)).toEqual([0, 1]);
  });

  it("THEN a deeply indented item is not top level", () => {
    expect(topLevelListItemLines(["- outer", "      - nested"], 0)).toEqual([0]);
  });

  it("THEN a line that merely starts with a dash is not an item", () => {
    expect(topLevelListItemLines(["-no space", "- yes"], 0)).toEqual([1]);
  });

  it("THEN no items yields an empty list", () => {
    expect(topLevelListItemLines(["just a paragraph"], 5)).toEqual([]);
  });
});

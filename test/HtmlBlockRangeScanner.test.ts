import { describe, expect, it } from "vitest";
import { HtmlBlockRangeScanner } from "../src/HtmlBlockRangeScanner";

/**
 * GIVEN full raw note text
 * WHEN HtmlBlockRangeScanner.scan is called
 * THEN it returns 0-indexed line ranges of supported <details> blocks.
 */
describe("HtmlBlockRangeScanner.scan", () => {
  const TAGS = new Set(["details", "div", "section"]);
  const scan = (lines: string[]) => HtmlBlockRangeScanner.scan(lines.join("\n"), TAGS);

  it("THEN a simple block yields its full range", () => {
    const lines = ["before", "<details>", "body", "</details>", "after"];
    expect(scan(lines)).toEqual([{ tag: "details", startLine: 1, endLine: 3 }]);
  });

  it("THEN a block with blank lines in the body is one range", () => {
    const lines = ["<details>", "a", "", "b", "</details>"];
    expect(scan(lines)).toEqual([{ tag: "details", startLine: 0, endLine: 4 }]);
  });

  it("THEN two blocks yield two ranges", () => {
    const lines = ["<details>", "a", "</details>", "", "<details open>", "b", "</details>"];
    expect(scan(lines)).toEqual([
      { tag: "details", startLine: 0, endLine: 2 },
      { tag: "details", startLine: 4, endLine: 6 },
    ]);
  });

  it("THEN an unclosed block yields no range", () => {
    expect(scan(["<details>", "body forever"])).toEqual([]);
  });

  it("THEN an opening tag with a class attribute is recognized", () => {
    const lines = ['<details class="bordered-when-open">', "body", "</details>"];
    expect(scan(lines)).toEqual([{ tag: "details", startLine: 0, endLine: 2 }]);
  });

  it("THEN a nested block on its own lines extends the outer range to the matching close", () => {
    const lines = ["<details>", "<details>", "inner", "</details>", "</details>"];
    expect(scan(lines)).toEqual([{ tag: "details", startLine: 0, endLine: 4 }]);
  });

  it("THEN details tags inside a code fence are ignored", () => {
    const lines = ["<details>", "```", "</details>", "```", "real body", "</details>"];
    expect(scan(lines)).toEqual([{ tag: "details", startLine: 0, endLine: 5 }]);
  });

  it("THEN a code fence outside any block does not create ranges", () => {
    const lines = ["```", "<details>", "</details>", "```"];
    expect(scan(lines)).toEqual([]);
  });

  it("THEN an unclosed outer still lets a later closed block match", () => {
    const lines = ["<details>", "no close here", "", "<details>", "b", "</details>"];
    expect(scan(lines)).toEqual([{ tag: "details", startLine: 3, endLine: 5 }]);
  });

  it("THEN inline (non-own-line) tags are not block boundaries", () => {
    expect(scan(["text <details> text", "</details>"])).toEqual([]);
  });
});

/**
 * GIVEN a configured set of container tags beyond <details>
 * WHEN HtmlBlockRangeScanner.scan is called
 * THEN every configured tag is scanned with the same rules.
 */
describe("HtmlBlockRangeScanner.scan with multiple container tags", () => {
  const TAGS = new Set(["details", "div", "section"]);
  const scan = (lines: string[]) => HtmlBlockRangeScanner.scan(lines.join("\n"), TAGS);

  it("THEN a <div> block yields a range tagged div", () => {
    expect(scan(["<div>", "body", "</div>"])).toEqual([
      { tag: "div", startLine: 0, endLine: 2 },
    ]);
  });

  it("THEN attributes on a non-details tag are allowed", () => {
    expect(scan(['<section class="card" id="x">', "body", "</section>"])).toEqual([
      { tag: "section", startLine: 0, endLine: 2 },
    ]);
  });

  it("THEN an outer <div> wrapping a <details> yields only the outer range", () => {
    const lines = ["<div>", "<details>", "inner", "</details>", "</div>"];
    expect(scan(lines)).toEqual([{ tag: "div", startLine: 0, endLine: 4 }]);
  });

  it("THEN a closing tag of a different name does not end the block", () => {
    const lines = ["<details>", "</div>", "body", "</details>"];
    expect(scan(lines)).toEqual([{ tag: "details", startLine: 0, endLine: 3 }]);
  });

  it("THEN a tag outside the configured set is ignored", () => {
    expect(scan(["<span>", "body", "</span>"])).toEqual([]);
  });

  it("THEN a self-closing tag opens no block", () => {
    expect(scan(["<div />", "body", "</div>"])).toEqual([]);
  });

  it("THEN two different container tags in one note both yield ranges", () => {
    const lines = ["<div>", "a", "</div>", "", "<details>", "b", "</details>"];
    expect(scan(lines)).toEqual([
      { tag: "div", startLine: 0, endLine: 2 },
      { tag: "details", startLine: 4, endLine: 6 },
    ]);
  });

  it("THEN an empty tag set yields no ranges (plugin effectively inert)", () => {
    expect(
      HtmlBlockRangeScanner.scan(["<details>", "a", "</details>"].join("\n"), new Set())
    ).toEqual([]);
  });
});

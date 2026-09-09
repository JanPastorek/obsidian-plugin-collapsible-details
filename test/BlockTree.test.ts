import { describe, expect, it } from "vitest";
import { BlockTree } from "../src/BlockTree";

/**
 * GIVEN note lines containing nested container blocks
 * WHEN BlockTree.build is called
 * THEN it reports each block with its children, in whole-document line numbers.
 */
describe("BlockTree.build", () => {
  const TAGS = new Set(["details", "div", "section"]);
  const build = (lines: string[]) => BlockTree.build(lines, TAGS);

  it("THEN a flat block has no children", () => {
    const tree = build(["<div>", "body", "</div>"]);
    expect(tree).toEqual([
      { range: { tag: "div", startLine: 0, endLine: 2 }, children: [] },
    ]);
  });

  it("THEN a nested block is reported as a child, in document line numbers", () => {
    const tree = build(["<div>", "<section>", "body", "</section>", "</div>"]);
    expect(tree).toEqual([
      {
        range: { tag: "div", startLine: 0, endLine: 4 },
        children: [
          { range: { tag: "section", startLine: 1, endLine: 3 }, children: [] },
        ],
      },
    ]);
  });

  it("THEN two siblings inside one parent are both children", () => {
    const tree = build([
      "<div>",
      "<section>",
      "a",
      "</section>",
      "<section>",
      "b",
      "</section>",
      "</div>",
    ]);
    expect(tree[0].children.map((child) => child.range)).toEqual([
      { tag: "section", startLine: 1, endLine: 3 },
      { tag: "section", startLine: 4, endLine: 6 },
    ]);
  });

  it("THEN same-tag nesting is reported as a child, not as a sibling", () => {
    // The CV shape: a styling <div> wrapping the whole note, <div>s inside it.
    const tree = build(["<div>", "<div>", "inner", "</div>", "</div>"]);
    expect(tree).toHaveLength(1);
    expect(tree[0].range).toEqual({ tag: "div", startLine: 0, endLine: 4 });
    expect(tree[0].children[0].range).toEqual({ tag: "div", startLine: 1, endLine: 3 });
  });

  it("THEN nesting three deep is walked all the way down", () => {
    const tree = build([
      "<div>",
      "<section>",
      "<details>",
      "deep",
      "</details>",
      "</section>",
      "</div>",
    ]);
    expect(tree[0].children[0].children[0].range).toEqual({
      tag: "details",
      startLine: 2,
      endLine: 4,
    });
  });

  it("THEN a child separated from its parent by other content keeps its line numbers", () => {
    const tree = build(["intro", "<div>", "text", "", "<section>", "b", "</section>", "</div>"]);
    expect(tree[0].range).toEqual({ tag: "div", startLine: 1, endLine: 7 });
    expect(tree[0].children[0].range).toEqual({ tag: "section", startLine: 4, endLine: 6 });
  });

  it("THEN a nested block inside a code fence is not a child", () => {
    const tree = build(["<div>", "```", "<section>", "</section>", "```", "</div>"]);
    expect(tree[0].children).toEqual([]);
  });

  it("THEN two top-level blocks are siblings", () => {
    const tree = build(["<div>", "a", "</div>", "<section>", "b", "</section>"]);
    expect(tree.map((node) => node.range.tag)).toEqual(["div", "section"]);
  });

  it("THEN no blocks yields an empty tree", () => {
    expect(build(["just", "text"])).toEqual([]);
  });
});

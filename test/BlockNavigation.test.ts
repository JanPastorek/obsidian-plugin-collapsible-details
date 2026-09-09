import { describe, expect, it } from "vitest";
import { HtmlBlockNode } from "../src/BlockTree";
import { blockAbove, blockBelow, selectRenderedBlocks } from "../src/BlockNavigation";

const node = (startLine: number, endLine: number, children: HtmlBlockNode[] = []): HtmlBlockNode => ({
  range: { tag: "div", startLine, endLine },
  children,
});

/**
 * GIVEN a block tree and which blocks the cursor is in
 * WHEN selectRenderedBlocks is called
 * THEN it returns exactly the blocks shown as rendered output.
 */
describe("selectRenderedBlocks", () => {
  const none = () => false;

  it("THEN with the cursor nowhere, the outermost blocks render", () => {
    const tree = [node(0, 10, [node(2, 4)]), node(12, 20)];
    expect(selectRenderedBlocks(tree, none).map((n) => n.range.startLine)).toEqual([0, 12]);
  });

  it("THEN a block being edited is replaced by its children", () => {
    const tree = [node(0, 10, [node(2, 4), node(6, 8)])];
    const edited = (start: number) => start === 0;
    expect(selectRenderedBlocks(tree, edited).map((n) => n.range.startLine)).toEqual([2, 6]);
  });

  it("THEN editing an inner block leaves its siblings rendered", () => {
    const tree = [node(0, 10, [node(2, 4), node(6, 8)])];
    const edited = (start: number, end: number) =>
      (start === 0 && end === 10) || (start === 2 && end === 4);
    expect(selectRenderedBlocks(tree, edited).map((n) => n.range.startLine)).toEqual([6]);
  });

  it("THEN a childless block being edited renders nothing", () => {
    expect(selectRenderedBlocks([node(0, 4)], () => true)).toEqual([]);
  });

  it("THEN nesting three deep unwinds one level at a time", () => {
    const tree = [node(0, 20, [node(1, 19, [node(2, 18)])])];
    const editedTwo = (start: number) => start === 0 || start === 1;
    expect(selectRenderedBlocks(tree, editedTwo).map((n) => n.range.startLine)).toEqual([2]);
  });
});

/**
 * GIVEN the rendered blocks and the caret's line
 * WHEN blockBelow / blockAbove are called
 * THEN they name the block the caret should step into rather than skip.
 */
describe("caret motion into a rendered block", () => {
  const rendered = [node(5, 9), node(12, 20)];

  it("THEN Down from the line above a block enters it", () => {
    expect(blockBelow(rendered, 4)?.range.startLine).toBe(5);
  });

  it("THEN Down from anywhere else enters nothing", () => {
    expect(blockBelow(rendered, 2)).toBeNull();
    expect(blockBelow(rendered, 9)).toBeNull();
  });

  it("THEN Up from the line below a block enters it", () => {
    expect(blockAbove(rendered, 10)?.range.endLine).toBe(9);
  });

  it("THEN Up from anywhere else enters nothing", () => {
    expect(blockAbove(rendered, 30)).toBeNull();
    expect(blockAbove(rendered, 5)).toBeNull();
  });

  it("THEN two adjacent blocks each stay reachable", () => {
    const adjacent = [node(0, 3), node(4, 7)];
    expect(blockBelow(adjacent, 3)?.range.startLine).toBe(4);
    expect(blockAbove(adjacent, 4)?.range.endLine).toBe(3);
  });
});

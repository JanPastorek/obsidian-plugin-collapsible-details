import { describe, expect, it } from "vitest";
import { isBeingEdited } from "../src/BlockEditingState";

/**
 * GIVEN a block's character span and the editor's selection
 * WHEN isBeingEdited is called
 * THEN it says whether the block should show raw source instead of rendered output.
 *
 * The block below spans characters 10..20 inclusive.
 */
describe("isBeingEdited", () => {
  const edited = (...selection: [number, number][]) =>
    isBeingEdited(
      selection.map(([from, to]) => ({ from, to })),
      10,
      20
    );

  it("THEN a cursor before the block leaves it rendered", () => {
    expect(edited([5, 5])).toBe(false);
  });

  it("THEN a cursor after the block leaves it rendered", () => {
    expect(edited([25, 25])).toBe(false);
  });

  it("THEN a cursor inside the block reveals the source", () => {
    expect(edited([15, 15])).toBe(true);
  });

  it("THEN a cursor on the opening edge reveals the source", () => {
    expect(edited([10, 10])).toBe(true);
  });

  it("THEN a cursor on the closing edge reveals the source", () => {
    expect(edited([20, 20])).toBe(true);
  });

  it("THEN a selection spanning the whole block reveals the source", () => {
    expect(edited([0, 30])).toBe(true);
  });

  it("THEN a selection overlapping only the block's start reveals the source", () => {
    expect(edited([5, 12])).toBe(true);
  });

  it("THEN a selection ending exactly where the block starts reveals the source", () => {
    // Select-to-here then keep typing: this is an edit about to touch the block.
    expect(edited([5, 10])).toBe(true);
  });

  it("THEN a selection entirely past the block leaves it rendered", () => {
    expect(edited([21, 30])).toBe(false);
  });

  it("THEN one of several cursors inside the block is enough", () => {
    expect(edited([0, 0], [30, 30], [15, 15])).toBe(true);
  });

  it("THEN several cursors all outside leave it rendered", () => {
    expect(edited([0, 0], [30, 30], [40, 45])).toBe(false);
  });

  it("THEN no selection at all leaves it rendered", () => {
    expect(edited()).toBe(false);
  });
});

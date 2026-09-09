import { describe, expect, it } from "vitest";
import { SupportedTags } from "../src/SupportedTags";

/**
 * GIVEN the comma-separated "Container tags" settings string
 * WHEN SupportedTags.parse is called
 * THEN it yields the usable tag set, silently dropping anything unusable.
 */
describe("SupportedTags.parse", () => {
  const parse = (setting: string) => [...SupportedTags.parse(setting)];

  it("THEN a plain list is split and trimmed", () => {
    expect(parse("details, div, section")).toEqual(["details", "div", "section"]);
  });

  it("THEN tag names are lowercased", () => {
    expect(parse("Details, DIV")).toEqual(["details", "div"]);
  });

  it("THEN duplicates collapse", () => {
    expect(parse("div, div , DIV")).toEqual(["div"]);
  });

  it("THEN empty entries and stray commas are ignored", () => {
    expect(parse(" , details, ,")).toEqual(["details"]);
  });

  it("THEN an empty setting yields an empty set", () => {
    expect(parse("   ")).toEqual([]);
  });

  it("THEN summary is reserved: it belongs to a details block, not a container", () => {
    expect(parse("details, summary")).toEqual(["details"]);
  });

  it("THEN void elements are dropped: they can never hold a body", () => {
    expect(parse("div, br, hr, img")).toEqual(["div"]);
  });

  it("THEN syntactically invalid names are dropped rather than thrown on", () => {
    expect(parse("div, <span>, 1st, a b, my-tag")).toEqual(["div", "my-tag"]);
  });
});

# Requirements: Obsidian "Details Markdown" plugin

## Objective

Make Markdown render correctly inside native HTML `<details>` / `<summary>` blocks in Obsidian. Today Obsidian intentionally does not parse Markdown inside raw HTML blocks, so headings, lists, tables, and internal links inside a `<details>` fold show as literal text. The plugin fixes that.

Keep it simple and robust. This is a small, focused plugin, not a framework.

## Context (so the terrain is understood, not a spec)

- Obsidian skips Markdown parsing inside HTML blocks by design (a CommonMark rule). We render the body ourselves.
- A blank line inside a `<details>` block terminates the HTML block early in Obsidian, splitting the block across multiple render sections. The plugin re-assembles the block from raw source (Phase 1.5) so blank lines in the body are supported — essential for code fences (e.g. Python) that contain blank lines.
- A reference plugin exists (`RubiaPath/obsidian-folded-markdown-renderer`). Do not fork or copy it. It is Reading-mode only and has fidelity and lifecycle problems we explicitly want to avoid. It may be read once for orientation, nothing more.

## Scope

Three phases, each independently shippable:

- **Phase 1 (MVP): Reading mode.** The simple, robust core. **Done.**
- **Phase 1.5: Blank-line bodies in Reading mode.** Support blank lines inside the body (multi-section re-assembly from raw source). **Done.**
- **Phase 1.6: Container tags and math in Reading mode.** Generalize the block from `<details>` to a configurable set of HTML container tags, and make LaTeX math typeset inside rendered bodies. **Done.**
- **Phase 2: Live Preview (the editor).** The main reason the plugin exists, and the harder half. Build last; it assumes blank-line support from day one.

Do not begin Phase 2 until Phase 1.5 meets its acceptance criteria.

## Supported input (the contract)

The plugin must handle exactly this shape:

```
<details>
<summary>Summary text</summary>
### Any markdown body
- lists, [[internal links]], tables, embeds, code fences

blank lines allowed in the body (Phase 1.5)
</details>
```

- `<details>` on its own line; any attributes are allowed (e.g. `open`, `class="..."`).
- `<summary>...</summary>` optional, on a single line, immediately after `<details>`; attributes on the tag are allowed.
- Body: everything between the summary (or the opening tag if no summary) and `</details>`. Blank lines allowed (Phase 1.5), including inside code fences.
- `</details>` on its own line.
- Any block that does not match this shape (malformed, unclosed) is left untouched.

## Functional requirements

1. In Reading mode, the body of a supported `<details>` block renders as real Markdown, visually identical to the same content written outside the block.
2. In Live Preview, the same block renders when the cursor is outside it.
3. In Live Preview, when the cursor is inside the block, the raw source is shown so it can be edited normally. Moving the cursor out re-renders it.
4. The `<details>` fold still works: `open` state is respected, and expand/collapse behaves natively.
5. Markdown features inside the body work fully: headings, lists, tables, internal links (clickable and resolving), and embeds/transclusions.
6. Multiple `<details>` blocks in one note render independently.
7. A single setting toggles the plugin on or off. When off, Obsidian's native (literal) behavior returns with nothing left behind.

## Quality requirements (outcomes, not methods)

- **Faithful rendering.** The rendered body must preserve the original structure (line breaks, paragraphs, indentation, links). No lossy reconstruction from already-rendered text.
- **No leaks.** Anything with a lifecycle inside the body (embeds, Dataview, transclusions) must unload when the note closes. Nothing should accumulate across opens/closes.
- **No crashes.** Malformed or unsupported blocks degrade gracefully to native behavior; the plugin never throws into Obsidian's render loop.
- **Idempotent.** Re-renders, scrolling, and cursor movement never double-render or stack duplicate content.
- **Works on mobile** as well as desktop.

## Phase 1.6 requirements

10. Any tag in the configured "Container tags" list is treated as a block in exactly the same way as `<details>`: opening and closing tags on their own lines, attributes allowed, blank-line bodies re-assembled, fenced code ignored.
11. The container's own attributes (`class`, `style`, `id`, `open`, `data-*`) survive rendering. The plugin reuses the element Obsidian created and replaces only its body, so the author's CSS keeps applying.
12. `<summary>` is recognised only inside `<details>`. Inside any other container it is ordinary body content.
13. The tag list is user-editable and never throws: invalid, reserved (`summary`), void (`br`, `hr`, ...) and duplicate entries are dropped silently, since the setting is edited character by character.
14. LaTeX math inside a rendered body (`$...$` and `$$...$$`) typesets immediately, with no flash of raw source and no layout jump. A setting can turn this off.
15. Reducing the tag list back to `details` restores native behavior for every other tag, with nothing left behind.

## Non-goals (do not build now)

- Rendering Markdown inside the `<summary>` text itself.
- Inline (not-on-their-own-line) container tags.
- Re-processing a container nested inside another container's body.
- Deep nested-`<details>` fidelity beyond "the outer block renders and nothing breaks".
- PDF export / print edge cases.

## Acceptance tests

Build a test note covering each case. Phase 1 verifies in Reading mode; Phase 2 re-verifies 2 through 8 in the editor.

1. Summary + heading + bullet list renders as heading and list, not literal text.
2. Same block renders in Live Preview when the cursor is elsewhere.
3. Cursor inside the block shows raw source, with no flicker; moving out re-renders.
4. `<details open>` stays open; user expand/collapse still works.
5. Body with a table, an internal link, and an embed: table renders, link resolves and is clickable, embed loads. Closing the note leaves nothing leaked or duplicated.
6. Two blocks in one note both render independently.
7. Toggling the setting off restores native behavior with no leftovers.
8. A body with blank lines — including a code fence containing blank lines (Python-style) — renders fully inside the fold, with no escaped fragments left visible below it and no duplication. (Phase 1.5)
9. An unclosed or malformed block does not crash and is left as-is; no unrelated content is hidden.

Ship Phase 1 when 1, 4, 5, 6, 7 pass in Reading mode. Ship Phase 1.5 when 8 and 9 also pass in Reading mode. Ship Phase 2 when all pass in the editor.

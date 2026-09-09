# HTML Block Markdown — acceptance tests

Copy this note (and a note named `Target Note` containing any content) into a vault
with the plugin installed. Phase 1: verify in Reading mode.

## Test 1 — summary + heading + bullet list

Expected: renders as a real heading and list, not literal text.

<details>
<summary>Test 1: heading and list</summary>
### A rendered heading
- bullet one
- bullet two
</details>

## Test 4 — open attribute

Expected: starts expanded; manual expand/collapse still works.

<details open>
<summary>Test 4: starts open</summary>
This body is visible immediately because of the open attribute.
</details>

## Test 5 — table, internal link, embed

Expected: table renders, link resolves and is clickable, embed loads.
Close and reopen the note: nothing duplicated, nothing leaked.

<details>
<summary>Test 5: table, link, embed</summary>
| Column A | Column B |
| -------- | -------- |
| 1        | 2        |
[[Target Note]]
![[Target Note]]
</details>

## Test 6 — two independent blocks

Expected: both render independently.

<details>
<summary>Test 6a: first block</summary>
- first block content
</details>

<details>
<summary>Test 6b: second block</summary>
- second block content
</details>

## Test 7 — settings toggle

Turn the plugin's setting off: all blocks above revert to native literal text with
no leftovers. Turn it back on: they render again.

## Test 8 — blank lines in body, incl. code fence (Phase 1.5)

Expected: everything below renders INSIDE the fold — both paragraphs and the full
code fence with its blank lines. No escaped fragments visible below the fold, no
duplication. Edit a line after a blank line, switch back to Reading mode: the fold
updates (no stale body).

<details>
<summary>Test 8: blank lines and a Python fence</summary>
paragraph before blank

paragraph after blank
```python
some code

some more code, code will have empty lines
```
</details>

## Test 10 — attributes on details and summary

Expected: renders as a real heading and list (not literal text); the `class`
attributes are preserved on the rendered `<details>`/`<summary>` for CSS snippets.

<details class="bordered-when-open">
<summary class="central-thought-centered">Use goals to set direction. Rely on systems to make progress.</summary>
### Goals and Systems Simplified
- **Consistency beats intensity:** small, regular actions.
- **Enjoy the journey:** process over outcome.
</details>

## Test 9 — unclosed block (malformed, must not crash)

Expected: left as-is (native behavior), no crash, and the trailing text below is
NOT hidden.

<details>
<summary>Test 9: no closing tag</summary>
this block never closes

This trailing paragraph must stay visible.

## Test 10 — Markdown inside a `<div>` (multi-tag)

Expected: the heading and list render as Markdown, and the div keeps its border and
padding (attributes are preserved, not stripped).

<div class="acceptance-card" style="border: 1px solid var(--interactive-accent); border-radius: 6px; padding: 12px">

### Rendered inside a div
- bullet one
- bullet two

</div>

## Test 11 — other container tags

Expected: both render as Markdown. If you removed a tag from the "Container tags"
setting, that block should fall back to literal native output instead.

<section>
### Rendered inside a section
Some **bold** text.
</section>

<aside>
### Rendered inside an aside
[[Target Note]]
</aside>

## Test 12 — LaTeX math

Expected: all three typeset immediately on opening the note, with no flash of raw
`$...$` and no layout jump.

<details open>
<summary>Test 12: math in the summary is NOT rendered (out of scope): $E = mc^2$</summary>
Inline math in the body: $f(x) = \sin(x)$, and $e^{i\pi} + 1 = 0$.

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$
</details>

<div>

$$
\begin{pmatrix} a & b \\ c & d \end{pmatrix}^{-1} = \frac{1}{ad-bc}\begin{pmatrix} d & -b \\ -c & a \end{pmatrix}
$$

</div>

## Test 13 — tags that must be left alone

Expected: all three render natively (literal), because they are not supported blocks.

<span>
### Not a configured container tag
</span>

<div />
### Self-closing: opens no block
</div>

<div>
### Unclosed: no matching close, so left native

## Test 14 — container tags inside a code fence

Expected: shown as literal code, not treated as a block.

```html
<div>
### not a real block
</div>
```

## Test 15 — turning off a tag

Set "Container tags" to just `details`, then re-read this note. Expected: Tests 10,
11 and the `<div>` in Test 12 revert to native literal output with nothing left
behind; Tests 1–9 still pass.

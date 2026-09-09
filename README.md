# Details Markdown

An Obsidian plugin that renders Markdown — and LaTeX math — inside native HTML
container blocks such as
[`<details>`/`<summary>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details),
`<div>` and `<section>`. Obsidian intentionally does not parse Markdown inside raw
HTML blocks, so headings, lists, tables, internal links, embeds and `$math$` inside
such a block show as literal text. This plugin fixes that: the body renders as real
Markdown, visually identical to the same content written outside the block, and the
container keeps its own tag, classes and inline styles.

> **Scope:** Rendering happens in **Reading view**. Live Preview (the editor) is not
> yet supported — there, the block shows Obsidian's native output. Support for Live
> Preview is planned for a future release.

## Supported block shape

```
<details>
<summary>Summary text</summary>
### Any markdown body
- lists, [[internal links]], tables, embeds, code fences
- inline math $e^{i\pi} + 1 = 0$

$$\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}$$
</details>
```

Any configured container tag works the same way:

```
<div class="custom-card" style="border: 1px solid var(--interactive-accent); padding: 12px">

### Rendered inside a `<div>`
The div keeps its class and style; only its body is re-rendered as Markdown.

</div>
```

- The opening tag sits on its own line; any attributes are allowed (`open`,
  `class="..."`, `style="..."`, `id`, `data-*`, ...). They are preserved, because the
  plugin reuses the element Obsidian already created and replaces only its body.
- The matching closing tag sits on its own line.
- `<summary>...</summary>` is optional and single-line, immediately after
  `<details>`. It is only recognised inside `<details>`; elsewhere it is body content.
- The body is everything in between. Blank lines are supported, including inside
  code fences.
- Tags inside fenced code blocks are ignored.
- Unsupported, malformed, unclosed, or self-closing blocks are left untouched
  (native behavior).
- Rendering the `<summary>` text itself as Markdown is out of scope.

### Nesting

Nesting a **different** container inside another works as HTML, but only the
**outermost** block's body is re-rendered as Markdown; an inner container inside that
body is emitted as raw HTML by Obsidian's renderer, so its own body is not
re-processed. Repeating the *same* tag (`<details>` inside `<details>`) is tracked so
the outer block still ends at its own matching close.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Render Markdown inside HTML container blocks | on | Master switch. When off, Obsidian's native (literal) behavior returns with nothing left behind. |
| Container tags | `details, div, section, aside, article, figure, center` | Comma-separated tags whose bodies render as Markdown. Set it to just `details` to restrict the plugin to folds. |
| Render LaTeX math | on | Flushes MathJax after each body render so `$...$` and `$$...$$` typeset immediately. |

Invalid entries in the tag list are ignored rather than rejected, so the setting is
safe to edit character by character. `summary` is reserved (it belongs to a
`<details>` block) and void elements such as `br` and `hr` are dropped.

## Installation

### From the Community Plugins directory

Settings → Community plugins → Browse → search for "Details Markdown" → Install →
Enable.

### Manual

Copy `manifest.json`, `main.js`, and `styles.css` into
`<vault>/.obsidian/plugins/details-markdown/`, then enable the plugin in
Settings → Community plugins.

## Development

```bash
npm install
npm test        # unit tests (pure logic: tags, scanner, parser, classifier)
npm run build   # typecheck + bundle -> main.js
npm run dev     # watch mode
```

Manual acceptance tests: `test-vault-notes/Details Markdown Acceptance.md`.

### How it works

Obsidian ends an HTML block at the first blank line, so a body with blank lines is
split across several render sections and its tail "escapes" the container. The plugin
re-assembles blocks from **raw source** (never from rendered DOM):

- `SupportedTags` normalizes the configured tag list into the set of container tags.
- `HtmlBlockRangeScanner` scans the full note text for supported block line ranges
  (fence-aware, nesting-aware; unclosed blocks yield no range).
- `HtmlBlockParser` parses one block's source into its tag, optional summary, and
  raw body Markdown; `null` means unsupported, so native rendering stands.
- `SectionRoleClassifier` decides per rendered section: **opening** (starts a
  block) → render the whole body via `MarkdownRenderer.render` into the existing
  container element (its attributes, the native `<summary>`, and the `open` state are
  preserved); **fragment** (escaped content inside a block) → hidden, but only once
  its block's opening actually rendered, so content can never be lost.
- `finishRenderMath()` runs after each body render so MathJax typesets math in the
  freshly rendered body immediately.
- A `MarkdownRenderChild` registered via `ctx.addChild` ties embeds/lifecycles to
  the note, so nothing leaks when the note closes. A registry reconciles edits:
  interior edits re-render the body in place; deleting a block boundary restores
  native output.

## License

[MIT](LICENSE)

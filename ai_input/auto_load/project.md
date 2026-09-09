# Project: HTML Block Markdown (Obsidian plugin)

- Purpose: render Markdown (and LaTeX math) inside native HTML container blocks —
  `<details>`/`<summary>` plus any configured tag (`div`, `section`, `aside`, ...).
  Requirements: `req.md` (Phase 1 + 1.5 = Reading mode incl. blank-line bodies, done;
  Phase 1.6 = multi-tag + math, done; Phase 2 = Live Preview, next).
- Commands: `npm test` (vitest, pure-logic unit tests), `npm run build` (tsc typecheck + esbuild -> `main.js`), `npm run dev` (watch).
- Architecture (all rendering from **raw source** via `ctx.getSectionInfo`, never from rendered DOM):
  - `src/SupportedTags.ts` — pure: settings string -> tag set (drops invalid/reserved/void).
  - `src/HtmlTagPatterns.ts` — shared line-level tag recognition (DRY between parser/scanner).
  - `src/HtmlBlockParser.ts` — pure parser of one block's source; `null` = unsupported → native.
  - `src/HtmlBlockRangeScanner.ts` — pure scan of full note text for block line ranges (fence-aware, nesting-aware, unclosed → no range, resumes on next line).
  - `src/SectionRoleClassifier.ts` — pure: section line-span → opening | fragment | none.
  - `src/main.ts` — orchestration: opening sections render full body (`MarkdownRenderer.render`) into the element Obsidian already created, so its attributes survive; `<details>` bodies go in a `.html-block-markdown-body` wrapper (to preserve `<summary>`), other containers render directly into the element (to preserve the author's layout CSS). Escaped fragment sections hidden (styles.css class) only after opening rendered; registry per path reconciles interior edits (in-place body re-render), boundary deletions (full view rerender), unhide, cleanup. Lifecycle via `MarkdownRenderChild` + `ctx.addChild`; idempotency via `data-html-block-markdown-rendered`; `finishRenderMath()` after each render (`loadMathJax()` once on load).
- Key constraint: Obsidian ends an HTML block at the first blank line — a blank-line body splits into multiple sections; plugin re-assembles them (that's the whole point of Phase 1.5). Reading mode renders sections lazily and detached-first (`isConnected` false during postprocessor).
- Tag-set invariants: `summary` is reserved (part of a `<details>` block, never a container); void elements rejected; tag names constrained to `/^[a-z][a-z0-9-]*$/` so they are safe as CSS selectors.
- Manual acceptance: `test-vault-notes/HTML Block Markdown Acceptance.md` (needs a real vault; not runnable in CI).
- Reference plugin `RubiaPath/obsidian-folded-markdown-renderer`: do NOT fork/copy (req.md).

import {
  App,
  Component,
  MarkdownRenderer,
  finishRenderMath,
  sanitizeHTMLToDom,
} from "obsidian";
import { BlockTree, HtmlBlockNode } from "./BlockTree";
import { HtmlBlockParser } from "./HtmlBlockParser";

/** Everything a render pass needs, so this module stays independent of both views. */
export interface RenderContext {
  readonly app: App;
  readonly supportedTags: ReadonlySet<string>;
  readonly sourcePath: string;
  /** Owns the lifecycle of embeds, Dataview blocks and anything else rendered here. */
  readonly component: Component;
  readonly renderMath: boolean;
}

/**
 * Fills a container element from the block's own source lines, descending into any
 * containers nested inside it. This is the single rendering path: Reading view and
 * Live Preview both call it, so the two views cannot disagree about a block.
 *
 * A single `MarkdownRenderer.render` of the whole body is not enough. Obsidian treats
 * a nested `<div>` in that Markdown as raw HTML and stops parsing Markdown inside it,
 * so in a note wrapped in a styling container everything comes out literal. Rendering
 * the gaps as Markdown and building the nested containers here is what makes an
 * arbitrarily nested note render the same as a flat one.
 */
export async function fillBlock(
  context: RenderContext,
  element: HTMLElement,
  sourceLines: readonly string[],
  /** Absolute line of `sourceLines[0]`; keeps nested line numbers meaningful. */
  blockStartLine: number
): Promise<boolean> {
  const parsed = HtmlBlockParser.parse(sourceLines.join("\n"), context.supportedTags);
  if (parsed === null) {
    return false;
  }
  const hasSummary = parsed.summaryText !== null;
  if (hasSummary) {
    // Rebuilt from the original line so the tag's own attributes survive; its content
    // stays HTML rather than Markdown, matching Obsidian's native <summary>.
    appendSanitized(element, sourceLines[1]);
  }
  const bodyOffset = hasSummary ? 2 : 1;
  const bodyLines = sourceLines.slice(bodyOffset, sourceLines.length - 1);
  // <details> keeps its body in a wrapper so a re-render never disturbs the summary.
  // Every other container is filled directly, so the author's own layout CSS
  // (flex, grid, `figure > figcaption`) still applies to the real children.
  const bodyTarget =
    parsed.tag === "details" ? element.createDiv({ cls: "details-markdown-body" }) : element;
  await renderBody(context, bodyLines, bodyTarget, blockStartLine + bodyOffset);
  return true;
}

async function renderBody(
  context: RenderContext,
  bodyLines: readonly string[],
  target: HTMLElement,
  bodyStartLine: number
): Promise<void> {
  const nodes = BlockTree.build(bodyLines, context.supportedTags, bodyStartLine);
  let cursor = bodyStartLine;

  for (const node of nodes) {
    await renderMarkdownSlice(context, bodyLines, bodyStartLine, cursor, node.range.startLine, target);
    await renderNested(context, bodyLines, bodyStartLine, node, target);
    cursor = node.range.endLine + 1;
  }
  await renderMarkdownSlice(
    context,
    bodyLines,
    bodyStartLine,
    cursor,
    bodyStartLine + bodyLines.length,
    target
  );
}

/** Renders the plain Markdown between two nested containers (or a whole body). */
async function renderMarkdownSlice(
  context: RenderContext,
  bodyLines: readonly string[],
  bodyStartLine: number,
  fromLine: number,
  toLine: number,
  target: HTMLElement
): Promise<void> {
  const slice = bodyLines.slice(fromLine - bodyStartLine, toLine - bodyStartLine).join("\n");
  if (slice.trim() === "") {
    return;
  }
  await MarkdownRenderer.render(context.app, slice, target, context.sourcePath, context.component);
}

async function renderNested(
  context: RenderContext,
  bodyLines: readonly string[],
  bodyStartLine: number,
  node: HtmlBlockNode,
  target: HTMLElement
): Promise<void> {
  const sourceLines = bodyLines.slice(
    node.range.startLine - bodyStartLine,
    node.range.endLine - bodyStartLine + 1
  );
  const element = createContainerElement(sourceLines[0], node.range.tag);
  target.appendChild(element);
  if (!(await fillBlock(context, element, sourceLines, node.range.startLine))) {
    // The scanner found it, so this should not happen — but never drop the content.
    element.remove();
    await MarkdownRenderer.render(
      context.app,
      sourceLines.join("\n"),
      target,
      context.sourcePath,
      context.component
    );
  }
}

/**
 * Rebuilds a container element from its original opening tag using Obsidian's own
 * sanitizer, so attributes (class, style, id, open, data-*) come out exactly as
 * Reading view would produce them — and an event-handler attribute in a note cannot
 * survive into the rendered output.
 */
export function createContainerElement(openTag: string, tag: string): HTMLElement {
  try {
    const element = sanitizeHTMLToDom(`${openTag.trimEnd()}</${tag}>`).firstElementChild;
    if (element instanceof HTMLElement && element.tagName.toLowerCase() === tag) {
      element.empty();
      return element;
    }
  } catch (error) {
    console.error("details-markdown: failed to rebuild container tag", error);
  }
  return document.createElement(tag);
}

function appendSanitized(target: HTMLElement, html: string): void {
  try {
    target.appendChild(sanitizeHTMLToDom(html));
  } catch (error) {
    console.error("details-markdown: failed to sanitize summary", error);
  }
}

/** Typesets math in whatever was just rendered; never lets MathJax break a render. */
export async function flushMath(renderMath: boolean): Promise<void> {
  if (!renderMath) {
    return;
  }
  try {
    await finishRenderMath();
  } catch (error) {
    console.error("details-markdown: failed to finish math rendering", error);
  }
}

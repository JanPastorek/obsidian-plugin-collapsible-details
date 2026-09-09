import { App, Component, editorInfoField, editorLivePreviewField } from "obsidian";
import { EditorState, Extension, Prec, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";
import { isBeingEdited } from "./BlockEditingState";
import { blockAbove, blockBelow, selectRenderedBlocks } from "./BlockNavigation";
import { BlockTree, HtmlBlockNode } from "./BlockTree";
import {
  SOURCE_LINE_ATTRIBUTE,
  createContainerElement,
  fillBlock,
  flushMath,
} from "./ContainerRenderer";
import { columnForRenderedPrefix } from "./SourceColumn";
import { HtmlBlockParser } from "./HtmlBlockParser";

/** What the extension needs from the plugin, kept narrow so this file stays testable in isolation. */
export interface LivePreviewHost {
  readonly app: App;
  readonly supportedTags: ReadonlySet<string>;
  readonly enabled: boolean;
  readonly livePreviewEnabled: boolean;
  readonly renderMath: boolean;
}

/** Clicking these must behave normally rather than dropping the cursor into the source. */
const INTERACTIVE_SELECTOR =
  "a, button, input, textarea, select, summary, label, .internal-embed, .task-list-item-checkbox";

/** The text node and offset under the pointer, across the DOM APIs Electron exposes. */
function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position != null) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = doc.caretRangeFromPoint?.(x, y);
  return range === null || range === undefined
    ? null
    : { node: range.startContainer, offset: range.startOffset };
}

/**
 * The rendered text inside `element` that precedes the caret, and how many soft
 * breaks it crossed.
 *
 * Walking the DOM rather than using `Range.toString()` is what makes the line count
 * possible: a `<br>` contributes nothing to a range's text, but it is exactly where
 * one source line ended and the next began.
 */
function renderedPrefixWithin(
  element: Element,
  node: Node,
  offset: number
): { prefix: string; lineBreaks: number } {
  let prefix = "";
  let lineBreaks = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current: Node | null = walker.currentNode;
  while (current !== null) {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) {
        prefix += (current.textContent ?? "").slice(0, offset);
      }
      break;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      prefix += current.textContent ?? "";
    } else if (current instanceof HTMLBRElement) {
      prefix = "";
      lineBreaks++;
    }
    current = walker.nextNode();
  }
  return { prefix, lineBreaks };
}

/**
 * Whether the click landed on something that handles its own clicks, searching only
 * inside the widget.
 *
 * `closest` walks the whole ancestor chain, so a selector matching anything on the
 * editor *around* the widget vetoes every click inside it — which is what
 * `[contenteditable]` did, since the editor's content element carries it. Stopping
 * at the widget root keeps the test about what was actually clicked.
 */
function isInteractiveWithin(target: HTMLElement, container: HTMLElement): boolean {
  for (let el: HTMLElement | null = target; el !== null && el !== container; el = el.parentElement) {
    if (el.matches(INTERACTIVE_SELECTOR)) {
      return true;
    }
  }
  return false;
}

/**
 * Renders one container block in place of its source lines.
 *
 * The widget owns a `Component` rather than a `MarkdownRenderChild` tied to a note:
 * in the editor there is no post-processor context to register with, so the widget's
 * own `destroy` is what unloads embeds and other lifecycles.
 */
class HtmlBlockWidget extends WidgetType {
  private component: Component | null = null;

  constructor(
    private readonly host: LivePreviewHost,
    /** Full block source; the identity used by `eq`, so untouched blocks are never rebuilt. */
    private readonly source: string,
    private readonly openTag: string,
    private readonly tag: string,
    private readonly sourceLines: readonly string[],
    private readonly startLine: number,
    private readonly sourcePath: string
  ) {
    super();
  }

  /**
   * CodeMirror reuses the existing DOM when widgets compare equal, which is what keeps
   * typing elsewhere in the note from tearing down every rendered block (and with it
   * the user's expand/collapse state and any loaded embeds).
   */
  eq(other: HtmlBlockWidget): boolean {
    return (
      other.source === this.source &&
      other.sourcePath === this.sourcePath &&
      other.host.renderMath === this.host.renderMath
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = this.createContainer();
    container.addClass("html-block-markdown-lp");
    const component = new Component();
    this.component = component;
    component.load();
    void this.renderInto(container, component, view);
    // mousedown, not click: CodeMirror settles the selection on mousedown, so a
    // selection dispatched from a later click event is immediately overwritten.
    container.addEventListener("mousedown", (event) => this.onMouseDown(event, view, container));
    return container;
  }

  destroy(): void {
    this.component?.unload();
    this.component = null;
  }

  /**
   * Keep CodeMirror out of events inside the widget: link clicks, fold toggles and
   * our own cursor placement all need to happen without it selecting the widget.
   */
  ignoreEvent(): boolean {
    return true;
  }

  /**
   * A block widget is not editable, so arrowing into it would otherwise stall.
   * Reporting a coordinate map lets CodeMirror place the cursor before or after the
   * block as the caret passes it.
   */
  get estimatedHeight(): number {
    return -1;
  }

  /**
   * Builds the container by handing the original opening tag to Obsidian's own
   * sanitizer, so attributes (class, style, id, open, data-*) end up exactly as they
   * would in Reading view — no hand-rolled attribute parsing, and no way for an
   * event-handler attribute in a note to survive.
   */
  private createContainer(): HTMLElement {
    return createContainerElement(this.openTag, this.tag);
  }

  private async renderInto(
    container: HTMLElement,
    component: Component,
    view: EditorView
  ): Promise<void> {
    try {
      await fillBlock(
        {
          app: this.host.app,
          supportedTags: this.host.supportedTags,
          sourcePath: this.sourcePath,
          component,
          renderMath: this.host.renderMath,
        },
        container,
        this.sourceLines,
        this.startLine
      );
      await flushMath(this.host.renderMath);
    } catch (error) {
      console.error("html-block-markdown: failed to render block in Live Preview", error);
    }
    // The body's height is only known after rendering; without this the editor keeps
    // its pre-render estimate and the text below sits at the wrong offset.
    view.requestMeasure();
  }

  /**
   * Clicking the rendered block reveals its source with the cursor where the click
   * landed, so editing continues from the spot the eye was already on. Interactive
   * children (links, embeds, the fold triangle) keep their own behavior.
   */
  /**
   * Maps a click back to a document position: the source line the renderer recorded
   * on the clicked element, plus the column the rendered text before the pointer
   * traces to. posAtCoords cannot help here — every line the widget covers is
   * replaced, so there are no mapped coordinates inside it to hit.
   */
  private sourcePosFor(
    event: MouseEvent,
    view: EditorView,
    container: HTMLElement
  ): number {
    const fallback = view.posAtDOM(container);
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return fallback;
    }
    const tagged = target.closest(`[${SOURCE_LINE_ATTRIBUTE}]`);
    const tagLine = Number(tagged?.getAttribute(SOURCE_LINE_ATTRIBUTE));
    if (tagged === null || !Number.isInteger(tagLine) || tagLine < 0) {
      return fallback;
    }

    const caret = caretFromPoint(event.clientX, event.clientY);
    const placement =
      caret === null ? null : renderedPrefixWithin(tagged, caret.node, caret.offset);
    // A soft break inside one rendered element is a real newline in the source, so
    // the breaks before the pointer say which of the element's lines was clicked.
    const line = tagLine + (placement?.lineBreaks ?? 0);
    if (line >= view.state.doc.lines) {
      return fallback;
    }
    const docLine = view.state.doc.line(line + 1);
    const column = columnForRenderedPrefix(docLine.text, placement?.prefix ?? "");
    return docLine.from + Math.min(column, docLine.length);
  }

  private onMouseDown(event: MouseEvent, view: EditorView, container: HTMLElement): void {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && isInteractiveWithin(target, container)) {
      return;
    }
    const pos = this.sourcePosFor(event, view, container);
    event.preventDefault();
    event.stopPropagation();
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    view.focus();
  }
}

/** Why the last build produced no decorations; surfaced by the diagnostics command. */
export let lastBuildReason = "not built yet";

function buildDecorations(state: EditorState, host: LivePreviewHost): DecorationSet {
  if (!host.enabled || !host.livePreviewEnabled) {
    lastBuildReason = `disabled (enabled=${host.enabled}, livePreview=${host.livePreviewEnabled})`;
    return Decoration.none;
  }
  // Source mode must stay untouched; the field is absent outside Markdown editors.
  const livePreview = state.field(editorLivePreviewField, false);
  if (livePreview !== true) {
    lastBuildReason = `editorLivePreviewField = ${String(livePreview)} (not Live Preview)`;
    return Decoration.none;
  }
  currentTags = host.supportedTags;
  const lines = state.doc.toString().split("\n");
  const tree = BlockTree.build(lines, host.supportedTags);
  if (tree.length === 0) {
    lastBuildReason = `no blocks found in ${lines.length} lines for tags [${[...host.supportedTags].join(", ")}]`;
    return Decoration.none;
  }

  const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
  const builder = new RangeSetBuilder<Decoration>();
  addNodes(tree, state, lines, sourcePath, host, builder);
  const result = builder.finish();
  lastBuildReason = `built ${result.size} decoration(s) from ${tree.length} top-level block(s)`;
  return result;
}

/**
 * Replaces each block the cursor is outside of. When the cursor *is* inside one,
 * that block stays as source but its children are still considered — so editing one
 * section of a note wrapped in a styling container does not flip the whole note to
 * raw text. The recursion is what makes the reveal happen per innermost block.
 */
function addNodes(
  nodes: readonly HtmlBlockNode[],
  state: EditorState,
  lines: readonly string[],
  sourcePath: string,
  host: LivePreviewHost,
  builder: RangeSetBuilder<Decoration>
): void {
  for (const node of nodes) {
    const from = state.doc.line(node.range.startLine + 1).from;
    const to = state.doc.line(node.range.endLine + 1).to;

    if (isBeingEdited(state.selection.ranges, from, to)) {
      addNodes(node.children, state, lines, sourcePath, host, builder);
      continue;
    }

    const sourceLines = lines.slice(node.range.startLine, node.range.endLine + 1);
    const parsed = HtmlBlockParser.parse(sourceLines.join("\n"), host.supportedTags);
    if (parsed === null) {
      addNodes(node.children, state, lines, sourcePath, host, builder);
      continue;
    }
    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new HtmlBlockWidget(
          host,
          sourceLines.join("\n"),
          parsed.openTag,
          parsed.tag,
          sourceLines,
          node.range.startLine,
          sourcePath
        ),
        block: true,
      })
    );
  }
}

/**
 * Moves the caret into a rendered block instead of over it.
 *
 * CodeMirror skips a replaced block on vertical motion, because none of its lines
 * are on screen to land on — so a block is unreachable except by arrowing sideways
 * past its edge. Landing on its first (or last) line reveals the source, which is
 * the only thing there is to edit.
 */
function stepIntoBlock(view: EditorView, forward: boolean): boolean {
  const state = view.state;
  if (state.field(editorLivePreviewField, false) !== true) {
    return false;
  }
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }
  const lines = state.doc.toString().split("\n");
  const tree = BlockTree.build(lines, currentTags);
  if (tree.length === 0) {
    return false;
  }
  const rendered = selectRenderedBlocks(tree, (startLine, endLine) =>
    isBeingEdited(
      state.selection.ranges,
      state.doc.line(startLine + 1).from,
      state.doc.line(endLine + 1).to
    )
  );
  const cursorLine = state.doc.lineAt(selection.head).number - 1;
  const target = forward ? blockBelow(rendered, cursorLine) : blockAbove(rendered, cursorLine);
  if (target === null) {
    return false;
  }
  // Enter at the near edge, so Down lands on the top and Up lands on the bottom.
  const line = forward ? target.range.startLine : target.range.endLine;
  view.dispatch({ selection: { anchor: state.doc.line(line + 1).from }, scrollIntoView: true });
  return true;
}

/** The tag set of the most recent decoration build, for the keymap to reuse. */
let currentTags: ReadonlySet<string> = new Set();

/**
 * The decorations replace line breaks, so they must come from a state field:
 * CodeMirror refuses block decorations supplied by a view plugin, because it needs
 * them before it can estimate line heights.
 */
/** Caret motion into rendered blocks; registered alongside the decoration field. */
export function createBlockNavigationKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      { key: "ArrowDown", run: (view) => stepIntoBlock(view, true) },
      { key: "ArrowUp", run: (view) => stepIntoBlock(view, false) },
    ])
  );
}

export function createLivePreviewExtension(host: LivePreviewHost): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, host),
    update: (value, transaction) => {
      // Selection moves decide whether a block shows rendered or raw, so they matter
      // as much as edits; anything else can keep the mapped set.
      if (!transaction.docChanged && transaction.selection === undefined) {
        return value.map(transaction.changes);
      }
      return buildDecorations(transaction.state, host);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

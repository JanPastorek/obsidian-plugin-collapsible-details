import {
  App,
  Component,
  MarkdownRenderer,
  editorInfoField,
  editorLivePreviewField,
  finishRenderMath,
  sanitizeHTMLToDom,
} from "obsidian";
import { EditorState, Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { isBeingEdited } from "./BlockEditingState";
import { HtmlBlockParser } from "./HtmlBlockParser";
import { HtmlBlockRangeScanner } from "./HtmlBlockRangeScanner";

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
  "a, button, input, textarea, select, summary, label, .internal-embed, .task-list-item-checkbox, [contenteditable]";

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
    private readonly summaryHtml: string | null,
    private readonly bodyMarkdown: string,
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
    container.addClass("details-markdown-lp");
    const component = new Component();
    this.component = component;
    component.load();
    void this.renderInto(container, component, view);
    container.addEventListener("click", (event) => this.onClick(event, view, container));
    return container;
  }

  destroy(): void {
    this.component?.unload();
    this.component = null;
  }

  /** Let every event through: link clicks, fold toggles and our own handler all need it. */
  ignoreEvent(): boolean {
    return true;
  }

  /**
   * Builds the container by handing the original opening tag to Obsidian's own
   * sanitizer, so attributes (class, style, id, open, data-*) end up exactly as they
   * would in Reading view — no hand-rolled attribute parsing, and no way for an
   * event-handler attribute in a note to survive.
   */
  private createContainer(): HTMLElement {
    try {
      const element = sanitizeHTMLToDom(`${this.openTag}</${this.tag}>`).firstElementChild;
      if (element instanceof HTMLElement && element.tagName.toLowerCase() === this.tag) {
        element.empty();
        return element;
      }
    } catch (error) {
      console.error("details-markdown: failed to rebuild container tag", error);
    }
    return document.createElement(this.tag);
  }

  private async renderInto(
    container: HTMLElement,
    component: Component,
    view: EditorView
  ): Promise<void> {
    try {
      if (this.tag === "details" && this.summaryHtml !== null) {
        // Reading view leaves the native <summary> alone, so its content stays HTML
        // rather than Markdown here too (rendering Markdown in <summary> is a non-goal).
        container.createEl("summary").appendChild(sanitizeHTMLToDom(this.summaryHtml));
      }
      const body =
        this.tag === "details"
          ? container.createDiv({ cls: "details-markdown-body" })
          : container;
      await MarkdownRenderer.render(
        this.host.app,
        this.bodyMarkdown,
        body,
        this.sourcePath,
        component
      );
      if (this.host.renderMath) {
        await finishRenderMath();
      }
    } catch (error) {
      console.error("details-markdown: failed to render block in Live Preview", error);
    }
    // The body's height is only known after rendering; without this the editor keeps
    // its pre-render estimate and the text below sits at the wrong offset.
    view.requestMeasure();
  }

  /**
   * Clicking the rendered block puts the cursor at its first line, which is what
   * reveals the source for editing. Interactive children keep their own behavior.
   */
  private onClick(event: MouseEvent, view: EditorView, container: HTMLElement): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(INTERACTIVE_SELECTOR) !== null) {
      return;
    }
    const pos = view.posAtDOM(container);
    event.preventDefault();
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
  }
}

function buildDecorations(state: EditorState, host: LivePreviewHost): DecorationSet {
  if (!host.enabled || !host.livePreviewEnabled) {
    return Decoration.none;
  }
  // Source mode must stay untouched; the field is absent outside Markdown editors.
  if (state.field(editorLivePreviewField, false) !== true) {
    return Decoration.none;
  }
  const doc = state.doc;
  const text = doc.toString();
  const ranges = HtmlBlockRangeScanner.scan(text, host.supportedTags);
  if (ranges.length === 0) {
    return Decoration.none;
  }

  const lines = text.split("\n");
  const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
  const builder = new RangeSetBuilder<Decoration>();

  for (const range of ranges) {
    const from = doc.line(range.startLine + 1).from;
    const to = doc.line(range.endLine + 1).to;
    if (isBeingEdited(state.selection.ranges, from, to)) {
      continue;
    }
    const source = lines.slice(range.startLine, range.endLine + 1).join("\n");
    const parsed = HtmlBlockParser.parse(source, host.supportedTags);
    if (parsed === null || parsed.bodyMarkdown === "") {
      continue;
    }
    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new HtmlBlockWidget(
          host,
          source,
          parsed.openTag,
          parsed.tag,
          parsed.summaryText,
          parsed.bodyMarkdown,
          sourcePath
        ),
        block: true,
      })
    );
  }
  return builder.finish();
}

/**
 * The decorations replace line breaks, so they must come from a state field:
 * CodeMirror refuses block decorations supplied by a view plugin, because it needs
 * them before it can estimate line heights.
 */
export function createLivePreviewExtension(host: LivePreviewHost): Extension {
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

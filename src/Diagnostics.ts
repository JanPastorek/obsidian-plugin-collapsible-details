import { App, Component, MarkdownView, Notice, TFile } from "obsidian";
import { StateField } from "@codemirror/state";
import { DecorationSet, EditorView } from "@codemirror/view";
import { BlockTree, HtmlBlockNode } from "./BlockTree";
import { createContainerElement, fillBlock } from "./ContainerRenderer";
import { HtmlBlockParser } from "./HtmlBlockParser";
import { lastBuildReason } from "./LivePreviewBlocks";

const REPORT_PATH = "details-markdown-diagnostics.md";

/**
 * Writes what the plugin actually sees for the active note into a vault note.
 *
 * Screenshots say what the result looks like but not which stage produced it, and
 * "does it render?" has too many candidate causes (settings, tag set, block
 * detection, the editor field, the decoration build) to narrow down by guessing.
 * This reports each stage's own answer.
 */
export async function writeDiagnostics(
  app: App,
  supportedTags: ReadonlySet<string>,
  settings: Record<string, unknown>,
  field: StateField<DecorationSet> | null
): Promise<void> {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (view === null) {
    new Notice("Details Markdown: open a note first.");
    return;
  }

  const lines = view.editor.getValue().split("\n");
  const tree = BlockTree.build(lines, supportedTags);
  const report: string[] = [
    "# Details Markdown diagnostics",
    "",
    `- note: \`${view.file?.path ?? "(none)"}\``,
    `- view mode: **${view.getMode()}**`,
    `- lines: ${lines.length}`,
    `- settings: \`${JSON.stringify(settings)}\``,
    `- parsed tags: \`${[...supportedTags].join(", ")}\``,
    "",
    "## Editor state",
    "",
  ];

  // @ts-expect-error -- cm is Obsidian's untyped handle on the CodeMirror view.
  const editorView = view.editor?.cm as EditorView | undefined;
  if (editorView === undefined) {
    report.push("- CodeMirror view: **not reachable**");
  } else {
    report.push(`- last decoration build: \`${lastBuildReason}\``);
    if (field === null) {
      report.push("- decoration field: **not registered**");
    } else {
      const decorations = editorView.state.field(field, false);
      report.push(
        decorations === undefined
          ? "- decoration field: **absent from editor state** (extension not installed)"
          : `- decorations currently active: **${decorations.size}**`
      );
    }
  }

  report.push("", "## Blocks found", "");
  if (tree.length === 0) {
    report.push("**No blocks found.** The scanner matched nothing in this note.");
  } else {
    describe(tree, lines, supportedTags, report, 0);
  }

  report.push("", "## Rendered output", "");
  if (tree.length === 0) {
    report.push("(nothing to render)");
  } else {
    report.push(...(await renderSample(app, supportedTags, lines, tree[0], view.file?.path ?? "")));
  }

  await write(app, report.join("\n"));
  new Notice(`Details Markdown: wrote ${REPORT_PATH}`);
}

function describe(
  nodes: readonly HtmlBlockNode[],
  lines: readonly string[],
  supportedTags: ReadonlySet<string>,
  report: string[],
  depth: number
): void {
  for (const node of nodes) {
    const indent = "  ".repeat(depth);
    const source = lines.slice(node.range.startLine, node.range.endLine + 1);
    const parsed = HtmlBlockParser.parse(source.join("\n"), supportedTags);
    report.push(
      `${indent}- \`<${node.range.tag}>\` lines ${node.range.startLine}–${node.range.endLine}, ` +
        `${node.children.length} nested, parse: ${parsed === null ? "**FAILED**" : `ok (\`${parsed.openTag}\`)`}`
    );
    describe(node.children, lines, supportedTags, report, depth + 1);
  }
}

/**
 * Runs the real render path into a detached element and reports the HTML it produces.
 *
 * The stages above can all report success while the output is still wrong; this is the
 * only line that shows what the user is actually looking at.
 */
async function renderSample(
  app: App,
  supportedTags: ReadonlySet<string>,
  lines: readonly string[],
  node: HtmlBlockNode,
  sourcePath: string
): Promise<string[]> {
  const sourceLines = lines.slice(node.range.startLine, node.range.endLine + 1);
  const component = new Component();
  component.load();
  try {
    const element = createContainerElement(sourceLines[0], node.range.tag);
    const filled = await fillBlock(
      { app, supportedTags, sourcePath, component, renderMath: false },
      element,
      sourceLines,
      node.range.startLine
    );
    const html = element.innerHTML;
    return [
      `- fillBlock returned: **${filled}**`,
      `- child elements produced: **${element.children.length}**`,
      `- html length: ${html.length}`,
      "",
      "```html",
      html.slice(0, 3000),
      "```",
    ];
  } catch (error) {
    return ["**render threw:**", "", "```", String(error), "```"];
  } finally {
    component.unload();
  }
}

async function write(app: App, contents: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(REPORT_PATH);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, contents);
    return;
  }
  await app.vault.create(REPORT_PATH, contents);
}

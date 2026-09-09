import {
  App,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  finishRenderMath,
  loadMathJax,
} from "obsidian";
import { Extension, Prec, StateField } from "@codemirror/state";
import { DecorationSet } from "@codemirror/view";
import { createContainerElement, fillBlock, flushMath } from "./ContainerRenderer";
import { writeDiagnostics } from "./Diagnostics";
import { HtmlBlockParser } from "./HtmlBlockParser";
import { LivePreviewHost, createLivePreviewExtension } from "./LivePreviewBlocks";
import { HtmlBlockRange, HtmlBlockRangeScanner } from "./HtmlBlockRangeScanner";
import { SectionRoleClassifier } from "./SectionRoleClassifier";
import { SupportedTags } from "./SupportedTags";

interface DetailsMarkdownSettings {
  enabled: boolean;
  /** Comma-separated container tags whose bodies render as Markdown. */
  supportedTags: string;
  /** Flush MathJax after each body render so $...$ and $$...$$ typeset inside blocks. */
  renderMath: boolean;
  /** Render blocks in the editor too, revealing source while the cursor is inside. */
  enableLivePreview: boolean;
}

const DEFAULT_SETTINGS: DetailsMarkdownSettings = {
  enabled: true,
  supportedTags: "details, div, section, aside, article, figure, center",
  renderMath: true,
  enableLivePreview: true,
};

/** Marks a container element whose body we already replaced, so re-runs never double-render. */
const RENDERED_ATTRIBUTE = "data-details-markdown-rendered";
/** Hides escaped fragment sections (styles.css); removed by unhide/reconcile. */
const HIDDEN_FRAGMENT_CLASS = "details-markdown-hidden-fragment";
/** Bounded retries for the post-render fragment sweep, which must wait for DOM attach. */
const FRAGMENT_SWEEP_MAX_TRIES = 10;

/** A container block whose body this plugin rendered; tracked to detect staleness and leaks. */
interface RenderedBlockEntry {
  sectionEl: HTMLElement;
  blockEl: HTMLElement;
  lifecycleOwner: MarkdownRenderChild;
  renderedSource: string;
  /** Sections render detached and attach later; only ever-connected elements can be pronounced dead. */
  everConnected: boolean;
}

/** A section we hid because its content is rendered inside a fold; tracked so it can be unhidden. */
interface HiddenFragmentEntry {
  el: HTMLElement;
  everConnected: boolean;
}

interface PathBlocks {
  rendered: RenderedBlockEntry[];
  hidden: HiddenFragmentEntry[];
}

export default class DetailsMarkdownPlugin extends Plugin implements LivePreviewHost {
  settings: DetailsMarkdownSettings = DEFAULT_SETTINGS;
  private readonly blocksByPath = new Map<string, PathBlocks>();
  /** Cached parse of `settings.supportedTags`; rebuilt whenever the setting changes. */
  private tagSet: ReadonlySet<string> = SupportedTags.parse(DEFAULT_SETTINGS.supportedTags);
  /**
   * Registered once by reference and mutated in place: swapping in a fresh state field
   * and calling `updateOptions` is what makes a settings change take effect in open
   * editors, since an existing field keeps its decorations until it is replaced.
   */
  private readonly editorExtensions: Extension[] = [];
  /** Kept so the diagnostics command can ask the live editor what it actually holds. */
  private livePreviewField: StateField<DecorationSet> | null = null;

  // --- LivePreviewHost -------------------------------------------------------
  get supportedTags(): ReadonlySet<string> {
    return this.tagSet;
  }
  get enabled(): boolean {
    return this.settings.enabled;
  }
  get livePreviewEnabled(): boolean {
    return this.settings.enableLivePreview;
  }
  get renderMath(): boolean {
    return this.settings.renderMath;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    // Idempotent; ensures MathJax is present before the first body render needs it.
    loadMathJax().catch((error) =>
      console.error("details-markdown: failed to load MathJax", error)
    );
    this.addSettingTab(new DetailsMarkdownSettingTab(this.app, this));

    this.livePreviewField = createLivePreviewExtension(this);
    // Prec.highest: Obsidian's own Live Preview renderer puts a replace decoration
    // over the same HTML block and outranks a plainly registered extension, so its
    // widget wins and ours is built but never shown. Raising precedence is what
    // makes our decoration the one that renders.
    this.editorExtensions.push(Prec.highest(this.livePreviewField));
    this.registerEditorExtension(this.editorExtensions);

    this.addCommand({
      id: "diagnostics",
      name: "Write diagnostics for the current note",
      callback: () => {
        void writeDiagnostics(this.app, this.tagSet, { ...this.settings }, this.livePreviewField);
      },
    });

    this.registerMarkdownPostProcessor(async (el, ctx) => {
      if (!this.settings.enabled) {
        return;
      }
      try {
        await this.processSection(el, ctx);
      } catch (error) {
        // Never throw into Obsidian's render loop; the section stays native.
        console.error("details-markdown: failed to process section", error);
      }
    });
  }

  onunload(): void {
    this.blocksByPath.clear();
    // Restore native rendering in already-open views.
    this.rerenderOpenMarkdownViews();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.tagSet = SupportedTags.parse(this.settings.supportedTags);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Applies a settings change immediately: full re-render restores native or rendered state. */
  onSettingsChanged(): void {
    this.tagSet = SupportedTags.parse(this.settings.supportedTags);
    this.blocksByPath.clear();
    this.rerenderOpenMarkdownViews();
    this.refreshEditorExtensions();
  }

  /** Replaces the live-preview state field so open editors rebuild their decorations. */
  private refreshEditorExtensions(): void {
    this.editorExtensions.length = 0;
    this.livePreviewField = createLivePreviewExtension(this);
    this.editorExtensions.push(Prec.highest(this.livePreviewField));
    this.app.workspace.updateOptions();
  }

  private rerenderOpenMarkdownViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        view.previewMode?.rerender(true);
      }
    }
  }

  private rerenderViewsForPath(path: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) {
        view.previewMode?.rerender(true);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Section processing
  // ---------------------------------------------------------------------------

  private async processSection(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    const sectionInfo = ctx.getSectionInfo(el);
    if (sectionInfo === null) {
      // No source access (embeds, export, nested renders): leave native.
      return;
    }
    const lines = sectionInfo.text.split("\n");
    const ranges = HtmlBlockRangeScanner.scan(sectionInfo.text, this.tagSet);

    await this.reconcileTrackedBlocks(ctx, ranges, lines);

    const role = SectionRoleClassifier.classify(ranges, sectionInfo.lineStart, sectionInfo.lineEnd);
    if (role.kind === "opening") {
      await this.renderOpeningSection(el, ctx, role.range, lines);
    } else if (role.kind === "fragment") {
      this.hideFragmentIfBlockRendered(el, ctx, role.range);
    }
  }

  /** Renders the full block body (from raw source) into the section's <details> element. */
  private async renderOpeningSection(
    sectionEl: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    range: HtmlBlockRange,
    lines: string[]
  ): Promise<void> {
    const source = this.sliceRange(lines, range);
    const sourceLines = lines.slice(range.startLine, range.endLine + 1);
    const parsed = HtmlBlockParser.parse(source, this.tagSet);
    if (parsed === null || parsed.bodyMarkdown === "") {
      return;
    }
    const blockEl = this.resolveBlockElement(sectionEl, parsed.tag, parsed.openTag);
    if (blockEl === null || blockEl.hasAttribute(RENDERED_ATTRIBUTE)) {
      return;
    }

    blockEl.empty();
    // MarkdownRenderChild ties embeds/Dataview/etc. in the body to the note's
    // lifecycle via ctx.addChild, so everything unloads when the note closes.
    const lifecycleOwner = new MarkdownRenderChild(blockEl);
    ctx.addChild(lifecycleOwner);
    blockEl.setAttribute(RENDERED_ATTRIBUTE, "true");

    await fillBlock(
      this.renderContext(ctx.sourcePath, lifecycleOwner),
      blockEl,
      sourceLines,
      range.startLine
    );
    await flushMath(this.settings.renderMath);

    this.pathBlocks(ctx.sourcePath).rendered.push({
      sectionEl,
      blockEl,
      lifecycleOwner,
      renderedSource: source,
      everConnected: sectionEl.isConnected,
    });

    // Fragment sections may have rendered before this opening (scroll order is not
    // guaranteed); sweep siblings once attached so nothing shows twice.
    this.scheduleFragmentSweep(sectionEl, ctx, FRAGMENT_SWEEP_MAX_TRIES);
  }

  /**
   * Hides an escaped fragment section, but only when its block's opening is actually
   * rendered — otherwise (e.g. opening glued into a list section) hiding would lose content.
   */
  private hideFragmentIfBlockRendered(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    range: HtmlBlockRange
  ): void {
    const opening = this.findRenderedOpening(ctx, ctx.sourcePath, range.startLine);
    if (opening === null) {
      // The opening's post-render sweep will hide this section if the block renders.
      return;
    }
    this.hideFragment(el, ctx.sourcePath);
  }

  /** After the opening attaches, hides already-rendered sibling sections inside its block. */
  private scheduleFragmentSweep(
    sectionEl: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    triesLeft: number
  ): void {
    if (triesLeft <= 0) {
      return;
    }
    requestAnimationFrame(() => {
      try {
        if (!sectionEl.isConnected) {
          this.scheduleFragmentSweep(sectionEl, ctx, triesLeft - 1);
          return;
        }
        this.sweepSiblingFragments(sectionEl, ctx);
      } catch (error) {
        console.error("details-markdown: fragment sweep failed", error);
      }
    });
  }

  private sweepSiblingFragments(
    sectionEl: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): void {
    const openingInfo = ctx.getSectionInfo(sectionEl);
    const parent = sectionEl.parentElement;
    if (openingInfo === null || parent === null) {
      return;
    }
    const ranges = HtmlBlockRangeScanner.scan(openingInfo.text, this.tagSet);
    for (const sibling of Array.from(parent.children)) {
      if (
        sibling === sectionEl ||
        !(sibling instanceof HTMLElement) ||
        sibling.classList.contains(HIDDEN_FRAGMENT_CLASS)
      ) {
        continue;
      }
      const info = ctx.getSectionInfo(sibling);
      if (info === null) {
        continue;
      }
      const role = SectionRoleClassifier.classify(ranges, info.lineStart, info.lineEnd);
      if (role.kind === "fragment" && role.range.startLine === openingInfo.lineStart) {
        this.hideFragment(sibling, ctx.sourcePath);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Reconciliation: staleness after interior edits, unhiding, dead-entry cleanup
  // ---------------------------------------------------------------------------

  private async reconcileTrackedBlocks(
    ctx: MarkdownPostProcessorContext,
    ranges: HtmlBlockRange[],
    lines: string[]
  ): Promise<void> {
    const path = ctx.sourcePath;
    const blocks = this.blocksByPath.get(path);
    if (blocks === undefined) {
      return;
    }

    for (const entry of [...blocks.rendered]) {
      entry.everConnected ||= entry.sectionEl.isConnected;
      if (entry.everConnected && !entry.sectionEl.isConnected) {
        this.remove(blocks.rendered, entry);
        continue;
      }
      const info = ctx.getSectionInfo(entry.sectionEl);
      if (info === null) {
        continue;
      }
      const range = ranges.find((r) => r.startLine === info.lineStart);
      if (range === undefined) {
        // Block boundary edited away (e.g. </details> deleted): full re-render restores
        // native output; entry removed first so this cannot loop.
        this.remove(blocks.rendered, entry);
        this.rerenderViewsForPath(path);
        continue;
      }
      const source = this.sliceRange(lines, range);
      if (source !== entry.renderedSource) {
        await this.rerenderStaleBody(entry, source, range.startLine, ctx);
      }
    }

    for (const fragment of [...blocks.hidden]) {
      fragment.everConnected ||= fragment.el.isConnected;
      if (fragment.everConnected && !fragment.el.isConnected) {
        this.remove(blocks.hidden, fragment);
        continue;
      }
      const info = ctx.getSectionInfo(fragment.el);
      if (info === null) {
        continue;
      }
      const role = SectionRoleClassifier.classify(ranges, info.lineStart, info.lineEnd);
      if (role.kind !== "fragment") {
        fragment.el.classList.remove(HIDDEN_FRAGMENT_CLASS);
        this.remove(blocks.hidden, fragment);
      }
    }
  }

  /**
   * Re-renders a block body in place after an interior (blank-line-separated) edit:
   * Obsidian re-renders only the edited fragment section, never the opening one.
   */
  private async rerenderStaleBody(
    entry: RenderedBlockEntry,
    source: string,
    startLine: number,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    const parsed = HtmlBlockParser.parse(source, this.tagSet);
    if (parsed === null || parsed.bodyMarkdown === "") {
      this.remove(this.pathBlocks(ctx.sourcePath).rendered, entry);
      this.rerenderViewsForPath(ctx.sourcePath);
      return;
    }
    // Unload the old lifecycle owner so embeds from the previous body do not leak.
    entry.lifecycleOwner.unload();
    entry.blockEl.empty();
    const lifecycleOwner = new MarkdownRenderChild(entry.blockEl);
    ctx.addChild(lifecycleOwner);
    entry.lifecycleOwner = lifecycleOwner;
    entry.renderedSource = source;
    await fillBlock(
      this.renderContext(ctx.sourcePath, lifecycleOwner),
      entry.blockEl,
      source.split("\n"),
      startLine
    );
    await flushMath(this.settings.renderMath);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private findRenderedOpening(
    ctx: MarkdownPostProcessorContext,
    path: string,
    blockStartLine: number
  ): RenderedBlockEntry | null {
    for (const entry of this.pathBlocks(path).rendered) {
      const info = ctx.getSectionInfo(entry.sectionEl);
      if (info !== null && info.lineStart === blockStartLine) {
        return entry;
      }
    }
    return null;
  }

  private hideFragment(el: HTMLElement, path: string): void {
    el.classList.add(HIDDEN_FRAGMENT_CLASS);
    this.pathBlocks(path).hidden.push({ el, everConnected: el.isConnected });
  }

  /**
   * Returns the section's container element only when the section contains exactly
   * one top-level element of `tag`; otherwise the section is not a supported opening.
   * "Top-level" is judged within the section, so an unrelated wrapper outside it
   * (e.g. another note's fold in an embed) can never suppress a match.
   */
  /**
   * Finds the element Obsidian rendered for this block, or builds one.
   *
   * A container whose opening tag is followed by a blank line is a truncated HTML
   * block, and Obsidian may render nothing at all for that section; without a
   * fallback the whole block would silently stay native. Building it here keeps
   * such notes working, and the source is the same opening tag either way.
   */
  private resolveBlockElement(
    sectionEl: HTMLElement,
    tag: string,
    openTag: string
  ): HTMLElement | null {
    const existing = this.findSingleTopLevelBlock(sectionEl, tag);
    if (existing !== null) {
      return existing;
    }
    if (sectionEl.querySelector(tag) !== null) {
      // Several candidates: ambiguous, so leave the section native.
      return null;
    }
    const created = createContainerElement(openTag, tag);
    sectionEl.empty();
    sectionEl.appendChild(created);
    return created;
  }

  private renderContext(sourcePath: string, component: MarkdownRenderChild) {
    return {
      app: this.app,
      supportedTags: this.tagSet,
      sourcePath,
      component,
      renderMath: this.settings.renderMath,
    };
  }

  private findSingleTopLevelBlock(el: HTMLElement, tag: string): HTMLElement | null {
    // Safe as a selector: SupportedTags only admits /^[a-z][a-z0-9-]*$/ names.
    const topLevel = Array.from(el.querySelectorAll<HTMLElement>(tag)).filter(
      (candidate) => !this.hasSupportedAncestorWithin(candidate, el)
    );
    return topLevel.length === 1 ? topLevel[0] : null;
  }

  private hasSupportedAncestorWithin(el: HTMLElement, boundary: HTMLElement): boolean {
    for (let parent = el.parentElement; parent !== null && parent !== boundary; ) {
      if (this.tagSet.has(parent.tagName.toLowerCase())) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  private sliceRange(lines: string[], range: HtmlBlockRange): string {
    return lines.slice(range.startLine, range.endLine + 1).join("\n");
  }

  private pathBlocks(path: string): PathBlocks {
    let blocks = this.blocksByPath.get(path);
    if (blocks === undefined) {
      blocks = { rendered: [], hidden: [] };
      this.blocksByPath.set(path, blocks);
    }
    return blocks;
  }

  private remove<T>(list: T[], item: T): void {
    const index = list.indexOf(item);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }
}

class DetailsMarkdownSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DetailsMarkdownPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("Render Markdown inside HTML container blocks")
      .setDesc("When off, Obsidian's native (literal) behavior is restored.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
          this.plugin.onSettingsChanged();
        })
      );

    new Setting(this.containerEl)
      .setName("Container tags")
      .setDesc(
        "Comma-separated HTML tags whose bodies render as Markdown. " +
          "Each tag must sit alone on its line, with a matching closing tag. " +
          "Set to just \u201cdetails\u201d to restrict the plugin to folds."
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.supportedTags)
          .setValue(this.plugin.settings.supportedTags)
          .onChange(async (value) => {
            this.plugin.settings.supportedTags = value;
            await this.plugin.saveSettings();
            this.plugin.onSettingsChanged();
          })
      );

    new Setting(this.containerEl)
      .setName("Render in Live Preview")
      .setDesc(
        "Render blocks in the editor as well as Reading view. " +
          "Put the cursor inside a block to edit its source; move it out to render again."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableLivePreview).onChange(async (value) => {
          this.plugin.settings.enableLivePreview = value;
          await this.plugin.saveSettings();
          this.plugin.onSettingsChanged();
        })
      );

    new Setting(this.containerEl)
      .setName("Render LaTeX math")
      .setDesc(
        "Typeset $...$ and $$...$$ inside rendered bodies. " +
          "Turn off only if math elsewhere in the note misbehaves."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.renderMath).onChange(async (value) => {
          this.plugin.settings.renderMath = value;
          await this.plugin.saveSettings();
          this.plugin.onSettingsChanged();
        })
      );
  }
}

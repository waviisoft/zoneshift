import { findConversions, type Conversion, type ConvertOptions } from '@zoneshift/core';

/**
 * Page annotator. Every recognised time gets a clock icon after it:
 *  - prose times are converted straight away (solid icon);
 *  - timestamps in code/log blocks and ISO 8601 timestamps are left as
 *    written (hollow icon) until the reader asks for them.
 * The icon opens a popover to switch one time, or every time on the page.
 *
 * A text node that holds a recognised time is replaced by one inline
 * <zoneshift-run> element holding the text and the marks, so it stays a
 * single item in flex and grid layouts and can be swapped back for the
 * original text node at any moment (editing, stop).
 *
 * Not built yet: settings, per-site memory, feedback, <time> elements.
 */

export type State = 'converted' | 'original';

export interface Annotator {
  /** Mark every recognised time under `root`. */
  annotate(root: Node): void;
  setState(mark: HTMLElement, state: State): void;
  /** Switch every time on the page, and remember the choice for later content. */
  setAll(state: State): void;
  openPopover(mark: HTMLElement): void;
  /** Close the popover; focus returns to its icon if focus was inside the popover. */
  closePopover(): void;
  /** Put the page's own text nodes back under `root`, removing every mark. */
  restore(root: Node): void;
  /**
   * Annotate the document, wire up the icons and watch for added content.
   * Returns a stop function, which also restores the page's original text.
   */
  start(): () => void;
}

export const POPOVER_ID = 'zoneshift-popover';
/** Delay before content added to the page is annotated, in milliseconds. */
export const MUTATION_DELAY = 200;
/**
 * Budget per container against sites that undo the annotator's work over and
 * over (putting a snapshot back, restoring their own text): this many strikes
 * within FIGHT_WINDOW pause the container for a back-off that doubles each time.
 */
export const FIGHT_LIMIT = 5;
export const FIGHT_WINDOW = 2_000;
export const BACKOFF_START = 5_000;
export const BACKOFF_MAX = 5 * 60_000;
/** A run of ours removed by the page this soon after it was made counts as a strike. */
export const FIGHT_RECENT = 1_000;

/** Element names. Custom names, so page rules aimed at `span` or `div` never match them. */
export const RUN_TAG = 'zoneshift-run';
export const MARK_TAG = 'zoneshift-mark';
export const TEXT_TAG = 'zoneshift-text';
export const ICON_TAG = 'zoneshift-icon';
const POPOVER_TAG = 'zoneshift-popover';
/** Elements that may turn up as copies of the annotator's own (cloned, pasted, restored from a snapshot). */
const COPYABLE = `${RUN_TAG}, ${MARK_TAG}, ${TEXT_TAG}, ${ICON_TAG}, ${POPOVER_TAG}`;
/** On each mark: the text it replaced, so any copy of it can be turned back into the original. */
const ORIGINAL_ATTR = 'data-zs-original';
const OWN_PREFIX = 'zoneshift-';

const XHTML = 'http://www.w3.org/1999/xhtml';

/** HTML elements whose text is never touched (compared by lower-case local name). */
const SKIP = new Set([
  // not rendered as page text
  'script', 'style', 'noscript', 'template', 'title', 'iframe', 'noembed', 'noframes', 'object', 'canvas',
  'audio', 'video', 'xmp', 'plaintext',
  // form controls and their contents
  'textarea', 'input', 'select', 'option', 'optgroup', 'datalist',
  // machine-readable already; handled separately later
  'time',
  // foreign content (also caught by the namespace check)
  'svg', 'math',
]);
/** ARIA roles of custom text-entry widgets. */
const TEXT_ENTRY_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const TECHNICAL = 'code, pre, samp, kbd, tt';

/**
 * Inline elements whose text is read as part of the same line when checking
 * what sits on either side of a text node. Anything else is a boundary.
 */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd',
  'label', 'mark', 'nobr', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'tt', 'u', 'var',
  RUN_TAG,
]);
/** How much neighbouring text is read on each side. */
const CONTEXT = 64;
/** Characters that, touching a match, mean the match may be part of something longer. */
const GLUED_BEFORE = /[\p{L}\p{N}+\-−‐-―:/]$/u;
const GLUED_AFTER = /^[\p{L}\p{N}+\-−‐-―:/]/u;

const POPOVER_CSS = `
  :host {
    all: initial !important; display: block !important; position: fixed !important;
    z-index: 2147483647 !important; left: var(--zs-left) !important; top: var(--zs-top) !important;
  }
  .box {
    font: 13px/1.4 system-ui, sans-serif; color: #111827; background: #fff;
    border: 1px solid #d1d5db; border-radius: 8px; padding: 10px 12px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); width: max-content; max-width: min(320px, calc(100vw - 16px));
    box-sizing: border-box;
  }
  dl { margin: 0 0 8px; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  dt { color: #6b7280; } dd { margin: 0; overflow-wrap: anywhere; }
  .note { color: #b45309; margin: 0 0 8px; }
  button {
    display: block; width: 100%; margin-top: 6px; padding: 7px 10px; font: inherit; text-align: start;
    color: inherit; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer;
  }
  button:hover { background: #e5e7eb; }
  @media (prefers-color-scheme: dark) {
    .box { color: #f3f4f6; background: #1f2937; border-color: #4b5563; }
    dt { color: #9ca3af; } .note { color: #fbbf24; }
    button { background: #374151; border-color: #4b5563; } button:hover { background: #4b5563; }
  }
`;

/** What replaced one of the page's text nodes. */
interface Run {
  /** The page's own text node, detached and unchanged while the run is in the page. */
  original: Text;
  /** The neighbouring text it was read with. */
  context: string;
  /** Where and what each mark in the run was read as, to notice when context changes the reading. */
  readings: string;
  /** When it was made (Date.now()). */
  created: number;
}

/** A record of fights with the page, for a container or for one copied text. */
interface Budget {
  strikes: number[];
  /** Paused until this time (Date.now()). */
  until: number;
  backoff: number;
  /** For copied text: where paused copies were left, to look at again on resuming. */
  left?: WeakRef<Element>[];
}
/** At most this many copied texts are tracked; the oldest is forgotten first. */
const COPY_BUDGETS = 500;

/** What a text node will become. */
interface Plan {
  node: Text;
  found: Conversion[];
  context: [before: string, after: string];
}

const DAY = 86_400_000;
/** "5:30 PM PST (−1 day)" → "5:30 PM PST". */
const withoutDayShift = (converted: string) => converted.replace(/\s*\([+\u2212-]\d+ days?\)$/u, '');

function isModal(dialog: Element): boolean {
  try {
    return dialog.matches(':modal');
  } catch {
    return false; // a browser without :modal
  }
}

const readingsOf = (conversions: Conversion[]) =>
  conversions.map((c) => `${c.index}:${c.length}:${c.epochMs}`).join(',');

/**
 * @param doc      The document to annotate.
 * @param options  Passed to the conversion engine (target zone, reference time, default zone).
 */
export function createAnnotator(doc: Document, options: ConvertOptions = {}): Annotator {
  const view = doc.defaultView;
  /** Only HTML and XHTML documents are annotated: not SVG or XML documents, or the browser's XML viewer. */
  const supported = view != null && doc.documentElement?.namespaceURI === XHTML;
  // Weak, so marks and runs a page throws away are never kept alive here.
  const conversions = new WeakMap<Element, Conversion>();
  const runs = new WeakMap<Element, Run>();
  /** Set once the reader picks "all on this page"; applied to content added later. */
  let pageState: State | null = null;
  let popover: { host: HTMLElement; mark: HTMLElement; icon: HTMLElement } | null = null;
  /**
   * A press on annotated text: where in the original text it landed, and the
   * restored text node if the run was put back during the press (a site that
   * makes content editable on mousedown).
   */
  let press: { run: Element; offset: number; text?: Text } | null = null;
  /** Fights over the annotator's own runs, by the container the page changes. */
  const budgets = new WeakMap<Element, Budget>();
  /**
   * Fights over copies, by the text copied, not where it lands: a site
   * putting the same snapshot back may build a new wrapper each time.
   */
  const copyBudgets = new Map<string, Budget>();
  /** Called when a back-off ends, to look at these elements again. */
  let onResume: (elements: () => Element[], delay: number) => void = () => {};

  const newBudget = (): Budget => ({ strikes: [], until: 0, backoff: BACKOFF_START });
  /** Count one fight; enough of them within FIGHT_WINDOW pause it. Returns the pause, if one began. */
  function count(b: Budget, now: number): number {
    b.strikes = b.strikes.filter((t) => now - t < FIGHT_WINDOW);
    b.strikes.push(now);
    if (b.strikes.length < FIGHT_LIMIT) return 0;
    const delay = b.backoff;
    b.strikes = [];
    b.until = now + delay;
    b.backoff = Math.min(b.backoff * 2, BACKOFF_MAX);
    return delay;
  }
  function strike(container: Element, now = Date.now()): void {
    let b = budgets.get(container);
    if (!b) budgets.set(container, (b = newBudget()));
    const delay = count(b, now);
    if (delay) onResume(() => [container], delay);
  }
  /** Count a fight over a copy; true if this one began a pause. */
  function strikeCopy(key: string, now: number): boolean {
    let b = copyBudgets.get(key);
    if (!b) {
      if (copyBudgets.size >= COPY_BUDGETS) copyBudgets.delete(copyBudgets.keys().next().value!);
      copyBudgets.set(key, (b = newBudget()));
    }
    const delay = count(b, now);
    if (delay) {
      const budget = b;
      budget.left = [];
      onResume(() => {
        const left = (budget.left ?? []).map((r) => r.deref()).filter((e): e is Element => !!e);
        budget.left = undefined;
        return left;
      }, delay);
    }
    return delay > 0;
  }
  const paused = (el: Element, now: number) => (budgets.get(el)?.until ?? 0) > now;
  /** What a copy is counted under: the text it stands for. */
  const copyKey = (el: Element) =>
    el.localName === RUN_TAG
      ? `run:${[...el.childNodes].map(lengthlessText).join('')}`
      : el.localName === MARK_TAG
        ? `mark:${markOriginal(el)}`
        : `${el.localName}:${el.textContent ?? ''}`;

  const isOwn = (el: Element) => el.localName.startsWith(OWN_PREFIX);
  const designMode = () => doc.designMode === 'on';

  /**
   * Editable through inheritance or a style. Chromium honours
   * `-webkit-user-modify: read-write` for editing but not in isContentEditable.
   */
  function editableByStyle(el: Element): boolean {
    if ((el as HTMLElement).isContentEditable) return true;
    const modify = view?.getComputedStyle(el).getPropertyValue('-webkit-user-modify') ?? '';
    return modify.startsWith('read-write');
  }

  /** Whether an element is an editing host or inside one (including `contenteditable="false"` islands). */
  function inEditable(el: Element | null): boolean {
    if (!el) return false;
    if (designMode() || editableByStyle(el)) return true;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const ce = e.getAttribute('contenteditable');
      if (ce !== null && ce.toLowerCase() !== 'false') return true;
    }
    return false;
  }

  /** The outermost editable element around `el`, or null if it is not editable. */
  function editingRoot(el: Element): Element | null {
    if (designMode()) return doc.body ?? doc.documentElement;
    if (!inEditable(el)) return null;
    let root = el;
    while (root.parentElement && inEditable(root.parentElement)) root = root.parentElement;
    return root;
  }

  /** Structural checks, cheap enough for every text node with a digit. */
  function shouldSkip(node: Text): boolean {
    const parent = node.parentElement;
    if (!parent || !doc.body || designMode()) return true;
    let inBody = false;
    const now = Date.now();
    for (let el: Element | null = parent; el; el = el.parentElement) {
      if (el === doc.body) inBody = true;
      if (el.namespaceURI !== XHTML || paused(el, now)) return true;
      const name = el.localName.toLowerCase();
      if (SKIP.has(name) || name.startsWith(OWN_PREFIX)) return true;
      const ce = el.getAttribute('contenteditable');
      if (ce !== null && ce.toLowerCase() !== 'false') return true;
      const role = el.getAttribute('role');
      if (role && TEXT_ENTRY_ROLES.has(role.trim().toLowerCase())) return true;
    }
    return !inBody;
  }

  /** Text of a node as part of the surrounding line, or null if it is a boundary (a block, a line break). */
  function inlineText(n: Node): string | null {
    if (n.nodeType === 3) return (n as Text).data;
    if (n.nodeType !== 1) return '';
    const el = n as Element;
    const run = runs.get(el);
    if (run) return run.original.data;
    if (el.namespaceURI === XHTML && INLINE.has(el.localName.toLowerCase())) return el.textContent ?? '';
    return null;
  }

  /** Up to CONTEXT characters of text on one side of `node`, within the same line of inline content. */
  function contextText(node: Node, forward: boolean): string {
    let out = '';
    for (let cur: Node = node; ; ) {
      for (let sib = forward ? cur.nextSibling : cur.previousSibling; sib; sib = forward ? sib.nextSibling : sib.previousSibling) {
        const t = inlineText(sib);
        if (t === null) return out;
        out = forward ? out + t : t + out;
        if (out.length >= CONTEXT) return forward ? out.slice(0, CONTEXT) : out.slice(-CONTEXT);
      }
      const parent = cur.parentElement;
      if (!parent || parent.namespaceURI !== XHTML || !INLINE.has(parent.localName.toLowerCase())) return out;
      cur = parent;
    }
  }

  /**
   * The text on either side of `text`, which sits at `at`. In code and log
   * blocks a newline is a hard line break, so the context stops there.
   */
  function contextOf(text: string, at: Node): [before: string, after: string] {
    let before = contextText(at, false);
    let after = contextText(at, true);
    if (at.parentElement?.closest(TECHNICAL)) {
      before = text.startsWith('\n') ? '' : before.slice(before.lastIndexOf('\n') + 1);
      after = text.endsWith('\n') ? '' : after.split('\n', 1)[0]!;
    }
    return [before, after];
  }

  /**
   * Conversions in `text`, which sits between `before` and `after` in the page.
   * A match is kept only if reading it together with the text on either side
   * gives the same match: "10:00 AM UTC" followed by a text node "+2" is left
   * alone, as is a match touching neighbouring text that could continue it
   * (letters, digits, + - : /). Text before it may only add a date or weekday
   * that leaves the local time unchanged ("Friday at" + "1:30 AM UTC").
   */
  function find(text: string, [before, after]: [string, string]): Conversion[] {
    const found = findConversions(text, options);
    if (found.length === 0 || (before === '' && after === '')) return found;
    const whole = findConversions(before + text + after, options);
    const b = before.length;
    return found.filter((c) => {
      const start = c.index + b;
      const end = start + c.length;
      if (c.index === 0 && GLUED_BEFORE.test(before)) return false;
      if (c.index + c.length === text.length && GLUED_AFTER.test(after)) return false;
      return whole.some((w) => {
        if (w.index + w.length !== end || w.index > start) return false;
        if (w.index === start) return w.epochMs === c.epochMs;
        // Extended leftwards: only a date or weekday, read as the same clock
        // time on another day and shown as the same local time. A range or
        // list start, or a daylight-saving change between the days, fails.
        return (w.epochMs - c.epochMs) % DAY === 0 && w.converted.endsWith(withoutDayShift(c.converted));
      });
    });
  }

  function setState(mark: HTMLElement, state: State): void {
    const c = conversions.get(mark);
    if (!c) return;
    mark.dataset.zsState = state;
    mark.firstElementChild!.textContent = state === 'converted' ? c.converted : c.original;
    mark.lastElementChild!.setAttribute(
      'aria-label',
      state === 'converted' ? `Converted to local time. Original: ${c.original}` : `Local time: ${c.converted}`,
    );
  }

  function setAll(state: State): void {
    pageState = state;
    // A snapshot: walking a live collection while changing the page is quadratic.
    for (const mark of doc.querySelectorAll<HTMLElement>(MARK_TAG)) setState(mark, state);
  }

  function createMark(c: Conversion, technical: boolean): HTMLElement {
    const mark = doc.createElement(MARK_TAG);
    mark.className = 'zoneshift';
    mark.setAttribute(ORIGINAL_ATTR, c.original);
    mark.dataset.zsConfidence = c.confidence;
    const text = doc.createElement(TEXT_TAG);
    const icon = doc.createElement(ICON_TAG);
    icon.className = 'zoneshift-icon';
    icon.setAttribute('role', 'button');
    icon.setAttribute('aria-haspopup', 'dialog');
    icon.setAttribute('aria-expanded', 'false');
    icon.tabIndex = 0;
    mark.append(text, icon);
    conversions.set(mark, c);
    setState(mark, pageState ?? (technical || c.format === 'iso' ? 'original' : 'converted'));
    return mark;
  }

  /** Read phase: what a text node would become, or null. Does not change the page. */
  function plan(node: Text, editable: Map<Element, boolean>): Plan | null {
    const text = node.data;
    if (!node.isConnected || !/\d/.test(text) || shouldSkip(node)) return null;
    const context = contextOf(text, node);
    const found = find(text, context);
    if (found.length === 0) return null;
    // Checked last, once per parent: reading the computed style is the costly part.
    const parent = node.parentElement!;
    let byStyle = editable.get(parent);
    if (byStyle === undefined) editable.set(parent, (byStyle = editableByStyle(parent)));
    return byStyle ? null : { node, found, context };
  }

  /** Write phase. */
  function wrap({ node, found, context }: Plan): void {
    if (!node.isConnected) return;
    const text = node.data;
    const technical = node.parentElement!.closest(TECHNICAL) != null;
    const run = doc.createElement(RUN_TAG);
    run.className = 'zoneshift-run';
    let pos = 0;
    for (const c of found) {
      run.append(text.slice(pos, c.index), createMark(c, technical));
      pos = c.index + c.length;
    }
    run.append(text.slice(pos));
    runs.set(run, { original: node, context: context.join('\0'), readings: readingsOf(found), created: Date.now() });
    node.replaceWith(run);
  }

  /**
   * Read everything first, then write, so reading styles does not force a
   * style recalculation after every change.
   */
  function annotateAll(roots: Iterable<Node>): void {
    if (!supported) return;
    // A set: a batch can hold a node and its own ancestor.
    const nodes = new Set<Text>();
    for (const root of roots) {
      if (!root.isConnected) continue;
      if (root.nodeType === 3) nodes.add(root as Text);
      else {
        const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
        while (walker.nextNode()) nodes.add(walker.currentNode as Text);
      }
    }
    const editable = new Map<Element, boolean>();
    const plans: Plan[] = [];
    for (const node of nodes) {
      const p = plan(node, editable);
      if (p) plans.push(p);
    }
    for (const p of plans) wrap(p);
  }

  function annotate(root: Node): void {
    annotateAll([root]);
  }

  /** Whether an element of ours in the page is one this annotator made and still manages. */
  function isLive(el: Element): boolean {
    switch (el.localName) {
      case RUN_TAG:
        return runs.has(el);
      case MARK_TAG:
        return conversions.has(el) && runs.has(el.parentElement!);
      case TEXT_TAG:
      case ICON_TAG:
        return el.parentElement?.localName === MARK_TAG && isLive(el.parentElement);
      case POPOVER_TAG:
        return el === popover?.host;
      default:
        return true;
    }
  }

  /** The text a mark replaced; for a mark without the attribute, its visible text. */
  const markOriginal = (mark: Element) =>
    mark.getAttribute(ORIGINAL_ATTR) ?? mark.querySelector(TEXT_TAG)?.textContent ?? '';

  /**
   * Position in a run's original text that corresponds to (node, offset) in
   * the run as shown. Inside a converted time the position is scaled to the
   * original's length.
   */
  function originalOffset(run: Element, node: Node, offset: number): number {
    let pos = 0;
    const children = [...run.childNodes];
    if (node === run) {
      for (const child of children.slice(0, offset)) pos += lengthOf(child);
      return pos;
    }
    for (const child of children) {
      if (child === node) return pos + offset;
      if (child.contains(node)) {
        const original = markOriginal(child as Element).length;
        const shown = (child as Element).querySelector(TEXT_TAG)?.textContent?.length ?? 0;
        if (node.nodeType !== 3 || !shown) return pos + original;
        return pos + Math.min(original, Math.round((offset / shown) * original));
      }
      pos += lengthOf(child);
    }
    return pos;
  }
  const lengthOf = (n: Node) =>
    n.nodeType === 3 ? (n as Text).data.length : n.nodeType === 1 && (n as Element).localName === MARK_TAG ? markOriginal(n as Element).length : 0;

  /**
   * Replace a run (ours or a copy) with a text node, moving the selection or
   * caret to the matching place in the restored text.
   */
  function replaceRun(run: Element, text: Text): void {
    const sel = view?.getSelection();
    const inside = (n: Node | null | undefined) => n != null && run.contains(n);
    let anchor: number | null = null;
    let focus: number | null = null;
    if (sel && sel.rangeCount > 0) {
      if (inside(sel.anchorNode)) anchor = originalOffset(run, sel.anchorNode!, sel.anchorOffset);
      if (inside(sel.focusNode)) focus = originalOffset(run, sel.focusNode!, sel.focusOffset);
    }
    if (popover && run.contains(popover.mark)) closePopover();
    if (press?.run === run) press.text = text;
    run.replaceWith(text);
    if (sel && (anchor !== null || focus !== null)) {
      const [an, ao] = anchor !== null ? [text, anchor] : [sel.anchorNode!, sel.anchorOffset];
      const [fn, fo] = focus !== null ? [text, focus] : [sel.focusNode!, sel.focusOffset];
      try {
        sel.setBaseAndExtent(an, ao, fn, fo);
      } catch {
        // The other end moved too; leave the selection to the browser.
      }
    }
  }

  /** The text position under a point. */
  function caretAt(x: number, y: number): { node: Node; offset: number } | null {
    const d = doc as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (d.caretPositionFromPoint) {
      const p = d.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    const r = d.caretRangeFromPoint?.(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }

  /** Swap a run back for the page's own text node. */
  function unwrap(run: Element): void {
    const record = runs.get(run);
    if (!record) return;
    runs.delete(run);
    if (run.parentNode) replaceRun(run, record.original);
  }

  /**
   * Turn a copy of one of our elements (not one this annotator manages) back
   * into plain original text. Returns the text nodes it left, for annotating again.
   */
  function revert(el: Element): Text[] {
    if (!el.parentNode) return [];
    switch (el.localName) {
      case RUN_TAG: {
        const children = [...el.childNodes];
        // Unchanged copy: text and marks only, so it becomes one text node again.
        if (children.every((c) => c.nodeType === 3 || (c.nodeType === 1 && (c as Element).localName === MARK_TAG))) {
          const text = doc.createTextNode(children.map(lengthlessText).join(''));
          replaceRun(el, text);
          return [text];
        }
        // Edited inside: keep what is there, with each time back as written.
        const out: Text[] = [];
        for (const inner of [...el.querySelectorAll(COPYABLE)]) out.push(...revert(inner));
        el.replaceWith(...el.childNodes);
        return out;
      }
      case MARK_TAG:
      case TEXT_TAG: {
        const text = doc.createTextNode(el.localName === MARK_TAG ? markOriginal(el) : (el.textContent ?? ''));
        el.replaceWith(text);
        return [text];
      }
      default:
        el.remove();
        return [];
    }
  }
  const lengthlessText = (n: Node) => (n.nodeType === 3 ? (n as Text).data : markOriginal(n as Element));

  /** Copies of our elements under `root` (including `root`), outermost only, in document order. */
  function copiesIn(root: Element): Element[] {
    const out: Element[] = [];
    const consider = (el: Element) => {
      // Document order: anything inside the last copy found comes right after it.
      const last = out[out.length - 1];
      if (last?.contains(el) || isLive(el)) return;
      out.push(el);
    };
    if (root.matches(COPYABLE)) consider(root);
    for (const el of root.querySelectorAll(COPYABLE)) consider(el);
    return out;
  }

  /**
   * Put the page's own text back under `root`: our runs, and (unless
   * `copies` is false) any copies of them.
   */
  function restore(root: Node, copies = true): void {
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const el = root.nodeType === 9 ? (root as Document).documentElement : (root as Element);
    if (!el) return;
    if (el.localName === RUN_TAG && runs.has(el)) return unwrap(el);
    for (const run of [...el.getElementsByTagName(RUN_TAG)]) unwrap(run);
    if (copies) for (const copy of copiesIn(el)) revert(copy);
  }

  /** Undo a run whose reading changed because text was added next to it. */
  function recheck(run: Element): void {
    const record = runs.get(run);
    if (!record || !run.isConnected) return;
    const context = contextOf(record.original.data, run);
    if (context.join('\0') === record.context) return;
    if (readingsOf(find(record.original.data, context)) !== record.readings) unwrap(run);
    else record.context = context.join('\0');
  }

  function closePopover(): void {
    if (!popover) return;
    const { host, icon } = popover;
    const hadFocus = doc.activeElement === host;
    popover = null;
    host.remove();
    icon.setAttribute('aria-expanded', 'false');
    // Focus would otherwise fall back to <body>.
    if (hadFocus && icon.isConnected) icon.focus({ preventScroll: true });
  }

  function openPopover(mark: HTMLElement): void {
    const c = conversions.get(mark);
    if (!c || !view) return;
    closePopover();
    const icon = mark.lastElementChild as HTMLElement;

    const host = doc.createElement(POPOVER_TAG);
    host.id = POPOVER_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    // A constructed sheet is not subject to the page's content-security policy.
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(POPOVER_CSS);
    shadow.adoptedStyleSheets = [sheet];
    const box = doc.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Zoneshift');
    // Tab is kept inside while it is open.
    box.setAttribute('aria-modal', 'true');

    const dl = doc.createElement('dl');
    for (const [label, value] of [
      ['Original', c.original],
      ['Local', c.converted],
      ['Read as', c.sourceDescription],
    ] as const) {
      const dt = doc.createElement('dt');
      dt.textContent = label;
      const dd = doc.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    }
    box.append(dl);

    if (c.confidence === 'low') {
      const note = doc.createElement('p');
      note.className = 'note';
      note.textContent = 'The zone label is ambiguous, so this may be wrong.';
      box.append(note);
    }

    const buttons: HTMLButtonElement[] = [];
    const button = (label: string, action: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        action();
        closePopover();
      });
      buttons.push(b);
      box.append(b);
    };
    const converted = mark.dataset.zsState === 'converted';
    button(converted ? 'Show original here' : 'Convert to local time', () =>
      setState(mark, converted ? 'original' : 'converted'),
    );
    button('Convert all times on this page', () => setAll('converted'));
    button('Show all originals on this page', () => setAll('original'));

    // Keys pressed in the popover are the popover's: Tab and Shift+Tab cycle
    // through its buttons, and nothing reaches the page's own key handlers.
    box.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const i = buttons.indexOf(shadow.activeElement as HTMLButtonElement);
      const next = i < 0 ? 0 : (i + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]!.focus();
    });
    for (const type of ['keyup', 'keypress'] as const) box.addEventListener(type, (event) => event.stopPropagation());
    // Focus moving elsewhere in the page (a click, a script) closes it.
    shadow.addEventListener('focusout', (event) => {
      const to = (event as FocusEvent).relatedTarget as Node | null;
      if (popover?.host === host && to && to !== popover.icon && !host.contains(to) && !shadow.contains(to)) closePopover();
    });

    shadow.append(box);
    // Everything outside an open modal dialog is inert, so the popover goes
    // inside it; the top layer (where supported) puts it above the dialog or
    // a fullscreen element.
    const modal = icon.closest('dialog');
    const fullscreen = doc.fullscreenElement;
    const container =
      modal && isModal(modal) ? modal : fullscreen?.contains(icon) ? fullscreen : doc.documentElement;
    container.append(host);
    if (typeof host.showPopover === 'function') {
      host.setAttribute('popover', 'manual');
      host.showPopover();
    }
    popover = { host, mark, icon };
    icon.setAttribute('aria-expanded', 'true');

    // Place under the icon, kept inside the viewport.
    const anchor = icon.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, view.innerWidth - size.width - 8));
    const below = anchor.bottom + 6;
    const top = below + size.height > view.innerHeight - 8 ? Math.max(8, anchor.top - size.height - 6) : below;
    host.style.setProperty('--zs-left', `${left}px`);
    host.style.setProperty('--zs-top', `${top}px`);
    buttons[0]!.focus();
  }

  function iconFrom(event: Event): HTMLElement | null {
    const target = event.target as Element | null;
    return target?.nodeType === 1 && target.localName === ICON_TAG && conversions.has(target.parentElement!)
      ? (target as HTMLElement)
      : null;
  }

  /**
   * The browser's own plain text for a selection: what Selection.toString()
   * gives, plus the alt text of selected images, which the browser's copy
   * includes and toString() leaves out. Reads each stretch between images
   * by selecting it in turn, then puts the reader's selection back.
   */
  function clipboardText(sel: Selection, ranges: Range[]): string {
    const images = ranges.map((r) => {
      const c = r.commonAncestorContainer;
      const scope = c.nodeType === 1 ? (c as Element) : c.parentElement;
      return [...(scope?.querySelectorAll('img[alt]') ?? [])].filter(
        (img) => r.intersectsNode(img) && img.getAttribute('alt') && img.getClientRects().length > 0,
      );
    });
    if (images.every((list) => list.length === 0)) return sel.toString();
    const saved = { an: sel.anchorNode!, ao: sel.anchorOffset, fn: sel.focusNode!, fo: sel.focusOffset };
    const textOf = (start: [Node, number], end: [Node, number]) => {
      const r = doc.createRange();
      r.setStart(...start);
      r.setEnd(...end);
      sel.removeAllRanges();
      sel.addRange(r);
      return sel.toString();
    };
    let out = '';
    ranges.forEach((range, i) => {
      let from: [Node, number] = [range.startContainer, range.startOffset];
      for (const img of images[i]!) {
        const at = [...img.parentNode!.childNodes].indexOf(img as ChildNode);
        out += textOf(from, [img.parentNode!, at]) + img.getAttribute('alt');
        from = [img.parentNode!, at + 1];
      }
      out += textOf(from, [range.endContainer, range.endOffset]);
    });
    sel.setBaseAndExtent(saved.an, saved.ao, saved.fn, saved.fo);
    return out;
  }

  function start(): () => void {
    if (!supported || !view) return () => {};
    if (doc.body) annotate(doc.body);

    const onClick = (event: Event) => {
      const icon = iconFrom(event);
      if (icon) {
        // The time may sit inside a link or button; the icon must not trigger it.
        event.preventDefault();
        event.stopPropagation();
        if (popover?.icon === icon) closePopover();
        else openPopover(icon.parentElement!);
      } else if (isCopyIcon(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        openCopy(event.target as Element);
      } else if (popover && !event.composedPath().includes(popover.host)) {
        closePopover();
      }
    };
    const isCopyIcon = (t: EventTarget | null) =>
      (t as Node | null)?.nodeType === 1 && (t as Element).localName === ICON_TAG && !isLive(t as Element);
    /**
     * The icon of a copy not yet turned back (that waits for the next pass):
     * do that pass now, then open the icon of the time that replaced it.
     */
    const openCopy = (icon: Element) => {
      const mark = icon.parentElement;
      if (!mark || mark.localName !== MARK_TAG) return;
      const run = mark.parentElement?.localName === RUN_TAG ? mark.parentElement : null;
      const outer = run ?? mark;
      const parent = outer.parentNode;
      if (!parent) return;
      const index = [...parent.childNodes].indexOf(outer as ChildNode);
      const nth = run ? [...run.children].filter((c) => c.localName === MARK_TAG).indexOf(mark) : 0;
      if (timer !== undefined) {
        clearTimeout(timer);
        flush();
      }
      const now = parent.childNodes[index];
      const live = now?.nodeType === 1 && runs.has(now as Element) ? (now as Element).querySelectorAll(MARK_TAG)[nth] : null;
      if (live) {
        openPopover(live as HTMLElement);
      }
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && popover) {
        // Only when the popover is open, so the same key does not also close a site's dialog.
        event.preventDefault();
        event.stopPropagation();
        closePopover();
        return;
      }
      const icon = iconFrom(event);
      if (icon && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        event.stopPropagation();
        openPopover(icon.parentElement!);
      } else if ((event.key === 'Enter' || event.key === ' ') && isCopyIcon(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        openCopy(event.target as Element);
      }
    };
    const onKeyup = (event: KeyboardEvent) => {
      // A button around the icon activates on Space keyup.
      if (iconFrom(event) && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Pointer presses on the icon are the icon's, not a surrounding link's or button's.
    const onPress = (event: Event) => {
      if (iconFrom(event)) event.stopPropagation();
    };
    // The browser places the caret for a press after the page's handlers run;
    // if a handler made the text editable, the run it hit is gone by then, so
    // the caret is put back at the matching place in the restored text.
    const onPressStart = (event: MouseEvent) => {
      press = null;
      if (event.button !== 0 || iconFrom(event)) return;
      const target = event.target as Element | null;
      const run = target?.nodeType === 1 ? target.closest(RUN_TAG) : null;
      if (!run || !runs.has(run)) return;
      const hit = caretAt(event.clientX, event.clientY);
      if (hit && run.contains(hit.node)) press = { run, offset: originalOffset(run, hit.node, hit.offset) };
    };
    const onPressEnd = () => {
      const p = press;
      press = null;
      const sel = view.getSelection();
      if (!p?.text?.isConnected || !sel || !sel.isCollapsed) return;
      sel.collapse(p.text, Math.min(p.offset, p.text.data.length));
    };
    const PRESS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick', 'auxclick'];
    const onScroll = (event: Event) => {
      if (!popover) return;
      // Only scrolling that moves the icon: the viewport or a container around it.
      const target = event.target;
      if (target === doc || target === view || (target as Node | null)?.contains?.(popover.icon)) closePopover();
    };
    // Content about to be edited: put the page's own text back first, so
    // nothing the site saves contains marks or converted times.
    const onEditIntent = (event: Event) => {
      const target = event.composedPath()[0] as Node | undefined;
      const el = target?.nodeType === 1 ? (target as Element) : (target?.parentElement ?? null);
      const root = el && editingRoot(el);
      if (root) restore(root);
    };

    // Copying a selection that includes annotated text: the clipboard gets
    // only plain text, the visible text exactly as the browser would copy it,
    // and no HTML, since the browser's HTML would carry Zoneshift's elements.
    // Registered first (window, capture), so a site handler that stops the
    // event cannot leave marks on the clipboard; a site handler that sets
    // data itself afterwards still wins. Selections without marks are left
    // entirely to the browser.
    const onClipboard = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const sel = view.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const ranges = Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i));
      const inOwn = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(COPYABLE) != null;
      const touched = ranges.some((r) => {
        if (inOwn(r.startContainer) || inOwn(r.endContainer)) return true;
        const c = r.commonAncestorContainer;
        const scope = c.nodeType === 1 ? (c as Element) : c.parentElement;
        for (const el of scope?.querySelectorAll(COPYABLE) ?? []) if (r.intersectsNode(el)) return true;
        return false;
      });
      if (!touched) return;
      if (event.type === 'cut') {
        // Cut only acts in editable content: put the page's own text back
        // first and let the browser cut that.
        for (const r of ranges) {
          const c = r.commonAncestorContainer;
          const root = editingRoot(c.nodeType === 1 ? (c as Element) : c.parentElement!);
          if (root) restore(root);
        }
        return;
      }
      if (!event.clipboardData) return;
      event.clipboardData.setData('text/plain', clipboardText(sel, ranges));
      event.preventDefault();
    };

    doc.addEventListener('mousedown', onPressStart, true);
    doc.addEventListener('mouseup', onPressEnd, true);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKeydown, true);
    doc.addEventListener('keyup', onKeyup, true);
    for (const type of PRESS) doc.addEventListener(type, onPress, { capture: true, passive: true });
    doc.addEventListener('focusin', onEditIntent, true);
    doc.addEventListener('beforeinput', onEditIntent, true);
    view.addEventListener('scroll', onScroll, { passive: true, capture: true });
    view.addEventListener('copy', onClipboard, true);
    view.addEventListener('cut', onClipboard, true);

    // Pages that add content later (single-page apps, streaming logs), replace
    // <body> (Turbo-style navigation), or make content editable.
    // Each queued node with the container whose children changed, which is
    // what the fight budget is counted against.
    let pending: [Node, Element | null][] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resumeTimers = new Set<ReturnType<typeof setTimeout>>();
    const flush = () => {
      timer = undefined;
      const batch = pending;
      pending = [];
      const now = Date.now();
      // Copies of annotated markup (a snapshot put back, a cloned slide, a
      // paste) become plain original text, then are annotated with the rest,
      // unless they sit in editable content. Done here, never in the
      // observer callback, so a site that puts its snapshot back from its own
      // observer cannot ping-pong with us; each container doing it counts
      // against its budget.
      const reverted: Text[] = [];
      const struck = new Set<string>();
      for (const [n, container] of batch) {
        if (n.nodeType !== 1 || !n.isConnected || paused(container ?? (n as Element), now)) continue;
        for (const copy of copiesIn(n as Element)) {
          if (!copy.isConnected) continue;
          const key = copyKey(copy);
          if (!struck.has(key)) {
            struck.add(key);
            if (!((copyBudgets.get(key)?.until ?? 0) > now)) strikeCopy(key, now);
          }
          const b = copyBudgets.get(key)!;
          if (b.until > now) {
            // Paused: left as it is, and looked at again when the pause ends.
            if (b.left && b.left.length < 50 && copy.parentElement) b.left.push(new WeakRef(copy.parentElement));
            continue;
          }
          reverted.push(...revert(copy));
        }
      }
      annotateAll([...batch.map(([n]) => n), ...reverted]);
    };
    const queue = (n: Node, container: Element | null = null) => {
      pending.push([n, container]);
      if (timer === undefined) timer = setTimeout(flush, MUTATION_DELAY);
    };
    onResume = (elements, delay) => {
      const t = setTimeout(() => {
        resumeTimers.delete(t);
        for (const el of elements()) if (el.isConnected) queue(el, el);
      }, delay);
      resumeTimers.add(t);
    };
    /** Original text of each run of ours in a removed subtree made in the last FIGHT_RECENT ms. */
    const recentOriginals = (el: Element, now: number, out: string[]) => {
      const take = (run: Element) => {
        const record = runs.get(run);
        if (record && now - record.created < FIGHT_RECENT) out.push(record.original.data);
      };
      if (el.localName === RUN_TAG) take(el);
      else for (const run of el.getElementsByTagName(RUN_TAG)) take(run);
    };
    const observer = new view.MutationObserver((records) => {
      const now = Date.now();
      const struck = new Set<Element>();
      const removedRecent = new Map<Element, string[]>();
      if (designMode() && doc.body?.getElementsByTagName(RUN_TAG).length) restore(doc.body);
      for (const r of records) {
        if (r.type === 'attributes') {
          const el = r.target as Element;
          if (inEditable(el)) restore(el);
          else queue(el, el);
          continue;
        }
        // Our own changes inside a run (switching a time) need nothing.
        if (isOwn(r.target as Element)) continue;
        const target = r.target.nodeType === 1 ? (r.target as Element) : null;
        // Noted for the fight check below.
        if (target) {
          for (const n of r.removedNodes) {
            if (n.nodeType !== 1) continue;
            const list = removedRecent.get(target) ?? [];
            recentOriginals(n as Element, now, list);
            if (list.length) removedRecent.set(target, list);
          }
        }
        for (const n of r.addedNodes) {
          if (!n.isConnected) continue;
          if (n.nodeType === 1) {
            const el = n as Element;
            if (isOwn(el) && isLive(el)) continue;
            // Annotated content moved into an editor: our own runs go now,
            // copies on the next pass.
            if (el.getElementsByTagName(RUN_TAG)[0] && inEditable(el)) restore(el, false);
          }
          // Text added next to a run can change how the run reads ("UTC" + "+2").
          // A run that now reads differently is undone; its text node comes back
          // through this observer and is annotated again with the new neighbour.
          for (const sib of [n.previousSibling, n.nextSibling]) if (sib?.nodeType === 1) recheck(sib as Element);
          queue(n, target);
        }
      }
      // The page removed a run of ours it had only just been given and put
      // the same text back: a fight (a site restoring its own text, #18),
      // counted against the container. New text (a ticking clock) is not.
      // Only where one of our recent runs was removed is the added text read.
      const addedText = new Map<Element, string>();
      if (removedRecent.size) {
        for (const r of records) {
          const t = r.target as Element;
          if (r.type !== 'childList' || !removedRecent.has(t)) continue;
          for (const n of r.addedNodes) addedText.set(t, (addedText.get(t) ?? '') + (n.textContent ?? ''));
        }
      }
      for (const [target, originals] of removedRecent) {
        const added = addedText.get(target) ?? '';
        if (!struck.has(target) && originals.some((o) => added.includes(o))) {
          struck.add(target);
          strike(target, now);
        }
      }
      if (popover && !popover.mark.isConnected) closePopover();
    });
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['contenteditable'],
    });

    return () => {
      observer.disconnect();
      clearTimeout(timer);
      closePopover();
      doc.removeEventListener('mousedown', onPressStart, true);
      doc.removeEventListener('mouseup', onPressEnd, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKeydown, true);
      doc.removeEventListener('keyup', onKeyup, true);
      for (const type of PRESS) doc.removeEventListener(type, onPress, { capture: true });
      doc.removeEventListener('focusin', onEditIntent, true);
      doc.removeEventListener('beforeinput', onEditIntent, true);
      view.removeEventListener('scroll', onScroll, { capture: true });
      view.removeEventListener('copy', onClipboard, true);
      view.removeEventListener('cut', onClipboard, true);
      for (const t of resumeTimers) clearTimeout(t);
      restore(doc.documentElement);
    };
  }

  return { annotate, setState, setAll, openPopover, closePopover, restore, start };
}

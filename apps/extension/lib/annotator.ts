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

/** Element names. Custom names, so page rules aimed at `span` or `div` never match them. */
export const RUN_TAG = 'zoneshift-run';
export const MARK_TAG = 'zoneshift-mark';
export const TEXT_TAG = 'zoneshift-text';
export const ICON_TAG = 'zoneshift-icon';
const POPOVER_TAG = 'zoneshift-popover';
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
}

/** What a text node will become. */
interface Plan {
  node: Text;
  found: Conversion[];
  context: [before: string, after: string];
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
    for (let el: Element | null = parent; el; el = el.parentElement) {
      if (el === doc.body) inBody = true;
      if (el.namespaceURI !== XHTML) return true;
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
   * (letters, digits, + - : /). Text before it may only extend the match
   * leftwards ("Nov 13 at" + "1:30 AM UTC").
   */
  function find(text: string, [before, after]: [string, string]): Conversion[] {
    const found = findConversions(text, options);
    if (found.length === 0 || (before === '' && after === '')) return found;
    const whole = findConversions(before + text + after, options);
    const b = before.length;
    return found.filter((c) => {
      const end = c.index + c.length;
      if (c.index === 0 && GLUED_BEFORE.test(before)) return false;
      if (end === text.length && GLUED_AFTER.test(after)) return false;
      return whole.some(
        (w) => w.index <= c.index + b && w.index + w.length === end + b && (w.index < c.index + b || w.epochMs === c.epochMs),
      );
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
    runs.set(run, { original: node, context: context.join('\0'), readings: readingsOf(found) });
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

  /** Swap a run back for the page's own text node. */
  function unwrap(run: Element): void {
    const record = runs.get(run);
    if (!record) return;
    runs.delete(run);
    if (popover && run.contains(popover.mark)) closePopover();
    if (run.parentNode) run.replaceWith(record.original);
  }

  function restore(root: Node): void {
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const el = root as Element;
    if (el.nodeType === 1 && el.localName === RUN_TAG) return unwrap(el);
    for (const run of [...el.getElementsByTagName(RUN_TAG)]) unwrap(run);
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
    doc.documentElement.append(host);
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
      } else if (popover && !event.composedPath().includes(popover.host)) {
        closePopover();
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

    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKeydown, true);
    doc.addEventListener('keyup', onKeyup, true);
    for (const type of PRESS) doc.addEventListener(type, onPress, { capture: true, passive: true });
    doc.addEventListener('focusin', onEditIntent, true);
    doc.addEventListener('beforeinput', onEditIntent, true);
    view.addEventListener('scroll', onScroll, { passive: true, capture: true });

    // Pages that add content later (single-page apps, streaming logs), replace
    // <body> (Turbo-style navigation), or make content editable.
    let pending: Node[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      const batch = pending;
      pending = [];
      annotateAll(batch);
    };
    const queue = (n: Node) => {
      pending.push(n);
      if (timer === undefined) timer = setTimeout(flush, MUTATION_DELAY);
    };
    const observer = new view.MutationObserver((records) => {
      if (designMode() && doc.body?.getElementsByTagName(RUN_TAG).length) restore(doc.body);
      for (const r of records) {
        if (r.type === 'attributes') {
          const el = r.target as Element;
          if (inEditable(el)) restore(el);
          else queue(el);
          continue;
        }
        // Our own changes inside a run (switching a time) need nothing.
        if (isOwn(r.target as Element)) continue;
        for (const n of r.addedNodes) {
          if (n.nodeType === 1 && isOwn(n as Element)) continue;
          // Annotated content moved into an editor.
          if (n.nodeType === 1 && n.isConnected && (n as Element).getElementsByTagName(RUN_TAG)[0] && inEditable(n as Element)) {
            restore(n);
          }
          // Text added next to a run can change how the run reads ("UTC" + "+2").
          // A run that now reads differently is undone; its text node comes back
          // through this observer and is annotated again with the new neighbour.
          for (const sib of [n.previousSibling, n.nextSibling]) if (sib?.nodeType === 1) recheck(sib as Element);
          queue(n);
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
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKeydown, true);
      doc.removeEventListener('keyup', onKeyup, true);
      for (const type of PRESS) doc.removeEventListener(type, onPress, { capture: true });
      doc.removeEventListener('focusin', onEditIntent, true);
      doc.removeEventListener('beforeinput', onEditIntent, true);
      view.removeEventListener('scroll', onScroll, { capture: true });
      restore(doc.documentElement);
    };
  }

  return { annotate, setState, setAll, openPopover, closePopover, restore, start };
}

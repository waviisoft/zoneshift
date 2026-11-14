import { findConversions, type Conversion, type ConvertOptions } from '@zoneshift/core';
import type { Annotator, State } from './annotator';

/**
 * PROTOTYPE for issue #34 (evaluation only, not the shipping annotator).
 *
 * Shows converted times through shadow DOM so the page's own DOM keeps the
 * original text. Three layouts, chosen with `render`:
 *
 *  - 'mark':    <zoneshift-run>text <zoneshift-mark>ORIGINAL</zoneshift-mark> text</zoneshift-run>
 *               Each mark is a shadow host; its shadow root renders the
 *               converted text and the icon (or a <slot> for "show original").
 *  - 'run':     <zoneshift-run>ORIGINAL TEXT NODE (the page's own object)</zoneshift-run>
 *               The run is the shadow host and renders the whole text node,
 *               with converted times and icons, from its shadow root.
 *  - 'inplace': no light-DOM change at all. The page's own parent element (when
 *               it is allowed to host a shadow root and has none) gets a shadow
 *               root with manual slot assignment: every other child is slotted,
 *               the text node holding a time is rendered from the shadow root.
 *               Falls back to 'run' where the parent cannot host one.
 *
 * Shadow roots are styled with one shared constructed stylesheet
 * (adoptedStyleSheets), or with a <style> element when `style` is 'element'.
 */

export type Render = 'mark' | 'run' | 'inplace';
export interface ShadowOptions extends ConvertOptions {
  render?: Render;
  shadowMode?: ShadowRootMode;
  style?: 'adopted' | 'element';
  /**
   * 'unslotted': the original light-DOM text is not rendered at all.
   * 'hidden': it stays slotted inside a zero-size, clipped, aria-hidden box,
   * so it keeps a layout box (innerText, Selection.toString() see it).
   */
  original?: 'unslotted' | 'hidden';
}

export const POPOVER_ID = 'zoneshift-popover';
export const MUTATION_DELAY = 200;
export const RUN_TAG = 'zoneshift-run';
export const MARK_TAG = 'zoneshift-mark';
const POPOVER_TAG = 'zoneshift-popover';
const OWN_PREFIX = 'zoneshift-';
const XHTML = 'http://www.w3.org/1999/xhtml';

const SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'title', 'iframe', 'noembed', 'noframes', 'object', 'canvas',
  'audio', 'video', 'xmp', 'plaintext', 'textarea', 'input', 'select', 'option', 'optgroup', 'datalist',
  'time', 'svg', 'math',
]);
const TEXT_ENTRY_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const TECHNICAL = 'code, pre, samp, kbd, tt';
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd',
  'label', 'mark', 'nobr', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'tt', 'u', 'var',
  RUN_TAG,
]);
/** Elements allowed to host a shadow root (besides custom elements, which we never use as hosts in place). */
const CAN_HOST = new Set([
  'article', 'aside', 'blockquote', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'main',
  'nav', 'p', 'section', 'span',
]);
const CONTEXT = 64;
const GLUED_BEFORE = /[\p{L}\p{N}+\-−‐-―:/]$/u;
const GLUED_AFTER = /^[\p{L}\p{N}+\-−‐-―:/]/u;
const DAY = 86_400_000;
const withoutDayShift = (converted: string) => converted.replace(/\s*\([+−-]\d+ days?\)$/u, '');
const readingsOf = (conversions: Conversion[]) => conversions.map((c) => `${c.index}:${c.length}:${c.epochMs}`).join(',');

/** Styles inside every shadow root. Page rules never reach these elements. */
/** For our own hosts only: an in-place host is the page's element and must keep its own styles. */
const HOST_CSS = `
  :host { all: unset !important; }
  :host::before, :host::after { content: none !important; display: none !important; }
`;
export const SHADOW_CSS = `
  .m, .c { all: unset; }
  .h { all: unset; display: inline-block; width: 0; height: 0; overflow: hidden; }
  .i {
    all: unset; box-sizing: content-box; display: inline-block; position: relative;
    width: 0.7em; height: 0.7em; margin: 0; margin-inline-start: 0.3em; padding: 0;
    border: 0.1em solid currentColor; border-radius: 50%; vertical-align: -0.08em;
    cursor: pointer; user-select: none; -webkit-user-select: none;
  }
  .i::before, .i::after {
    content: ''; display: block; position: absolute; left: calc(50% - 0.05em);
    background: currentColor; border-radius: 0.05em;
  }
  .i::before { top: 12%; width: 0.1em; height: 44%; }
  .i::after { top: calc(50% - 0.05em); width: 36%; height: 0.1em; }
  .i:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
  .m[data-state='converted'] > .i { color: #fff; background: #2563eb; border-color: #2563eb; }
  .m[data-state='converted'][data-confidence='low'] > .i { background: #d97706; border-color: #d97706; }
  .m[data-state='original'] > .i { opacity: 0.55; }
  .m[data-state='original'] > .i:hover { opacity: 1; }
`;

const POPOVER_CSS = `
  :host { all: initial !important; display: block !important; position: fixed !important;
    z-index: 2147483647 !important; left: var(--zs-left) !important; top: var(--zs-top) !important; }
  .box { font: 13px/1.4 system-ui, sans-serif; color: #111827; background: #fff; border: 1px solid #d1d5db;
    border-radius: 8px; padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18); width: max-content;
    max-width: min(320px, calc(100vw - 16px)); box-sizing: border-box; }
  dl { margin: 0 0 8px; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  dt { color: #6b7280; } dd { margin: 0; overflow-wrap: anywhere; }
  button { display: block; width: 100%; margin-top: 6px; padding: 7px 10px; font: inherit; text-align: start;
    color: inherit; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; }
`;

/** One shadow root of ours. */
interface Host {
  root: ShadowRoot;
  /** Marks (the `.m` spans inside the root). */
  marks: HTMLElement[];
  /** 'mark' and 'run' hosts are our own wrapper; 'inplace' hosts are the page's element. */
  kind: Render;
  /** run / inplace: the page's own text nodes rendered from this root. */
  texts: Text[];
  /** run: the reading context, to notice when neighbours change it. */
  context?: string;
  readings?: string;
}

interface Plan {
  node: Text;
  found: Conversion[];
  context: [string, string];
}

export function createShadowAnnotator(doc: Document, options: ShadowOptions = {}): Annotator {
  const view = doc.defaultView;
  const render: Render = options.render ?? 'mark';
  const shadowMode: ShadowRootMode = options.shadowMode ?? 'open';
  const supported = view != null && doc.documentElement?.namespaceURI === XHTML;
  const conversions = new WeakMap<HTMLElement, Conversion>();
  /** Shadow hosts we made or took over. */
  const hosts = new WeakMap<Element, Host>();
  /** The page's own text node that a 'mark'-layout run replaced. */
  const runOriginals = new WeakMap<Element, Text>();
  /** Every host, for "convert all" (a WeakMap cannot be walked). */
  const allHosts = new Set<WeakRef<Element>>();
  let pageState: State | null = null;
  let popover: { host: HTMLElement; mark: HTMLElement; icon: HTMLElement } | null = null;

  const hidden = options.original === 'hidden';
  const sheets: Record<string, CSSStyleSheet> = {};
  function style(root: ShadowRoot, own: boolean): void {
    const css = (own ? HOST_CSS : '') + SHADOW_CSS;
    if (options.style !== 'element') {
      try {
        root.adoptedStyleSheets = [
          (sheets[String(own)] ??= (() => {
            const s = new view!.CSSStyleSheet();
            s.replaceSync(css);
            return s;
          })()),
        ];
        return;
      } catch (e) {
        (doc.documentElement as HTMLElement).dataset.zsSheetError = String(e);
      }
    }
    const el = doc.createElement('style');
    el.textContent = css;
    root.append(el);
  }

  const designMode = () => doc.designMode === 'on';
  function editableByStyle(el: Element): boolean {
    if ((el as HTMLElement).isContentEditable) return true;
    return (view?.getComputedStyle(el).getPropertyValue('-webkit-user-modify') ?? '').startsWith('read-write');
  }
  function inEditable(el: Element | null): boolean {
    if (!el) return false;
    if (designMode() || editableByStyle(el)) return true;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const ce = e.getAttribute('contenteditable');
      if (ce !== null && ce.toLowerCase() !== 'false') return true;
    }
    return false;
  }
  function editingRoot(el: Element): Element | null {
    if (designMode()) return doc.body ?? doc.documentElement;
    if (!inEditable(el)) return null;
    let root = el;
    while (root.parentElement && inEditable(root.parentElement)) root = root.parentElement;
    return root;
  }
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
  function inlineText(n: Node): string | null {
    if (n.nodeType === 3) return (n as Text).data;
    if (n.nodeType !== 1) return '';
    const el = n as Element;
    if (el.namespaceURI === XHTML && INLINE.has(el.localName.toLowerCase())) return el.textContent ?? '';
    return null;
  }
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
  function contextOf(text: string, at: Node): [string, string] {
    let before = contextText(at, false);
    let after = contextText(at, true);
    if (at.parentElement?.closest(TECHNICAL)) {
      before = text.startsWith('\n') ? '' : before.slice(before.lastIndexOf('\n') + 1);
      after = text.endsWith('\n') ? '' : after.split('\n', 1)[0]!;
    }
    return [before, after];
  }
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
        return (w.epochMs - c.epochMs) % DAY === 0 && w.converted.endsWith(withoutDayShift(c.converted));
      });
    });
  }

  // ---------- rendering ----------

  /** A mark inside a shadow root: [content, icon]. Content is converted text, original text, or a <slot>. */
  function createMark(c: Conversion, technical: boolean, slotted: boolean): HTMLElement {
    const mark = doc.createElement('span');
    mark.className = 'm';
    mark.dataset.confidence = c.confidence;
    if (slotted) mark.dataset.slotted = '';
    const icon = doc.createElement('span');
    icon.className = 'i';
    icon.setAttribute('role', 'button');
    icon.setAttribute('aria-haspopup', 'dialog');
    icon.setAttribute('aria-expanded', 'false');
    icon.tabIndex = 0;
    const content = doc.createElement('span');
    content.className = 'c';
    mark.append(content, icon);
    conversions.set(mark, c);
    setState(mark, pageState ?? (technical || c.format === 'iso' ? 'original' : 'converted'));
    return mark;
  }

  function setState(mark: HTMLElement, state: State): void {
    const c = conversions.get(mark);
    if (!c) return;
    mark.dataset.state = state;
    const content = mark.firstElementChild!;
    // 'mark' layout: the original is the host's own light-DOM text, shown through a slot.
    if (mark.dataset.slotted !== undefined) {
      if (state === 'original') content.replaceChildren(doc.createElement('slot'));
      else content.replaceChildren(c.converted, ...(hidden ? [hiddenSlot()] : []));
    } else {
      content.replaceChildren(state === 'converted' ? c.converted : c.original);
    }
    mark.lastElementChild!.setAttribute(
      'aria-label',
      state === 'converted' ? `Converted to local time. Original: ${c.original}` : `Local time: ${c.converted}`,
    );
  }

  function forEachHost(fn: (host: Element, h: Host) => void): void {
    for (const ref of allHosts) {
      const el = ref.deref();
      const h = el && hosts.get(el);
      if (!el || !h) allHosts.delete(ref);
      else fn(el, h);
    }
  }

  function setAll(state: State): void {
    pageState = state;
    forEachHost((_, h) => {
      for (const m of h.marks) setState(m, state);
    });
  }

  /** The original, slotted but invisible: keeps a layout box so innerText and selection see it. */
  function hiddenSlot(assign?: Text): HTMLElement {
    const box = doc.createElement('span');
    box.className = 'h';
    box.setAttribute('aria-hidden', 'true');
    const slot = doc.createElement('slot');
    box.append(slot);
    if (assign) (slot as HTMLSlotElement).assign(assign);
    return box;
  }

  function attach(el: Element, kind: Render, manual = false): Host {
    const root = el.attachShadow({ mode: shadowMode, ...(manual && { slotAssignment: 'manual' as SlotAssignmentMode }) });
    style(root, kind !== 'inplace');
    const h: Host = { root, marks: [], kind, texts: [] };
    hosts.set(el, h);
    allHosts.add(new WeakRef(el));
    return h;
  }

  /** Render a text node's pieces (plain text and marks) into `parent` inside a shadow root. */
  function renderPieces(h: Host, parent: Node, text: string, found: Conversion[], technical: boolean): void {
    let pos = 0;
    for (const c of found) {
      if (c.index > pos) parent.appendChild(doc.createTextNode(text.slice(pos, c.index)));
      const m = createMark(c, technical, false);
      h.marks.push(m);
      parent.appendChild(m);
      pos = c.index + c.length;
    }
    if (pos < text.length) parent.appendChild(doc.createTextNode(text.slice(pos)));
  }

  function plan(node: Text, editable: Map<Element, boolean>): Plan | null {
    const text = node.data;
    if (!node.isConnected || !/\d/.test(text) || shouldSkip(node)) return null;
    // Already rendered from one of our in-place hosts.
    const parent = node.parentElement!;
    if (hosts.get(parent)?.texts.includes(node)) return null;
    const context = contextOf(text, node);
    const found = find(text, context);
    if (found.length === 0) return null;
    let byStyle = editable.get(parent);
    if (byStyle === undefined) editable.set(parent, (byStyle = editableByStyle(parent)));
    return byStyle ? null : { node, found, context };
  }

  /** In-place: rebuild the shadow root of a page element so every child is slotted except our text nodes. */
  const inplacePlans = new WeakMap<Text, Plan>();
  function renderInplace(el: Element, h: Host): void {
    const technical = el.closest(TECHNICAL) != null;
    for (const node of [...h.root.childNodes]) if (node.nodeName !== 'STYLE') node.remove();
    h.marks = [];
    h.texts = [];
    for (const child of [...el.childNodes]) {
      const p = child.nodeType === 3 ? inplacePlans.get(child as Text) : undefined;
      if (p) {
        // Re-read: the page may have changed the text (React updating nodeValue).
        const found = find(p.node.data, contextOf(p.node.data, p.node));
        if (found.length) {
          h.texts.push(p.node);
          // One inline wrapper, so a flex or grid container still sees one item for this text.
          const wrapper = doc.createElement('span');
          wrapper.className = 'c';
          renderPieces(h, wrapper, p.node.data, found, technical);
          if (hidden) wrapper.appendChild(hiddenSlot(p.node));
          h.root.appendChild(wrapper);
          continue;
        }
      }
      const slot = doc.createElement('slot');
      h.root.appendChild(slot);
      (slot as HTMLSlotElement).assign(child as Element | Text);
    }
  }

  function canHostInPlace(el: Element): boolean {
    return el.namespaceURI === XHTML && CAN_HOST.has(el.localName) && el !== doc.body && (el as HTMLElement).shadowRoot == null;
  }

  function wrap({ node, found, context }: Plan): void {
    if (!node.isConnected) return;
    const parent = node.parentElement!;
    const technical = parent.closest(TECHNICAL) != null;
    if (render === 'inplace' && (hosts.get(parent)?.kind === 'inplace' || canHostInPlace(parent))) {
      let h = hosts.get(parent);
      if (!h) {
        try {
          h = attach(parent, 'inplace', true);
        } catch {
          h = undefined; // a closed root of the page's own, or not allowed
        }
      }
      if (h) {
        inplacePlans.set(node, { node, found, context });
        renderInplace(parent, h);
        inplaceObserver?.observe(parent, { childList: true, characterData: true, subtree: true });
        return;
      }
    }
    const text = node.data;
    const run = doc.createElement(RUN_TAG);
    if (render === 'mark') {
      let pos = 0;
      for (const c of found) {
        const host = doc.createElement(MARK_TAG);
        host.append(text.slice(c.index, c.index + c.length));
        const h = attach(host, 'mark');
        const m = createMark(c, technical, true);
        h.marks.push(m);
        h.root.appendChild(m);
        run.append(text.slice(pos, c.index), host);
        pos = c.index + c.length;
      }
      run.append(text.slice(pos));
      runOriginals.set(run, node);
      hosts.set(run, { root: null as unknown as ShadowRoot, marks: [], kind: 'mark', texts: [], context: context.join('\0'), readings: readingsOf(found) });
      node.replaceWith(run);
    } else {
      // 'run' (and 'inplace' fallback): the page's own text node moves into the host, unsplit.
      node.replaceWith(run);
      run.append(node);
      const h = attach(run, 'run');
      h.texts = [node];
      h.context = context.join('\0');
      h.readings = readingsOf(found);
      renderPieces(h, h.root, text, found, technical);
      if (hidden) h.root.appendChild(hiddenSlot());
    }
  }

  function annotateAll(roots: Iterable<Node>): void {
    if (!supported) return;
    const nodes = new Set<Text>();
    for (const root of roots) {
      if (!root.isConnected) continue;
      if (root.nodeType === 3) nodes.add(root as Text);
      else {
        const walker = doc.createTreeWalker(root, 4);
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
  const annotate = (root: Node) => annotateAll([root]);

  // ---------- undoing ----------

  function unwrapEl(el: Element): void {
    const h = hosts.get(el);
    if (el.localName === RUN_TAG) {
      hosts.delete(el);
      const original = runOriginals.get(el) ?? h?.texts[0];
      if (original && el.parentNode) {
        if (popover && (el.contains(popover.mark) || h?.root?.contains(popover.mark))) closePopover();
        el.replaceWith(original);
      }
    } else if (h?.kind === 'inplace') {
      // A shadow root cannot be removed: slot every child again, and stop managing it.
      for (const node of [...h.root.childNodes]) if (node.nodeName !== 'STYLE') node.remove();
      for (const child of [...el.childNodes]) {
        const slot = doc.createElement('slot');
        h.root.appendChild(slot);
        (slot as HTMLSlotElement).assign(child as Element | Text);
      }
      h.marks = [];
      h.texts = [];
    }
  }

  /** Copies of our wrappers (no shadow root of ours): back to plain text. */
  function revertCopy(el: Element): Text[] {
    if (!el.parentNode) return [];
    const text = doc.createTextNode(el.textContent ?? '');
    el.replaceWith(text);
    return [text];
  }
  const isLive = (el: Element) =>
    el.localName === RUN_TAG ? hosts.has(el) : el.localName === MARK_TAG ? hosts.has(el) && hosts.has(el.parentElement!) : true;
  function copiesIn(root: Element): Element[] {
    const out: Element[] = [];
    const sel = `${RUN_TAG}, ${MARK_TAG}`;
    const consider = (el: Element) => {
      const last = out[out.length - 1];
      if (last?.contains(el) || isLive(el)) return;
      out.push(el);
    };
    if (root.matches(sel)) consider(root);
    for (const el of root.querySelectorAll(sel)) consider(el);
    return out;
  }

  function restore(root: Node): void {
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const el = root.nodeType === 9 ? (root as Document).documentElement : (root as Element);
    if (!el) return;
    if (hosts.has(el)) unwrapEl(el);
    for (const run of [...el.getElementsByTagName(RUN_TAG)]) unwrapEl(run);
    if (render === 'inplace') for (const e of [...el.querySelectorAll('*')]) if (hosts.get(e)?.kind === 'inplace') unwrapEl(e);
    for (const copy of copiesIn(el)) revertCopy(copy);
  }

  // ---------- popover ----------

  const hostOf = (mark: HTMLElement) => (mark.getRootNode() as ShadowRoot).host;

  function closePopover(): void {
    if (!popover) return;
    const { host, icon } = popover;
    const hadFocus = doc.activeElement === host;
    popover = null;
    host.remove();
    icon.setAttribute('aria-expanded', 'false');
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
    const s = new view.CSSStyleSheet();
    s.replaceSync(POPOVER_CSS);
    shadow.adoptedStyleSheets = [s];
    const box = doc.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Zoneshift');
    box.setAttribute('aria-modal', 'true');
    const dl = doc.createElement('dl');
    for (const [label, value] of [['Original', c.original], ['Local', c.converted], ['Read as', c.sourceDescription]] as const) {
      const dt = doc.createElement('dt');
      dt.textContent = label;
      const dd = doc.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    }
    box.append(dl);
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
    const converted = mark.dataset.state === 'converted';
    button(converted ? 'Show original here' : 'Convert to local time', () => setState(mark, converted ? 'original' : 'converted'));
    button('Convert all times on this page', () => setAll('converted'));
    button('Show all originals on this page', () => setAll('original'));
    box.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const i = buttons.indexOf(shadow.activeElement as HTMLButtonElement);
      const next = i < 0 ? 0 : (i + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]!.focus();
    });
    shadow.append(box);
    const anchorHost = hostOf(mark);
    const modal = anchorHost.closest('dialog');
    const container = modal && modal.matches(':modal') ? modal : doc.documentElement;
    container.append(host);
    if (typeof host.showPopover === 'function') {
      host.setAttribute('popover', 'manual');
      host.showPopover();
    }
    popover = { host, mark, icon };
    icon.setAttribute('aria-expanded', 'true');
    const anchor = icon.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, view.innerWidth - size.width - 8));
    const below = anchor.bottom + 6;
    const top = below + size.height > view.innerHeight - 8 ? Math.max(8, anchor.top - size.height - 6) : below;
    host.style.setProperty('--zs-left', `${left}px`);
    host.style.setProperty('--zs-top', `${top}px`);
    buttons[0]!.focus();
  }

  /**
   * The icon an event is for. Open roots: from the composed path. Closed roots
   * hide their inside from the path, so we look at the host we know and test
   * focus (keys) or the pointer position (presses).
   */
  function iconFrom(event: Event): HTMLElement | null {
    const path = event.composedPath();
    const first = path[0] as Element | undefined;
    if (first?.nodeType === 1 && (first as Element).classList?.contains('i') && conversions.has((first as Element).parentElement as HTMLElement)) {
      return first as HTMLElement;
    }
    if (shadowMode === 'open') return null;
    for (const n of path) {
      const h = n instanceof view!.Element ? hosts.get(n as Element) : undefined;
      if (!h?.root) continue;
      for (const m of h.marks) {
        const icon = m.lastElementChild as HTMLElement;
        if (event instanceof view!.KeyboardEvent) {
          if (h.root.activeElement === icon) return icon;
        } else if (event instanceof view!.MouseEvent) {
          const r = icon.getBoundingClientRect();
          const { clientX: x, clientY: y } = event as MouseEvent;
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return icon;
        }
      }
    }
    return null;
  }

  let inplaceObserver: MutationObserver | null = null;

  function start(): () => void {
    if (!supported || !view) return () => {};
    if (render === 'inplace') {
      // Children added to, or text changed in, a page element we host: slot or re-render them now (microtask).
      inplaceObserver = new view.MutationObserver((records) => {
        const touched = new Set<Element>();
        for (const r of records) {
          const t = r.type === 'characterData' ? r.target.parentElement : (r.target as Element);
          if (t && hosts.get(t)?.kind === 'inplace') touched.add(t);
        }
        for (const t of touched) renderInplace(t, hosts.get(t)!);
      });
    }
    if (doc.body) annotate(doc.body);

    const onClick = (event: Event) => {
      const icon = iconFrom(event);
      if (icon) {
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
    const onPress = (event: Event) => {
      if (iconFrom(event)) event.stopPropagation();
    };
    const PRESS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick', 'auxclick'];
    const onEditIntent = (event: Event) => {
      const target = event.composedPath()[0] as Node | undefined;
      const el = target?.nodeType === 1 ? (target as Element) : (target?.parentElement ?? null);
      const root = el && editingRoot(el);
      if (root) restore(root);
    };
    /**
     * Copy, 'mark' layout only: the clipboard gets the text as shown. HTML is
     * the page's own structure from the light-DOM selection with each time
     * replaced by what is shown; plain text is the selection's text with the
     * same replacement (needs the hidden original, or the time is missing from
     * Selection.toString()). A selection that starts or ends inside a time is
     * found through getComposedRanges and cut to the part selected.
     */
    const onCopy = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData || render !== 'mark') return;
      const sel = view.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const roots: ShadowRoot[] = [];
      forEachHost((_, h) => roots.push(h.root));
      const composed = (sel as Selection & { getComposedRanges?: (o: { shadowRoots: ShadowRoot[] }) => StaticRange[] })
        .getComposedRanges?.({ shadowRoots: roots })?.[0];
      const hostOfPoint = (n: Node | undefined) => {
        const r = n?.getRootNode();
        return r instanceof view.ShadowRoot && hosts.get(r.host)?.kind === 'mark' ? r.host : null;
      };
      const startHost = hostOfPoint(composed?.startContainer);
      const endHost = hostOfPoint(composed?.endContainer);
      const common = range.commonAncestorContainer;
      const scope = common.nodeType === 1 ? (common as Element) : common.parentElement;
      const inRange = [...(scope?.querySelectorAll(MARK_TAG) ?? [])].filter((el) => hosts.has(el) && range.intersectsNode(el));
      if (startHost && !inRange.includes(startHost)) inRange.unshift(startHost);
      if (endHost && !inRange.includes(endHost)) inRange.push(endHost);
      if (!inRange.length && !startHost) return;
      const shownOf = (host: Element) => {
        const m = hosts.get(host)!.marks[0]!;
        const c = conversions.get(m)!;
        let text = m.dataset.state === 'converted' ? c.converted : c.original;
        const inText = (n: Node | undefined) => n?.nodeType === 3 && m.contains(n) && !n.parentElement?.closest('.h');
        const from = host === startHost && inText(composed!.startContainer) ? composed!.startOffset : 0;
        const to = host === endHost && inText(composed!.endContainer) ? composed!.endOffset : text.length;
        return text.slice(from, to);
      };
      if (startHost && startHost === endHost) {
        event.clipboardData.setData('text/plain', shownOf(startHost));
        event.clipboardData.setData('text/html', shownOf(startHost));
        event.preventDefault();
        return;
      }
      // Plain: the light-DOM text with each original replaced, in order.
      let plain = sel.toString();
      let at = 0;
      for (const host of inRange) {
        const original = host.textContent ?? '';
        const i = plain.indexOf(original, at);
        if (i < 0) continue;
        const shown = shownOf(host);
        plain = plain.slice(0, i) + shown + plain.slice(i + original.length);
        at = i + shown.length;
      }
      // HTML: the page's structure, our elements replaced by what is shown.
      const fragment = range.cloneContents();
      const clones = [...fragment.querySelectorAll(MARK_TAG)];
      const live = inRange.filter((h) => range.intersectsNode(h));
      clones.forEach((clone, i) => clone.replaceWith(live[i] ? shownOf(live[i]!) : (clone.textContent ?? '')));
      for (const run of [...fragment.querySelectorAll(RUN_TAG)]) run.replaceWith(...run.childNodes);
      const box = doc.createElement('div');
      box.append(fragment);
      let html = box.innerHTML;
      if (startHost && !range.intersectsNode(startHost)) html = shownOf(startHost) + html;
      event.clipboardData.setData('text/plain', plain);
      event.clipboardData.setData('text/html', html);
      event.preventDefault();
    };
    view.addEventListener('copy', onCopy);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKeydown, true);
    for (const type of PRESS) doc.addEventListener(type, onPress, { capture: true, passive: true });
    doc.addEventListener('focusin', onEditIntent, true);
    doc.addEventListener('beforeinput', onEditIntent, true);

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
      for (const r of records) {
        if (r.type === 'attributes') {
          const el = r.target as Element;
          if (inEditable(el)) restore(el);
          else queue(el);
          continue;
        }
        if ((r.target as Element).localName?.startsWith(OWN_PREFIX)) continue;
        for (const n of r.addedNodes) {
          if (!n.isConnected) continue;
          if (n.nodeType === 1) {
            const el = n as Element;
            if (el.localName.startsWith(OWN_PREFIX) && isLive(el)) continue;
            const copies = copiesIn(el);
            if (copies.length) {
              for (const copy of copies) for (const t of revertCopy(copy)) queue(t);
              if (!el.isConnected) continue;
            }
            if (el.getElementsByTagName(RUN_TAG)[0] && inEditable(el)) restore(el);
          }
          queue(n);
        }
      }
      if (popover && !popover.mark.isConnected) closePopover();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });

    return () => {
      observer.disconnect();
      inplaceObserver?.disconnect();
      view.removeEventListener('copy', onCopy);
      clearTimeout(timer);
      closePopover();
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKeydown, true);
      for (const type of PRESS) doc.removeEventListener(type, onPress, { capture: true });
      doc.removeEventListener('focusin', onEditIntent, true);
      doc.removeEventListener('beforeinput', onEditIntent, true);
      restore(doc.documentElement);
    };
  }

  return { annotate, setState, setAll, openPopover, closePopover, restore, start };
}

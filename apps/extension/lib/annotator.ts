import { findConversions, type Conversion, type ConvertOptions } from '@zoneshift/core';

/**
 * Page annotator. Every recognised time gets a clock icon after it:
 *  - prose times are converted straight away (solid icon);
 *  - timestamps in code/log blocks and ISO 8601 timestamps are left as
 *    written (hollow icon) until the reader asks for them.
 * The icon opens a popover to switch one time, or every time on the page.
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
  closePopover(): void;
  /** Annotate the document, wire up the icons and watch for added content. Returns a stop function. */
  start(): () => void;
}

export const POPOVER_ID = 'zoneshift-popover';
/** Delay before content added to the page is annotated, in milliseconds. */
export const MUTATION_DELAY = 200;

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'TIME']);
const TECHNICAL = 'code, pre, samp, kbd, tt';

const POPOVER_CSS = `
  :host { all: initial; position: fixed; z-index: 2147483647; }
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
    display: block; width: 100%; margin-top: 6px; padding: 7px 10px; font: inherit; text-align: left;
    color: inherit; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer;
  }
  button:hover { background: #e5e7eb; }
  @media (prefers-color-scheme: dark) {
    .box { color: #f3f4f6; background: #1f2937; border-color: #4b5563; }
    dt { color: #9ca3af; } .note { color: #fbbf24; }
    button { background: #374151; border-color: #4b5563; } button:hover { background: #4b5563; }
  }
`;

function shouldSkip(node: Text): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName) || el.isContentEditable || el.classList.contains('zoneshift')) return true;
    if (el.id === POPOVER_ID) return true;
  }
  return false;
}

function iconFrom(event: Event): HTMLElement | null {
  const target = event.target as HTMLElement | null;
  return target?.classList?.contains('zoneshift-icon') ? target : null;
}

/**
 * @param doc      The document to annotate.
 * @param options  Passed to the conversion engine (target zone, reference time, default zone).
 */
export function createAnnotator(doc: Document, options: ConvertOptions = {}): Annotator {
  const view = doc.defaultView!;
  const marks = new Map<HTMLElement, Conversion>();
  /** Set once the reader picks "all on this page"; applied to content added later. */
  let pageState: State | null = null;
  let popover: HTMLElement | null = null;

  function setState(mark: HTMLElement, state: State): void {
    const c = marks.get(mark);
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
    for (const mark of marks.keys()) {
      if (mark.isConnected) setState(mark, state);
      else marks.delete(mark);
    }
  }

  function createMark(c: Conversion, technical: boolean): HTMLElement {
    const mark = doc.createElement('span');
    mark.className = 'zoneshift';
    mark.dataset.zsConfidence = c.confidence;
    const text = doc.createElement('span');
    const icon = doc.createElement('span');
    icon.className = 'zoneshift-icon';
    icon.setAttribute('role', 'button');
    icon.tabIndex = 0;
    mark.append(text, icon);
    marks.set(mark, c);
    setState(mark, pageState ?? (technical || c.format === 'iso' ? 'original' : 'converted'));
    return mark;
  }

  function annotate(root: Node): void {
    const nodes: Text[] = [];
    if (root.nodeType === 3) nodes.push(root as Text);
    else {
      const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    }

    for (const node of nodes) {
      const text = node.data;
      if (!node.isConnected || !/\d/.test(text) || shouldSkip(node)) continue;
      const conversions = findConversions(text, options);
      if (conversions.length === 0) continue;
      const technical = node.parentElement?.closest(TECHNICAL) != null;

      const fragment = doc.createDocumentFragment();
      let pos = 0;
      for (const c of conversions) {
        fragment.append(text.slice(pos, c.index), createMark(c, technical));
        pos = c.index + c.length;
      }
      fragment.append(text.slice(pos));
      node.replaceWith(fragment);
    }
  }

  function closePopover(): void {
    popover?.remove();
    popover = null;
  }

  function openPopover(mark: HTMLElement): void {
    const c = marks.get(mark);
    if (!c) return;
    closePopover();

    const host = doc.createElement('div');
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

    const button = (label: string, action: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        action();
        closePopover();
      });
      box.append(b);
    };
    const converted = mark.dataset.zsState === 'converted';
    button(converted ? 'Show original here' : 'Convert to local time', () =>
      setState(mark, converted ? 'original' : 'converted'),
    );
    button('Convert all times on this page', () => setAll('converted'));
    button('Show all originals on this page', () => setAll('original'));

    shadow.append(box);
    doc.documentElement.append(host);
    popover = host;

    // Place under the icon, kept inside the viewport.
    const anchor = mark.lastElementChild!.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, view.innerWidth - size.width - 8));
    const below = anchor.bottom + 6;
    const top = below + size.height > view.innerHeight - 8 ? Math.max(8, anchor.top - size.height - 6) : below;
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    box.querySelector('button')!.focus();
  }

  function start(): () => void {
    annotate(doc.body);

    const onClick = (event: Event) => {
      const icon = iconFrom(event);
      if (icon) {
        // The time may sit inside a link or button; the icon must not trigger it.
        event.preventDefault();
        event.stopPropagation();
        openPopover(icon.parentElement!);
      } else if (popover && !event.composedPath().includes(popover)) {
        closePopover();
      }
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePopover();
      const icon = iconFrom(event);
      if (icon && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        openPopover(icon.parentElement!);
      }
    };
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKeydown, true);
    view.addEventListener('scroll', closePopover, { passive: true, capture: true });

    // Pages that add content later (single-page apps, streaming logs).
    let pending: Node[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new view.MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) pending.push(n);
      if (timer !== undefined || pending.length === 0) return;
      timer = setTimeout(() => {
        timer = undefined;
        const batch = pending;
        pending = [];
        for (const n of batch) if (n.isConnected) annotate(n);
      }, MUTATION_DELAY);
    });
    observer.observe(doc.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clearTimeout(timer);
      closePopover();
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKeydown, true);
      view.removeEventListener('scroll', closePopover, { capture: true });
    };
  }

  return { annotate, setState, setAll, openPopover, closePopover, start };
}
